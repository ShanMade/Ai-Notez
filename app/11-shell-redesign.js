/* Notez shell redesign: adds a top tab bar (desktop and tablet) and a floating bottom dock (phone).
   Purely additive. Every control proxies to existing handlers and no existing element is removed. */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const ICON = {
    home: '<path d="m3.8 10.6 8.2-6.8 8.2 6.8v8.2a1.4 1.4 0 0 1-1.4 1.4h-13a1.4 1.4 0 0 1-1.4-1.4v-8.2Z"/>',
    notes: '<rect x="4.5" y="4.5" width="6" height="6" rx="1"/><rect x="13.5" y="4.5" width="6" height="6" rx="1"/><rect x="4.5" y="13.5" width="6" height="6" rx="1"/><rect x="13.5" y="13.5" width="6" height="6" rx="1"/>',
    star: '<path d="m12 3.8 2.55 5.17 5.7.83-4.12 4.02.97 5.68L12 16.82l-5.1 2.68.97-5.68-4.12-4.02 5.7-.83L12 3.8Z"/>',
    recent: '<circle cx="12" cy="12" r="8.2"/><path d="M12 7.5V12l3 2"/>',
    review: '<circle cx="12" cy="12" r="8.2"/><path d="m8.5 12.2 2.3 2.3 4.7-4.9"/>',
    mic: '<rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"/>',
    spark: '<path d="M12 3.5 13.8 9l5.7 1.8-5.7 1.8L12 18l-1.8-5.4L4.5 10.8 10.2 9 12 3.5Z"/>',
    more: '<path d="M5 7h14M5 12h14M5 17h14"/>',
    folder: '<path d="M4 7.5a1.5 1.5 0 0 1 1.5-1.5h4l2 2h7A1.5 1.5 0 0 1 20 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5v-10Z"/>'
  };
  const svg = (k, w = 1.6) => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;
  const TABS = [['home', 'Home'], ['all', 'Notes'], ['starred', 'Starred'], ['recent', 'Recent'], ['review', 'Review']];

  function go(page) {
    const item = $(`.sidebar .nav-item[data-page="${page}"]`);
    if (item) item.click();
    else if (typeof navigateToPage === 'function') navigateToPage(page);
  }
  function openAi() { if (typeof openNotezAi === 'function') openNotezAi(null); }
  function openRec() { if (typeof openRecorder === 'function') openRecorder(); }

  function build() {
    const shell = $('#app-shell'), top = $('.topbar');
    if (!shell || !top || $('#nz-tabs')) return;

    // Tab bar (desktop and tablet). The sidebar stays and becomes the Folders drawer.
    const tabs = document.createElement('nav');
    tabs.id = 'nz-tabs'; tabs.className = 'nz-tabs'; tabs.setAttribute('aria-label', 'Sections');
    tabs.innerHTML = TABS.map(([p, l]) => `<button type="button" class="nz-tab" data-nz-page="${p}">${svg(p === 'all' ? 'notes' : p === 'starred' ? 'star' : p)}<span>${l}</span></button>`).join('')
      + `<button type="button" class="nz-tab nz-tab-folders" data-nz="folders" aria-haspopup="true" aria-expanded="false">${svg('folder')}<span>Folders</span></button>`;
    const ctx = $('.top-context', top);
    (ctx || top.firstChild).after(tabs);

    // Floating dock (phone).
    const dock = document.createElement('nav');
    dock.id = 'nz-dock'; dock.className = 'nz-dock'; dock.setAttribute('aria-label', 'Main navigation');
    dock.innerHTML =
      `<button type="button" data-nz-page="home">${svg('home')}<span>Home</span></button>` +
      `<button type="button" data-nz-page="all">${svg('notes')}<span>Notes</span></button>` +
      `<button type="button" class="nz-rec" data-nz="record" aria-label="Record a lecture">${svg('mic', 1.8)}</button>` +
      `<button type="button" data-nz="ai">${svg('spark')}<span>NotezAi</span></button>` +
      `<button type="button" data-nz="more" aria-haspopup="true">${svg('more')}<span>More</span></button>`;
    shell.appendChild(dock);

    const sync = () => {
      const active = $('.sidebar .nav-item.active')?.dataset.page || 'home';
      document.querySelectorAll('[data-nz-page]').forEach(b => {
        if (b.dataset.nzPage === active) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
      });
      const open = shell.classList.contains('mobile-nav-open');
      const f = $('.nz-tab-folders'); if (f) f.setAttribute('aria-expanded', String(open));
    };
    document.addEventListener('click', e => {
      const p = e.target.closest('[data-nz-page]');
      if (p) { go(p.dataset.nzPage); shell.classList.remove('mobile-nav-open'); return setTimeout(sync, 0); }
      const a = e.target.closest('[data-nz]'); if (!a) return;
      const k = a.dataset.nz;
      if (k === 'folders') { shell.classList.toggle('mobile-nav-open'); sync(); }
      else if (k === 'record') openRec();
      else if (k === 'ai') openAi();
      else if (k === 'more') $('#top-avatar')?.click();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && shell.classList.contains('mobile-nav-open')) { shell.classList.remove('mobile-nav-open'); sync(); }
    });
    const side = $('.sidebar');
    if (side) new MutationObserver(sync).observe(side, { attributes: true, subtree: true, attributeFilter: ['class'] });
    new MutationObserver(sync).observe(shell, { attributes: true, attributeFilter: ['class'] });
    // Mirror the live recording state onto the dock button.
    const rec = () => { const live = !!document.querySelector('#rec-pill, .rec-pill:not(.hidden)'); const b = $('.nz-rec'); if (b) b.classList.toggle('live', live); };
    new MutationObserver(rec).observe(document.body, { childList: true, subtree: true });
    sync(); rec();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
