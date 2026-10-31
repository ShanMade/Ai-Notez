// Phase 4b of the chat rebuild: the prompt is built by pure functions (app/16-chat-core.js).
// Each fixture writes out the full prompt the model receives. A change in wording,
// spacing or order fails the test, so the answers stay the same.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const C = require('../app/16-chat-core.js');

const RULE_NUMBERED = 'Answer ONLY from the numbered notes. Cite them as [1], [2] after the sentences they support. If the notes do not contain the answer, say so instead of guessing.';
const RULE_NOTE = 'Answer using the note when it helps. Say clearly when the note does not cover something.';
const RULE_GENERAL = "Answer the user's question directly using your general knowledge and the context provided in the user's message.";
const RULE_RECORDING = ' This note is a recording: its lines are stamped and labelled by speaker (Voice 1, or a name). Say who said something only when the line shows that label, and say "unclear" when it does not. Cite the stamped line, for example [00:12].';

test('library question with notes: numbered context, numbered rule, USER line', () => {
  const context = C.numberedContext([{ title: 'Cell division', folderPath: 'Bio', body: 'Mitosis splits.' }], 6000);
  const out = C.buildPrompt({ question: 'What is mitosis?', context, routed: C.route({ scope: 'library' }), hasNotes: true });
  assert.equal(out.prompt, [
    "NUMBERED NOTES FROM THE USER'S LIBRARY:",
    '[1] "Cell division" (Bio)',
    '<note>',
    'Mitosis splits.',
    '</note>',
    '',
    RULE_NUMBERED,
    '',
    'USER: What is mitosis?',
  ].join('\n'));
  assert.equal(out.rules, RULE_NUMBERED);
});

test('no notes: general rule, and the prompt starts with the empty context', () => {
  const out = C.buildPrompt({ question: 'hi', routed: C.route({ scope: 'library' }), hasNotes: false });
  assert.equal(out.prompt, `\n\n${RULE_GENERAL}\n\nUSER: hi`);
});

test('a note that is not a recording uses the note rule, with the chat so far first', () => {
  const out = C.buildPrompt({
    question: 'q', transcript: 'USER: earlier\n', context: 'NOTE "Lecture":\n<note>\nHello\n</note>',
    routed: C.route({ hasNote: true, recording: false }), hasNotes: true,
  });
  assert.equal(out.prompt, 'USER: earlier\nNOTE "Lecture":\n<note>\nHello\n</note>\n\n' + RULE_NOTE + '\n\nUSER: q');
});

test('a recording note adds the speaker rule, and only for a recording', () => {
  const rec = C.buildPrompt({ question: 'q', context: 'NOTE "Talk":\n<note>\n[00:12] Voice 1: hi\n</note>', routed: C.route({ hasNote: true, recording: true }), hasNotes: true });
  assert.equal(rec.rules, RULE_NOTE + RULE_RECORDING);
  assert.ok(rec.prompt.endsWith('\n\n' + RULE_NOTE + RULE_RECORDING + '\n\nUSER: q'));
  const plain = C.buildPrompt({ question: 'q', context: 'x', routed: C.route({ hasNote: true, recording: false }), hasNotes: true });
  assert.equal(plain.rules, RULE_NOTE);
});

test('a folder scope with notes uses the numbered rule', () => {
  assert.equal(C.rulesFor(C.route({ scope: 'folder' }), true), RULE_NUMBERED);
  assert.equal(C.rulesFor(C.route({ scope: 'folder' }), false), RULE_GENERAL);
});

test('the tutor quiz prompt replaces the normal prompt and ends with the student line', () => {
  const out = C.buildPrompt({ question: 'Osmosis', transcript: 'STUDENT: start\n', context: 'NOTE "Cells":\n<note>\nOsmosis.\n</note>', routed: C.route({ hasNote: true }), hasNotes: true, quiz: true });
  assert.equal(out.prompt, [
    "You are a strict but kind tutor quizzing a student on the note below. The student's latest message is their answer to your previous question (or a request to start if this is the first turn). Grade the answer as Correct, Partly correct or Incorrect, give the right answer in one or two sentences, then ask ONE new short question about an important idea in the note. Never reveal the next answer. Base everything only on the note.",
    '',
    'NOTE "Cells":',
    '<note>',
    'Osmosis.',
    '</note>',
    '',
    'STUDENT: start',
    'STUDENT: Osmosis',
  ].join('\n'));
});

test('inventory: exact count, sorted by title, capped, with the omitted line and cited sources', () => {
  const notes = [
    { id: 'a', title: 'Zeta', folderPath: '' },
    { id: 'b', title: 'alpha', folderPath: 'Bio', tags: ['x'] },
    { title: 'no id', folderPath: '' },
  ];
  const inv = C.inventoryContext(notes, { limit: 1 });
  assert.equal(inv.context, [
    'LIBRARY INVENTORY from the current NoteZ workspace cache.',
    'Exact local note count: 3.',
    'Entries shown: 1 of 3.',
    '[1] alpha — folder=Bio; tags=x',
    '2 additional notes are omitted from this compact inventory.',
    'Use these metadata records for library questions. Do not infer note contents from titles or invent omitted records.',
  ].join('\n'));
  assert.deepEqual(JSON.parse(JSON.stringify(inv.sources)), [{ n: 1, id: 'b', title: 'alpha', folderPath: 'Bio' }]);
  assert.equal(C.buildPrompt({ question: 'how many?', context: inv.context, routed: C.route({ wantsInventory: true }), hasNotes: true }).rules,
    'Answer library inventory questions from the provided LIBRARY INVENTORY metadata. Use its exact count, list only the titles shown, and do not infer note contents from titles. If the backend provides a fresher authoritative inventory, prefer it.');
});

test('numbered context cuts each body to the limit and falls back to General', () => {
  assert.equal(C.numberedContext([{ title: 'T', folderPath: '', body: 'abcdefgh' }], 5),
    "NUMBERED NOTES FROM THE USER'S LIBRARY:\n[1] \"T\" (General)\n<note>\nabcde\n</note>");
  assert.equal(C.numberedContext([{ title: 'A', body: 'x' }, { title: 'B', folderPath: 'F', body: 'y' }], 9),
    "NUMBERED NOTES FROM THE USER'S LIBRARY:\n[1] \"A\" (General)\n<note>\nx\n</note>\n\n[2] \"B\" (F)\n<note>\ny\n</note>");
});
