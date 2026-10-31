// Phase 3 of the voice rebuild: the recording state machine (app/15-recording-state.js)
// and the rule that the recorder changes its state only through it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const M = require('../app/15-recording-state.js');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = fs.readFileSync(path.join(root, 'app/06-ai-and-recording.js'), 'utf8');

const S = M.STATUS;
const idle = { status: S.IDLE, starting: false, discarding: false };
const session = patch => ({ ...idle, ...patch });
const move = (s, event) => M.nextSession(s, event);

test('a new recording: begin, granted, then recording', () => {
  const asking = move(idle, 'begin');
  assert.deepEqual(asking, session({ starting: true }));
  assert.deepEqual(move(asking, 'granted'), session({ status: S.RECORDING }));
});

test('a refused microphone returns to where it was and clears the flag', () => {
  const asking = move(idle, 'begin');
  assert.deepEqual(move(asking, 'denied'), idle);
});

test('continuing a note: begin from done, and the note stays done until granted', () => {
  const done = session({ status: S.DONE });
  const asking = move(done, 'begin');
  assert.equal(asking.status, S.DONE);
  assert.equal(asking.starting, true);
  assert.equal(move(asking, 'granted').status, S.RECORDING);
});

test('pause and resume only swap between recording and paused', () => {
  const rec = session({ status: S.RECORDING });
  const paused = move(rec, 'pause');
  assert.equal(paused.status, S.PAUSED);
  assert.equal(move(paused, 'resume').status, S.RECORDING);
  assert.equal(move(paused, 'pause'), null);
  assert.equal(move(rec, 'resume'), null);
});

test('stop finishes, and finishing with a save ends in done', () => {
  const finishing = move(session({ status: S.RECORDING }), 'stop');
  assert.equal(finishing.status, S.FINISHING);
  assert.equal(finishing.discarding, false);
  assert.equal(move(finishing, 'finished').status, S.DONE);
});

test('a discard finishes into a reset, never into done', () => {
  const discarding = move(session({ status: S.PAUSED }), 'discard');
  assert.equal(discarding.status, S.FINISHING);
  assert.equal(discarding.discarding, true);
  assert.equal(move(discarding, 'finished'), null, 'finished is refused while discarding');
  assert.deepEqual(move(discarding, 'reset'), idle);
});

test('discard from a finished session is allowed, and so is a reset', () => {
  assert.equal(move(session({ status: S.DONE }), 'discard').status, S.FINISHING);
  assert.deepEqual(move(session({ status: S.DONE }), 'reset'), idle);
});

test('nothing can reset a live recording: stop first', () => {
  assert.equal(move(session({ status: S.RECORDING }), 'reset'), null);
  assert.equal(move(session({ status: S.PAUSED }), 'reset'), null);
});

test('a finishing recording cannot be stopped or started again', () => {
  const finishing = session({ status: S.FINISHING });
  assert.equal(move(finishing, 'stop'), null);
  assert.equal(move(finishing, 'begin'), null);
  assert.equal(move(finishing, 'pause'), null);
});

test('a reopened note with waiting parts is restored as done, and only from idle', () => {
  assert.equal(move(idle, 'restore').status, S.DONE);
  assert.equal(move(session({ status: S.DONE }), 'restore'), null);
});

test('a granted microphone during a discard is refused', () => {
  const asking = session({ starting: true, discarding: true });
  assert.equal(move(asking, 'granted'), null);
});

test('a part moves pending, in progress, completed, and failed parts can be sent again', () => {
  assert.equal(M.nextPart(undefined, 'queue'), M.PART.PENDING);
  assert.equal(M.nextPart(M.PART.PENDING, 'send'), M.PART.IN_PROGRESS);
  assert.equal(M.nextPart(M.PART.IN_PROGRESS, 'done'), M.PART.COMPLETED);
  assert.equal(M.nextPart(M.PART.IN_PROGRESS, 'hold'), M.PART.FAILED);
  assert.equal(M.nextPart(M.PART.FAILED, 'send'), M.PART.IN_PROGRESS);
});

test('a completed part is final: it cannot be held or queued again', () => {
  assert.equal(M.nextPart(M.PART.COMPLETED, 'hold'), null);
  assert.equal(M.nextPart(M.PART.COMPLETED, 'send'), null);
  assert.equal(M.nextPart(M.PART.PENDING, 'queue'), null);
});

test('the table covers the statuses the recorder shows', () => {
  assert.deepEqual(Object.values(M.STATUS).sort(), ['done', 'finishing', 'idle', 'paused', 'recording']);
  for (const event of ['begin', 'granted', 'denied', 'pause', 'resume', 'stop', 'discard', 'finished', 'restore', 'reset']) {
    assert.ok(M.SESSION_EVENTS.includes(event), event);
  }
});

test('the recorder changes its status only through the state table', () => {
  // The only direct writes are inside the two helpers, and the restore of saved parts.
  for (const field of ['status', 'starting', 'discarding']) {
    const writes = app.match(new RegExp(`REC\\.${field} = [^=]`, 'g')) || [];
    assert.equal(writes.length, 1, `one write to REC.${field}, inside recMove`);
  }
  assert.match(app, /REC\.status = next\.status; REC\.starting = next\.starting; REC\.discarding = next\.discarding;/);
  const partWrites = app.match(/REC\.segStatuses\[index\] = [^=]/g) || [];
  assert.equal(partWrites.length, 2, 'recPartMove, and the load of saved parts');
  assert.ok(app.includes('recMove(\'granted\')'));
  assert.ok(app.includes('recMove(\'reset\')'));
});

test('the page loads the state table before the recorder, and caches it', () => {
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.ok(index.indexOf('15-recording-state.js') > 0 && index.indexOf('15-recording-state.js') < index.indexOf('06-ai-and-recording.js'));
  assert.match(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), /'app\/15-recording-state\.js'/);
});
