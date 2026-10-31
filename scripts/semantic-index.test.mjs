// Unit tests for the semantic index queue (app/13-semantic-index.js).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, 'app/13-semantic-index.js'), 'utf8'), sandbox);
const Q = sandbox.window.NzIndex;
// Arrays made inside the sandbox have another realm; compare plain copies.
const same = (actual, expected) => assert.deepStrictEqual(JSON.parse(JSON.stringify(actual)), expected);

function memoryStorage() {
  const map = new Map();
  return { getItem: key => (map.has(key) ? map.get(key) : null), setItem: (key, value) => map.set(key, String(value)) };
}
const note = (id, body = 'text', updatedAt = 1) => ({ id, title: id, body, updatedAt });
const httpError = status => Object.assign(new Error(`status ${status}`), { status });

test('pendingIds: only notes with text and no index entry', () => {
  const state = Q.emptyState();
  state.done.a = 1;
  const ids = Q.pendingIds([note('a'), note('b'), note('c', '   '), note('d')], state);
  same(ids, ['b', 'd']);
});

test('plan: a small batch builds automatically', () => {
  const state = Q.emptyState();
  const result = Q.plan(state, ['a', 'b', 'c']);
  assert.equal(result.auto, true);
  same(state.priority, ['a', 'b', 'c']);
  same(state.later, []);
});

test('plan: a batch over the limit waits for the user', () => {
  const state = Q.emptyState();
  const ids = Array.from({ length: Q.BULK + 3 }, (_, i) => 'n' + i);
  const result = Q.plan(state, ids);
  assert.equal(result.auto, false);
  assert.equal(result.count, Q.BULK + 3);
  same(state.priority, []);
  assert.equal(state.later.length, Q.BULK + 3);
});

test('plan: already queued and failed notes are not added again', () => {
  const state = Q.emptyState();
  state.priority = ['a'];
  state.failed = ['f'];
  const result = Q.plan(state, ['a', 'f']);
  assert.equal(result.changed, false);
  same(state.priority, ['a']);
});

test('promote: chosen notes move to the front; the rest keep waiting', () => {
  const state = Q.emptyState();
  state.later = ['x', 'y', 'z'];
  Q.promote(state, ['z', 'x']);
  same(state.priority, ['z', 'x']);
  same(state.later, ['y']);
});

test('run: builds the queue, one note at a time, and records each as done', async () => {
  const store = Q.makeStore(memoryStorage());
  store.update(state => { state.priority = ['a', 'b']; });
  const sent = [];
  await Q.run(store, {
    send: async id => { sent.push(id); },
    noteFor: id => note(id),
    sleep: async () => {},
    now: () => 100,
  });
  same(sent, ['a', 'b']);
  const state = store.read();
  same(state.priority, []);
  assert.equal(state.done.a, 100);
  assert.equal(state.done.b, 100);
});

test('429: the note stays first, the worker cools down, and it retries', async () => {
  const store = Q.makeStore(memoryStorage());
  store.update(state => { state.priority = ['a']; });
  let calls = 0;
  const waits = [];
  await Q.run(store, {
    send: async () => { calls += 1; if (calls === 1) throw httpError(429); },
    noteFor: id => note(id),
    sleep: async ms => { waits.push(ms); },
    now: () => 100,
  });
  assert.equal(calls, 2);
  assert.equal(waits[0], Q.DELAY.cool);
  same(store.read().priority, []);
});

test('repeated 429s pause the queue (daily quota is likely spent)', async () => {
  const store = Q.makeStore(memoryStorage());
  store.update(state => { state.priority = ['a', 'b']; });
  let calls = 0;
  await Q.run(store, {
    send: async () => { calls += 1; throw httpError(429); },
    noteFor: id => note(id),
    sleep: async () => {},
    now: () => 1000,
  });
  const state = store.read();
  assert.equal(calls, 3, 'stops after three 429s in a row');
  assert.ok(state.pausedUntil > 1000);
  // While paused nothing runs.
  let more = 0;
  await Q.run(store, { send: async () => { more += 1; }, noteFor: id => note(id), sleep: async () => {}, now: () => 1000 });
  assert.equal(more, 0);
});

test('404 (note not in the database yet) waits and retries; after the limit it is marked failed', async () => {
  const store = Q.makeStore(memoryStorage());
  store.update(state => { state.priority = ['a']; });
  const waits = [];
  await Q.run(store, {
    send: async () => { throw httpError(404); },
    noteFor: id => note(id),
    sleep: async ms => { waits.push(ms); },
    now: () => 100,
  });
  const state = store.read();
  assert.ok(waits.slice(0, -1).every(ms => ms === Q.DELAY.wait), 'waits between attempts');
  assert.equal(waits.length, Q.MAX_TRIES, 'one wait per attempt, including the final failed step');
  same(state.failed, ['a']);
  same(state.priority, []);
  assert.equal(state.done.a, undefined);
});

test('a note that was deleted or emptied is skipped, not sent', async () => {
  const store = Q.makeStore(memoryStorage());
  store.update(state => { state.priority = ['gone', 'b']; });
  const sent = [];
  await Q.run(store, {
    send: async id => { sent.push(id); },
    noteFor: id => (id === 'gone' ? undefined : note(id)),
    sleep: async () => {},
    now: () => 1,
  });
  same(sent, ['b']);
  same(store.read().priority, []);
});

test('the queue survives a reload: state is read back from storage', () => {
  const storage = memoryStorage();
  Q.makeStore(storage).update(state => { state.later = ['x', 'y']; });
  same(Q.makeStore(storage).read().later, ['x', 'y']);
});
