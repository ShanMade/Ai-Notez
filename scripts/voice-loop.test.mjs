// Regression test: a transcript that loops on one line keeps at most two copies in a row,
// and a muted (silent) part is never sent to the model. Voice-note text uses one model only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = fs.readFileSync(path.join(root, 'app/06-ai-and-recording.js'), 'utf8');
const start = app.indexOf('      // A model that falls into a loop writes');
const end = app.indexOf('return unloop.join', start);
assert.ok(start > 0 && end > start, 'loop guard is in recCleanPart');
const body = app.slice(start, app.indexOf('\n', end) + 1);
const unloopLines = new Function('kept', 'recUnmark', `${body.replace(/return unloop\.join[^\n]*\n/, '')}; return unloop;`);
const recUnmark = line => String(line ?? '');

test('keeps at most two copies of a line in a row', () => {
  const looped = ['[00:01] Voice 1: thank you', '[00:02] Voice 1: thank you', '[00:03] Voice 1: thank you', '[00:04] Voice 1: thank you', '[00:05] Voice 2: ok'];
  const kept = [...unloopLines(looped, recUnmark)];
  assert.equal(kept.length, 3);
  assert.equal(kept[2], '[00:05] Voice 2: ok');
});

test('two copies of a line can be real speech and are kept', () => {
  assert.equal(unloopLines(['Voice 1: yes', 'Voice 1: yes', 'Voice 2: no'], recUnmark).length, 3);
});

test('voice-note model is pinned in the client and the backend', () => {
  assert.match(app, /const REC_VOICE_MODEL = 'gemini-3\.5-flash-lite';/);
  assert.match(app, /const REC_AUDIO_MODELS = \[REC_VOICE_MODEL\];/);
  const config = fs.readFileSync(path.join(root, 'backend/app/config.py'), 'utf8');
  assert.match(config, /"AI_GEMINI_AUDIO_MODELS",\n\s+"gemini-3\.5-flash-lite",/);
  const main = fs.readFileSync(path.join(root, 'backend/app/main.py'), 'utf8');
  assert.match(main, /if body\.voice_only:\n\s+models = \[settings\.voice_model\]/);
});
