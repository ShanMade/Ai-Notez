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
  function provenance(text, sources, { task = '' } = {}) {
    if (task === 'title' || task === 'tags') {
      return { kind: 'suggestion', label: 'AI suggestions · review before using', cited: [] };
    }
    const list = (Array.isArray(sources) ? sources : []).filter(source => source && source.id);
    if (!list.length) return { kind: 'general', label: 'AI answer · not from your notes', cited: [] };
    const cited = [...new Set([...String(text || '').matchAll(/\[(\d{1,2})\]/g)].map(match => Number(match[1])))]
      .filter(n => list.some(source => source.n === n));
    if (!cited.length) return { kind: 'context', label: 'Used your notes as context · no specific citation', cited: [] };
    return { kind: 'cited', label: `From your notes · ${cited.length} of ${list.length} source${list.length === 1 ? '' : 's'} cited`, cited };
  }

  const api = { route, ruleKey, attachSources, provenance };
  root.NzChat = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
