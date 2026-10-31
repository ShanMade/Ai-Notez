// Phase 4c of the chat rebuild: suggestions are only ever suggestions, and a recording answer
// says where it came from. Pure logic in app/16-chat-core.js.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const C = require('../app/16-chat-core.js');

test('normalizeSuggestion: a title is trimmed, collapsed and capped at 180', () => {
  assert.equal(C.normalizeSuggestion('title', '  Cell   division \n basics  '), 'Cell division basics');
  assert.equal(C.normalizeSuggestion('title', 'x'.repeat(300)).length, 180);
});

test('normalizeSuggestion: a tag is capped at 40; an empty edit is refused', () => {
  assert.equal(C.normalizeSuggestion('tags', 'y'.repeat(60)).length, 40);
  assert.equal(C.normalizeSuggestion('tags', '   '), null);
  assert.equal(C.normalizeSuggestion('title', undefined), null);
});

test('suggestionRows: rows start open; a state is per row, not per value', () => {
  const rows = C.suggestionRows(['A', 'B', 'A'], { 1: 'dismissed' });
  assert.deepEqual(rows.map(r => r.state), ['open', 'dismissed', 'open']);
});

test('suggestionRows: an answer saved before row states still shows its applied value', () => {
  const rows = C.suggestionRows(['Old title', 'Other'], {}, ['Old title']);
  assert.deepEqual(rows.map(r => r.state), ['applied', 'open']);
});

test('suggestionRows: a missing or empty list gives no rows', () => {
  assert.deepEqual(C.suggestionRows(undefined), []);
  assert.deepEqual(C.suggestionRows([]), []);
});

test('provenance: a recording answer says "From this recording"', () => {
  const p = C.provenance('Voice 1 agrees [1].', [{ n: 1, id: 'r' }], { recording: true });
  assert.equal(p.kind, 'cited');
  assert.equal(p.label, 'From this recording · 1 of 1 source cited');
});

test('provenance: a recording with no citation is labelled as context, not as notes', () => {
  const p = C.provenance('Unclear.', [{ n: 1, id: 'r' }], { recording: true });
  assert.equal(p.kind, 'context');
  assert.equal(p.label, 'Used this recording as context · no specific citation');
});

test('provenance: a suggestion stays a suggestion even for a recording', () => {
  const p = C.provenance('1. Lecture recap', [{ n: 1, id: 'r' }], { task: 'title', recording: true });
  assert.equal(p.kind, 'suggestion');
  assert.equal(p.label, 'AI suggestions · review before using');
});

test('provenance: without the recording flag, the notes wording is unchanged', () => {
  assert.equal(C.provenance('x [1]', [{ n: 1, id: 'a' }]).label, 'From your notes · 1 of 1 source cited');
});
