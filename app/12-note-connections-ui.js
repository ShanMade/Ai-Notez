// Source passage highlighting: a source chip opens its note and marks the passage the answer used.
(function () {
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
  window.nzAfterNoteRender = note => highlightPendingPassage(note);
})();
