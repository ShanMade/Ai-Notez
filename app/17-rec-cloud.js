// Durable recording — the cloud workspace copy.
//
// Responsibilities and limits (Phase 0.2/0.3 corrections, verbatim in spirit):
//   - Firebase is the CLOUD COPY, not the recording engine. Local capture and
//     the local journal never depend on anything in this module; every
//     function here resolves to a 'local-only' outcome instead of failing
//     when the cloud is unavailable, and the UI is told the truth.
//   - A signed-in workspace is a precondition. Guests are never claimed
//     backed up: every call no-ops to 'local-only'.
//   - Realtime Database is the index and the default audio payload (the same
//     base64-chunk layout the existing attachment uploads use — meta written
//     LAST, so a half-finished upload is never a complete file). Firebase
//     Storage is used for audio only when the deployment explicitly says it
//     is configured: the existing unauthenticated GET /v1/firebase-config
//     endpoint gains a `storageEnabled` field (backend env
//     FIREBASE_STORAGE_ENABLED, default false). Nothing here changes the
//     Firebase project, the bucket, the rules or the billing — enabling
//     Storage is an operator action, documented in docs/durable-recording.md.
//   - Concurrency: one capture at a time per (user, note). The claim is an
//     atomic runTransaction on users/{uid}/rec/{noteId}/claim with a 30 s
//     expiry, a 10 s heartbeat while owned, and an onDisconnect release, so a
//     crashed tab lets go of the claim without a live tab that reclaims it.
//     A conflict NEVER overwrites: the losing device keeps recording locally
//     and simply does not write the cloud copy until the claim is free.
//   - Deletion: explicit only. discardSession() removes the audio, the
//     session, the claim and the index, and writes the tombstone
//     users/{uid}/rec-tombs/{noteId} LAST, so no other device can resurrect
//     the session. A tombstone newer than a session start makes writes to
//     that session refuse (loudly logged), per the app's existing tombstone
//     pattern for notes.

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.NzRecCloud = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Global object for property-style references: self/window in the browser
  // (platform globals, the window.NzRec* modules and top-level FUNCTION
  // declarations ARE properties of it), globalThis in Node so every access
  // degrades to undefined instead of throwing.
  // IMPORTANT: app-level `let`/`const` globals (e.g. currentSession in 01,
  // aiBackendBase in 04, firebaseConfig in 01) are NOT properties of the
  // global object — they live in the global lexical environment. Those are
  // referenced by bare name with a typeof guard below, never via root.
  const root = (typeof self !== 'undefined' && self) || (typeof window !== 'undefined' && window) || (typeof globalThis !== 'undefined' && globalThis) || {};

  const CLAIM_TTL_MS = 30 * 1000;
  const CLAIM_HEARTBEAT_MS = 10 * 1000;
  const CHUNK_BYTES = 510000;   // multiple of 3 so base64 chunks join cleanly
  const CHUNK_PARALLEL = 4;

  const state = {
    configPromise: null,
    storageEnabled: false,
    storageBucket: '',
    storageModule: null,
    tabId: Math.random().toString(36).slice(2, 10),
    claimTimer: 0,
    claiming: null,
    initialized: false,
  };

  const log = (...args) => root.console?.warn?.('[rec-cloud]', ...args);

  function uidOf() {
    // `currentSession` is a top-level `let` in 01 — a global-lexical binding,
    // not a property of the global object — so it is referenced by name. The
    // typeof guard keeps this from throwing in non-browser environments where
    // it is undeclared (it simply means "no signed-in session" there).
    return (typeof currentSession !== 'undefined' ? currentSession?.user?.uid : '') || '';
  }

  async function sdk() {
    if (typeof root.ensureFirebase !== 'function') throw new Error('Firebase not available yet');
    return root.ensureFirebase();
  }

  // ---- configuration ------------------------------------------------------

  /** Load the deployment's answer to "is Storage configured?". Uses the
   *  existing unauthenticated endpoint; a missing endpoint or field means
   *  Storage stays OFF (the RTDB fallback is the default, not a degraded
   *  mode). */
  function loadConfig() {
    if (state.configPromise) return state.configPromise;
    state.configPromise = (async () => {
      // `aiBackendBase` is a top-level `const` in 04 (global-lexical, not a
      // global-object property) — referenced by name, typeof-guarded.
      const base = (typeof aiBackendBase === 'function' ? (aiBackendBase() || '') : '').trim();
      if (!base) return;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        const response = await fetch(`${base}/v1/firebase-config`, { signal: controller.signal });
        clearTimeout(timer);
        if (!response.ok) return;
        const cfg = await response.json();
        state.storageEnabled = !!cfg?.storageEnabled;
        state.storageBucket = String(cfg?.storageBucket || '');
      } catch { /* offline or backend down: Storage stays off */ }
    })();
    return state.configPromise;
  }

  /** init() is called once by the app. It does not block anything: config
   *  loads lazily, and every operation is safe before it resolves. */
  function init() {
    if (state.initialized) return;
    state.initialized = true;
    void loadConfig();
  }

  // ---- storage module (only when enabled) -----------------------------------

  async function storageReady() {
    if (!state.storageEnabled || !state.storageBucket) return null;
    if (!state.storageModule) {
      const [appModule, storageModule] = await Promise.all([
        import('https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js'),
        import('https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js'),
      ]);
      // Find the SAME app the rest of the app initialised (01 matches by the
      // whole options object; the guest app is excluded by name).
      // `firebaseConfig` is a top-level `const` in 01 (global-lexical, not a
      // global-object property) — referenced by name, typeof-guarded. An empty
      // match set would wrongly accept the first app, so require the config.
      const fc = (typeof firebaseConfig !== 'undefined' ? firebaseConfig : null);
      const app = fc && appModule.getApps().find(candidate =>
        candidate.name !== 'notez-ai-guest' &&
        Object.entries(fc).every(([key, value]) => candidate.options?.[key] === value)
      );
      if (!app) { log('Storage enabled but the Firebase app was not found.'); return null; }
      state.storageModule = { appModule, storageModule, storage: storageModule.getStorage(app, { bucket: state.storageBucket }) };
    }
    return state.storageModule;
  }

  // ---- tombstones ---------------------------------------------------------------

  async function isTombstoned(noteId) {
    const uid = uidOf();
    if (!uid) return false;
    try {
      const s = await sdk();
      const snap = await s.dbGet(s.dbRef(s.database, `users/${uid}/rec-tombs/${noteId}`));
      return snap.exists();
    } catch { return false; }
  }

  // ---- claim protocol ------------------------------------------------------------

  function stopHeartbeat() {
    if (state.claimTimer) { clearInterval(state.claimTimer); state.claimTimer = 0; }
  }

  /** Acquire the capture claim for a session. Returns 'own' | 'conflict' |
   *  false (local-only: no signed-in workspace, no Firebase, or the claim
   *  could not be touched). */
  async function acquireClaim(noteId) {
    const uid = uidOf();
    if (!uid) return false;
    stopHeartbeat();
    try {
      const s = await sdk();
      if (await isTombstoned(noteId)) { log(`claim refused: ${noteId} is tombstoned`); return false; }
      const claimRef = s.dbRef(s.database, `users/${uid}/rec/${noteId}/claim`);
      // Pre-check for the honest "another device" message; the transaction
      // below re-checks against the fresh value, so a race still resolves to
      // conflict, never to an overwrite.
      const pre = await s.dbGet(claimRef);
      if (pre.exists() && pre.val()?.uid !== uid && (pre.val()?.expiresAt || 0) > Date.now()) return 'conflict';
      try {
        await s.dbTransaction(claimRef, current => {
          if (current && current.uid !== uid && (current.expiresAt || 0) > Date.now()) return undefined; // abort
          return { uid, tab: state.tabId, claimedAt: Date.now(), expiresAt: Date.now() + CLAIM_TTL_MS };
        });
      } catch {
        return 'conflict';   // the updater aborted on a live foreign claim
      }
      try { s.onDisconnect(claimRef).remove().catch(() => {}); } catch { /* older SDK */ }
      state.claiming = noteId;
      state.claimTimer = setInterval(() => renewClaim(noteId).catch(() => {}), CLAIM_HEARTBEAT_MS);
      return 'own';
    } catch (error) {
      log('claim:', error);
      return false;
    }
  }

  async function renewClaim(noteId) {
    const uid = uidOf();
    if (!uid || state.claiming !== noteId) return;
    try {
      const s = await sdk();
      const claimRef = s.dbRef(s.database, `users/${uid}/rec/${noteId}/claim`);
      await s.dbTransaction(claimRef, current => {
        if (!current || current.uid !== uid) return;      // lost it: do not write
        return Object.assign({}, current, { expiresAt: Date.now() + CLAIM_TTL_MS });
      });
    } catch { /* the next heartbeat or the TTL handles it */ }
  }

  /** Release the claim (session stopped or discarded). */
  async function releaseClaim(noteId) {
    const uid = uidOf();
    stopHeartbeat();
    state.claiming = null;
    if (!uid) return false;
    try {
      const s = await sdk();
      const claimRef = s.dbRef(s.database, `users/${uid}/rec/${noteId}/claim`);
      const snap = await s.dbGet(claimRef);
      if (snap.exists() && snap.val()?.uid === uid) {
        try { s.onDisconnect(claimRef).cancel(); } catch { /* older SDK */ }
        await s.dbRemove(claimRef);
        return true;
      }
      return false;
    } catch (error) {
      log('claim release:', error);
      return false;
    }
  }

  /** Who (if anyone) holds the claim right now — for the UI to say "open on
   *  another device". */
  async function claimStatus(noteId) {
    const uid = uidOf();
    if (!uid) return null;
    try {
      const s = await sdk();
      const snap = await s.dbGet(s.dbRef(s.database, `users/${uid}/rec/${noteId}/claim`));
      if (!snap.exists()) return null;
      const value = snap.val();
      if ((value.expiresAt || 0) < Date.now()) return null;
      return { uid: value.uid, own: value.uid === uid, at: value.claimedAt || 0 };
    } catch { return null; }
  }

  // ---- session metadata ---------------------------------------------------------------

  /** Persist the session row to the cloud workspace (read-modify-write: the
   *  claim lives beside it and must never be clobbered by a plain set). */
  async function syncSession(noteId, patch) {
    const uid = uidOf();
    if (!uid) return { mode: 'local-only' };
    try {
      const s = await sdk();
      if (await isTombstoned(noteId)) { log(`session sync refused: ${noteId} is tombstoned`); return { mode: 'tombstoned' }; }
      const path = `users/${uid}/rec/${noteId}/session`;
      const snap = await s.dbGet(s.dbRef(s.database, path));
      await s.dbSet(s.dbRef(s.database, path), Object.assign({}, snap.exists() ? snap.val() : {}, patch, { updatedAt: Date.now() }));
      return { mode: 'cloud' };
    } catch (error) {
      log('session sync:', error);
      return { mode: 'local-only' };
    }
  }

  // ---- audio upload / download -----------------------------------------------------------

  async function sha256Hex(blob) {
    try {
      if (!root.crypto?.subtle) return '';
      const digest = await root.crypto.subtle.digest('SHA-256', new Uint8Array(await blob.arrayBuffer()));
      return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
    } catch { return ''; }
  }

  /** Upload one part's audio to the cloud workspace. Idempotent: the meta
   *  carries a sha256, and a matching meta means "already uploaded" — a retry
   *  (job crash, reload) never re-uploads, and a different sha (the part was
   *  recovered with different bytes) replaces the old copy under the same
   *  stable key, so a part is never written twice under two keys. */
  async function putPartAudio(noteId, slot, blob, { mime, sha }) {
    const uid = uidOf();
    if (!uid) return { mode: 'local-only' };
    const s = await sdk().catch(() => null);
    if (!s) return { mode: 'local-only' };
    if (await isTombstoned(noteId)) { log(`audio upload refused: ${noteId} is tombstoned`); return { mode: 'tombstoned' }; }
    // Live-claim guard: another device is capturing this note right now, so
    // its part numbering is live too. Refuse (loudly) instead of risking an
    // overwrite; the job retries, and the upload goes through once the other
    // device lets go of the claim.
    const claim = await claimStatus(noteId);
    if (claim && !claim.own) throw new Error(`upload deferred: ${noteId} is being captured by another device`);
    await loadConfig();
    const base = `users/${uid}/rec/${noteId}/audio/${slot}`;
    const metaRef = s.dbRef(s.database, `${base}/meta`);
    const metaSnap = await s.dbGet(metaRef);
    if (metaSnap.exists() && metaSnap.val()?.sha && sha && metaSnap.val().sha === sha) {
      return { mode: state.storageEnabled ? 'storage' : 'rtdb', uploaded: false };
    }
    try {
      if (state.storageEnabled) {
        const storage = await storageReady();
        if (storage) {
          const ext = mime === 'audio/wav' ? 'wav' : 'webm';
          const path = `users/${uid}/rec/${noteId}/audio/p${slot}.${ext}`;
          // Firebase Storage v10 uploadBytes handles chunking/resume internally.
          await storage.storageModule.uploadBytes(storage.storageModule.ref(storage.storage, path), blob);
          await s.dbSet(metaRef, { sha: sha || '', mime: mime || blob.type, size: blob.size, at: Date.now(), backend: 'storage', path });
          await s.dbSet(s.dbRef(s.database, `users/${uid}/rec/${noteId}/audioIndex/${slot}`), { sha: sha || '', mime: mime || blob.type, size: blob.size, at: Date.now(), backend: 'storage', path });
          return { mode: 'storage', uploaded: true };
        }
        // Storage enabled but the module/app failed: fall through to RTDB so
        // the copy still happens, and say so in the result.
      }
      // RTDB chunk layout (the app's existing attachment convention): small
      // base64 chunks, meta written LAST.
      const count = Math.max(1, Math.ceil(blob.size / CHUNK_BYTES));
      for (let start = 0; start < count; start += CHUNK_PARALLEL) {
        const batch = [];
        for (let i = start; i < Math.min(count, start + CHUNK_PARALLEL); i++) {
          batch.push((async () => {
            const data = await blobToBase64Local(blob.slice(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES));
            await s.dbSet(s.dbRef(s.database, `${base}/c/${i}`), data);
          })());
        }
        await Promise.all(batch);
      }
      await s.dbSet(metaRef, { sha: sha || '', mime: mime || blob.type, size: blob.size, chunks: count, at: Date.now(), backend: 'rtdb' });
      await s.dbSet(s.dbRef(s.database, `users/${uid}/rec/${noteId}/audioIndex/${slot}`), { sha: sha || '', mime: mime || blob.type, size: blob.size, at: Date.now(), backend: 'rtdb' });
      return { mode: 'rtdb', uploaded: true };
    } catch (error) {
      log('audio upload:', error);
      return { mode: 'failed', error: String(error?.message || error) };
    }
  }

  function blobToBase64Local(blob) {
    return new Promise((resolve, reject) => {
      const reader = new root.FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
      reader.onerror = () => reject(reader.error || new Error('Could not read slice'));
      reader.readAsDataURL(blob);
    });
  }

  /** Read a part's audio back from the cloud (multi-device: another device's
   *  finished session). Returns a Blob or null. */
  async function getPartAudio(noteId, slot) {
    const uid = uidOf();
    if (!uid) return null;
    try {
      const s = await sdk();
      const metaSnap = await s.dbGet(s.dbRef(s.database, `users/${uid}/rec/${noteId}/audio/${slot}/meta`));
      if (!metaSnap.exists()) return null;
      const meta = metaSnap.val();
      if (meta.backend === 'storage' && meta.path) {
        const storage = await storageReady();
        if (!storage) return null;
        // firebase-storage v10: getStream(reference) → File (a Blob).
        const file = await storage.storageModule.getStream(storage.storage.ref(meta.path));
        return file;
      }
      const parts = new Array(meta.chunks);
      for (let start = 0; start < meta.chunks; start += CHUNK_PARALLEL) {
        const batch = [];
        for (let i = start; i < Math.min(meta.chunks, start + CHUNK_PARALLEL); i++) {
          batch.push((async () => {
            const snap = await s.dbGet(s.dbRef(s.database, `users/${uid}/rec/${noteId}/audio/${slot}/c/${i}`));
            if (!snap.exists()) throw new Error('Audio chunk missing');
            parts[i] = base64ToBlobLocal(snap.val(), meta.type || meta.mime);
          })());
        }
        await Promise.all(batch);
      }
      return new Blob(parts, { type: meta.mime || 'audio/webm' });
    } catch (error) {
      log('audio download:', error);
      return null;
    }
  }

  function base64ToBlobLocal(b64, type) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: type || 'application/octet-stream' });
  }

  // ---- explicit discard ---------------------------------------------------------------

  /** Remove the session's cloud copy. The tombstone is written LAST, after
   *  everything else is gone, so other devices (which check the tombstone
   *  before writing) cannot resurrect a discarded session. */
  async function discardSession(noteId) {
    const uid = uidOf();
    if (!uid) return { mode: 'local-only' };
    try {
      const s = await sdk();
      await releaseClaim(noteId);
      // Storage objects first (they have no RTDB-style subtree delete).
      if (state.storageEnabled) {
        const storage = await storageReady();
        if (storage) {
          const indexSnap = await s.dbGet(s.dbRef(s.database, `users/${uid}/rec/${noteId}/audioIndex`));
          if (indexSnap.exists()) {
            for (const value of Object.values(indexSnap.val() || {})) {
              if (value?.backend === 'storage' && value.path) {
                try { await storage.storageModule.deleteObject(storage.storageModule.ref(storage.storage, value.path)); } catch { /* already gone */ }
              }
            }
          }
        }
      }
      await s.dbRemove(s.dbRef(s.database, `users/${uid}/rec/${noteId}`));
      await s.dbSet(s.dbRef(s.database, `users/${uid}/rec-tombs/${noteId}`), { at: Date.now(), uid });
      return { mode: 'cloud' };
    } catch (error) {
      log('discard:', error);
      return { mode: 'failed', error: String(error?.message || error) };
    }
  }

  /** One line for the UI: where this session's audio actually lives. */
  async function status(noteId) {
    const uid = uidOf();
    if (!uid) return { mode: 'local-only', label: 'Local device only' };
    await loadConfig();
    try {
      const s = await sdk();
      const indexSnap = await s.dbGet(s.dbRef(s.database, `users/${uid}/rec/${noteId}/audioIndex`));
      const parts = indexSnap.exists() ? Object.values(indexSnap.val() || {}) : [];
      if (await isTombstoned(noteId)) return { mode: 'tombstoned', label: 'Deleted', parts: 0 };
      if (!parts.length) return { mode: 'cloud', label: state.storageEnabled ? 'Cloud copy: pending' : 'Cloud copy: pending', parts: 0 };
      return { mode: state.storageEnabled ? 'storage' : 'rtdb', label: state.storageEnabled ? 'Cloud copy (Storage)' : 'Cloud copy (Realtime DB)', parts: parts.length };
    } catch {
      return { mode: 'local-only', label: 'Local device only (cloud unreachable)' };
    }
  }

  return {
    CLAIM_TTL_MS, init, loadConfig,
    acquireClaim, releaseClaim, claimStatus, syncSession,
    putPartAudio, getPartAudio, sha256Hex, discardSession, status,
    _state: state,
  };
});
