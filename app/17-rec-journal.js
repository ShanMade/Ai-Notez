// Durable recording — the journal (IndexedDB, database "notez-rec-journal" v2).
//
// This module is the SINGLE owner of the recording journal database. Older
// builds opened the same database at version 1 with one store, "parts" (one
// row per finished part: the part blob plus its text/status). v2 keeps that
// store untouched and adds:
//
//   parts      (v1, unchanged)  one row per part. key `${noteId}:${index}`.
//   slices                    durably committed capture slices: the ~1 s
//             MediaRecorder timeslices of each part, key
//             `${noteId}:${slot}:${seq padded to 8 digits}` (padded so
//             lexicographic key order equals numeric seq order). A part is
//             rebuilt ONLY from committed slices — never from memory.
//   sessions                    one row per recording session (keyPath
//             noteId): which uid owns the capture, its mime, when capture
//             began and ended, and the notesCursor (the transcript text the
//             machine last wrote, for the user-wins commit rule).
//   jobs                      the durable processing queue (see
//             app/17-rec-jobs.js), keyPath jobId.
//
// Every write resolves ONLY on transaction success (the "commit ack"): a
// slice is durably recorded when its transaction completed, which is what
// makes "audio survives a crash" a structural property instead of a hope.
// The commit-ack semantics are the P0.3a idb-contract result (6/6):
// oncomplete only — onerror/onabort reject, and a stuck transaction is
// rejected after a timeout so the recording can never hang on the journal.

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.NzRecJournal = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DB_NAME = 'notez-rec-journal';
  const DB_VERSION = 2;
  const PARTS = 'parts';
  const SLICES = 'slices';
  const SESSIONS = 'sessions';
  const JOBS = 'jobs';
  const COMMIT_TIMEOUT_MS = 8000;

  let opening = null;

  function db() {
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      if (!root.indexedDB) { opening = null; reject(new Error('IndexedDB is not available')); return; }
      const request = root.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        // v0 → v2 (new device) and v1 → v2 (an older build already wrote
        // part rows). The upgrade transaction creates whatever is missing and
        // never touches existing rows.
        const tx = request.transaction;
        if (!tx.objectStoreNames.contains(PARTS)) tx.objectStore(PARTS, { keyPath: 'key' });
        if (!tx.objectStoreNames.contains(SLICES)) tx.objectStore(SLICES, { keyPath: 'key' });
        if (!tx.objectStoreNames.contains(SESSIONS)) tx.objectStore(SESSIONS, { keyPath: 'noteId' });
        if (!tx.objectStoreNames.contains(JOBS)) tx.objectStore(JOBS, { keyPath: 'jobId' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { opening = null; reject(request.error || new Error('Journal could not be opened')); };
      request.onblocked = () => { /* an old tab still holds v1; the open resolves once it goes */ };
    }).catch(error => { opening = null; throw error; });
    return opening;
  }

  /** Run one unit of work in its own transaction. Resolves with the result of
   *  the last IDB request on tx.oncomplete ONLY; onerror/onabort (and a
   *  timeout) reject. `work(store)` may return an IDBRequest or a Promise of
   *  one — chained requests stay inside the transaction. */
  function run(storeName, mode, work) {
    return db().then(database => new Promise((resolve, reject) => {
      let settled = false;
      const finish = (fn, value) => { if (!settled) { settled = true; clearTimeout(timer); fn(value); } };
      const timer = setTimeout(() => finish(reject, new Error('Journal transaction timed out')), COMMIT_TIMEOUT_MS);
      const tx = database.transaction(storeName, mode);
      tx.oncomplete = () => finish(resolve, lastResult.request ? lastResult.request.result : lastResult.value);
      tx.onerror = () => finish(reject, tx.error || new Error('Journal transaction failed'));
      tx.onabort = () => finish(reject, tx.error || new Error('Journal transaction aborted'));
      let lastResult = { request: null, value: undefined };
      try {
        const result = work(tx.objectStore(storeName));
        if (result && typeof result.then === 'function') {
          result.then(
            value => { lastResult = { request: null, value }; },
            error => finish(reject, error)
          );
        } else if (result) {
          lastResult = { request: result, value: undefined };
        }
      } catch (error) {
        finish(reject, error);
      }
    }));
  }

  // ---- parts (v1 store, unchanged rows) ---------------------------------

  const partKey = (noteId, index) => `${noteId}:${index}`;

  /** Write (or update) a part row. A null blob NEVER erases a blob that is
   *  already stored — once a part's audio is journaled it stays (retention),
   *  so a later "transcribed" save with no blob keeps the audio. */
  function savePart(record) {
    return run(PARTS, 'readwrite', store => store.get(record.key).then(existing => {
      const merged = Object.assign({}, existing, record);
      if (!merged.blob && existing && existing.blob) merged.blob = existing.blob;
      if (!merged.blob) delete merged.blob;
      return store.put(merged);
    }));
  }

  function getPartRow(noteId, index) {
    return run(PARTS, 'readonly', store => store.get(partKey(noteId, index)));
  }

  function getAllParts() {
    return run(PARTS, 'readonly', store => store.getAll());
  }

  /** Remove every part row of a session. Only the explicit discard path
   *  calls this; a normal finish keeps the rows (audio retention). */
  function forgetParts(noteId) {
    return run(PARTS, 'readonly', store => store.getAll()).then(rows => {
      const keys = (rows || []).filter(row => row.noteId === noteId).map(row => row.key);
      if (!keys.length) return 0;
      return run(PARTS, 'readwrite', store => { keys.forEach(key => store.delete(key)); return null; }).then(() => keys.length);
    });
  }

  // ---- slices -------------------------------------------------------------
  // Per-part seq (each part's recorder emits its first ~1 s slice with the
  // EBML header, so a part's slice stream is a self-contained valid file
  // from seq 0).

  const sliceKey = (noteId, slot, seq) => `${noteId}:${slot}:${String(seq).padStart(8, '0')}`;
  const slotPrefix = (noteId, slot) => `${noteId}:${slot}:`;

  /** Durable commit of one capture slice. Resolves only after the IDB
   *  transaction completed (commit ack). */
  function commitSlice({ noteId, slot, seq, blob, mime, at }) {
    if (!noteId || slot == null || seq == null || !blob) return Promise.resolve(false);
    return run(SLICES, 'readwrite', store => store.put({
      key: sliceKey(noteId, slot, seq), noteId, slot, seq, mime: mime || '', at: at || 0, blob,
    })).then(() => true);
  }

  /** Drop the slices of one part. Only called after the part's v1 row has
   *  durably received the whole part blob (the caller verifies that first):
   *  a completed part keeps its audio in the part row, and the slices exist
   *  to recover parts that never completed. */
  function discardSlices(noteId, slot) {
    const prefix = slotPrefix(noteId, slot);
    return run(SLICES, 'readonly', store => store.getAllKeys(root.indexedDB.keyRange.bound(prefix + '\u0000', prefix + '\uffff')))
      .then(keys => {
        const sliceKeys = (keys || []).filter(key => String(key).startsWith(prefix));
        if (!sliceKeys.length) return 0;
        return run(SLICES, 'readwrite', store => { sliceKeys.forEach(key => store.delete(key)); return null; }).then(() => sliceKeys.length);
      });
  }

  /** All committed slices of one part, in seq order (the key order). */
  function slicesForSlot(noteId, slot) {
    const prefix = slotPrefix(noteId, slot);
    return run(SLICES, 'readonly', store => store.getAll(root.indexedDB.keyRange.bound(prefix + '\u0000', prefix + '\uffff')))
      .then(rows => (rows || [])
        .filter(row => row.noteId === noteId && row.slot === slot)
        .sort((a, b) => a.seq - b.seq));
  }

  /** Which parts have committed slices for this session (ascending). */
  function listSlots(noteId) {
    const prefix = noteId + ':';
    return run(SLICES, 'readonly', store => store.getAllKeys(root.indexedDB.keyRange.bound(prefix + '\u0000', prefix + '\uffff')))
      .then(keys => {
        const slots = new Set((keys || [])
          .filter(key => String(key).startsWith(prefix))
          .map(key => Number(String(key).split(':')[1])));
        return [...slots].filter(slot => Number.isFinite(slot) && slot >= 0).sort((a, b) => a - b);
      });
  }

  function sliceExtent(noteId, slot) {
    return slicesForSlot(noteId, slot).then(rows => {
      if (!rows.length) return null;
      return { first: rows[0].seq, last: rows[rows.length - 1].seq, count: rows.length, bytes: rows.reduce((sum, row) => sum + (row.blob?.size || 0), 0) };
    });
  }

  // ---- sessions -------------------------------------------------------------

  function getSession(noteId) {
    return run(SESSIONS, 'readonly', store => store.get(noteId));
  }

  function listSessions() {
    return run(SESSIONS, 'readonly', store => store.getAll());
  }

  /** Merge a patch into the session row (creating it when absent). The uid is
   *  fixed when the session opens: a patch that would change it is dropped
   *  (a session never moves to a different account). */
  function updateSession(noteId, patch) {
    if (!noteId) return Promise.resolve(null);
    return run(SESSIONS, 'readwrite', store => store.get(noteId).then(existing => {
      const row = Object.assign({ noteId, uid: '', capture: '', startedAt: 0, finalizedAt: 0, deletedAt: 0, notesCursor: '' }, existing, patch);
      if (existing?.uid && patch && 'uid' in patch && patch.uid !== existing.uid) {
        row.uid = existing.uid;
        root.console?.warn?.('Journal: session uid is fixed; uid rebind dropped for', noteId);
      }
      row.updatedAt = Date.now();
      return store.put(row);
    }));
  }

  function removeSession(noteId) {
    return run(SESSIONS, 'readwrite', store => store.delete(noteId));
  }

  // ---- jobs -------------------------------------------------------------------

  function putJob(job) {
    if (!job?.jobId) return Promise.resolve(null);
    const row = Object.assign({
      jobId: job.jobId, dedupKey: job.dedupKey || '', type: job.type || '',
      ref: job.ref || {}, state: 'queued', attempts: 0, nextAttemptAt: 0,
      lease: null, uid: job.uid || '', payload: job.payload || {}, error: null, result: null,
      createdAt: job.createdAt || Date.now(), updatedAt: Date.now(),
    }, job);
    return run(JOBS, 'readwrite', store => store.put(row)).then(() => row);
  }

  function getJob(jobId) {
    return run(JOBS, 'readonly', store => store.get(jobId));
  }

  function listJobs(filter) {
    return run(JOBS, 'readonly', store => store.getAll()).then(rows => {
      rows = rows || [];
      return filter ? rows.filter(filter) : rows;
    });
  }

  function updateJob(jobId, patch) {
    return run(JOBS, 'readwrite', store => store.get(jobId).then(existing => {
      if (!existing) return null;
      const row = Object.assign({}, existing, patch, { jobId, updatedAt: Date.now() });
      return store.put(row).then(() => row);
    }));
  }

  function deleteJob(jobId) {
    return run(JOBS, 'readwrite', store => store.delete(jobId));
  }

  /** Remove every queued job of a session (explicit discard). */
  function cancelJobsFor(noteId) {
    return listJobs(job => (job.ref?.noteId === noteId) && job.state !== 'done').then(jobs => {
      if (!jobs.length) return 0;
      return run(JOBS, 'readwrite', store => {
        jobs.forEach(job => store.delete(job.jobId));
        return null;
      }).then(() => jobs.length);
    });
  }

  // ---- session teardown (explicit discard) -------------------------------------

  /** Drop every local trace of a session: parts, slices, session row and
   *  its queued jobs. The caller (06, explicit discard only) writes the cloud
   *  tombstone before this runs, so no device can resurrect the session. */
  function forgetSession(noteId) {
    if (!noteId) return Promise.resolve({ parts: 0, slices: 0, jobs: 0 });
    return forgetParts(noteId).then(partCount =>
      run(SLICES, 'readonly', store => store.getAllKeys(root.indexedDB.keyRange.bound(noteId + ':\u0000', noteId + ':\uffff'))).then(keys => {
        const sliceKeys = (keys || []).filter(key => String(key).startsWith(noteId + ':'));
        const delSlices = sliceKeys.length
          ? run(SLICES, 'readwrite', store => { sliceKeys.forEach(key => store.delete(key)); return null; }).then(() => sliceKeys.length)
          : Promise.resolve(0);
        return Promise.all([delSlices, cancelJobsFor(noteId), removeSession(noteId)])
          .then(([sliceCount, jobCount]) => ({ parts: partCount, slices: sliceCount, jobs: jobCount }));
      })
    );
  }

  // ---- part rebuild ---------------------------------------------------------------

  async function concatSlices(rows) {
    let total = 0;
    for (const row of rows) total += row.blob.size;
    const out = new Uint8Array(total);
    let offset = 0;
    for (const row of rows) {
      const bytes = new Uint8Array(await row.blob.arrayBuffer());
      out.set(bytes, offset);
      offset += bytes.length;
    }
    return out;
  }

  /** Rebuild one part's audio. Order of preference:
   *  1. the v1 part row, when it holds the finished part blob (the normal
   *     case — completed parts are stored whole);
   *  2. the committed slices, joined and run through the EBML recovery
   *     (strict, then salvage). The result is a byte prefix of the captured
   *     stream: every complete second that made it to disk, nothing invented,
   *     and the incomplete final region discarded.
   *  3. for WAV parts, the slice WAVs are stripped/validated and one correct
   *     header is written (never a concatenation of WAV files).
   *  Returns {blob, mime, source, report} or null — null means the audio
   *  cannot be recovered and stays lost, which is reported, not hidden. */
  async function rebuildPart(noteId, slot) {
    const row = await getPartRow(noteId, slot).catch(() => null);
    if (row?.blob) return { blob: row.blob, mime: row.blob.type || 'audio/webm', source: 'part-row', report: null };

    const rows = await slicesForSlot(noteId, slot).catch(() => []);
    if (!rows.length) return null;

    const mime = (rows[0].mime || 'audio/webm').split(';')[0];
    if (mime === 'audio/wav' || mime === 'audio/x-wav' || mime === 'audio/wave') {
      if (typeof root.NzRecWav !== 'object') return null;
      const wavs = [];
      for (const row of rows) wavs.push(new Uint8Array(await row.blob.arrayBuffer()));
      const built = root.NzRecWav.reconstructWav(wavs);
      if (!built.ok) return { blob: null, mime, source: 'slices-wav-failed', report: built };
      return { blob: new Blob([built.wav], { type: 'audio/wav' }), mime: 'audio/wav', source: 'slices-wav', report: built };
    }

    if (typeof root.NzRecRecovery !== 'object') return null;
    const joined = await concatSlices(rows);
    let report = root.NzRecRecovery.recover(joined, { mode: 'strict' });
    if (!report.ok) {
      const salvage = root.NzRecRecovery.recover(joined, { mode: 'salvage' });
      if (salvage.ok || salvage.cut > 0) report = salvage;
    }
    if (!report.ok || report.cut <= 0) return { blob: null, mime, source: 'slices-unrecoverable', report };
    const bytes = report.bytes;
    return { blob: new Blob([bytes], { type: mime }), mime, source: `slices-${report.mode}`, report };
  }

  return {
    DB_NAME, DB_VERSION, PARTS, SLICES, SESSIONS, JOBS,
    db, run,
    partKey, savePart, getPartRow, getAllParts, forgetParts,
    sliceKey, commitSlice, discardSlices, slicesForSlot, listSlots, sliceExtent,
    getSession, listSessions, updateSession, removeSession,
    putJob, getJob, listJobs, updateJob, deleteJob, cancelJobsFor,
    forgetSession, rebuildPart,
  };
});
