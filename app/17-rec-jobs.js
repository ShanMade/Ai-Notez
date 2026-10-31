// Durable recording — the processing job queue.
//
// A job is a row in the journal's "jobs" store (app/17-rec-journal.js), so it
// survives a refresh, a closed tab and a crash — the same object that holds
// the audio. This module owns the loop that turns queued jobs into work:
//
//   - one runner at a time, across tabs: the loop runs inside a Web Lock
//     ("notez-rec-jobs"), so two tabs never claim the same job;
//   - safe claiming: a claim is a state change with a 90 s lease. A job whose
//     lease expires without completion (crash, killed tab) is put back in the
//     queue; a lease that is still live is never stolen;
//   - retries with backoff: min(30 min, 30 s · 2^attempts). A job is never
//     given up silently — the 30 s cap keeps a permanently failing route from
//     hammering the network while the part stays held;
//   - idempotency by dedupKey: enqueueing the same logical work twice
//     (e.g. a restore that re-queues a part whose job already exists) returns
//     the existing job instead of creating a duplicate;
//   - auth-aware (R1): when the sign-in goes away, jobs park in
//     "awaiting-auth" instead of burning attempts or writing to a workspace
//     they can no longer reach; they resume when the user is back.
//
// Handler contract (registered per type with addHandler):
//   - resolve with a value            → the job is done (value stored as result);
//   - resolve with {skip, reason}     → done without retry (terminal);
//   - resolve with {defer, reason}    → re-queued in DEFER_MS, attempts unchanged;
//   - reject / throw                  → attempts + 1, re-queued with backoff.

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') { window.NzRecJobs = api; root.nzRecAuthLost = api.markAuthLost; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LOCK_NAME = 'notez-rec-jobs';
  const LEASE_MS = 90 * 1000;
  const TICK_MS = 5 * 1000;
  const DEFER_MS = 30 * 1000;
  const backoff = attempts => Math.min(30 * 60 * 1000, 30 * 1000 * 2 ** Math.max(0, attempts));
  const instance = 'tab-' + Math.random().toString(36).slice(2, 10);

  const handlers = Object.create(null);
  // Returns the signed-in cloud uid, or '' when there is none (demo
  // workspace, signed out, Firebase not up). The queue only runs for a
  // concrete uid, and never claims a job that was created for a different
  // one (an account switch must not process another account's work).
  let onUid = () => '';
  let started = false;
  let busy = false;

  function addHandler(type, fn) { handlers[type] = fn; }

  /** Park every non-done job when the sign-in goes away (R1). Idempotent and
   *  safe to call from any auth-exit path. The audio and session rows are
   *  untouched — only the queue waits. */
  function markAuthLost() {
    void (async () => {
      const J = root.NzRecJournal;
      if (!J) return;
      const now = Date.now();
      const jobs = await J.listJobs().catch(() => []);
      for (const job of jobs) {
        if (job.state !== 'done') await J.updateJob(job.jobId, { state: 'awaiting-auth', updatedAt: now }).catch(() => {});
      }
    })();
  }

  /** Recover jobs a previous incarnation of this or another tab left in
   *  "running": the lease is the only evidence of a live worker, so only an
   *  EXPIRED lease (or a missing lease) is recovered. A live lease is left
   *  alone — worst case a crash delays a job by one lease (90 s). */
  async function recoverOrphans(now) {
    const J = root.NzRecJournal;
    const jobs = await J.listJobs(job => job.state === 'running').catch(() => []);
    for (const job of jobs) {
      const until = job.lease?.until || 0;
      if (until > now) continue;
      await J.updateJob(job.jobId, {
        state: 'queued', lease: null, attempts: job.attempts,
        nextAttemptAt: now + backoff(job.attempts),
        error: 'lease expired — recovered', updatedAt: now,
      }).catch(() => {});
    }
  }

  async function processOnce() {
    const J = root.NzRecJournal;
    if (!J) return;
    const now = Date.now();
    const uid = onUid();
    await recoverOrphans(now);

    const jobs = await J.listJobs().catch(() => []);
    for (const job of jobs) {
      if (job.state === 'done') continue;
      // A job created for another account is left exactly where it is: the
      // sign-out parked it, and a different uid coming back must not run it.
      if (job.uid && uid && job.uid !== uid) continue;
      if (!uid && job.state !== 'awaiting-auth') {
        await J.updateJob(job.jobId, { state: 'awaiting-auth', updatedAt: Date.now() }).catch(() => {});
      } else if (uid && job.state === 'awaiting-auth') {
        await J.updateJob(job.jobId, { state: 'queued', nextAttemptAt: Date.now(), lease: null, updatedAt: Date.now() }).catch(() => {});
      }
    }
    if (!uid) return;

    const due = jobs
      .filter(job => job.state === 'queued' && (job.nextAttemptAt || 0) <= now && (!job.uid || job.uid === uid))
      .sort((a, b) => (a.createdAt - b.createdAt) || (a.attempts - b.attempts));

    for (const job of due) {
      if (job.type === 'rec-transcribe' && !root.navigator?.onLine) continue;   // stays queued, no attempt spent
      const handler = handlers[job.type];
      if (!handler) {
        await J.updateJob(job.jobId, {
          state: 'queued', attempts: job.attempts + 1, nextAttemptAt: Date.now() + backoff(job.attempts),
          error: `no handler registered for "${job.type}"`, updatedAt: Date.now(),
        }).catch(() => {});
        continue;
      }
      // Claim: state → running with this tab's owner and a 90 s lease. The
      // Web Lock guarantees no other tab is mid-claim, so the read-update is
      // safe.
      const claimed = await J.updateJob(job.jobId, {
        state: 'running', lease: { owner: instance, until: Date.now() + LEASE_MS }, updatedAt: Date.now(),
      }).catch(() => null);
      if (!claimed) continue;
      try {
        const outcome = await handler(job);
        if (outcome && outcome.defer) {
          await J.updateJob(job.jobId, {
            state: 'queued', lease: null, attempts: job.attempts,
            nextAttemptAt: Date.now() + DEFER_MS, error: `deferred: ${outcome.reason || ''}`, updatedAt: Date.now(),
          }).catch(() => {});
        } else if (outcome && outcome.skip) {
          await J.updateJob(job.jobId, { state: 'done', lease: null, result: { skipped: true, reason: outcome.reason || '' }, error: null, updatedAt: Date.now() }).catch(() => {});
        } else {
          await J.updateJob(job.jobId, { state: 'done', lease: null, result: outcome && outcome.sent ? outcome : (outcome && typeof outcome === 'object' ? outcome : { ok: true }), error: null, updatedAt: Date.now() }).catch(() => {});
        }
      } catch (error) {
        const attempts = job.attempts + 1;
        await J.updateJob(job.jobId, {
          state: 'queued', lease: null, attempts, nextAttemptAt: Date.now() + backoff(attempts),
          error: String(error?.message || error), updatedAt: Date.now(),
        }).catch(() => {});
        root.console?.warn?.(`Job ${job.jobId} (${job.type}) attempt ${attempts} failed:`, error);
      }
    }
  }

  async function tick() {
    if (busy || !root.NzRecJournal) return;
    busy = true;
    try {
      if (root.navigator?.locks?.request) await navigator.locks.request(LOCK_NAME, () => processOnce());
      else await processOnce();
    } catch (error) {
      root.console?.warn?.('Job queue tick failed:', error);
    } finally {
      busy = false;
    }
  }

  /** Start the loop once. `onUid` is polled on every tick; it returns the
   *  signed-in cloud uid ('' when signed out / demo workspace), and the
   *  parked jobs flip back to queued automatically when a uid is back. */
  function init(opts = {}) {
    if (opts.onUid) onUid = opts.onUid;
    if (started || !root.NzRecJournal) return;
    started = true;
    setInterval(tick, TICK_MS);
    setTimeout(tick, 500);
  }

  /** Enqueue one unit of work. When a job with the same dedupKey exists it is
   *  reused: done jobs are left alone, a running/queued job is returned as-is,
   *  and a failed/deferred job is put back to queued with the new payload. */
  async function enqueueJob(spec) {
    const J = root.NzRecJournal;
    if (!J) throw new Error('Journal not available');
    const dedupKey = spec.dedupKey || `${spec.type}:${spec.ref?.noteId || ''}:${spec.ref?.slot ?? ''}`;
    const now = spec.now || Date.now();
    const existing = (await J.listJobs(job => job.dedupKey === dedupKey).catch(() => []))[0];
    if (existing) {
      if (existing.state === 'done') return { job: existing, created: false, duplicate: 'done' };
      if (existing.state === 'running') return { job: existing, created: false, duplicate: 'running' };
      const job = await J.updateJob(existing.jobId, {
        state: 'queued', nextAttemptAt: now, lease: null,
        ref: spec.ref || existing.ref, payload: spec.payload || existing.payload,
        uid: spec.uid != null ? spec.uid : existing.uid, updatedAt: now,
      }).catch(() => null);
      return { job: job || existing, created: false, duplicate: existing.state };
    }
    const job = await J.putJob({
      jobId: `${spec.type.slice(0, 2)}-${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
      dedupKey, type: spec.type, ref: spec.ref || {}, payload: spec.payload || {},
      state: 'queued', attempts: 0, nextAttemptAt: now, lease: null,
      uid: spec.uid || '', createdAt: now,
    });
    return { job, created: true };
  }

  return {
    LOCK_NAME, LEASE_MS, instance,
    init, addHandler, enqueueJob, markAuthLost,
    // exposed for the module's own tests and debugging, not for app code:
    _processOnce: processOnce,
  };
});
