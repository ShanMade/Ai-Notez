// Phase 2 of the voice rebuild: the recorder offers six modes, keeps its settings in a
// drawer, shows one status line for waiting parts, and names speakers in place.
// Checked against the source, since the recorder is one closure in app/06.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const app = read('app/06-ai-and-recording.js');

test('the picker offers the six modes, from the core', () => {
  assert.match(app, /const REC_TAGS = \{ class: 'CLASS', meeting: 'MEETING', casual: 'CASUAL', call: 'CALL', chat: 'CHAT', custom: 'CUSTOM' \};/);
  assert.match(app, /REC_MODE_IDS\.map\(id => `<label class="rec-mode-opt">/);
  assert.doesNotMatch(app, /\[\['class', 'Classroom'\], \['meeting', 'Meeting'\]\]/, 'the old two-mode picker is gone');
});

test('class and meeting keep their tags, folders and titles', () => {
  assert.equal(app.includes("recTagOf(REC.mode)"), true);
  assert.match(app, /const recFolderOf = mode => mode === 'meeting' \? 'Meetings' : mode === 'class' \? 'Classes' : 'Recordings';/);
  assert.match(app, /const recTitleWord = mode => mode === 'class' \? 'Class' : mode === 'meeting' \? 'Meeting' : NzVoice\.modeOf\(mode\)\.label;/);
});

test('settings sit in a drawer whose open state survives redraws', () => {
  assert.match(app, /<details class="rec-more" \$\{REC\.moreOpen \? 'open' : ''\}>/);
  assert.match(app, /event\.target\?\.matches\?\.\('details\.rec-more'\)\) REC\.moreOpen = event\.target\.open/);
});

test('waiting parts show in one status line, not a separate box', () => {
  assert.match(app, /function recStatusLine\(failedCount\)/);
  assert.match(app, /\$\{recStatusLine\(failedCount\)\}\$\{tabs\}/);
  assert.doesNotMatch(app, /\$\{notice\}\$\{tabs\}/, 'the separate notice box is not drawn while recording');
});

test('speakers are named in place and the names apply to later parts too', () => {
  assert.match(app, /data-rec-speaker="\$\{esc\(row\.label\)\}"/);
  assert.match(app, /event\.target\?\.matches\?\.\('\[data-rec-speaker\]'\)\) recRenameSpeaker/);
  assert.match(app, /function recLiveTranscript\(\) \{[\s\S]*?return recApplyRenames\(recNormalizeLabels\(text\)\);/);
  assert.match(app, /if \(name && \/\^voice\\s\+\\d\+\$\/i\.test\(name\)\)/, 'a Voice number cannot be used as a name');
});

test('the new stylesheet is loaded and cached', () => {
  assert.match(read('index.html'), /styles\/voice-recorder\.css/);
  assert.match(read('sw.js'), /'styles\/voice-recorder\.css'/);
});
