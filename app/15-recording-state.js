// Recording state machine: pure functions, no DOM, no network. Tested in Node
// (scripts/recording-state.test.mjs). The recorder in app/06 changes its status
// only through these tables, so every move is one the table allows.
// See docs/voice-and-chat-design.md, phase 3.
(function (root) {
  'use strict';

  // The status a session is in. The names match the values the UI already reads.
  const STATUS = { IDLE: 'idle', RECORDING: 'recording', PAUSED: 'paused', FINISHING: 'finishing', DONE: 'done' };
  // The state of one 20-40 second part.
  const PART = { PENDING: 'pending', IN_PROGRESS: 'in_progress', COMPLETED: 'completed', FAILED: 'failed', NEEDS_RETRY: 'needs_retry' };

  // A session is { status, starting, discarding }.
  //   starting   the microphone is being opened (a flag, because the status stays
  //              idle or done while it waits: a continued note stays done until the
  //              microphone is granted)
  //   discarding the finish that is running is a discard, not a save
  const S = STATUS;
  const SESSION = {
    // The microphone is requested from idle (new recording) or done (continue).
    begin:   { from: [S.IDLE, S.DONE], when: s => !s.starting, apply: s => ({ ...s, starting: true }) },
    // The microphone was granted: recording starts. Refused while a discard is running.
    granted: { from: [S.IDLE, S.DONE], when: s => s.starting && !s.discarding, apply: s => ({ ...s, starting: false, status: S.RECORDING, discarding: false }) },
    // The microphone was refused, or the request was dropped: nothing changes but the flag.
    denied:  { from: [S.IDLE, S.DONE], when: s => s.starting, apply: s => ({ ...s, starting: false }) },
    pause:   { from: [S.RECORDING], apply: s => ({ ...s, status: S.PAUSED }) },
    resume:  { from: [S.PAUSED], apply: s => ({ ...s, status: S.RECORDING }) },
    stop:    { from: [S.RECORDING, S.PAUSED], apply: s => ({ ...s, status: S.FINISHING, discarding: false }) },
    discard: { from: [S.RECORDING, S.PAUSED, S.DONE], apply: s => ({ ...s, status: S.FINISHING, discarding: true }) },
    // A finish that was a save is complete. A discard is completed by reset, not by this.
    finished: { from: [S.FINISHING], when: s => !s.discarding, apply: s => ({ ...s, status: S.DONE }) },
    // A reopened note with parts waiting to send is shown as a finished session.
    restore: { from: [S.IDLE], apply: s => ({ ...s, status: S.DONE }) },
    // The session is forgotten. Never allowed while recording or paused: stop first.
    reset:   { from: [S.IDLE, S.DONE, S.FINISHING], apply: () => ({ status: S.IDLE, starting: false, discarding: false }) },
  };

  // A part moves through these events. `queue` is the first state of a part.
  const PART_EVENTS = {
    queue:  { from: [undefined, null], to: PART.PENDING },
    send:   { from: [PART.PENDING, PART.FAILED, PART.IN_PROGRESS], to: PART.IN_PROGRESS },
    done:   { from: [PART.IN_PROGRESS, PART.COMPLETED], to: PART.COMPLETED },
    hold:   { from: [PART.PENDING, PART.IN_PROGRESS, PART.FAILED], to: PART.FAILED },
  };

  // The next session, or null when the event is not allowed from this session.
  function nextSession(session, event) {
    const rule = SESSION[event];
    if (!rule || !session) return null;
    if (!rule.from.includes(session.status)) return null;
    if (rule.when && !rule.when({ starting: !!session.starting, discarding: !!session.discarding, status: session.status })) return null;
    return rule.apply({ status: session.status, starting: !!session.starting, discarding: !!session.discarding });
  }

  function canSession(session, event) {
    return nextSession(session, event) !== null;
  }

  // The next part state, or null when the event is not allowed from this state.
  function nextPart(current, event) {
    const rule = PART_EVENTS[event];
    if (!rule) return null;
    return rule.from.includes(current) ? rule.to : null;
  }

  const api = { STATUS, PART, SESSION_EVENTS: Object.keys(SESSION), PART_EVENTS: Object.keys(PART_EVENTS), nextSession, canSession, nextPart };
  root.NzRecState = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
