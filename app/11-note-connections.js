// Note connections and organization suggestions.
//
// Everything here runs on the device from the notes already in memory. Nothing
// is sent to a model, and nothing is applied until the user accepts it.
//
// The engine part (NzConn.*) is pure: it takes notes and returns plain data so
// it can be unit-tested in Node. The panel part (below) reads the DOM and
// writes through the normal persistNote path.
(function () {
  const STOP = new Set(('a an and are as at be been but by can could did do does for from had has have he her his how i if in into is it its just like more most not of on or our out she so some such than that the their them then there these they this those to too up us very was we were what when where which who why will with would you your about also any each being both over only other same own under while through during before after above below again further once here all am because until between against off down whom yet shall may might must one two new use used using get got make made see also said say says let lets via per').split(' '));

  const tokenize = text => String(text || '').toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2 && !STOP.has(word) && !/^\d+$/.test(word));

  const plain = text => String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[\[([^\[\]\n]{1,120})\]\]/g, '$1')
    .replace(/[#*_`>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const foldTitle = value => String(value || '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();

  // Title and tags count twice so a note about a topic it names ranks higher.
  const docText = note => [note.title, note.title, (note.tags || []).join(' '), (note.tags || []).join(' '), note.body || ''].join('\n');

  function buildIndex(list) {
    const docs = new Map(), df = new Map();
    list.forEach(note => {
      if (!note || !note.id) return;
      const tf = new Map();
      tokenize(docText(note)).forEach(term => tf.set(term, (tf.get(term) || 0) + 1));
      if (!tf.size) return;
      docs.set(note.id, { note, tf });
      tf.forEach((_, term) => df.set(term, (df.get(term) || 0) + 1));
    });
    const N = Math.max(1, docs.size);
    const vec = new Map(), norm = new Map();
    docs.forEach((doc, id) => {
      const weights = new Map(); let sum = 0;
      doc.tf.forEach((count, term) => {
        const idf = Math.log((N + 1) / ((df.get(term) || 0) + 1)) + 1;
        const weight = (1 + Math.log(count)) * idf;
        weights.set(term, weight); sum += weight * weight;
      });
      vec.set(id, weights); norm.set(id, Math.sqrt(sum) || 1);
    });
    return { docs, vec, norm };
  }

  // The index is rebuilt only when a note's content or identity changes.
  let cache = { sig: '', index: null };
  function indexFor(list) {
    const sig = list.map(note => `${note.id}|${note.updatedAt || 0}|${(note.title || '').length}|${(note.body || '').length}|${(note.tags || []).length}`).join('\n');
    if (sig !== cache.sig) cache = { sig, index: buildIndex(list) };
    return cache.index;
  }

  function cosine(index, a, b) {
    const va = index.vec.get(a), vb = index.vec.get(b);
    if (!va || !vb) return 0;
    const [small, large] = va.size <= vb.size ? [va, vb] : [vb, va];
    let dot = 0;
    small.forEach((weight, term) => { const other = large.get(term); if (other) dot += weight * other; });
    return dot / (index.norm.get(a) * index.norm.get(b));
  }

  function sharedTerms(index, a, b, limit) {
    const va = index.vec.get(a), vb = index.vec.get(b);
    const hits = [];
    va.forEach((weight, term) => { const other = vb.get(term); if (other) hits.push([term, weight * other]); });
    return hits.sort((x, y) => y[1] - x[1]).slice(0, limit).map(([term]) => term);
  }

  // The sentence in another note that best matches the shared topics.
  function bestPassage(note, terms) {
    const text = plain(note.body);
    if (!text || !terms.length) return '';
    const sentences = text.split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(s => s.length > 20);
    let best = '', bestHits = 0;
    sentences.forEach(sentence => {
      const lower = sentence.toLowerCase();
      const hits = terms.reduce((count, term) => count + (lower.includes(term) ? 1 : 0), 0);
      if (hits > bestHits) { best = sentence; bestHits = hits; }
    });
    return best.slice(0, 240);
  }

  function linkedTitlesOf(note) {
    return new Set([...String(note.body || '').matchAll(/\[\[([^\[\]\n]{1,120})\]\]/g)].map(match => foldTitle(match[1])));
  }

  function related(note, list, { limit = 5, min = 0.08 } = {}) {
    const index = indexFor(list);
    if (!index.vec.has(note.id)) return [];
    const scored = [];
    index.docs.forEach((doc, id) => {
      if (id === note.id) return;
      const score = cosine(index, note.id, id);
      if (score >= min) scored.push({ id, score });
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map(({ id, score }) => {
      const other = index.docs.get(id).note;
      const terms = sharedTerms(index, note.id, id, 4);
      return { note: other, score: Math.round(score * 100) / 100, shared: terms, passage: bestPassage(other, terms) };
    });
  }

  // Possible duplicates: near-identical content, or the same title with real overlap.
  function duplicates(note, list) {
    const title = foldTitle(note.title);
    return related(note, list, { limit: 8, min: 0.2 }).filter(item => item.score >= 0.55 || (title && foldTitle(item.note.title) === title)).slice(0, 4).map(item => ({
      note: item.note,
      score: item.score,
      reason: foldTitle(item.note.title) === title ? 'Same title' : item.score >= 0.8 ? 'Nearly the same content' : 'Large overlap in content',
    }));
  }

  // Link suggestions: related notes this note does not already link to.
  function linkSuggestions(note, list) {
    const linked = linkedTitlesOf(note);
    return related(note, list, { limit: 8, min: 0.12 })
      .filter(item => !linked.has(foldTitle(item.note.title)) && foldTitle(item.note.title) !== foldTitle(note.title))
      .slice(0, 3);
  }

  const GENERIC_TITLE = /^(untitled|new note|note|scan|image|document|recording|class recording|meeting recording|img|dsc|screenshot|copy of)\b|^[\d\s._-]+$|·/i;
  const TYPE_RULES = [
    ['meeting', /\b(meeting|minutes|agenda|attendees|action items?)\b/gi, 2],
    ['lecture', /\b(lecture|class|chapter|slides?|professor|syllabus|lesson)\b/gi, 2],
    ['research', /\b(abstract|hypothesis|methodology|literature|references?|experiment|results?|findings)\b/gi, 3],
    ['personal', /\b(dear diary|today i|my goals?|journal|personal|i felt|my week)\b/gi, 2],
  ];

  // Suggestions for one note. Each is independent so the user can accept or dismiss it alone.
  function organize(note, list) {
    const out = [];
    const body = String(note.body || ''), title = String(note.title || '').trim();
    const ownFolder = String(note.folderPath || '').trim();

    if (GENERIC_TITLE.test(title)) {
      const heading = (body.match(/^\s*#{1,3}\s+(.+)$/m) || [])[1];
      const firstLine = body.split('\n').map(line => line.trim()).find(line => line.length >= 4) || '';
      const candidate = plain(heading || firstLine).slice(0, 70).trim();
      if (candidate && candidate.toLowerCase() !== title.toLowerCase()) {
        out.push({ kind: 'title', value: candidate, reason: heading ? 'The title is generic. This is the note\u2019s first heading.' : 'The title is generic. This is the note\u2019s first line.' });
      }
    }

    const index = indexFor(list);
    if (index.vec.has(note.id)) {
      const have = new Set((note.tags || []).map(tag => tag.toLowerCase()));
      const weights = [...index.vec.get(note.id).entries()].filter(([term]) => !have.has(term) && term.length > 3).sort((a, b) => b[1] - a[1]);
      weights.slice(0, 4).forEach(([term]) => out.push({ kind: 'tag', value: term, reason: 'A frequent topic in this note.' }));
    }

    const folderScore = new Map();
    related(note, list, { limit: 6, min: 0.1 }).forEach(item => {
      const folder = String(item.note.folderPath || '').trim();
      if (folder && folder !== ownFolder) folderScore.set(folder, (folderScore.get(folder) || 0) + item.score);
    });
    const bestFolder = [...folderScore.entries()].sort((a, b) => b[1] - a[1])[0];
    if (bestFolder && bestFolder[1] >= 0.25) out.push({ kind: 'folder', value: bestFolder[0], reason: 'The notes most similar to this one are in this folder.' });

    const text = `${title}\n${body}`;
    const guess = TYPE_RULES.map(([type, pattern, need]) => ({ type, hits: (text.match(pattern) || []).length, need }))
      .filter(item => item.hits >= item.need).sort((a, b) => b.hits - a.hits)[0];
    if (guess && note.noteType !== guess.type) out.push({ kind: 'type', value: guess.type, reason: `Its wording looks like ${guess.type} notes.` });

    duplicates(note, list).forEach(item => out.push({ kind: 'duplicate', value: item.note.id, title: item.note.title, reason: item.reason }));
    return out;
  }

  // Grounding label for an answer. It never says the answer came from the notes unless a source was cited.
  function provenance(text, sources) {
    const list = (Array.isArray(sources) ? sources : []).filter(source => source && source.id);
    if (!list.length) return { kind: 'general', label: 'AI answer · not from your notes', cited: [] };
    const cited = [...new Set([...String(text || '').matchAll(/\[(\d{1,2})\]/g)].map(match => Number(match[1])))]
      .filter(n => list.some(source => source.n === n));
    if (!cited.length) return { kind: 'context', label: 'Used your notes as context · no specific citation', cited: [] };
    return { kind: 'cited', label: `From your notes · ${cited.length} of ${list.length} source${list.length === 1 ? '' : 's'} cited`, cited };
  }

  // Follow-up questions built from the material that was retrieved, not from the model.
  function followUps(question, sources, folderLabel = '') {
    const list = (Array.isArray(sources) ? sources : []).filter(source => source && source.id && source.title);
    if (!list.length) return [];
    const asked = new Set(tokenize(question));
    const out = [];
    const top = list.find(source => source.passage || source.text) || list[0];
    const counts = new Map();
    tokenize(top.passage || top.text || '').forEach(term => { if (!asked.has(term)) counts.set(term, (counts.get(term) || 0) + 1); });
    const term = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0];
    if (term) out.push(`What does \u201c${top.title}\u201d say about ${term[0]}?`);
    if (list.length >= 2) out.push(`How do \u201c${list[0].title}\u201d and \u201c${list[1].title}\u201d differ?`);
    if (folderLabel) out.push(`What are the main points across ${folderLabel}?`);
    return out.slice(0, 3);
  }

  const api = { tokenize, related, duplicates, linkSuggestions, organize, provenance, followUps, linkedTitlesOf, foldTitle, plain, indexFor };
  window.NzConn = api;
})();
