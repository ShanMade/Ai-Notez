// Phase 4a of the voice and chat rebuild: NotezAi chat core (app/16-chat-core.js).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const C = require('../app/16-chat-core.js');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const src = (n, id) => ({ n, id, title: 'Note ' + id, folderPath: 'Bio' });

test('inventory questions win over any scope', () => {
  assert.deepEqual(C.route({ wantsInventory: true, scope: 'note', hasNote: true }), { kind: 'inventory', recording: false });
});

test('a note in scope routes to note; folder and library follow', () => {
  assert.equal(C.route({ scope: 'note', hasNote: true }).kind, 'note');
  assert.equal(C.route({ hasNote: true }).kind, 'note', 'a forced note also routes to note');
  assert.equal(C.route({ scope: 'note' }).kind, 'library', 'a note scope with no note cannot route to a note');
  assert.equal(C.route({ scope: 'folder' }).kind, 'folder');
  assert.equal(C.route({ scope: 'library' }).kind, 'library');
  assert.equal(C.route({}).kind, 'library');
});

test('a recording answer keeps its flag only for a note', () => {
  assert.deepEqual(C.route({ scope: 'note', hasNote: true, recording: true }), { kind: 'note', recording: true });
  assert.equal(C.route({ scope: 'library', recording: true }).recording, false, 'recording needs a note');
});

test('rule keys: each route gets its own rules', () => {
  assert.equal(C.ruleKey({ kind: 'inventory' }, true), 'inventory');
  assert.equal(C.ruleKey({ kind: 'note', recording: true }, true), 'note-recording');
  assert.equal(C.ruleKey({ kind: 'note', recording: false }, true), 'note');
  assert.equal(C.ruleKey({ kind: 'library' }, true), 'numbered-notes');
  assert.equal(C.ruleKey({ kind: 'library' }, false), 'general');
});

test('attachSources: a source the model names that was not sent is dropped', () => {
  const sent = [src(1, 'a'), src(2, 'b')];
  const kept = C.attachSources(sent, [{ id: 'b' }, { id: 'zzz' }]);
  assert.deepEqual(kept.map(s => s.id), ['b']);
  assert.equal(kept[0].n, 2, 'the number it was sent with stays');
});

test('attachSources: no claim, or no valid claim, shows what was sent', () => {
  const sent = [src(1, 'a'), src(2, 'b')];
  assert.deepEqual(C.attachSources(sent, undefined), sent);
  assert.deepEqual(C.attachSources(sent, [{ id: 'nope' }]), sent);
  assert.deepEqual(C.attachSources([], [{ id: 'a' }]), []);
});

test('provenance: general when there are no sources', () => {
  assert.equal(C.provenance('Paris.', []).kind, 'general');
});

test('provenance: context when sources were sent but not cited', () => {
  assert.equal(C.provenance('Something.', [src(1, 'a')]).kind, 'context');
});

test('provenance: cited counts the markers that match a source', () => {
  const p = C.provenance('Mitosis splits the cell [1] and [2].', [src(1, 'a'), src(2, 'b'), src(3, 'c')]);
  assert.equal(p.kind, 'cited');
  assert.deepEqual(p.cited, [1, 2]);
  assert.equal(p.label, 'From your notes · 2 of 3 sources cited');
});

test('provenance: a title or tag suggestion is never a note fact', () => {
  for (const task of ['title', 'tags']) {
    const p = C.provenance('1. Cell division', [src(1, 'a')], { task });
    assert.equal(p.kind, 'suggestion');
    assert.match(p.label, /review before using/);
  }
  assert.equal(C.provenance('Summary.', [src(1, 'a')], { task: 'summary' }).kind, 'context', 'other tasks keep the normal kinds');
});

test('the chat page loads the core before its own script, and caches it', () => {
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.ok(index.indexOf('16-chat-core.js') > 0);
  assert.ok(index.indexOf('16-chat-core.js') > 0 && index.indexOf('16-chat-core.js') < index.indexOf('04-reader-and-html.js'));
  assert.match(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), /'app\/16-chat-core\.js'/);
});
