// Unit tests for the on-device note connections engine (app/11-note-connections.js).
// Runs the browser file in a sandbox with only `window` present, so the engine stays pure.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, 'app/11-note-connections.js'), 'utf8'), sandbox);
const C = sandbox.window.NzConn;

const note = (id, title, body, extra = {}) => ({ id, title, body, tags: [], folderPath: 'Biology', updatedAt: 1, ...extra });
const photo = note('p1', 'Photosynthesis', 'Photosynthesis happens in the chloroplast. Chlorophyll absorbs light energy and the Calvin cycle fixes carbon dioxide into sugar.', { folderPath: 'Biology/Plants' });
const chloro = note('p2', 'Chloroplast structure', 'The chloroplast has thylakoid membranes where light reactions run. Chlorophyll sits inside the thylakoid and absorbs light.', { folderPath: 'Biology/Plants' });
const revolution = note('h1', 'French revolution', 'The estates-general met in 1789 and the Bastille fell in July. Taxes and bread prices drove the unrest across France.', { folderPath: 'History' });
const photoCopy = note('p3', 'Photosynthesis', 'Photosynthesis happens in the chloroplast. Chlorophyll absorbs light energy and the Calvin cycle fixes carbon dioxide into sugar.', { folderPath: 'Biology' });

test('related notes rank by shared topic and skip unrelated ones', () => {
  const list = [photo, chloro, revolution];
  const rel = C.related(photo, list, { limit: 5 });
  assert.equal(rel[0].note.id, 'p2');
  assert.ok(rel[0].shared.includes('chloroplast') || rel[0].shared.includes('chlorophyll'));
  assert.ok(rel[0].passage.toLowerCase().includes('chloroplast') || rel[0].passage.toLowerCase().includes('chlorophyll'));
  assert.ok(!rel.some(item => item.note.id === 'h1'), 'unrelated history note must not appear');
});

test('duplicates: same title and near-identical content are flagged, with a reason', () => {
  const dups = C.duplicates(photo, [photo, photoCopy, chloro, revolution]);
  assert.equal(dups.length >= 1, true);
  assert.equal(dups[0].note.id, 'p3');
  assert.equal(dups[0].reason, 'Same title');
  assert.equal(C.duplicates(revolution, [photo, chloro, revolution]).length, 0);
});

test('link suggestions skip notes that are already linked', () => {
  const pigments = note('g1', 'Chlorophyll pigments', 'Chlorophyll a and chlorophyll b are the chloroplast pigments that absorb light.', { folderPath: 'Biology' });
  const linking = note('l1', 'Plant study', 'Chloroplast and chlorophyll notes. See [[Chloroplast structure]] for detail.', { folderPath: 'Biology' });
  const sugg = C.linkSuggestions(linking, [linking, chloro, pigments]);
  assert.ok(!sugg.some(item => item.note.id === 'p2'), 'already linked note must not be suggested again');
  assert.ok(sugg.some(item => item.note.id === 'g1'), 'a related, unlinked note is suggested');
});

test('organize: generic title gets the first heading; topics, type and folder are suggested', () => {
  const lecture = note('x1', 'Class recording · 10/31/2026 3:21 PM', '# Cell division\nMitosis splits a cell into two identical daughter cells. In this lecture the professor covers the phases of mitosis and the spindle.', { folderPath: 'Classes' });
  const list = [lecture, photo, chloro];
  const out = C.organize(lecture, list);
  const title = out.find(item => item.kind === 'title');
  assert.equal(title.value, 'Cell division');
  assert.equal(out.find(item => item.kind === 'type').value, 'lecture');
  assert.ok(out.some(item => item.kind === 'tag' && item.value.length > 3));
  assert.ok(!out.some(item => item.kind === 'tag' && lecture.tags.includes(item.value)));
});

test('organize: a note that already has a meaningful title gets no title suggestion', () => {
  assert.equal(C.organize(photo, [photo, chloro]).some(item => item.kind === 'title'), false);
});

test('index refreshes when a note changes', () => {
  const a = note('a', 'Rivers', 'Rivers carry sediment to the delta.', { folderPath: 'Geo' });
  const b = note('b', 'Notes', 'Nothing here yet.', { folderPath: 'Geo' });
  assert.equal(C.related(b, [a, b]).length, 0);
  const b2 = { ...b, body: 'Sediment deposits form the delta where rivers slow.', updatedAt: 2 };
  assert.equal(C.related(b2, [a, b2])[0].note.id, 'a');
});

test('provenance never claims notes unless a source was cited', () => {
  const src = [{ n: 1, id: 'p1', title: 'Photosynthesis' }, { n: 2, id: 'p2', title: 'Chloroplast' }];
  assert.equal(C.provenance('Plants make sugar.', []).kind, 'general');
  assert.match(C.provenance('Plants make sugar.', []).label, /not from your notes/);
  assert.equal(C.provenance('Plants make sugar.', src).kind, 'context');
  assert.equal(C.provenance('Plants make sugar [1].', src).kind, 'cited');
  assert.equal(C.provenance('Plants make sugar [1].', src).label, 'From your notes · 1 of 2 sources cited');
  assert.equal(C.provenance('Made up [9].', src).kind, 'context', 'a citation to a source that does not exist does not count');
});

test('follow-ups come from retrieved material and are empty without sources', () => {
  assert.equal(C.followUps('What is photosynthesis?', []).length, 0);
  const fu = C.followUps('What is photosynthesis?', [
    { n: 1, id: 'p1', title: 'Photosynthesis', passage: 'Chlorophyll absorbs light energy in the thylakoid.' },
    { n: 2, id: 'p2', title: 'Chloroplast structure', passage: '' },
  ], 'Biology');
  assert.ok(fu.some(q => q.includes('Photosynthesis') && /chlorophyll|thylakoid|absorbs|energy/.test(q)));
  assert.ok(fu.some(q => q.includes('Chloroplast structure')));
  assert.ok(fu.length <= 3);
});
