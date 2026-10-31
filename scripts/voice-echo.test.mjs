// Regression test: a part that repeats the end of the part before it (the model was given that text
// as context) loses the echoed lines at its top. Real repeats later in the part are kept.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = fs.readFileSync(path.join(root, 'app/06-ai-and-recording.js'), 'utf8');
const from = app.indexOf('    // The words a line says, without its time stamp or speaker label.');
const to = app.indexOf('    // A muted or silent part is not sent.');
assert.ok(from > 0 && to > from, 'echo guard is in the app');
const source = app.slice(from, to).replace(/    const recSpokenWords/, 'const recSpokenWords').replace(/    function recDropEcho/, 'function recDropEcho');
const recDropEcho = new Function('recUnmark', `${source}; return recDropEcho;`)(line => String(line ?? ''));

test('drops the echoed line at the top of a part', () => {
  const previous = '[00:20] Voice 1: Assalamu Alaikum';
  const current = '[00:05] Voice 1: Assalamu Alaikum\n[00:10] Voice 1: how are you';
  assert.equal(recDropEcho(previous, current), '[00:10] Voice 1: how are you');
});

test('ignores case and punctuation when matching', () => {
  assert.equal(recDropEcho('Voice 1: Assalamu Alaikum.', 'Voice 1: assalamu alaikum!'), '');
});

test('keeps a line that is really said again later in the part', () => {
  const previous = 'Voice 1: Assalamu Alaikum';
  const current = 'Voice 1: first\nVoice 1: second\nVoice 1: third\nVoice 1: Assalamu Alaikum';
  assert.equal(recDropEcho(previous, current), current);
});

test('nothing to drop when there is no previous text', () => {
  assert.equal(recDropEcho('', 'Voice 1: hello'), 'Voice 1: hello');
});
