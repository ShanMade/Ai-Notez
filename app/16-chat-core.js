// NotezAi chat core (phase 4a): pure functions, no DOM, no network. Tested in Node
// (scripts/chat-core.test.mjs). nzaiAsk in app/04 uses these for routing, the rule
// set, the source list and the provenance chip. See docs/voice-and-chat-design.md, section 7.
(function (root) {
  'use strict';

  // Which part of the library an answer is allowed to read.
  //   inventory  a question about how many notes there are, or what they are called
  //   note       one note (the note in the answer-scope chip, or a forced note)
  //   folder     the notes of one folder
  //   library    the whole library, through retrieval
  function route({ wantsInventory = false, scope = 'library', hasNote = false, recording = false } = {}) {
    if (wantsInventory) return { kind: 'inventory', recording: false };
    if (hasNote) return { kind: 'note', recording: Boolean(recording) };
    if (scope === 'folder') return { kind: 'folder', recording: false };
    return { kind: 'library', recording: false };
  }

  // The key of the rule set the prompt uses. The wording itself stays with the caller,
  // so the rules the model is given do not change in this phase.
  function ruleKey(routed, hasNotes) {
    if (routed.kind === 'inventory') return 'inventory';
    if (routed.kind === 'note') return routed.recording ? 'note-recording' : 'note';
    return hasNotes ? 'numbered-notes' : 'general';
  }

  // Sources the answer may show. The model is given a numbered list; a source it
  // names that was not in that list is dropped, so nothing is shown as used when it
  // was not. With no valid name, the sources that were sent are shown as context.
  function attachSources(sent, claimed) {
    const list = (Array.isArray(sent) ? sent : []).filter(source => source && source.id);
    const named = new Set((Array.isArray(claimed) ? claimed : []).map(source => String(source?.id || '')).filter(Boolean));
    if (!named.size) return list;
    const kept = list.filter(source => named.has(String(source.id)));
    return kept.length ? kept : list;
  }

  // The chip under an answer. `suggestion` is set by the quick tasks that propose
  // a title or tags: those are never labelled as facts from the notes.
  // `recording` is set when the note is a recording: the chip then says "From this recording".
  function provenance(text, sources, { task = '', recording = false } = {}) {
    if (task === 'title' || task === 'tags') {
      return { kind: 'suggestion', label: 'AI suggestions · review before using', cited: [] };
    }
    const list = (Array.isArray(sources) ? sources : []).filter(source => source && source.id);
    if (!list.length) return { kind: 'general', label: 'AI answer · not from your notes', cited: [] };
    const cited = [...new Set([...String(text || '').matchAll(/\[(\d{1,2})\]/g)].map(match => Number(match[1])))]
      .filter(n => list.some(source => source.n === n));
    if (!cited.length) return { kind: 'context', label: recording ? 'Used this recording as context · no specific citation' : 'Used your notes as context · no specific citation', cited: [] };
    const count = `${cited.length} of ${list.length} source${list.length === 1 ? '' : 's'} cited`;
    return { kind: 'cited', label: `${recording ? 'From this recording' : 'From your notes'} · ${count}`, cited };
  }

  // ---- Phase 4b: the prompt is built from pure parts. The wording below is copied
  // from the phase 4a code, so the model receives the same text for the same notes.
  const NUMBERED_HEAD = "NUMBERED NOTES FROM THE USER'S LIBRARY:\n";
  const RULE_INVENTORY = 'Answer library inventory questions from the provided LIBRARY INVENTORY metadata. Use its exact count, list only the titles shown, and do not infer note contents from titles. If the backend provides a fresher authoritative inventory, prefer it.';
  const RULE_NOTE = 'Answer using the note when it helps. Say clearly when the note does not cover something.';
  const RULE_NUMBERED = 'Answer ONLY from the numbered notes. Cite them as [1], [2] after the sentences they support. If the notes do not contain the answer, say so instead of guessing.';
  const RULE_GENERAL = "Answer the user's question directly using your general knowledge and the context provided in the user's message.";
  const RULE_RECORDING = ' This note is a recording: its lines are stamped and labelled by speaker (Voice 1, or a name). Say who said something only when the line shows that label, and say "unclear" when it does not. Cite the stamped line, for example [00:12].';
  const compact = value => String(value || '').replace(/\s+/g, ' ').trim();

  // The inventory context for a library question: the notes sorted by title, at most `limit`.
  function inventoryContext(notes, { limit = 50 } = {}) {
    const all = Array.isArray(notes) ? notes : [];
    const inventory = [...all].sort((a, b) => compact(a.title).localeCompare(compact(b.title))).slice(0, limit);
    const total = all.length;
    const context = [
      'LIBRARY INVENTORY from the current NoteZ workspace cache.',
      'Exact local note count: ' + total + '.',
      'Entries shown: ' + inventory.length + ' of ' + total + '.',
      ...inventory.map((item, index) => {
        const title = compact(item.title || 'Untitled note').slice(0, 180);
        const meta = [];
        if (item.folderPath) meta.push('folder=' + compact(item.folderPath).slice(0, 120));
        if (item.subject) meta.push('subject=' + compact(item.subject).slice(0, 100));
        if (Array.isArray(item.tags) && item.tags.length) meta.push('tags=' + item.tags.slice(0, 8).map(tag => compact(tag).slice(0, 50)).join(', '));
        if (item.updatedAt || item.createdAt) meta.push('date=' + String(item.updatedAt || item.createdAt).slice(0, 40));
        return '[' + (index + 1) + '] ' + title + (meta.length ? ' — ' + meta.join('; ') : '');
      }),
      total > inventory.length ? (total - inventory.length) + ' additional notes are omitted from this compact inventory.' : '',
      'Use these metadata records for library questions. Do not infer note contents from titles or invent omitted records.'
    ].filter(Boolean).join('\n');
    const sources = inventory.map((item, index) => ({ n: index + 1, id: String(item.id || ''), title: compact(item.title || 'Untitled note').slice(0, 180), folderPath: compact(item.folderPath || '').slice(0, 120) })).filter(item => item.id);
    return { context, sources };
  }

  // The numbered note blocks the model cites as [1], [2]. Each body is cut to `perChars`.
  function numberedContext(items, perChars) {
    const blocks = (Array.isArray(items) ? items : []).map((item, index) =>
      `[${index + 1}] "${item.title}" (${item.folderPath || 'General'})\n<note>\n${String(item.body || '').slice(0, perChars)}\n</note>`);
    return NUMBERED_HEAD + blocks.join('\n\n');
  }

  // The rule text for a route. The recording addendum is added only for a recording note.
  function rulesFor(routed, hasNotes) {
    const key = ruleKey(routed, hasNotes);
    if (key === 'inventory') return RULE_INVENTORY;
    if (key === 'note') return RULE_NOTE;
    if (key === 'note-recording') return RULE_NOTE + RULE_RECORDING;
    if (key === 'numbered-notes') return RULE_NUMBERED;
    return RULE_GENERAL;
  }

  // The prompt sent to the model. `transcript` is the chat so far; `quiz` switches to the tutor prompt.
  function buildPrompt({ question = '', transcript = '', context = '', routed, hasNotes = false, quiz = false } = {}) {
    if (quiz) {
      return { rules: '', prompt: `You are a strict but kind tutor quizzing a student on the note below. The student's latest message is their answer to your previous question (or a request to start if this is the first turn). Grade the answer as Correct, Partly correct or Incorrect, give the right answer in one or two sentences, then ask ONE new short question about an important idea in the note. Never reveal the next answer. Base everything only on the note.\n\n${context}\n\n${transcript}STUDENT: ${question}` };
    }
    const rules = rulesFor(routed, hasNotes);
    return { rules, prompt: `${transcript}${context}\n\n${rules}\n\nUSER: ${question}` };
  }

  // ---- Phase 4c: suggestions. A suggestion is saved only when the user accepts it
  // (or accepts an edited version). Nothing here touches a note.
  const TITLE_MAX = 180;
  const TAG_MAX = 40;
  // The text a suggestion would be saved as, or null when nothing usable is left.
  function normalizeSuggestion(task, value) {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    if (!text) return null;
    return text.slice(0, task === 'tags' ? TAG_MAX : TITLE_MAX);
  }
  // One row per suggestion. `states` maps a row index to 'applied' or 'dismissed'.
  // `appliedValues` is read for answers saved before rows had states.
  function suggestionRows(values, states = {}, appliedValues = []) {
    const applied = Array.isArray(appliedValues) ? appliedValues : [];
    return (Array.isArray(values) ? values : []).map((value, index) => {
      const state = states[index] || (applied.includes(value) ? 'applied' : 'open');
      return { index, value, state };
    });
  }

  const api = { route, ruleKey, attachSources, provenance, inventoryContext, numberedContext, rulesFor, buildPrompt, normalizeSuggestion, suggestionRows };
  root.NzChat = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
