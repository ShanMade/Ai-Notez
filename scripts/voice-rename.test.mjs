// Regression test: naming a speaker in a voice-note transcript must rename every
// "Voice n:" label it covers, and must not touch "Voice 10" when renaming "Voice 1".
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'app/06-ai-and-recording.js'), 'utf8');
const start = source.indexOf('    function recRenameVoice(');
assert.ok(start >= 0, 'recRenameVoice is defined in app/06');
const end = source.indexOf('\n    }\n', start) + '\n    }\n'.length;
const recRenameVoice = new Function(`${source.slice(start, end)}; return recRenameVoice;`)();

test('renames a labelled turn, with and without a timestamp', () => {
  assert.equal(recRenameVoice('[00:01] Voice 1: hello', 'Voice 1', 'Ali'), '[00:01] Ali: hello');
  assert.equal(recRenameVoice('Voice 2: hi\nVoice 1: yo', 'Voice 1', 'Ali'), 'Voice 2: hi\nAli: yo');
});

test('does not rename Voice 10 when renaming Voice 1', () => {
  assert.equal(recRenameVoice('- **Voice 10**: other', 'Voice 1', 'Ali'), '- **Voice 10**: other');
});

test('renames every turn of the same voice', () => {
  assert.equal(recRenameVoice('[00:01] Voice 1: a\n[00:09] Voice 1: b', 'Voice 1', 'Ali'), '[00:01] Ali: a\n[00:09] Ali: b');
});
