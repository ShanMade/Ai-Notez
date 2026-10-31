// Semantic index queue.
//
// New notes are indexed automatically. A large batch (a folder upload, or a
// big library that has never been indexed) waits until the user chooses what
// to build first; the rest stay queued and can be built at any time.
//
// The core (NzIndex.*) is pure and takes its storage and its send function as
// arguments, so it can be unit-tested in Node. The glue below it wires the
// queue to the app: the settings status, the picker dialog and the triggers.
(function () {
  const KEY = 'nz-sindex-v1';
  const BULK = 10;                  // more pending notes than this: wait for the user to choose
  const GAP_MS = 1300;              // about 45 requests a minute, under the 60/min embedding limit
  const COOL_MS = 65000;            // after a 429, wait for the minute window to reset
  const WAIT_MS = 8000;             // a 404 means the note has not reached the database yet
  const RETRY_MS = 3000;
  const MAX_TRIES = 6;
  const PAUSE_429 = 3;              // this many 429s in a row: the daily quota is likely spent
  const PAUSE_MS = 30 * 60 * 1000;
  const DELAY = { done: GAP_MS, failed: GAP_MS, skip: 0, cool: COOL_MS, wait: WAIT_MS, retry: RETRY_MS, stop: 0 };

  // ---- core -----------------------------------------------------------------
  function emptyState() {
    return { done: {}, priority: [], later: [], tries: {}, failed: [], rateHits: 0, pausedUntil: 0 };
  }
  function loadState(storage) {
    try { return Object.assign(emptyState(), JSON.parse(storage.getItem(KEY) || '{}')); } catch { return emptyState(); }
  }
  function makeStore(storage) {
    return {
      read: () => loadState(storage),
      // Read, change and write in one synchronous step, so concurrent callers cannot overwrite each other.
      update(fn) {
        const state = loadState(storage);
        const result = fn(state);
        try { storage.setItem(KEY, JSON.stringify(state)); } catch { /* storage full: the queue is rebuilt on the next check */ }
        return result;
      },
    };
  }
  const indexable = note => !!note && String(note.body || '').trim().length > 0;
  const queued = state => new Set([...state.priority, ...state.later]);

  // Notes that have text but no index entry yet.
  function pendingIds(notes, state) {
    return notes.filter(note => indexable(note) && state.done[note.id] === undefined).map(note => note.id);
  }

  // Decides where new pending notes go. Small batches build now; large ones wait for the user.
  function plan(state, ids, bulk = BULK) {
    const have = queued(state);
    const fresh = ids.filter(id => state.done[id] === undefined && !have.has(id) && !state.failed.includes(id));
    if (!fresh.length) return { changed: false, count: 0, auto: false };
    if (state.priority.length + fresh.length <= bulk) {
      state.priority.push(...fresh);
      return { changed: true, count: fresh.length, auto: true };
    }
    state.later.push(...fresh);
    return { changed: true, count: fresh.length, auto: false };
  }

  // Moves chosen notes to the front of the queue. Everything else stays waiting.
  function promote(state, ids) {
    const chosen = new Set(ids);
    state.later = state.later.filter(id => !chosen.has(id));
    ids.forEach(id => {
      if (state.done[id] === undefined && !state.priority.includes(id)) state.priority.push(id);
    });
    state.failed = state.failed.filter(id => !chosen.has(id));
    return state;
  }

  function paused(state, now) { return state.pausedUntil > now; }

  // One unit of work. Returns what happened, so the runner knows how long to wait.
  async function step(store, { send, noteFor, now = () => Date.now() }) {
    const id = store.update(state => (paused(state, now()) ? null : state.priority[0] || null));
    if (!id) return 'stop';
    const note = noteFor(id);
    if (!indexable(note)) {
      store.update(state => { state.priority = state.priority.filter(x => x !== id); });
      return 'skip';
    }
    try {
      await send(id);
    } catch (error) {
      const status = Number(error?.status || 0);
      if (status === 429) {
        return store.update(state => {
          state.rateHits += 1;
          if (state.rateHits >= PAUSE_429) { state.pausedUntil = now() + PAUSE_MS; state.rateHits = 0; return 'stop'; }
          return 'cool';
        });
      }
      return store.update(state => {
        state.priority = state.priority.filter(x => x !== id);
        const tries = (state.tries[id] || 0) + 1;
        state.tries[id] = tries;
        if (tries >= MAX_TRIES) {
          delete state.tries[id];
          state.failed = [...state.failed.filter(x => x !== id), id].slice(-50);
          return 'failed';
        }
        state.priority.push(id);   // try again after the others
        return status === 404 ? 'wait' : 'retry';
      });
    }
    return store.update(state => {
      state.done[id] = now();
      state.priority = state.priority.filter(x => x !== id);
      state.failed = state.failed.filter(x => x !== id);
      delete state.tries[id];
      state.rateHits = 0;
      return 'done';
    });
  }

  // Works through the priority queue. Returns when it is empty, paused, or the caller stops it.
  async function run(store, deps) {
    for (;;) {
      if (deps.available && !deps.available()) return;
      const outcome = await step(store, deps);
      if (outcome === 'stop') return;
      await deps.sleep(DELAY[outcome] ?? GAP_MS);
    }
  }

  const NzIndex = { KEY, BULK, MAX_TRIES, DELAY, emptyState, makeStore, indexable, pendingIds, plan, promote, step, run };

  // ---- glue -----------------------------------------------------------------
  // Everything below runs in the browser only; nothing here executes at load time.
  if (typeof window === 'undefined' || typeof document === 'undefined') { window.NzIndex = NzIndex; return; }

  const env = () => window.nzSindexEnv || { notes: () => [], available: () => false, toast: () => {}, showModal: () => {} };
  const esc = (value = '') => String(value).replace(/[&<>\"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const toast = (...args) => env().toast(...args);
  const showModal = (...args) => env().showModal(...args);
  const store = makeStore(window.localStorage);
  let working = false;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const available = () => !!env().available();
  const allNotes = () => env().notes() || [];
  const noteFor = id => allNotes().find(note => note.id === id);
  const deps = () => ({
    send: id => window.notezAiIndexNote(id),
    noteFor,
    sleep,
    available,
  });

  function kick() {
    if (working || !available()) return;
    working = true;
    run(store, deps()).catch(error => console.warn('Semantic index stopped:', error)).finally(() => {
      working = false;
      if (typeof window.nzSindexStatusRefresh === 'function') window.nzSindexStatusRefresh();
    });
  }

  // Called on every render. Cheap when nothing is new.
  window.nzSindexCheck = () => {
    if (!available()) return;
    const ids = pendingIds(allNotes(), store.read());
    if (!ids.length) return;
    const result = store.update(state => plan(state, ids));
    if (!result.changed) return;
    if (result.auto) kick();
    else toast(`${result.count} note${result.count === 1 ? '' : 's'} need a semantic index. Choose what to build first in NotezAi settings.`, 'info', 7000);
  };

  window.nzSindexStatusHtml = () => {
    if (!available()) return '<p class="nzai-sindex">Semantic index needs a signed-in account. Sign in to build it.</p>';
    const state = store.read();
    const notes = allNotes();
    const total = notes.filter(indexable).length;
    const indexed = notes.filter(note => indexable(note) && state.done[note.id] !== undefined).length;
    const parts = [`${indexed} of ${total} notes indexed`];
    if (state.priority.length) parts.push(`building ${state.priority.length}`);
    if (state.later.length) parts.push(`${state.later.length} waiting for your choice`);
    if (state.failed.length) parts.push(`${state.failed.length} failed`);
    if (paused(state, Date.now())) parts.push(`paused until ${new Date(state.pausedUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} (Gemini limit reached)`);
    return `<p class="nzai-sindex" id="nzsi-status">Semantic index: ${esc(parts.join(' · '))}. New notes are indexed automatically; large batches wait for you.</p>`;
  };
  window.nzSindexStatusRefresh = () => {
    const el = document.getElementById('nzsi-status');
    if (el) el.outerHTML = window.nzSindexStatusHtml();
  };
  window.nzSindexHasRest = () => store.read().later.length > 0;

  window.nzSindexBuildRest = () => {
    store.update(state => { state.later.forEach(id => { if (!state.priority.includes(id)) state.priority.push(id); }); state.later = []; });
    window.nzSindexStatusRefresh?.();
    kick();
  };

  window.nzSindexOpenPicker = () => {
    const state = store.read();
    const ids = [...new Set([...state.priority, ...state.later, ...state.failed])];
    const rows = ids.map(id => noteFor(id)).filter(Boolean).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    if (!rows.length) { toast('Every note with text is already indexed.', 'success'); return; }
    const picked = new Set(rows.slice(0, BULK).map(note => note.id));
    const list = rows.map(note => {
      const status = state.failed.includes(note.id) ? ' · failed, will retry' : state.priority.includes(note.id) ? ' · building' : '';
      return `<label class="nzsi-row"><input type="checkbox" data-id="${esc(note.id)}" ${picked.has(note.id) ? 'checked' : ''}><span><b>${esc(note.title || 'Untitled note')}</b><small>${esc(note.folderPath || 'General')}${status}</small></span></label>`;
    }).join('');
    showModal('semantic-index-picker', 'Choose what to build first',
      `<div class="nzsi">
        <p>These notes have no semantic index yet. Pick the ones to build first; the rest wait until you choose "Build remaining".</p>
        <div class="nzsi-list">${list}</div>
        <div class="nzsi-foot"><span id="nzsi-count">${picked.size} selected</span><button type="button" class="nzsi-btn primary" data-sindex="first">Build selected first</button><button type="button" class="nzsi-btn" data-sindex="later" data-close>Build the rest later</button></div>
      </div>`,
      dialog => {
        const count = () => { const n = dialog.querySelectorAll('input[type=checkbox]:checked').length; const el = dialog.querySelector('#nzsi-count'); if (el) el.textContent = `${n} selected`; };
        dialog.onchange = count;
        dialog.onclick = event => {
          if (event.target.closest('[data-sindex="first"]')) {
            const chosen = [...dialog.querySelectorAll('input[type=checkbox]:checked')].map(input => input.dataset.id);
            store.update(state => promote(state, chosen));
            dialog.hidden = true;
            window.nzSindexStatusRefresh?.();
            if (!available()) toast('Sign in to build the semantic index. Your choice is saved.', 'info', 6000);
            kick();
          }
        };
      });
  };

  window.NzIndex = NzIndex;
})();
