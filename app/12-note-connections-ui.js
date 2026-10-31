// Connections panel for the reader: suggestions, related notes, duplicates and
// linked notes. Built on NzConn (app/11-note-connections.js).
//
// Nothing is changed on its own. Each change needs a click on Accept, Save, or
// Add link, and dismissed suggestions are remembered on this device.
(function () {
  const DISMISS_KEY = 'nz-conn-dismissed-v1';
  const KIND_LABEL = { title: 'Recommended title', tag: 'Tag', folder: 'Folder', type: 'Note type' };
  let panelOpen = true;
  let refreshTimer = 0;

  const dismissed = () => {
    try { return new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]')); } catch { return new Set(); }
  };
  const dismissKey = (note, kind, value) => `${note.id}|${kind}|${value}`;
  function dismiss(note, kind, value) {
    const list = [...dismissed(), dismissKey(note, kind, value)].slice(-500);
    try { localStorage.setItem(DISMISS_KEY, JSON.stringify(list)); } catch { /* storage full: the suggestion returns next time */ }
  }

  function applySuggestion(note, kind, raw) {
    const value = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!value) return;
    if (kind === 'title') note.title = value.slice(0, 120);
    else if (kind === 'tag') note.tags = [...new Set([...(note.tags || []), value.toLowerCase()])].slice(0, 15);
    else if (kind === 'folder') { note.folderPath = value; note.subject = value.split('/')[0]; addFolderPath(value); }
    else if (kind === 'type') note.noteType = value;
    else return;
    note.updatedAt = Date.now();
    persistNote(note).catch(() => toast('Saved locally; sync is queued.', 'error'));
    renderEverything();
    const title = $('#reader-title'); if (title && kind === 'title') title.textContent = note.title;
    const subject = $('#reader-subject'); if (subject && kind === 'folder') subject.textContent = note.folderPath;
    nzRenderConnections(note);
  }

  // Add a [[link]] under a Related heading at the end of the note. Only runs on an explicit click.
  function addLink(note, target) {
    if (NzConn.linkedTitlesOf(note).has(NzConn.foldTitle(target.title))) { toast('Already linked.', 'info'); return; }
    const body = String(note.body || '').replace(/\s+$/, '');
    const line = `- [[${target.title}]]`;
    note.body = /^##\s+Related\s*$/m.test(body) ? `${body}\n${line}\n` : `${body}${body ? '\n\n' : ''}## Related\n${line}\n`;
    note.updatedAt = Date.now();
    persistNote(note).catch(() => toast('Saved locally; sync is queued.', 'error'));
    renderEverything();
    void renderNoteBody(note);
    nzRenderConnections(note);
    toast(`Linked to “${target.title}”.`, 'success');
  }

  function row(note, kind, value, reason, extraLabel = '') {
    const label = KIND_LABEL[kind] || kind;
    const shown = kind === 'tag' ? `#${value}` : value;
    return `<div class="nzc-row" data-kind="${esc(kind)}" data-value="${esc(value)}">
      <div class="nzc-main"><small>${esc(label)}${extraLabel ? ` · ${esc(extraLabel)}` : ''}</small><b>${esc(shown)}</b><em>${esc(reason)}</em>
        <input class="nzc-edit" type="text" maxlength="120" aria-label="Edit ${esc(label.toLowerCase())}" value="${esc(value)}"></div>
      <div class="nzc-acts">
        <button type="button" data-conn="accept">Accept</button>
        <button type="button" class="nzc-edit-btn" data-conn="edit">Edit</button>
        <button type="button" class="nzc-editonly" data-conn="save-edit">Save</button>
        <button type="button" class="nzc-editonly" data-conn="cancel-edit">Cancel</button>
        <button type="button" class="nzc-quiet" data-conn="dismiss">Dismiss</button>
      </div></div>`;
  }

  function noteRow(note, { reason = '', passage = '', shared = [], action = '', kind = '' } = {}) {
    const chips = shared.length ? `<span class="nzc-chips">${shared.map(term => `<span>${esc(term)}</span>`).join('')}</span>` : '';
    const quote = passage ? `<q>${esc(passage)}</q>` : '';
    return `<div class="nzc-row nzc-note"${kind ? ` data-kind="${esc(kind)}" data-value="${esc(note.id)}"` : ''}>
      <div class="nzc-main"><button type="button" class="nzc-open" data-conn="open" data-id="${esc(note.id)}">${esc(note.title || 'Untitled note')}</button>
        <small>${esc(note.folderPath || 'General')}${reason ? ` · ${esc(reason)}` : ''}</small>${chips}${quote}</div>
      <div class="nzc-acts">${action}</div></div>`;
  }

  function sectionHtml(title, body) {
    return body ? `<section class="nzc-sec"><h4>${esc(title)}</h4>${body}</section>` : '';
  }

  function panelHtml(note) {
    const seen = dismissed();
    const organize = NzConn.organize(note, notes)
      .filter(item => item.kind !== 'duplicate' && !seen.has(dismissKey(note, item.kind, item.value)));
    const dups = NzConn.duplicates(note, notes).filter(item => !seen.has(dismissKey(note, 'duplicate', item.note.id)));
    const linked = NzConn.linkedTitlesOf(note);
    const related = NzConn.related(note, notes, { limit: 4 });
    const outgoing = [...linked].map(key => notes.find(item => NzConn.foldTitle(item.title) === key)).filter(Boolean).filter(item => item.id !== note.id);
    const incoming = backlinksFor(note);

    const suggestions = organize.map(item => item.kind === 'title' || item.kind === 'tag' || item.kind === 'folder' || item.kind === 'type'
      ? row(note, item.kind, item.value, item.reason) : '').join('');
    const dupHtml = dups.map(item => noteRow(item.note, {
      reason: item.reason,
      kind: 'duplicate',
      action: `<button type="button" class="nzc-save" data-conn="open" data-id="${esc(item.note.id)}">Compare</button><button type="button" class="nzc-quiet" data-conn="dismiss">Not a duplicate</button>`,
    })).join('');
    const relHtml = related.map(item => noteRow(item.note, {
      reason: `${Math.round(item.score * 100)}% similar`,
      passage: item.passage,
      shared: item.shared,
      action: linked.has(NzConn.foldTitle(item.note.title))
        ? '<span class="nzc-muted">Linked</span>'
        : `<button type="button" class="nzc-save" data-conn="link" data-id="${esc(item.note.id)}" title="Adds [[${esc(item.note.title)}]] under Related in this note">Add link</button>`,
    })).join('');
    const linkedHtml = [
      ...outgoing.map(item => noteRow(item, { reason: 'linked from this note', action: '' })),
      ...incoming.filter(item => !outgoing.some(out => out.id === item.id)).map(item => noteRow(item, { reason: 'links here', action: '' })),
    ].join('');

    const body = sectionHtml('Suggestions', suggestions) + sectionHtml('Possible duplicates', dupHtml)
      + sectionHtml('Related notes', relHtml) + sectionHtml('Linked notes', linkedHtml);
    const empty = `<p class="nzc-muted">No connections yet. Suggestions appear as you add notes that share topics.</p>`;
    return `<details class="nzc-panel" id="note-connections-details" ${panelOpen ? 'open' : ''}>
      <summary><span>Connections &amp; organize</span><span class="nzc-count">${organize.length + dups.length + related.length + linkedHtml.length ? '' : 'none yet'}</span></summary>
      <div class="nzc-body">${body || empty}</div></details>`;
  }

  function ensureSection() {
    let section = $('#note-connections');
    const viewer = $('#viewer-content');
    if (!viewer) return null;
    if (!section) {
      section = document.createElement('section');
      section.id = 'note-connections';
      section.className = 'nzc';
      section.setAttribute('aria-label', 'Note connections and suggestions');
      section.addEventListener('toggle', event => { if (event.target.id === 'note-connections-details') panelOpen = event.target.open; }, true);
      section.addEventListener('click', onClick);
      viewer.after(section);
    }
    return section;
  }

  function nzRenderConnections(note) {
    if (!note || currentPage !== 'reader' || activeId !== note.id) return;
    const section = ensureSection();
    if (!section) return;
    section.innerHTML = panelHtml(note);
  }

  function onClick(event) {
    const el = event.target.closest('[data-conn]');
    if (!el) return;
    const note = notes.find(item => item.id === activeId);
    if (!note) return;
    const act = el.dataset.conn;
    if (act === 'open') { openNote(el.dataset.id); return; }
    if (act === 'link') { const target = notes.find(item => item.id === el.dataset.id); if (target) addLink(note, target); return; }
    const rowEl = el.closest('.nzc-row');
    if (!rowEl) return;
    const kind = rowEl.dataset.kind, value = rowEl.dataset.value;
    if (act === 'edit') { rowEl.classList.add('editing'); rowEl.querySelector('.nzc-edit')?.focus(); return; }
    if (act === 'cancel-edit') { rowEl.classList.remove('editing'); return; }
    if (act === 'save-edit') { applySuggestion(note, kind, rowEl.querySelector('.nzc-edit').value); return; }
    if (act === 'accept') { applySuggestion(note, kind, value); return; }
    if (act === 'dismiss') { dismiss(note, kind, value); nzRenderConnections(note); }
  }

  // Source chips open the note and mark the passage the answer came from.
  function highlightPendingPassage(note) {
    const pending = window.nzPendingPassage;
    window.nzPendingPassage = null;
    if (!pending || pending.id !== note.id || !pending.text) return;
    const root = $('#viewer-content');
    const words = (String(pending.text).match(/[\p{L}\p{N}]+/gu) || []).slice(0, 8);
    if (!root || words.length < 3) return;
    const escape = word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const build = list => new RegExp(list.map(escape).join('[^\\p{L}\\p{N}]+'), 'iu');
    const patterns = [build(words), build(words.slice(0, 4))];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      for (const pattern of patterns) {
        const match = pattern.exec(node.textContent);
        if (!match) continue;
        const range = document.createRange();
        range.setStart(node, match.index);
        range.setEnd(node, match.index + match[0].length);
        const mark = document.createElement('mark');
        mark.className = 'nzc-passage';
        try { range.surroundContents(mark); } catch { return toast('Opened the note. The passage is not shown as plain text here.', 'info'); }
        mark.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return;
      }
    }
    toast('Opened the note. The exact passage could not be located in the text.', 'info');
  }

  // Called after a note body is rendered in the reader.
  window.nzAfterNoteRender = note => {
    nzRenderConnections(note);
    highlightPendingPassage(note);
  };

  // Called on every note save. Keeps the panel in step while the user writes.
  window.nzNoteChanged = () => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      const note = notes.find(item => item.id === activeId);
      if (note) nzRenderConnections(note);
    }, 400);
  };
})();
