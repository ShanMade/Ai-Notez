// Reader v2 — editorial note view (design A)
//
// The note becomes the page: a single 46rem column, a hairline sticky header
// with a reading arc, section numbers in the margin, and the assistant behind
// a command bar instead of a permanent dock.
//
// Nothing here replaces existing behaviour: the original reader toolbar is
// moved into the article (all handlers intact), the assistant is still the
// same panel, and typography preferences write to the settings the app
// already uses.

(function () {
  'use strict';

  const $ = (selector, scope) => (scope || document).querySelector(selector);
  const $$ = (selector, scope) => Array.from((scope || document).querySelectorAll(selector));
  const root = document.documentElement;

  const FACE_KEY = 'notez-reader-face-v1';
  const READING_KEY = 'notez-reading-v1';
  const SIZE_KEY = 'notez-reader-size-v2';
  const SIZES = [15, 16, 17, 18.5, 20];
  const DEFAULT_SIZE = 17;
  const ARC_LENGTH = 50.27; // 2πr, r = 8

  const store = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch {} }
  };

  function toast(message) {
    if (typeof window.toast === 'function') { window.toast(message); return; }
    const host = $('#toast-stack') || $('#toast');
    if (!host) return;
    const note = document.createElement('div');
    note.className = 'toast';
    note.textContent = message;
    host.append(note);
    setTimeout(() => note.remove(), 2400);
  }

  // ---------------------------------------------------------------- layout
  // The bar is created once and reused for every note.
  let bar = null;
  let arcFill = null;
  let barTitle = null;

  function ensureBar() {
    const view = $('#note-view');
    if (!view) return null;
    if (bar && bar.isConnected) return bar;

    bar = document.createElement('header');
    bar.className = 'rv2-bar';
    bar.id = 'rv2-bar';
    bar.innerHTML = `
      <div class="rv2-bar-in">
        <button type="button" class="rv2-icon rv2-menu" id="rv2-menu" aria-label="Open workspace menu" title="Menu">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
        </button>
        <button type="button" class="rv2-icon rv2-back" id="rv2-back" aria-label="Back" title="Back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5m0 0 6-6m-6 6 6 6"/></svg>
        </button>
        <span class="rv2-title" id="rv2-bar-title"></span>
        <svg class="rv2-arc" viewBox="0 0 20 20" aria-hidden="true">
          <circle class="track" cx="10" cy="10" r="8"/>
          <circle class="fill" id="rv2-arc-fill" cx="10" cy="10" r="8" stroke-dasharray="${ARC_LENGTH}" stroke-dashoffset="${ARC_LENGTH}" transform="rotate(-90 10 10)"/>
        </svg>
        <span class="rv2-grow"></span>
        <button type="button" class="rv2-icon" id="rv2-contents" aria-label="Contents" title="Contents">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h11M4 17h7"/></svg>
        </button>
        <button type="button" class="rv2-icon face" id="rv2-face" aria-label="Switch body typeface" title="Serif / sans body">Aa</button>
        <button type="button" class="rv2-icon" id="rv2-smaller" aria-label="Smaller text" title="Smaller text">A−</button>
        <button type="button" class="rv2-icon" id="rv2-larger" aria-label="Larger text" title="Larger text">A+</button>
        <span class="rv2-sep" aria-hidden="true"></span>
        <button type="button" class="rv2-icon" id="rv2-theme" aria-label="Toggle light and dark" title="Toggle light and dark">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.2A8.2 8.2 0 1 1 9.8 4a6.6 6.6 0 0 0 10.2 10.2Z"/></svg>
        </button>
      </div>`;
    view.insertBefore(bar, view.firstChild);

    arcFill = $('#rv2-arc-fill', bar);
    barTitle = $('#rv2-bar-title', bar);

    $('#rv2-back', bar).addEventListener('click', () => $('#reader-back')?.click());
    $('#rv2-menu', bar).addEventListener('click', () => $('#mobile-menu')?.click());
    $('#rv2-theme', bar).addEventListener('click', () => $('#theme-toggle')?.click());
    $('#rv2-face', bar).addEventListener('click', toggleFace);
    $('#rv2-smaller', bar).addEventListener('click', () => stepReading(-1));
    $('#rv2-larger', bar).addEventListener('click', () => stepReading(1));
    $('#rv2-contents', bar).addEventListener('click', () => (contentsSheet.classList.contains('open') ? closeSheets() : openContents()));

    return bar;
  }

  // The article's action row is the app's original toolbar. Moving it keeps
  // every control (star, review, download, edit, AI, more, focus) working,
  // and the review popover still anchors to its real button.
  function placeToolbar() {
    const view = $('#note-view');
    const paper = $('#reader-paper');
    const row = $('.reader-toolbar-row');
    if (!view || !paper || !row) return;
    if (row.parentElement === paper) return;
    const anchor = $('#reader-outline') || $('#viewer-content');
    if (anchor && anchor.parentElement === paper) paper.insertBefore(row, anchor);
    else paper.insertBefore(row, paper.firstChild);
  }

  // -------------------------------------------------------------- ask bar
  const askBar = document.createElement('button');
  askBar.type = 'button';
  askBar.className = 'rv2-ask';
  askBar.id = 'rv2-ask';
  askBar.setAttribute('aria-controls', 'nz-ai');
  askBar.setAttribute('aria-expanded', 'false');
  askBar.innerHTML = '<span class="spark" aria-hidden="true">✦</span><span class="ph">Ask about this note…</span><kbd>⌘J</kbd>';

  const scrim = document.createElement('div');
  scrim.className = 'rv2-scrim';
  scrim.id = 'rv2-scrim';

  const contentsSheet = document.createElement('section');
  contentsSheet.className = 'rv2-sheet';
  contentsSheet.id = 'rv2-contents-sheet';
  contentsSheet.setAttribute('role', 'dialog');
  contentsSheet.setAttribute('aria-label', 'Contents');
  contentsSheet.innerHTML = `
    <header class="rv2-sheet-hd">
      <div><b>Contents</b><small id="rv2-toc-count">Sections</small></div>
      <button type="button" class="rv2-sheet-close" data-rv2-close>Esc</button>
    </header>
    <nav class="rv2-toc" id="rv2-toc"></nav>`;

  function mountChrome() {
    if (!askBar.isConnected) document.body.append(askBar);
    if (!scrim.isConnected) document.body.append(scrim);
    if (!contentsSheet.isConnected) document.body.append(contentsSheet);
  }

  // A Mac shows ⌘, everything else shows Ctrl.
  const isMac = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '');
  const hint = $('kbd', askBar);
  if (hint) hint.textContent = isMac ? '⌘ J' : 'Ctrl J';

  // ---------------------------------------------------------- reader state
  let reading = false;

  function setReading(next) {
    if (reading === next) { if (next) { ensureBar(); placeToolbar(); syncBarTitle(); } return; }
    reading = next;
    document.body.classList.toggle('rv2-reading', next);
    if (next) {
      ensureBar();
      placeToolbar();
      syncBarTitle();
      buildToc();
      updateScroll();
      syncPanelSheet();
    } else {
      closeSheets();
      document.body.classList.remove('rv2-sheet-open');
      if ($('#nz-ai')) { root.classList.remove('nzai-sheet'); scrim.classList.remove('on'); }
    }
  }

  function syncBarTitle() {
    if (!barTitle) return;
    const title = ($('#reader-title')?.textContent || '').trim();
    barTitle.textContent = title;
    barTitle.title = title;
  }

  // ------------------------------------------------------------ typography
  function currentSize() {
    const raw = parseFloat(getComputedStyle(root).getPropertyValue('--read-size'));
    if (Number.isFinite(raw) && raw > 0) return raw;
    return Number(store.get(READING_KEY) ? JSON.parse(store.get(READING_KEY) || '{}').size : 0) || DEFAULT_SIZE;
  }

  function applySize(px, persist) {
    const size = Math.min(20, Math.max(15, Math.round(px * 2) / 2));
    root.style.setProperty('--read-size', `${size}px`);
    if (persist) {
      let saved = {};
      try { saved = JSON.parse(store.get(READING_KEY) || '{}') || {}; } catch { saved = {}; }
      saved.size = size;
      store.set(READING_KEY, JSON.stringify(saved));
      store.set(SIZE_KEY, String(size));
    }
    $('#rv2-smaller')?.toggleAttribute('disabled', size <= 15);
    $('#rv2-larger')?.toggleAttribute('disabled', size >= 20);
    return size;
  }

  function stepReading(direction) {
    const index = SIZES.findIndex(px => px >= currentSize() - 0.01);
    const next = direction > 0
      ? SIZES[Math.min(SIZES.length - 1, (index < 0 ? SIZES.length - 1 : index) + 1)]
      : SIZES[Math.max(0, (index < 0 ? 0 : index) - 1)];
    applySize(next, true);
  }

  function toggleFace() {
    const next = root.getAttribute('data-reader-face') === 'serif' ? 'sans' : 'serif';
    root.setAttribute('data-reader-face', next);
    store.set(FACE_KEY, next);
    toast(next === 'serif' ? 'Serif body' : 'Sans body');
  }

  function initTypography() {
    const face = store.get(FACE_KEY);
    root.setAttribute('data-reader-face', face === 'serif' ? 'serif' : 'sans');

    const own = Number(store.get(SIZE_KEY));
    if (own > 0) { applySize(own, false); return; }

    // The app has always written its own default (14px) on boot, so a stored
    // 14 means "never chose". Anything the reader actually picked is kept.
    let legacy = 0;
    try { legacy = Number(JSON.parse(store.get(READING_KEY) || '{}').size) || 0; } catch { legacy = 0; }
    applySize(legacy > 14 ? legacy : DEFAULT_SIZE, true);
  }

  // ------------------------------------------------------------------ toc
  let tocTimer = 0;

  function buildToc() {
    const toc = $('#rv2-toc');
    const content = $('#viewer-content');
    if (!toc || !content) return;
    const headings = $$('h2, h3', content).filter(heading => heading.textContent.trim());
    toc.replaceChildren();
    let section = 0;
    headings.forEach(heading => {
      const isTop = heading.tagName === 'H2';
      if (isTop) section += 1;
      const button = document.createElement('button');
      button.type = 'button';
      if (!isTop) button.classList.add('sub');
      const number = document.createElement('span');
      number.className = 'n';
      number.textContent = isTop ? String(section).padStart(2, '0') : '';
      const label = document.createElement('span');
      label.textContent = heading.textContent.trim();
      button.append(number, label);
      button.dataset.rv2Target = heading.id || '';
      button.addEventListener('click', () => {
        closeSheets();
        if (!heading.id) heading.id = `rv2-h-${section}-${Math.random().toString(36).slice(2, 7)}`;
        heading.scrollIntoView({ block: 'start', behavior: 'smooth' });
      });
      toc.append(button);
    });
    const count = $('#rv2-toc-count');
    if (count) count.textContent = headings.length ? `${section} section${section === 1 ? '' : 's'} · ${headings.length} headings` : 'No headings yet';
    contentsSheet.hidden = headings.length === 0;
  }

  function queueToc() {
    clearTimeout(tocTimer);
    tocTimer = setTimeout(() => { placeToolbar(); syncBarTitle(); buildToc(); updateScroll(); }, 60);
  }

  // -------------------------------------------------------------- scrolling
  function updateScroll() {
    const scroller = $('#workspace-main');
    if (!scroller) return;
    const max = scroller.scrollHeight - scroller.clientHeight;
    const top = scroller.scrollTop;
    const ratio = max > 0 ? Math.min(1, Math.max(0, top / max)) : 0;

    if (arcFill) arcFill.setAttribute('stroke-dashoffset', String(ARC_LENGTH * (1 - ratio)));
    if (bar) bar.classList.toggle('stuck', top > 36);

    const content = $('#viewer-content');
    if (!content) return;
    $$('h2', content).forEach(heading => {
      heading.classList.toggle('rv2-seen', heading.getBoundingClientRect().bottom < 120);
    });

    const tocItems = $$('#rv2-toc button');
    if (!tocItems.length) return;
    const headings = $$('h2, h3', content);
    let activeId = headings.length ? headings[0].id : '';
    headings.forEach(heading => {
      if (heading.getBoundingClientRect().top <= 150) activeId = heading.id;
    });
    tocItems.forEach(item => item.classList.toggle('on', item.dataset.rv2Target === activeId));
  }

  // -------------------------------------------------------------- sheets
  function openContents() {
    buildToc();
    contentsSheet.classList.add('open');
    scrim.classList.add('on');
    document.body.classList.add('rv2-sheet-open');
  }

  function closeSheets() {
    contentsSheet.classList.remove('open');
    const assistantSheet = root.classList.contains('nzai-sheet');
    if (assistantSheet) scrim.classList.add('on');
    else { scrim.classList.remove('on'); document.body.classList.remove('rv2-sheet-open'); }
  }

  // ----------------------------------------------------------- the assistant
  // The panel is the app's own NotezAi dock; while the reader is open it is
  // presented as a sheet over the note instead of a column beside it.
  let panelWatch = null;
  let panelEl = null;

  function syncPanelSheet() {
    panelEl = $('#nz-ai');
    if (!panelEl) return false;
    const open = !panelEl.hidden;
    askBar.setAttribute('aria-expanded', String(open));
    const sheet = open && reading;
    root.classList.toggle('nzai-sheet', sheet);
    document.body.classList.toggle('rv2-sheet-open', sheet || contentsSheet.classList.contains('open'));
    if (sheet) scrim.classList.add('on');
    else if (!contentsSheet.classList.contains('open')) scrim.classList.remove('on');
    return true;
  }

  function watchPanel() {
    const panel = $('#nz-ai');
    if (!panel || panel === panelEl) return;
    panelEl = panel;
    if (panelWatch) panelWatch.disconnect();
    panelWatch = new MutationObserver(() => syncPanelSheet());
    panelWatch.observe(panel, { attributes: true, attributeFilter: ['hidden', 'class'] });
    syncPanelSheet();
  }

  function openAssistant(text) {
    $('#reader-ai')?.click();
    watchPanel();
    // The panel renders on the next frame; retry briefly for the input.
    if (text) deliverToAssistant(text, 0);
  }

  function deliverToAssistant(text, attempt) {
    const input = $('#nzai-input');
    if (input && !input.disabled) {
      input.value = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.style.height = 'auto';
      input.style.height = `${Math.min(160, input.scrollHeight)}px`;
      $('[data-nzai="send"]')?.click();
      return;
    }
    if (attempt < 12) setTimeout(() => deliverToAssistant(text, attempt + 1), 90);
  }

  // ----------------------------------------------------------------- wiring
  function wire() {
    initTypography();
    mountChrome();

    askBar.addEventListener('click', () => openAssistant(''));
    scrim.addEventListener('click', () => {
      if (root.classList.contains('nzai-sheet')) $('#nz-ai [data-nzai="close"]')?.click();
      closeSheets();
    });
    contentsSheet.addEventListener('click', event => {
      if (event.target.closest('[data-rv2-close]')) closeSheets();
    });

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && contentsSheet.classList.contains('open')) { closeSheets(); return; }
      if ((event.metaKey || event.ctrlKey) && (event.key || '').toLowerCase() === 'j') {
        if (!reading) return;
        // Do not steal the shortcut while typing in a field.
        const tag = (document.activeElement?.tagName || '').toLowerCase();
        if (['input', 'textarea'].includes(tag) || document.activeElement?.isContentEditable) return;
        event.preventDefault();
        openAssistant('');
      }
    });

    const scroller = $('#workspace-main');
    if (scroller) scroller.addEventListener('scroll', updateScroll, { passive: true });
    window.addEventListener('resize', updateScroll);

    // Reader state follows the app's own page switch.
    const view = $('#note-view');
    if (view) {
      new MutationObserver(() => setReading(!view.classList.contains('hidden'))).observe(view, { attributes: true, attributeFilter: ['class'] });
      setReading(!view.classList.contains('hidden'));
    }

    // Headings are re-rendered with every note and attachment.
    const content = $('#viewer-content');
    if (content) new MutationObserver(queueToc).observe(content, { childList: true, subtree: true });

    // The panel is created lazily on first open.
    new MutationObserver(() => watchPanel()).observe(document.body, { childList: true });
    watchPanel();

    // Keep the header title in step with the rendered note.
    const title = $('#reader-title');
    if (title) new MutationObserver(syncBarTitle).observe(title, { childList: true, characterData: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
