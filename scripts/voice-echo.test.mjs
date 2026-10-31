// Regression test: a part that repeats the end of the part before it (the model was given that text
// as context) loses the echoed lines at its top. Real repeats later in the part are kept.
// The guard lives in app/14-voice-core.js; the recorder in app/06 calls it.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const V = require('../app/14-voice-core.js');
const recDropEcho = (previous, current) => V.dropEcho(previous, current);

test('the recorder uses the core echo guard', async () => {
  const fs = await import('node:fs');
  const app = fs.readFileSync(new URL('../app/06-ai-and-recording.js', import.meta.url), 'utf8');
  assert.match(app, /const recDropEcho = \(previous, current\) => NzVoice\.dropEcho\(previous, current\);/);
});

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
