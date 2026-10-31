async function openWikiLink(title) {
      const target = noteByTitle(title);
      if (target) return openNote(target.id);
      if (await uiConfirm({ title: `No note called “${title}”`, message: 'Create a new note with this title and link to it?', confirmLabel: 'Create note' })) {
        openEditor(); setTimeout(() => { const input = $('#note-title-input'); if (input) input.value = title; }, 60);
      }
    }
    $('#viewer-content').addEventListener('click', event => {
      const link = event.target.closest('a.nz-wiki');
      if (!link) return;
      event.preventDefault();
      openWikiLink(link.dataset.wiki);
    });
    function printableNote(note) {
      const body = markdownToHtml(note.body || '');
      return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(note.title)}</title><style>
        body { font: 12.5pt/1.6 Georgia, 'Noto Naskh Arabic', serif; color: #111; margin: 0; padding: 24px 32px; }
        h1 { font-size: 22pt; margin: 0 0 4pt; } .meta { font: 9pt system-ui, sans-serif; color: #555; margin-bottom: 14pt; border-bottom: 1px solid #ccc; padding-bottom: 8pt; }
        h2 { font-size: 15pt; margin: 14pt 0 4pt; } h3 { font-size: 13pt; } pre, code { font-family: ui-monospace, monospace; font-size: 10pt; }
        pre { background: #f4f4f4; padding: 8pt; white-space: pre-wrap; } blockquote { border-left: 3px solid #bbb; margin: 8pt 0; padding-left: 10pt; color: #333; }
        table { border-collapse: collapse; } td, th { border: 1px solid #999; padding: 3pt 6pt; } a { color: #111; text-decoration: none; }
        @page { margin: 18mm; }
      </style></head><body><h1>${esc(note.title)}</h1><div class="meta">${esc(note.folderPath || 'General')} · ${new Date(note.updatedAt).toLocaleDateString()}${(note.tags || []).length ? ' · ' + esc(note.tags.join(', ')) : ''}</div>${body || '<p><em>This note has no readable text. Open the original file to view it.</em></p>'}</body></html>`;
    }
    function printNote(note) {
      if (!note) return;
      const frame = document.createElement('iframe');
      frame.setAttribute('aria-hidden', 'true');
      frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
      document.body.appendChild(frame);
      frame.srcdoc = printableNote(note);
      frame.onload = () => { try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch (error) { toast('Your browser blocked printing. Try Export as JSON instead.', 'error'); } setTimeout(() => frame.remove(), 1500); };
    }

    // ================= Quick capture + weekly digest =================
    async function quickCaptureFromClipboard() {
      let text = '';
      try { text = await navigator.clipboard.readText(); } catch { text = ''; }
      text = String(text || '').replace(/\r/g, '').trim();
      if (!text) { toast('Nothing to paste. Copy some text first, or allow clipboard access.', 'error', 5200); return; }
      const firstLine = text.split('\n').find(line => line.trim()) || 'Captured note';
      const stamp = Date.now();
      const created = normalizeNote({ id: uid(), title: firstLine.replace(/^#+\s*/, '').slice(0, 80) || 'Captured note', subject: 'Captured', folderPath: currentFolderPath || 'Captured', tags: ['captured'], kind: 'markdown', body: text.slice(0, 120000), createdAt: stamp, updatedAt: stamp, lastViewedAt: stamp });
      notes = [created, ...notes]; addFolderPath(created.folderPath);
      persistNote(created).catch(() => toast('Saved locally; sync is queued.', 'error'));
      renderEverything(); openNote(created.id); toast('Captured as a new note.');
    }
    $('#top-new-note')?.addEventListener('contextmenu', event => { event.preventDefault(); quickCaptureFromClipboard(); });
    document.addEventListener('keydown', event => {
      if (event.altKey && event.shiftKey && String(event.key).toLowerCase() === 'n' && currentSession) { event.preventDefault(); quickCaptureFromClipboard(); }
    });

    function weekDigest() {
      const weekAgo = Date.now() - 7 * 864e5, list = Array.isArray(notes) ? notes : [];
      const added = list.filter(note => (note.createdAt || 0) >= weekAgo).length;
      const reviewed = list.reduce((sum, note) => sum + ((note.lastReviewedAt || 0) >= weekAgo ? 1 : 0), 0);
      const covered = list.filter(note => progressOf(note) >= 0.9 && (progressMap[note.id]?.at || 0) >= weekAgo).length;
      let minutes = 0, activeDays = 0;
      try { const days = JSON.parse(localStorage.getItem('notez-focus-v1'))?.days || {}; Object.entries(days).forEach(([key, value]) => { if (new Date(key + 'T00:00:00').getTime() >= weekAgo - 864e5) { minutes += Number(value) || 0; if (value) activeDays++; } }); } catch {}
      return { added, reviewed, covered, minutes, activeDays };
    }
    function renderWeeklyDigest() {
      const anchor = $('.dashboard-stats'); if (!anchor) return;
      let card = $('#week-digest');
      if (!card) { card = document.createElement('section'); card.id = 'week-digest'; card.className = 'week-digest'; card.setAttribute('aria-label', 'This week'); anchor.before(card); }
      const d = weekDigest();
      const items = [[d.added, d.added === 1 ? 'note added' : 'notes added'], [d.covered, d.covered === 1 ? 'note covered' : 'notes covered'], [d.reviewed, d.reviewed === 1 ? 'review done' : 'reviews done'], [d.minutes, 'focus minutes']];
      const empty = !d.added && !d.covered && !d.reviewed && !d.minutes;
      card.innerHTML = `<div class="digest-head"><b>This week</b><span>${empty ? 'Nothing logged yet. Open a note or start a focus session to begin.' : `${d.activeDays} active day${d.activeDays === 1 ? '' : 's'}`}</span></div>${empty ? '' : `<div class="digest-grid">${items.map(([value, label]) => `<div><strong>${value}</strong><small>${label}</small></div>`).join('')}</div>`}`;
    }
    setInterval(renderWeeklyDigest, 30000);

    // ================= Settings hub (one place for every setting) =================
    const HUB_SECTIONS = [
      ['general', 'General'], ['study', 'Study'], ['privacy', 'Privacy & security'], ['data', 'Data & backup'],
      ['ai', 'NotezAi'], ['help', 'Help & diagnostics'], ['account', 'Account']
    ];
    function hubRow(title, detail, action, button = 'Open') {
      return `<div class="hub-row"><div><b>${title}</b><small>${detail}</small></div><button type="button" class="nzai-primary hub-btn" data-hub="${action}">${button}</button></div>`;
    }
    function hubSectionBody(id) {
      const cloud = currentSession?.mode === 'cloud';
      const sizes = [['0.85', '85%'], ['0.9', '90%'], ['1', '100%'], ['1.1', '110%'], ['1.25', '125%']];
      const current = (() => { try { return localStorage.getItem('notez-ui-scale') || 'auto'; } catch { return 'auto'; } })();
      if (id === 'general') return `
        <h3>Appearance</h3>
        <div class="hub-row"><div><b>Theme</b><small>Light or dark. Follows your system the first time.</small></div><button type="button" class="nzai-primary hub-btn" data-hub="theme">${document.documentElement.dataset.theme === 'light' ? 'Switch to dark' : 'Switch to light'}</button></div>
        <div class="hub-row"><div><b>Display size</b><small>Fit more on screen or make text larger.</small></div><div class="hub-seg">${[['auto', 'Auto']].concat(sizes).map(([v, l]) => `<button type="button" data-hub-scale="${v}" aria-pressed="${String(current === v || (v === '1' && current === '1'))}">${l}</button>`).join('')}</div></div>
        <h3>Reading</h3>
        ${readingSettingsHtml()}
        <h3>Colour theme</h3>
        <div class="hub-row"><div><b>Accent colour</b><small>Changes buttons, highlights and the app logo. Saved on this device.</small></div><div class="hub-seg">${ACCENT_THEMES.map(([id, label, color]) => `<button type="button" data-hub-accent="${id}" aria-pressed="${String(currentAccent() === id)}" style="display:inline-flex;align-items:center;gap:6px"><span style="width:10px;height:10px;border-radius:50%;background:${color};display:inline-block"></span>${label}</button>`).join('')}</div></div>
        <h3>Keyboard</h3>
        ${hubRow('Keyboard shortcuts', 'See every shortcut. Press ? anywhere.', 'shortcuts')}`;
      if (id === 'study') return `
        <h3>Focus and goals</h3>
        <p class="hub-note">Use the Focus button (bottom right) to set your daily goal, exam date and timer.</p>
        ${hubRow('Focus timer', 'Pomodoro timer, daily goal, exam countdown and streak.', 'focus', 'Open')}
        ${hubRow('Weekly schedule', 'Which subject you study each day, and your off days.', 'schedule', 'Edit')}
        ${hubRow('Library insights', 'Coverage, activity and study statistics.', 'insights')}
        ${hubRow('Trash', 'Notes you deleted in the last 30 days.', 'trash')}`;
      if (id === 'privacy') return `
        <h3>Protection</h3>
        ${hubRow('App lock', 'Require a PIN to open Notez on this device.', 'lock', 'Set up')}
        ${hubRow('Account and privacy', 'Email verification, password reset and account deletion.', 'account-center')}
        <p class="hub-note">Notez stores your notes on this device, and in your account when you sign in. Nothing is shared with other people.</p>`;
      if (id === 'data') return `
        <h3>Backup</h3>
        ${hubRow('Export everything (ZIP)', 'Every note as files, in its folder structure.', 'export-all')}
        ${hubRow('Export notes (JSON)', 'A single file you can re-import.', 'export-json')}
        ${hubRow('Import Notez JSON', 'Restore from a JSON backup.', 'import-json')}
        <h3>Clean up</h3>
        ${hubRow('Find duplicate notes', 'Review notes with the same text.', 'duplicates')}
        ${hubRow('Clean up empty folders', 'Remove folders that hold no notes.', 'cleanup')}
        <h3>Storage</h3>${storageMeterHtml()}`;
      if (id === 'ai') return `
        <h3>NotezAi</h3>
        <p class="hub-note">NotezAi is included and works as a guest or signed in. Prefer your own free Gemini or Groq key (BYOK)? Switch the source below; Voice-to-Note follows it too.</p>
        <div class="hub-row"><div><b>Current AI source</b><small>${aiUsesManaged() ? 'NotezAi (default)' : 'My own key (BYOK)'}</small></div></div>
        ${hubRow('Open NotezAi', 'Chat about your notes, quizzes, summaries.', 'ai')}
        ${hubRow('AI source, key and model', 'Choose NotezAi or your own key (BYOK), plus model and response style.', 'ai-settings', 'Configure')}`;
      if (id === 'help') return `
        <h3>Diagnostics</h3>
        <p class="hub-note">If something goes wrong, copy this report and send it with a description of what you did. It contains no note text.</p>
        <pre class="hub-diag" id="hub-diag">${esc(diagnosticsText())}</pre>
        <div class="hub-row"><div><b>Copy report</b><small>Copies the details above to your clipboard.</small></div><button type="button" class="nzai-primary hub-btn" data-hub="copy-diag">Copy</button></div>`;
      return `
        <h3>Account</h3>
        <div class="hub-row"><div><b>${cloud ? 'Signed in' : 'Demo workspace'}</b><small>${cloud ? esc(currentSession.email || '') : 'Notes stay in this browser. Sign in to sync.'}</small></div></div>
        ${hubRow('Account and privacy', 'Verification, password reset, delete account.', 'account-center')}
        ${hubRow('Sign out or leave workspace', 'Return to the sign-in screen.', 'logout', 'Leave')}`;
    }
    function diagnosticsText() {
      let storage = '';
      try { storage = (JSON.parse(localStorage.getItem('notez-trash-v1-' + (currentSession?.mode === 'cloud' ? currentSession.user.uid : 'demo')) || '[]').length) + ' trashed'; } catch {}
      return [
        `Notez diagnostics · ${new Date().toISOString()}`,
        `Mode: ${currentSession ? currentSession.mode : 'signed out'}`,
        `Notes: ${Array.isArray(notes) ? notes.length : 0} · Folders: ${getAllFolderPaths().length}`,
        `Sync: ${($('#sync-label')?.textContent || '').trim() || 'n/a'} · Online: ${navigator.onLine ? 'yes' : 'no'}`,
        `Trash: ${storage || 'n/a'} · Theme: ${document.documentElement.dataset.theme || 'auto'} · Zoom: ${document.documentElement.style.zoom || '1'}`,
        `Browser: ${navigator.userAgent.slice(0, 160)}`,
        `Screen: ${innerWidth}×${innerHeight} · Language: ${navigator.language}`,
        `Service worker: ${'serviceWorker' in navigator ? 'supported' : 'not supported'} · Build: notez-v12`,
        `Recent errors (${NZ_ERRORS.length}):`,
        ...(NZ_ERRORS.length ? NZ_ERRORS.slice(0, 8).map(item => `  ${item.t.slice(11, 19)} ${item.kind}: ${item.message}`) : ['  none'])
      ].join('\n');
    }
    const HUB_ACTIONS = {
      theme: () => $('#theme-toggle')?.click(), shortcuts: () => $('#shortcuts-menu')?.click(), schedule: () => $('#schedule-menu')?.click(),
      insights: () => $('#insights-menu')?.click(), trash: () => $('#trash-menu')?.click(), lock: () => $('#lock-menu')?.click(), focus: () => setTimeout(() => window.nzToggleFocus?.(), 0),
      'account-center': () => $('#account-center-menu')?.click(), 'export-all': () => $('#export-all-menu')?.click(),
      'export-json': () => $('#export-library')?.click(), 'import-json': () => $('#import-backup')?.click(),
      duplicates: () => $('#dup-menu')?.click(), cleanup: () => $('#cleanup-folders-menu')?.click(),
      ai: () => openNotezAi(null), 'ai-settings': () => { openNotezAi(null); setTimeout(() => document.querySelector('[data-nzai="settings"]')?.click(), 60); },
      logout: () => $('#logout-button')?.click()
    };
    let hubSection = 'general';
    function showSettingsHub(section = hubSection) {
      hubSection = section;
      const dialog = showModal('settings-hub', 'Settings', `<div class="hub"><nav class="hub-nav" aria-label="Settings sections">${HUB_SECTIONS.map(([id, label]) => `<button type="button" data-hub-tab="${id}" aria-current="${id === section}">${label}</button>`).join('')}</nav><div class="hub-body" id="hub-body">${hubSectionBody(section)}</div></div>`, dialog => {
        dialog.firstElementChild.style.width = 'min(760px,100%)';
        dialog.oninput = event => { const input = event.target.closest('[data-read]'); if (!input) return; const key = input.dataset.read; const value = Number(input.value); const next = applyReading({ [key]: value }); const preview = dialog.querySelector('#rd-preview'); if (preview) { preview.style.fontSize = next.size + 'px'; preview.style.lineHeight = String(next.lh); } };
        dialog.onclick = event => {
          const tab = event.target.closest('[data-hub-tab]')?.dataset.hubTab;
          if (tab) return showSettingsHub(tab);
          if (event.target.closest('[data-hub=read-reset]')) { applyReading({ ...READ_DEFAULTS }); return showSettingsHub(section); }
          const accent = event.target.closest('[data-hub-accent]')?.dataset.hubAccent;
          if (accent) { applyAccent(accent); return showSettingsHub(section); }
          const scale = event.target.closest('[data-hub-scale]')?.dataset.hubScale;
          if (scale) { if (scale === 'auto') { try { localStorage.removeItem('notez-ui-scale'); } catch {} applyUiScale(autoUiScale()); } else { applyUiScale(scale); try { localStorage.setItem('notez-ui-scale', scale); } catch {} } return showSettingsHub(section); }
          const act = event.target.closest('[data-hub]')?.dataset.hub;
          if (!act) return;
          if (act === 'copy-diag') { navigator.clipboard?.writeText(diagnosticsText()).then(() => toast('Diagnostics copied.'), () => toast('Your browser blocked clipboard access.', 'error')); return; }
          dialog.hidden = true;
          HUB_ACTIONS[act]?.();
        };
      });
    }
    $('#settings-hub-menu').addEventListener('click', () => { closeAccountMenu(); showSettingsHub('general'); });
    $('#record-menu').addEventListener('click', () => { closeAccountMenu(); openRecorder(); });
    const hubFix = document.createElement('style');
    hubFix.textContent = `.hub{display:grid;grid-template-columns:180px 1fr;gap:18px;min-height:340px}.hub-nav{display:flex;flex-direction:column;gap:2px;border-right:1px solid rgba(128,148,170,.22);padding-right:12px}.hub-nav button{text-align:left;border:0;background:transparent;color:inherit;padding:8px 10px;border-radius:8px;cursor:pointer;font:600 12.5px system-ui,sans-serif;opacity:.7}.hub-nav button[aria-current="true"]{background:color-mix(in srgb, var(--nz-accent) 14%, transparent);color:var(--nz-accent);opacity:1}.hub-body h3{font:700 10.5px system-ui,sans-serif;letter-spacing:.09em;text-transform:uppercase;opacity:.55;margin:4px 0 8px}.hub-body h3:not(:first-child){margin-top:18px}.hub-row{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid rgba(128,148,170,.16)}.hub-row b{display:block;font-size:13px}.hub-row small,.hub-note{font-size:11.5px;opacity:.7;display:block;margin-top:2px}.hub-note{margin:0 0 8px}.hub-btn{white-space:nowrap}.hub-seg{display:flex;gap:4px;flex-wrap:wrap}.hub-seg button{border:1px solid rgba(128,148,170,.35);background:transparent;color:inherit;border-radius:7px;padding:5px 9px;font:600 11.5px system-ui,sans-serif;cursor:pointer}.hub-seg button[aria-pressed="true"]{background:var(--nz-accent);border-color:var(--nz-accent);color:#fff}.hub-diag{font:11px ui-monospace,monospace;white-space:pre-wrap;padding:10px;border-radius:9px;background:rgba(128,148,170,.1);max-height:180px;overflow:auto;margin:0 0 10px}@media(max-width:640px){.hub{grid-template-columns:1fr}.hub-nav{flex-direction:row;overflow:auto;border-right:0;border-bottom:1px solid rgba(128,148,170,.22);padding:0 0 8px}.hub-nav button{white-space:nowrap}}`;
    document.head.appendChild(hubFix);

    // ================= Dialog focus: trap Tab inside the open dialog, restore focus on close =================
    (function dialogFocusManager() {
      const visible = el => !el.hidden && el.getClientRects().length > 0;
      const focusable = root => [...root.querySelectorAll('button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter(visible);
      const openDialogs = () => [...document.querySelectorAll('.nz-modal-overlay, [role="dialog"][aria-modal="true"]')].filter(visible);
      const returns = new WeakMap();
      document.addEventListener('keydown', event => {
        if (event.key !== 'Tab') return;
        const top = openDialogs().pop(); if (!top) return;
        const items = focusable(top); if (!items.length) return;
        const first = items[0], last = items[items.length - 1];
        if (event.shiftKey && (document.activeElement === first || !top.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !top.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
      }, true);
      const watch = new MutationObserver(records => {
        records.forEach(record => {
          const el = record.target;
          if (el.getAttribute('role') !== 'dialog' || el.getAttribute('aria-modal') !== 'true') return;
          if (!el.hidden && record.oldValue === null) { returns.set(el, document.activeElement); setTimeout(() => { const first = focusable(el)[0]; first?.focus({ preventScroll: true }); }, 30); }
          if (el.hidden && record.oldValue !== 'hidden') {
            const back = returns.get(el);
            const target = back && back.isConnected && visible(back) ? back : (document.getElementById('top-avatar') && visible(document.getElementById('top-avatar')) ? document.getElementById('top-avatar') : null);
            target?.focus({ preventScroll: true });
          }
        });
      });
      watch.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['hidden'], attributeOldValue: true });
    })();

    // ================= Colour themes: each one has its own logo, cached on this device =================
    const ACCENT_THEMES = [['teal', 'Teal', '#085d43'], ['gold', 'Gold', '#9c7d14'], ['forest', 'Forest', '#0c4a2e'], ['sky', 'Sky', '#2c6e9e']];
    const ACCENT_ALIAS = { yellow: 'gold', green: 'forest', blue: 'sky' };
    const currentAccent = () => ACCENT_THEMES.some(([id]) => id === document.documentElement.dataset.accent) ? document.documentElement.dataset.accent : 'teal';
    function updateFaviconFromTheme() {
      const raw = getComputedStyle(document.documentElement).getPropertyValue('--nz-logo').trim();
      const match = raw.match(/url\("?(data:[^")]+)"?\)/);
      if (!match) return;
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
        const ctx = canvas.getContext('2d'), k = Math.min(60 / img.width, 60 / img.height), w = img.width * k, h = img.height * k;
        ctx.drawImage(img, (64 - w) / 2, (64 - h) / 2, w, h);
        let link = document.querySelector('link[rel="icon"]');
        if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
        link.type = 'image/png'; link.href = canvas.toDataURL('image/png');
      };
      img.src = match[1];
    }
    function applyAccent(name) {
      name = ACCENT_ALIAS[name] || name;
      if (!ACCENT_THEMES.some(([id]) => id === name)) return;
      document.documentElement.dataset.accent = name;
      try { localStorage.setItem('notez-accent-v1', name); } catch {}
      updateFaviconFromTheme();
      const label = ACCENT_THEMES.find(([id]) => id === name)[1];
      toast(`${label} theme applied.`);
    }
    updateFaviconFromTheme();

    // ================= Live recording: real-time notes with provider failover =================
    // ---- chunk length -------------------------------------------------------
    // How much audio one transcription request carries. Longer chunks mean fewer
    // requests, so the daily allowance covers far more audio; shorter chunks put
    // words on screen sooner. 40 s is the ceiling: a failed part costs at most 40
    // seconds of retry, and the payload stays small enough to retry over a phone line.
    //
    // Tokens are not the limit here. Gemini counts audio at 32 tokens a second,
    // so even a minute of speech is ~1,900 input tokens: with the prompt, a part
    // is ~3,000 tokens, and a minute-sized part is one request a minute, about
    // 3,000 tokens per minute — 1.5% of a 200,000 tokens-per-minute allowance.
    // What runs out first is the request count (requests per minute and per day).
    const REC_CHUNK_KEY = 'notez-rec-chunk-v1';
    const REC_CHUNK_CHOICES = [20000, 30000, 40000];
    const REC_CHUNK_DEFAULT = 40000;
    const REC_CHUNK_FIRST = 20000;      // the first part is short so text appears fast
    // The author's account has no transcript-length limit in the app: it is offered
    // longer parts too. 4 minutes is the most one audio payload the backend accepts
    // (about 1.5 MB encoded at this bitrate), so that is the ceiling there.
    const REC_AUTHOR_EMAIL = 'zeeshandoes3d@gmail.com';
    const recNoLimits = () => String(currentSession?.email || currentSession?.user?.email || '').toLowerCase() === REC_AUTHOR_EMAIL;
    const recChunkChoices = () => (recNoLimits() ? [...REC_CHUNK_CHOICES, 60000, 120000, 240000] : REC_CHUNK_CHOICES);
    function recChunkMs() {
      const stored = Number(aiStore.get(REC_CHUNK_KEY, ''));
      const wanted = Number.isFinite(stored) && stored > 0 ? stored : REC_CHUNK_DEFAULT;
      const choices = recChunkChoices();
      const low = choices[0], high = choices[choices.length - 1];
      return Math.max(low, Math.min(high, Math.round(wanted / 5000) * 5000));
    }
    const recChunkSet = ms => aiStore.set(REC_CHUNK_KEY, String(ms));
    const REC_SEGMENT_MS = () => window.__REC_SEGMENT_MS || recChunkMs();
    const recChunkLabel = ms => `${Math.round(ms / 1000)} s`;
    // How long a finished part actually is, so the timeline can show it instead
    // of a timestamp that looked like the part's length.
    function recLengthLabel(ms) {
      const seconds = Math.max(0, Math.round((Number(ms) || 0) / 1000));
      if (seconds < 60) return `${seconds} s`;
      const minutes = Math.floor(seconds / 60), rest = seconds % 60;
      return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
    }
    // Shown in the recorder so the model in use is never a mystery.
    function recSttHint() {
      const chain = recSttModels().map(recModelLabel);
      return `Transcribed by ${chain[0]} with speaker labels. If it runs out of quota: ${chain.slice(1).join(', then ')}. Your own key is tried first, then NotezAi's service.`;
    }
    function recChunkHint(ms) {
      const perHour = Math.round(3600000 / ms);
      const hours = Math.round(500 * ms / 3600000 * 10) / 10;
      return `About ${perHour} request${perHour === 1 ? '' : 's'} an hour — roughly ${hours} hours of audio on a 500-request day.`;
    }
    function recChunkPicked(value) {
      const ms = Number(value) || REC_CHUNK_DEFAULT;
      recChunkSet(ms);
      const hint = $('#rec-chunk-hint');
      if (hint) hint.textContent = recChunkHint(recChunkMs());
      return ms;
    }
    document.addEventListener('change', event => {
      if (event.target?.id === 'rec-chunk') recChunkPicked(event.target.value);
    });
    // A hidden tab may delay timers until its next wake-up. On the way back, the
    // part that overran is closed at once instead of growing further.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && REC.status === REC_STATUS.RECORDING) recTick();
    });
    // Segment status constants
    const SEG_STATUS = { PENDING: 'pending', IN_PROGRESS: 'in_progress', COMPLETED: 'completed', FAILED: 'failed', NEEDS_RETRY: 'needs_retry' };
    // Recording status constants (separate from transcription status)
    const REC_STATUS = { IDLE: 'idle', RECORDING: 'recording', PAUSED: 'paused', FINALIZING: 'finishing', DONE: 'done' };
    // Every change of the session or a part goes through the tables in app/15-recording-state.js.
    // A move the table does not allow is logged and not applied.
    const recSession = () => ({ status: REC.status, starting: !!REC.starting, discarding: !!REC.discarding });
    function recMove(event) {
      const next = NzRecState.nextSession(recSession(), event);
      if (!next) { console.warn(`Recording: "${event}" is not allowed while the recording is ${REC.status}.`); return false; }
      REC.status = next.status; REC.starting = next.starting; REC.discarding = next.discarding;
      return true;
    }
    function recPartMove(index, event) {
      const next = NzRecState.nextPart(REC.segStatuses[index], event);
      if (!next) { console.warn(`Part ${index + 1}: "${event}" is not allowed from ${REC.segStatuses[index]}.`); return false; }
      REC.segStatuses[index] = next;
      return true;
    }
    const REC = { stream: null, recorder: null, mime: 'audio/webm', mode: 'class', renames: {}, dialog: null, timer: 0,
      status: 'idle', startedAt: 0, pausedMs: 0, pausedAt: 0, segIdx: 0, segTexts: [], segBlobs: [], segStatuses: [], queue: Promise.resolve(),
      noteId: '', provider: '', failovers: 0, notice: '', liveNotes: '', processed: 0, lastNotesAt: 0, busy: false, errors: 0, audioSaved: false,
      segMarks: [], segWall: [], speakerClips: {}, partMs: 0, partStartAt: 0, partDeadline: 0, partTimer: 0, baseMs: 0, stoppedMs: 0, discarding: false, starting: false, sttModel: '',
      histOpen: new Set() };
    const recMime = () => ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(type => window.MediaRecorder && MediaRecorder.isTypeSupported(type)) || 'audio/webm';
    // Audio time, not wall time: every continuation adds the time already
    // recorded, so part marks and the clock keep counting across a resume.
    const recElapsed = () => {
      if (REC.status === REC_STATUS.FINALIZING || REC.status === REC_STATUS.DONE) return REC.stoppedMs || REC.baseMs;
      return REC.baseMs + Math.max(0, (REC.status === REC_STATUS.PAUSED ? REC.pausedAt : Date.now()) - REC.startedAt - REC.pausedMs);
    };
    const fmtClock = ms => { const sec = Math.floor(ms / 1000), h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), x = sec % 60; return (h ? h + ':' : '') + String(m).padStart(2, '0') + ':' + String(x).padStart(2, '0'); };
    // Time of day on this device, not a stopwatch. A transcript is read days
    // later, so "14:05:12" tells you when a sentence was said; "Part 45 - 46 s"
    // only tells you how the audio was cut up. The clock is built by hand so it
    // does not pick up a locale's own separators or numerals.
    const recClockOf = ms => { const d = new Date(Number(ms) || Date.now()); return [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, '0')).join(':'); };
    // When a part began, on the wall clock. Parts are numbered internally for
    // retries, but a reader only ever sees the time.
    const recWallOf = index => Number(REC.segWall?.[index]) || Number(REC.startedAt) || Date.now();
    // "[02:14]" is an offset from the first second of its part, so the wall
    // time of a line is that part's start plus that offset.
    function recStampSeconds(stamp) {
      const found = String(stamp || '').match(/\d{1,2}(?::\d{1,2}){1,2}/);
      if (!found) return null;
      const bits = found[0].split(':').map(Number);
      return bits.length === 3 ? bits[0] * 3600 + bits[1] * 60 + bits[2] : bits[0] * 60 + (bits[1] || 0);
    }
    function recStampWall(partIndex, stamp) {
      const seconds = recStampSeconds(stamp);
      return seconds == null ? '' : recClockOf(recWallOf(partIndex) + seconds * 1000);
    }
    const recTransient = error => error?.status === 429 || error?.status >= 500 || error instanceof TypeError || error?.name === 'AbortError' || error?.code === 'cut';
    const recLabel = provider => provider === 'gemini' ? 'Gemini' : 'Groq';
    const recSleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    // Override the model with localStorage['notez-stt-model-v1'].
    // Gemini 3.5 Transcribe is the dedicated speech-to-text model: it labels up to
    // eight speakers itself, so the transcript arrives diarized instead of hoping
    // a chat model guesses the turns. The Live variant (gemini-3.5-transcribe-live)
    // streams audio over a WebSocket and cannot diarize, so it is not used here.
    // Voice-to-Note audio: Gemini 3.1 Flash-Lite first; a part moves to Gemini 3.5
    // Flash-Lite when the first is out of quota. Each model is tried on the user's
    // own key first, then on NotezAi's service (see recTranscribePart).
    // Voice-to-Note runs on Gemini 3.5 Flash-Lite only: no other Gemini model, no other provider.
    const REC_VOICE_MODEL = 'gemini-3.5-flash-lite';
    const REC_AUDIO_MODELS = [REC_VOICE_MODEL];
    const recSttModels = () => REC_AUDIO_MODELS;
    const recSttModel = () => REC_AUDIO_MODELS[0];
    const recModelLabel = model => model === 'gemini-3.1-flash-lite' ? 'Gemini 3.1 Flash-Lite'
      : model === 'gemini-3.5-flash-lite' ? 'Gemini 3.5 Flash-Lite' : model;
    // A model that is missing, rate limited or out of its daily free requests is
    // not a broken recording: the next model can still answer.
    const recModelExhausted = error => {
      if (typeof aiModelMissing === 'function' && aiModelMissing(error)) return true;
      return error?.status === 429 || /quota|exhaust|rate limit|resource_exhausted/i.test(String(error?.message || ''));
    };
    const recHasLabels = text => String(text || '').split('\n').some(line => recSpeakerOf(line));
    // The chat models that stand in for the transcription model cannot diarize,
    // and on some parts they return a clean transcript with no speaker labels at
    // all. That used to reach the note as plain paragraphs, so nothing could be
    // named and the voices looked broken. A short text-only pass labels the
    // part (no audio is sent again); it is kept only when every spoken word
    // survives it, so a model that summarises instead of labelling cannot
    // delete speech.
    async function recLabelPart(raw, index) {
      const text = String(raw || '').trim();
      if (!text || text.length < 40 || recHasLabels(text)) return text;
      try {
        const typed = await recTextCall(`${RECORD_LABEL_PASS}\n\n<transcript>\n${text}\n</transcript>`, { temperature: 0 });
        const labelled = String(typed || '').trim();
        if (labelled && recHasLabels(labelled) && recKeepsWords(text, labelled)) return labelled;
        if (labelled) console.warn(`Label pass on part ${index + 1} was rejected: labels or words did not survive.`);
      } catch (error) { console.warn(`Label pass failed on part ${index + 1}:`, error); }
      return text;
    }
    const recNormWord = word => String(word || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    const recWordList = text => (String(text || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
    // A part is 20 seconds, so a word or a sentence can straddle the cut. The
    // tail of what was already heard is handed to the next part, and whatever
    // the model repeats from it is removed, so nothing is lost and nothing is
    // said twice.
    const recTail = (text, chars = 320) => {
      const clean = String(text || '').replace(/\s+/g, ' ').trim();
      return clean.length > chars ? '…' + clean.slice(-chars) : clean;
    };
    function recBoundaryTail(index) {
      for (let i = index - 1; i >= 0; i--) { const text = REC.segTexts[i]; if (text && text.trim()) return recTail(text); }
      return '';
    }
    function recTrimOverlap(previous, current) {
      const lines = String(current || '').split('\n');
      const first = lines[0] || '';
      const label = (first.match(/^(\s*(?:\[[\d:]+\]\s*)?[^:\n]{1,40}:\s*)/) || [''])[0];
      const body = first.slice(label.length);
      const before = recWordList(recTail(previous, 600));
      const words = body.split(/\s+/).filter(Boolean);
      // A sentence that clearly finished is not expected to continue, so only a
      // longer echo there is real repetition. A sentence cut in the middle can
      // repeat as little as two words and still be the same thought.
      const finished = /[.!?…]["')\]]?\s*$/.test(String(previous || '').trim());
      for (let size = Math.min(16, before.length, words.length); size >= (finished ? 3 : 2); size--) {
        const head = words.slice(0, size).map(recNormWord).join(' ');
        if (!head || head !== before.slice(-size).join(' ')) continue;
        const rest = words.slice(size).join(' ');
        lines[0] = rest ? label + rest : '';
        return lines.filter((line, i) => i > 0 || line).join('\n').trim();
      }
      return String(current || '').trim();
    }
    // The audio of a part is freed as soon as it is transcribed, but a voice can
    // only be taught while its recording is still here. One clip per unnamed
    // speaker label is kept for exactly that.
    const REC_VOICE_CLIP_BYTES = 1000000;
    const REC_VOICE_CLIPS_MAX = 8;
    function recRememberVoiceClips(text, blob) {
      if (!blob || !blob.size || blob.size > REC_VOICE_CLIP_BYTES) return;
      const labels = new Set();
      String(text || '').split('\n').forEach(line => { const speaker = recSpeakerOf(line); if (speaker) labels.add(speaker.name); });
      for (const label of labels) {
        if (!/^Voice\s+\d+$/i.test(label)) continue;              // a known name already has its identity
        if (Object.keys(REC.speakerClips).length >= REC_VOICE_CLIPS_MAX) return;
        if (REC.speakerClips[label]) continue;
        REC.speakerClips[label] = { blob, at: Date.now() };
      }
    }
    // Naming a speaker is the app learning who that voice is: the identity is
    // saved in the background, with no extra prompt, no toast and nothing to
    // dismiss. The clip kept during the recording becomes its reference.
    async function recLearnNamedVoices(pairs) {
      if (typeof nzVoiceLearn !== 'function') return;
      for (const [label, name] of pairs) {
        try {
          await nzVoiceLearn(name, REC.speakerClips?.[label]?.blob || null);
          if (REC.speakerClips?.[label]) delete REC.speakerClips[label];
        } catch (error) { console.warn('Could not save the voice for', name, error); }
      }
    }
    const recKnownNames = () => (typeof nzVoiceNames === 'function' ? nzVoiceNames() : []);
    const recVoiceCount = () => (typeof nzVoices === 'function' ? nzVoices().length : 0);
    const recFold = value => String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    // A learned name is matched loosely: the model sometimes writes "Sir Ahmed."
    // or changes the spelling of a name it was given, and losing the chip over a
    // full stop is not a useful outcome.
    function recKnownMatch(name) {
      const wanted = recFold(name);
      if (!wanted) return '';
      return recKnownNames().find(known => recFold(known) === wanted) || '';
    }
    // Models label turns differently: Voice 2, Speaker 2, Speaker B (the usual
    // Gemini output when it ignores the "Voice n" instruction), bold labels and
    // a dash instead of a colon. All of them become a speaker turn, and the
    // numbered forms share one numbering so colours and naming still line up.
    // Arabic-Indic digits are digits too: a model writing Urdu can label a voice
    // "spk_١", and that still has to read as Voice 1.
    const recDigits = text => String(text || '').replace(/[\u0660-\u0669]/g, d => String(d.charCodeAt(0) - 0x0660));
    function recLabelName(name) {
      const raw = recUnmark(String(name || '')).replace(/\*+/g, '').trim();
      // Gemini says spk_1, spk_2 … and a chat model told to label turns often
      // says spk0, spk1, spk2. `recSpkZero` is set from the whole transcript, so
      // one recording is numbered one way and the first voice always reads
      // "Voice 1". A label is never shown raw.
      const spk = /^spk[\s_:-]*([0-9\u0660-\u0669]{1,2})$/i.exec(raw);
      if (spk) return `Voice ${Math.max(1, Number(recDigits(spk[1])) + (recSpkZero ? 1 : 0))}`;
      const numbered = /^(?:voice|speaker|person)[\s_:-]*([0-9\u0660-\u0669]{1,2})$/i.exec(raw);
      if (numbered) return `Voice ${Math.max(1, Number(recDigits(numbered[1])))}`;
      const letter = /^(?:speaker|person)\s*([A-Za-z])$/i.exec(raw);
      if (letter) return `Voice ${letter[1].toUpperCase().charCodeAt(0) - 64}`;
      return recKnownMatch(raw) || raw;
    }
    let recSpkZero = false;   // true while the current transcript labels its voices from 0
    // A saved note carries no live state, so its numbering is worked out from its
    // own words: one recording numbered from zero, the next from one.
    const recSpkZeroIn = text => /(?:^|\n)\s*(?:[-*•]\s+)?(?:\[[\d:]{3,12}\]\s*)?\**\s*spk[\s_:-]*0\s*\**\s*[:\uFF1A]/i.test(recUnmark(String(text || '')));
    const recWithSpkZero = (zero, run) => { const previous = recSpkZero; recSpkZero = zero; try { return run(); } finally { recSpkZero = previous; } };
    // A model writing Urdu or Hebrew often puts an invisible direction mark
    // (U+200F, U+200E …) in front of a line: "\u200Fspk0: …". The mark is not
    // part of the label, but it stopped the label regex from matching at the
    // start of the line, so a transcript showed raw "spk0:" and every voice
    // collapsed into the same colour. Marks are dropped before a line is read.
    const REC_BIDI_HEAD = /^[\u00ad\u180e\u200b-\u200f\u061c\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]+/;
    const REC_BIDI_ANY = /[\u00ad\u180e\u200b-\u200f\u061c\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]+/g;
    // Marks are removed wherever they sit (a model can also put one after a
    // timestamp or after bold asterisks), but a mark that opened the line is put
    // back afterwards, because that is what keeps a mixed Urdu line right-to-left.
    const recUnmark = line => String(line ?? '').replace(REC_BIDI_ANY, '');
    const recLeadMark = line => (String(line ?? '').match(REC_BIDI_HEAD) || [''])[0];
    // A model writing notes often puts a turn in a list item ("- Voice 1: …"),
    // so a bullet is allowed in front of the label and kept. The free-form
    // name alternative excludes [ and ]: a line that opens with a timestamp
    // but no speaker ("[00:00] our personality…") must NOT parse "[00" as a
    // label at the colon inside the timestamp — that read a real transcript
    // as a speaker named "[00", and (via recHasLabels) also suppressed the
    // label pass that would have fixed the line. No bracket-free name is
    // harmed: real labels are words, never timestamp fragments.
    const REC_LABEL_RE = /^\s*(?:[-*•–]\s+)?(?:\[([\d:]{3,12})\]\s*)?\**\s*((?:voice|speaker|person|spk)[\s_:-]*(?:[0-9\u0660-\u0669]{1,2}|[A-Za-z])|[^:\uFF1A\n\[\]]{1,40}?)\s*\**\s*(?:[:\uFF1A]\s*|\s+[-–—]\s+)(.*)$/i;
    function recSpeakerOf(line) {
      const match = String(recUnmark(line)).match(REC_LABEL_RE);
      if (!match) return null;
      const name = recLabelName(match[2]);
      const isVoice = /^Voice\s+\d+$/i.test(name);
      if (!name || name.length > 40) return null;   // any name the transcriber gives: Voice 2, Teacher, Student
      // A name made only of (two or more) digits — "00" from "00:00 …",
      // "12" from "12:34 …" — is a timestamp fragment the model left at the
      // line start, never a speaker. (Numbered forms are already normalized
      // to "Voice N" above, so real labels are unaffected.)
      if (!isVoice && /^\d{2,}$/.test(recDigits(name))) return null;
      return { stamp: match[1] || '', name, text: match[3] };
    }
    // A learned name keeps its colour; "Voice 3" keeps its number.
    function recSpeakerIndex(name) {
      const voice = /^Voice\s+(\d+)$/i.exec(name);
      if (voice) return Math.max(0, Number(voice[1]) - 1);
      const found = recKnownNames().findIndex(known => known.toLowerCase() === name.toLowerCase());
      if (found >= 0) return found;
      let hash = 0; for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) % 997;
      return hash;
    }

    // Runs the steps in order. A step that fails (network cut, rate limit, server error, cut-off reply) hands over to the next one.
    // A step can return a plain string or { text, provider }. The provider the
    // backend actually used wins: a managed request can be served by Groq even
    // though the step is called "gemini".
    const recStepResult = (result, step) => typeof result === 'string'
      ? { text: result, provider: step.name }
      : { text: String(result?.text || ''), provider: String(result?.provider || step.name) };
    async function recFailover(steps, tag) {
      let last = null;
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const { text, provider } = recStepResult(await step.run(), step);
            if (REC.provider && REC.provider !== provider) { REC.notice = `${recLabel(provider)} took over ${tag}.`; REC.failovers++; }
            REC.provider = provider;
            updateRecLive();
            return { text, provider };
          } catch (error) {
            last = error; console.warn(`${recLabel(step.name)} failed ${tag}:`, error); (REC.failedOn ||= new Set()).add(step.name);
            if (!recTransient(error)) break;
            if (attempt === 0) await recSleep(700);
          }
        }
        // The reason a provider refused is a backend detail: it is logged for
        // support, never printed. The panel only says who is carrying on.
        if (i < steps.length - 1) { REC.notice = `${recLabel(steps[i + 1].name)} is taking over ${tag}.`; REC.failovers++; updateRecLive(); }
      }
      throw last || new Error('No AI provider is available.');
    }
    // Check if a provider supports audio transcription
    const recAudioProviders = () => {
      // TEMPORARY: only Gemini transcribes audio (no Groq Whisper fallback).
      if (aiUsesManaged()) return ['gemini']; // NotezAi (default): the backend transcribes with its managed Gemini
      return aiKey('gemini') ? ['gemini'] : []; // Gemini supports audio via generateContent with inline data
    };
    const recProviders = () => recAudioProviders(); // Alias for backward compatibility
    
    // Check if any provider supports audio transcription
    const hasAudioProvider = () => recAudioProviders().length > 0;
    async function recTextCall(prompt, options = {}) {
      const steps = recProviders().map(name => ({ name, run: () => aiCall(name, prompt, { temperature: options.temperature ?? 0.3, json: Boolean(options.json), model: REC_VOICE_MODEL, exact: true, voiceOnly: true }) }));
      if (!steps.length) throw Object.assign(new Error('Add a Gemini or Groq key in NotezAi settings.'), { code: 'no-key' });
      const { text } = await recFailover(steps, 'while writing notes');
      return text;
    }
    // Reference clips for a chat model: the saved voices, plus the voices already
    // heard in this recording ("Voice 1" …) so the same person keeps the same
    // label after a provider switch. Clips are added until the size budget is full.
    const REC_CONTEXT_BUDGET = 1200000;   // base64 characters across all clips
    async function recVoiceContext(index) {
      const saved = typeof nzVoiceSamples === 'function' && recVoiceCount() > 0 ? await nzVoiceSamples() : [];
      const heard = [];
      for (const label of Object.keys(REC.speakerClips || {}).sort((a, b) => Number(a.match(/\d+/)?.[0] || 0) - Number(b.match(/\d+/)?.[0] || 0))) {
        const clip = REC.speakerClips[label];
        if (!clip?.blob || !clip.blob.size) continue;
        const data = bytesToB64Safe(new Uint8Array(await clip.blob.arrayBuffer()));
        heard.push({ name: label, mime: clip.blob.type || 'audio/webm', data });
      }
      const out = [];
      let used = 0;
      for (const sample of [...saved, ...heard]) {
        if (used + sample.data.length > REC_CONTEXT_BUDGET) continue;
        used += sample.data.length;
        out.push(sample);
      }
      return out;
    }
    // Voice-to-Note transcription. A part goes to Gemini 3.1 Flash-Lite; when that
    // model is out of quota the same part goes to Gemini 3.5 Flash-Lite. Each model
    // is tried on the user's own key first, then on NotezAi's service. A part is only
    // given up when every model on every route has failed, and its audio is kept.
    // Backend async transcription: the part becomes a durable job on the
    // server (POST → jobId, poll → text). The job outlives this tab — a
    // refresh or crash mid-transcription does not lose the work, and the job
    // key makes a retried request idempotent (a finished job resolves
    // instantly, a duplicate transcription is impossible). Only the managed
    // route uses it: a BYOK key is not a secret that belongs in a durable
    // job row, so own-key parts stay inline exactly as before.
    let recAsyncCapabilities = null;
    async function recAsyncCaps() {
      if (recAsyncCapabilities == null) {
        try { recAsyncCapabilities = await aiBackendRequest('/v1/config', undefined, 'GET', 15000, true); }
        catch { recAsyncCapabilities = { capabilities: {} }; }
      }
      return recAsyncCapabilities;
    }
    // `images` is the same array the inline path sends (the audio part first,
    // then the learned voice samples), so both paths give the model the same
    // input and only the transport (inline call vs durable job) differs.
    async function recAsyncTranscribe(index, model, prompt, images) {
      const created = await aiBackendRequest('/v1/ai/transcribe', {
        note_id: REC.noteId,
        part_slot: index,
        prompt,
        temperature: 0,
        model,
        images,
        audio_transcription: true,
      }, 'POST', 60000);
      const jobId = created.jobId;
      // Poll with growing delay (3 s → 5 s → 8 s …) so a long transcription
      // never burns the request limit, and cap the whole wait at 4 minutes:
      // past that the part goes held and the queue's own retry picks it up
      // (the job is still on the server, so the retry re-attaches, not
      // re-sends).
      const deadline = Date.now() + 240000;
      let delay = 3000;
      for (;;) {
        if (Date.now() > deadline) throw Object.assign(new Error('The transcription job is taking too long.'), { status: 408 });
        await recSleep(delay);
        delay = Math.min(15000, Math.round(delay * 1.6));
        const status = await aiBackendRequest(`/v1/ai/transcribe/${jobId}`, undefined, 'GET', 15000, true);
        if (status.status === 'done') {
          const text = String(status.text || '').trim();
          if (!text) throw new Error('The transcription job came back empty.');
          return text;
        }
        if (status.status === 'failed') throw Object.assign(new Error(status.error || 'The transcription job failed.'), { status: 502 });
      }
    }
    async function recTranscribePart(blob, index) {
      const context = recBoundaryTail(index);
      // Pre-transcription enhancement (app/17-rec-enhance.js): the provider gets
      // a derived, level-normalized + high-passed + limited mono WAV for THIS
      // part. The original part audio is never touched — it stays byte-identical
      // in the durable journal and the cloud copy, and voice samples are not
      // enhanced. The derivative is built fresh on every call and never
      // persisted, so a retry always enhances the pristine original, never an
      // already-enhanced file. Any failure (unsupported browser, size limit,
      // decode/render error) falls back to the original blob, so enhancement
      // can never block or lose a transcription. The per-part meta is kept on
      // REC.enhance for diagnostics only — it is not shown in the recording UI.
      let audioBlob = blob, audioMime = blob.type || 'audio/webm';
      if (typeof NzRecEnhance !== 'undefined' && NzRecEnhance) {
        try {
          const enhanced = await NzRecEnhance.enhanceForTranscription(blob);
          REC.enhance = REC.enhance || {};
          REC.enhance[index] = enhanced.meta;
          if (enhanced.meta.succeeded && enhanced.blob !== blob) { audioBlob = enhanced.blob; audioMime = enhanced.meta.outputFormat || 'audio/wav'; }
          console.debug('rec enhance part ' + (index + 1) + ':', enhanced.meta);
        } catch (error) {
          console.warn('Enhancement unavailable for part ' + (index + 1) + ', using original audio:', error);
        }
      }
      const bytes = new Uint8Array(await audioBlob.arrayBuffer());
      const audio = { mime: audioMime, data: bytesToB64Safe(bytes) };
      const samples = await recVoiceContext(index);   // saved voices and voices already heard here
      const images = [audio, ...samples.map(sample => ({ mime: sample.mime, data: sample.data }))];
      const names = samples.map(sample => sample.name);
      const routes = [];
      if (aiKey('gemini')) routes.push('own');
      if (aiBackendConfigured()) routes.push('managed');
      if (!routes.length) {
        recPartMove(index, 'hold');
        REC.segBlobs[index] = blob;
        throw Object.assign(new Error('Add a Gemini key in NotezAi settings, or sign in to use NotezAi.'), { code: 'no-key' });
      }
      recPartMove(index, 'send');
      updateRecLive();
      let lastError = null;
      for (const route of routes) {
        if (route !== routes[0]) { REC.notice = "Your key did not answer this part. Trying NotezAi's service."; updateRecLive(); }
        for (const model of REC_AUDIO_MODELS) {
          try {
            const prompt = RECORD_TRANSCRIBE_GEMINI_PART(index, context, names);
            let transcript;
            if (route === 'managed' && (await recAsyncCaps()).capabilities?.asyncTranscribe) {
              // Managed route: durable backend job (see recAsyncTranscribe).
              // The backend walks its own transcribe-model chain inside the
              // job, so a job that fails here has used every fallback.
              transcript = await recAsyncTranscribe(index, model, prompt, images);
            } else {
              const answer = await aiCall('gemini', prompt, {
                temperature: 0, model, route, exact: true, voiceOnly: true, images, timeout: 150000,
              });
              transcript = String(answer.text || '');
            }
            REC.sttModel = model;
            recPartMove(index, 'done');
            transcript = String(transcript || '').replace(/^```(?:\w+)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
            return await recLabelPart(transcript, index);
          } catch (error) {
            lastError = error;
            // A key that is refused (401/403) takes its whole route with it.
            if ([401, 403].includes(error?.status)) break;
            const next = REC_AUDIO_MODELS[REC_AUDIO_MODELS.indexOf(model) + 1];
            if (next) { REC.notice = `${recModelLabel(model)} did not answer this part. Trying ${recModelLabel(next)}.`; updateRecLive(); }
          }
        }
      }
      throw lastError || new Error('No transcription model is available.');
    }
    // The languages chosen in NotezAi settings. Read at each call, so a change
    // applies to the next part and the next notes write.
    const recLangLabel = code => (NZAI_LANGUAGES.find(([value]) => value === code) || [code, code])[1];
    const recTranscriptLang = () => aiStore.get('notez-ai-transcript-lang', 'original');
    const recNotesLang = () => aiStore.get('notez-ai-notes-lang', 'same');
    const recTranscriptRule = () => recTranscriptLang() === 'original'
      ? 'Keep the original language (English, Urdu or a mix of both) and never translate.'
      : `Write every line in ${recLangLabel(recTranscriptLang())}. If someone speaks another language, translate it faithfully into ${recLangLabel(recTranscriptLang())}; keep names, numbers and technical terms exact.`;
    const RECORD_TRANSCRIBE_GEMINI_PART = (index, context = '', attached = []) => `Transcribe audio part ${index + 1} of a recording, word for word.
${NzVoice.modeOf(REC.mode).setting}
Accuracy rules: write every sentence you can hear, in order. Never summarise, never skip a sentence, never paraphrase and never correct the speaker's grammar. ${recTranscriptRule()} Use [inaudible] only for a word you truly cannot hear.
${context ? `The part before this one ended with: "${context}"
If this part starts in the middle of a word or a sentence, continue it from there. Do not repeat those closing words.
` : ''}${typeof nzVoicePrompt === 'function' ? nzVoicePrompt() : ''}${attached.length ? `\nThe audio parts after this one are the reference clips for these voices, in this order: ${attached.join(', ')}.` : ''}
Speaker labels: every line of speech starts with a speaker label, exactly like "[00:12] Voice 1: words". Use the known name above when the voice matches one of them; otherwise use "Voice 1", "Voice 2" and so on. Keep the same label for the same person and continue the numbering used earlier${recKnownVoices() ? ` (already used: ${recKnownVoices()})` : ''}. If you cannot tell the voices apart, label every line "Voice 1:" — never write a line of speech without a label.
${REC.instructions ? `\nInstructions from the user for this recording. Follow them when labelling voices and choosing names. They never change the words spoken:\n"""${REC.instructions}"""\n` : ''}If the part has no speech (silence, room noise or a muted microphone), output nothing at all.
Output only the transcript.`;

    function recKnownVoices() { return recDetectVoices(recLiveTranscript()).join(', '); }
    // ---- Recording modes ---------------------------------------------------
    // Class and Meeting keep their original wording, titles and folders. The other
    // modes take their setting and notes text from NzVoice (app/14-voice-core.js).
    const REC_TAGS = { class: 'CLASS', meeting: 'MEETING', casual: 'CASUAL', call: 'CALL', chat: 'CHAT', custom: 'CUSTOM' };
    const REC_MODE_IDS = Object.keys(REC_TAGS);
    const recModeName = mode => mode === 'class' ? 'Classroom' : mode === 'meeting' ? 'Meeting' : NzVoice.modeOf(mode).label;
    const recTitleWord = mode => mode === 'class' ? 'Class' : mode === 'meeting' ? 'Meeting' : NzVoice.modeOf(mode).label;
    const recTagOf = mode => REC_TAGS[mode] || 'CLASS';
    const recFolderOf = mode => mode === 'meeting' ? 'Meetings' : mode === 'class' ? 'Classes' : 'Recordings';
    // Notes saved before the picker had six modes only carry CLASS or MEETING.
    function recModeOfNote(note) {
      const tags = note?.tags || [];
      const found = REC_MODE_IDS.find(id => tags.includes(REC_TAGS[id]));
      if (found) return found;
      return /· Meeting ·/.test(String(note?.body || '')) || /^Meeting recording/i.test(String(note?.title || '')) ? 'meeting' : 'class';
    }
    // The notes instruction for the automatic style.
    const recAutoNotes = () => RECORD_MODES[REC.mode] || NzVoice.modeOf(REC.mode).notes;
    const recAutoLabel = () => REC.mode === 'meeting' ? 'Meeting minutes' : REC.mode === 'class' ? 'Class notes' : `${NzVoice.modeOf(REC.mode).label} notes`;
    // ---- Speaker names in place -------------------------------------------
    // A name typed in the Speakers list replaces the "Voice n" label everywhere in
    // this recording. It is applied when the transcript is read, so a part sent
    // later is named too. Clearing the box goes back to "Voice n".
    function recApplyRenames(text) {
      let out = String(text || '');
      for (const [label, name] of Object.entries(REC.renames || {})) out = recRenameVoice(out, label, name);
      return out;
    }
    function recRenameSpeaker(label, value) {
      if (!label) return;
      const name = String(value || '').replace(/[:\n\r]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
      if (name && /^voice\s+\d+$/i.test(name)) { toast('Use a name, not a Voice number.', 'info', 4000); updateRecLive(); return; }
      if (name) REC.renames[label] = name; else delete REC.renames[label];
      if (name) recLearnNamedVoices([[label, name]]);   // taught in the background, as in the names dialog
      if (REC.status === REC_STATUS.DONE && REC.noteId) { recSaveNote(true, REC.liveNotes); recSaveTranscriptNote(); }
      updateRecLive();
    }
    // The Voice labels heard so far, with the box each one is named in. Read from
    // the raw labels, so a name typed here does not hide the label it replaces.
    function recSpeakerRows() {
      const labels = recDetectVoices(recNormalizeLabels(REC.segTexts.filter(Boolean).join('\n')));
      return labels.map(label => ({ label, n: recSpeakerIndex(label), name: REC.renames?.[label] || '' }));
    }
    function recSpeakerPanel() {
      const rows = recSpeakerRows();
      if (!rows.length) return '';
      const items = rows.map(row => `<label class="rec-spk"><span class="rec-speaker ${REC_VOICE_CLASS[row.n % 4]}">${esc(row.label)}</span><input class="nzai-field rec-spk-input" data-rec-speaker="${esc(row.label)}" maxlength="40" autocomplete="off" value="${esc(row.name)}" placeholder="Name this voice" aria-label="Name for ${esc(row.label)}"></label>`).join('');
      return `<div class="rec-spk-panel" aria-label="Speakers"><div class="rec-spk-h">Speakers <small>Type a name and press Enter. Clear it to go back to the number.</small></div><div class="rec-spk-list">${items}</div></div>`;
    }
    // One line for everything that is waiting: parts held on this device, and any notice.
    function recStatusLine(failedCount) {
      const parts = [];
      if (failedCount) parts.push(`${failedCount} part${failedCount === 1 ? '' : 's'} waiting${navigator.onLine ? ', they send by themselves' : ' · offline'}`);
      // Durable storage degrades visibly: when the journal cannot open its
      // database the UI says so, instead of the console being the only place
      // to see it.
      const jstate = (typeof NzRecJournal !== 'undefined' && typeof NzRecJournal.state === 'function') ? NzRecJournal.state() : null;
      if (jstate && jstate.degraded) parts.push(jstate.notice);
      if (REC.notice) parts.push(REC.notice);
      if (!parts.length) return '';
      const send = failedCount && navigator.onLine ? '<button type="button" class="ai-action" data-rec="retry">Send now</button>' : '';
      return `<div class="rec-status${failedCount ? ' has-held' : ''}" role="status"><span class="rec-status-t">${esc(parts.join(' · '))}</span>${send}</div>`;
    }
    // Rewrites one part's labels to "Voice n" using only that part's numbering.
    function recCanonicalPart(text) {
      const raw = String(text || '');
      return recWithSpkZero(recSpkZeroIn(raw), () => recNormalizeLabels(raw));
    }
    // The one place a transcript is read from: the raw parts are joined, the
    // speaker numbering is decided for the whole recording, and every label is
    // rewritten to "Voice n" before anything renders or saves it.
    function recLiveTranscript() {
      const text = REC.segTexts.filter(Boolean).join('\n');
      recSpkZero = recSpkZeroIn(text);
      return recApplyRenames(recNormalizeLabels(text));
    }
    // The transcript that goes into the note: every part joined, and every
    // stamped line rewritten to the time of day it was spoken. A note opened a
    // week later should say when something was said, not which audio chunk it
    // arrived in - and because each chunk restarts its offsets at zero, the raw
    // stamps jumped backwards every minute.
    const recPartTextForNote = index => {
      let lastClock = recClockOf(recWallOf(index));
      return String(recApplyRenames(recNormalizeLabels(REC.segTexts[index] || ''))).split('\n').map(raw => {
        const line = recUnmark(raw);
        if (!line.trim()) return '';
        const own = recStampWall(index, (line.match(/^\[([\d:]{3,12})\]/) || [])[1]);
        const clock = own || lastClock;
        lastClock = clock;
        if (!own) return `[${clock}] ${line}`;
        return line.replace(/^\[([\d:]{3,12})\]/, `[${clock}]`);
      }).filter(Boolean).join('\n');
    };
    function recTranscriptForNote() {
      recLiveTranscript();   // settles the Voice numbering before any line is read
      return REC.segTexts.map((text, index) => text ? recPartTextForNote(index) : '').filter(Boolean).join('\n');
    }
    // ---- Transcript commit: machine text vs user edits -----------------------
    // Two transcript surfaces exist: the "## Transcript" section inside the
    // recording note, and the dedicated transcript note ("{id}-tx"). Both use
    // one rule. While the user leaves the text alone, the machine rewrites it
    // in full on every save (that is how new parts appear). The moment the
    // stored text differs from what the machine last wrote, the section
    // becomes user-owned: its existing lines are never touched again — not
    // even by speaker renames — and newly finished parts are appended below,
    // each block marked, so a reader can tell machine text from user text.
    // Partial vs final stays explicit in the note header ("Recording in
    // progress" vs "Recording finished").
    const recTxState = key => (REC[key] = REC[key] || { userOwned: false, lastWritten: '', lastPartCount: 0 });
    function recCommitSection(key, storedSection) {
      const state = recTxState(key);
      const clean = text => String(text || '').replace(/\s+$/, '');
      const section = clean(storedSection);
      const fresh = clean(recTranscriptForNote());
      if (!state.userOwned && state.lastWritten && section !== clean(state.lastWritten)) state.userOwned = true;
      if (!state.userOwned) {
        state.lastWritten = fresh;
        state.lastPartCount = REC.segIdx;
        return fresh || section || '_Listening… the first part appears within about 30 seconds._';
      }
      // user-owned: append only the parts finished after the last write.
      const from = state.lastPartCount || 0;
      const added = REC.segTexts.slice(from).map((text, i) => text ? recPartTextForNote(from + i) : '').filter(Boolean).join('\n');
      if (added) {
        state.lastPartCount = REC.segIdx;
        state.lastWritten = `${section}${section ? '\n' : ''}<!-- rec: machine-appended part -->\n${added}`;
        return state.lastWritten;
      }
      return section;
    }
    // The "## Transcript" section of a recording note's body, or null.
    function recTranscriptSectionOf(body) {
      const text = String(body || '');
      const at = text.search(REC_HEADING('Transcript'));
      if (at < 0) return null;
      const rest = text.slice(at).replace(/^#{1,6}\s*Transcript[^\n]*\n?/, '');
      const notesAt = rest.search(REC_HEADING('AI notes'));
      return notesAt < 0 ? rest : rest.slice(0, notesAt);
    }
    function recNoteBody(transcript, notesText, finishing) {
      const when = new Date(REC.startedAt);
      const providerLine = REC.provider ? `${recLabel(REC.provider)}` : 'AI';
      const state = finishing ? 'Recording finished' : REC.status === REC_STATUS.RECORDING || REC.status === REC_STATUS.PAUSED ? 'Recording in progress' : 'Recording';
      const missing = (REC.segStatuses || []).map((status, index) => status === SEG_STATUS.FAILED ? index + 1 : 0).filter(Boolean);
      const gap = missing.length ? ` Part${missing.length === 1 ? '' : 's'} ${missing.join(', ')} could not be transcribed; they are held on this device and send when you are back online.` : '';
      const header = `> ${state} · ${when.toLocaleString()} · ${recModeName(REC.mode)} · transcribed by ${providerLine}${REC.failovers ? ` (${REC.failovers} provider switch${REC.failovers === 1 ? '' : 'es'})` : ''}. AI transcription with speaker labels. Check names and key facts before relying on them.${gap}`;
      return `${header}\n\n## Transcript\n\n${transcript || '_Listening… the first part appears within about 30 seconds._'}${notesText ? `\n\n## AI notes\n\n${notesText}` : ''}`;
    }
    // While the recording runs, the note holds only a short overview. The full
    // transcript and AI notes are written once the recording is finished.
    function recOverviewBody(note) {
      const parts = REC.processed || 0;
      const waiting = (REC.segStatuses || []).filter(status => status === SEG_STATUS.FAILED).length;
      const state = REC.status === REC_STATUS.PAUSED ? 'Recording paused' : 'Recording in progress';
      const mode = recModeName(REC.mode);
      const started = note?.createdAt ? new Date(note.createdAt).toLocaleString() : '';
      const progress = `${parts} part${parts === 1 ? '' : 's'} transcribed so far${waiting ? `, ${waiting} waiting to send` : ''}.`;
      return `> ${state}${started ? ` · ${started}` : ''} · ${mode}\n\n## Overview\n\n${progress}\n\nThe full transcript and AI notes are written here when you finish the recording.`;
    }
    function recSaveNote(finishing = false, notesText = REC.liveNotes) {
      if (REC.discarding) return;
      const note = notes.find(item => item.id === REC.noteId); if (!note) return;
      const complete = finishing || REC.status === REC_STATUS.DONE;
      // Complete save: the transcript section goes through the commit rule,
      // so a transcript the user has edited is kept and only new parts are
      // appended; an untouched section is rewritten in full as before.
      const transcript = complete ? recCommitSection('txBodyState', recTranscriptSectionOf(note.body)) : recTranscriptForNote();
      note.body = (complete ? recNoteBody(transcript, notesText, finishing) : recOverviewBody(note)).slice(0, recNoLimits() ? undefined : 200000);
      note.updatedAt = Date.now(); if (finishing) note.tags = ['RECORDING', recTagOf(REC.mode)];
      persistNote(note).catch(() => toast('Saved locally; sync is queued.', 'error'));
      renderEverything();
    }
    async function recRefreshNotes(final) {
      const transcript = recLiveTranscript(); if (!transcript) return;
      const choice = $('#rec-enhance')?.value || REC.choice || 'auto';
      if (choice === 'none') return;
      const base = choice === 'custom' ? RECORD_MODES.custom : choice === 'auto' ? recAutoNotes() : RECORD_MODES[choice] || recAutoNotes();
      const notesRule = choice === 'clean' ? '' : recNotesLang() === 'same' ? 'Write the notes in the same language as the transcript.' : `Write the notes in ${recLangLabel(recNotesLang())}, including the headings.`;
      const instruction = [base, notesRule, REC.instructions ? `The user's own instructions (follow them; they override the default format where they conflict): """${REC.instructions}"""` : ''].filter(Boolean).join('\n\n');
      try {
        if (final) {
          REC.liveNotes = await recEnhance(transcript, instruction, text => { REC.notice = text; updateRecLive(); });
        } else {
          const prior = REC.liveNotes ? `Current notes:\n${REC.liveNotes}\n\n` : '';
          REC.liveNotes = await recTextCall(`${instruction}\n\n${prior}Update the notes with the newest part of this recording. Keep earlier points, add new ones, and remove repeats. Keep every Voice label.\n\n<transcript>\n${recNoLimits() ? transcript : transcript.slice(-14000)}\n</transcript>`);
        }
      } catch (error) {
        // A notes refresh is retried on the next part, so a failed one needs no
        // message at all. The reason stays in the console for support.
        console.warn('Live notes update failed:', error);
        if (final) REC.notice = 'The notes summary could not be written this time. The transcript is saved.';
      }
      REC.lastNotesAt = Date.now();
    }
    // Rewrites a leading speaker label to its canonical "Voice n" spelling, so a
    // model that answers "spk_0:" or "Speaker B:" never stores a raw provider
    // label in the note. A real name ("Ayesha:") is left exactly as written.
    const REC_LABEL_HEAD = /^(\s*(?:[-*•–]\s+)?(?:\[[\d:]+\]\s*)?)(\**\s*(?:voice|speaker|person|spk)[\s_:-]*(?:[0-9\u0660-\u0669]{1,2}|[A-Za-z])\s*)\**\s*(?:[:\uFF1A]|\s+[-–—]\s+)\s*\**\s*/i;
    // Nothing above can be trusted to catch every model quirk forever, so the
    // raw provider spelling is also swept out of whatever is about to be shown.
    // This is the guarantee: no surface ever prints "spk0:".
    const recScrubSpk = line => String(line ?? '').replace(
      /(^|[^\p{L}\p{N}])(?:spk)[\s_:-]*([0-9\u0660-\u0669]{1,2})(?![0-9\u0660-\u0669])/giu,
      (all, lead, digits) => `${lead}Voice ${Math.max(1, Number(recDigits(digits)) + (recSpkZero ? 1 : 0))}`
    );
    function recNormalizeLabels(text) {
      return String(text || '').split('\n').map(raw => recScrubSpk(recLeadMark(raw) + recUnmark(raw).replace(
        REC_LABEL_HEAD,
        (all, stamp, label) => `${stamp}${recLabelName(label)}: `
      ))).join('\n');
    }
    // Keeps the words that were heard. Runs of [inaudible] or [unclear] lines are dropped; a part with no words becomes empty.
    // Labels are left as the model wrote them: they are rewritten once, for the
    // whole transcript, so every part shares one Voice numbering.
    function recCleanPart(raw) {
      const lines = String(raw || '').split('\n').filter(line => line.trim());
      const kept = lines.filter(line => {
        const words = recUnmark(line).replace(/^\s*(\[[\d:]+\]\s*)?\**\s*(?:voice|speaker|person|spk)[\s_:-]*(?:[0-9\u0660-\u0669]{1,2}|[A-Za-z])\s*\**\s*[:\uFF1A]/i, '').replace(/\[(inaudible|unclear)\]/gi, '').trim();
        return words.length > 0;
      });
      // A model that falls into a loop writes the same line again and again. Two
      // copies of a line can be real speech; a third copy in a row is not.
      const lineKey = line => recUnmark(line).replace(/^\s*(\[[\d:]+\]\s*)?/, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLowerCase();
      const unloop = [];
      let run = 0, previous = null;
      for (const line of kept) {
        const key = lineKey(line);
        run = key && key === previous ? run + 1 : 0;
        previous = key;
        if (run < 2) unloop.push(line);
      }
      return unloop.join('\n').trim();
    }
    // ---- Held parts and the offline journal ------------------------------
    // Every part is written to this device's IndexedDB before it is sent. A part
    // that cannot be sent (no connection, the service is down, a rate limit) stays
    // held there, in order, and is sent again when the connection is back. The
    // recording itself never needs the network: the microphone and the encoder
    // are local, so a dropped connection never stops a recording.
    // The journal database is owned by app/17-rec-journal.js (version 2: the
    // v1 "parts" store plus the durably committed capture slices, the session
    // rows and the durable job queue). One owner of the database means the
    // old v1 part rows keep working untouched, and every write here resolves
    // only on a committed transaction (the commit ack).
    const REC_JOURNAL_STORE = 'parts';
    // Runs one request in its own transaction and resolves with its result.
    function recJournalRun(mode, work) { return NzRecJournal.run(REC_JOURNAL_STORE, mode, work); }
    const recJournalKey = (noteId, index) => `${noteId}:${index}`;
    // The journal is a safety net. If it cannot be written the part is still
    // held in memory, so a failed write is logged and never stops the session.
    // The blob is merged, never nulled: once a part's audio is journaled it
    // stays (retention), even after the in-memory copy is dropped.
    function recJournalSave(index, noteId = REC.noteId) {
      if (!noteId || REC.discarding) return Promise.resolve();
      const record = {
        key: recJournalKey(noteId, index), noteId, index,
        blob: REC.segBlobs[index] || null, text: REC.segTexts[index] || '',
        wall: REC.segWall[index] || 0, mark: REC.segMarks[index] ?? null, status: REC.segStatuses[index] || '',
      };
      return NzRecJournal.savePart(record).catch(error => console.warn('Journal write failed:', error));
    }
    // ---- Durable session lifecycle -----------------------------------------
    // Session row (journal) + cloud claim, opened when capture begins. The uid
    // is fixed at this moment and never rebound (R1). A claim conflict never
    // stops the local recording — the audio is safe on this device; only the
    // cloud copy waits until the claim is free.
    async function recOpenDurableSession() {
      const noteId = REC.noteId; if (!noteId) return;
      const uid = currentSession?.user?.uid || '';
      try {
        await NzRecJournal.updateSession(noteId, {
          uid, mode: REC.mode, mime: REC.mime.split(';')[0],
          startedAt: REC.startedAt || Date.now(), capture: 'recording', finalizedAt: 0, deletedAt: 0,
        });
      } catch (error) { console.warn('Durable session open:', error); }
      if (!uid) return;
      let claimed = 0;
      try {
        const claim = await NzRecCloud.acquireClaim(noteId);
        if (claim === 'own') {
          claimed = 1;
          await NzRecCloud.syncSession(noteId, { uid, mode: REC.mode, mime: REC.mime.split(';')[0], startedAt: REC.startedAt || Date.now(), capture: 'recording' });
        } else if (claim === 'conflict' && !REC.discarding) {
          // The other device holds the cloud copy of this note. This device
          // records on (the audio is safe locally) but stays out of the
          // shared note entirely — uploading into an overlapping part
          // numbering could overwrite the first device's audio, which is
          // never allowed.
          REC.notice = 'This recording is open on another device. Recording continues here; its audio stays on this device for the time being.';
          updateRecLive();
        }
      } catch (error) { console.warn('Cloud claim:', error); }
      try { await NzRecJournal.updateSession(noteId, { cloudClaimed: claimed }); } catch { /* non-critical */ }
    }
    // Capture stopped (or discarded): the session row says so, the claim is
    // released, and every part that has audio gets a durable, idempotent
    // upload job. The jobs outlive the tab; a part whose cloud copy already
    // matches its sha256 is skipped, so retries never upload twice.
    async function recCloseDurableSession() {
      const noteId = REC.noteId; if (!noteId) return;
      try {
        const session = await NzRecJournal.getSession(noteId).catch(() => null);
        await NzRecJournal.updateSession(noteId, { capture: REC.discarding ? 'discarded' : 'stopped', finalizedAt: Date.now() });
        if (session?.cloudClaimed) {
          await NzRecCloud.syncSession(noteId, { capture: REC.discarding ? 'discarded' : 'stopped', finalizedAt: Date.now() });
          await NzRecCloud.releaseClaim(noteId);
        }
      } catch (error) { console.warn('Durable session close:', error); }
      const count = REC.segIdx;
      for (let index = 0; index < count; index++) {
        try {
          const session = await NzRecJournal.getSession(noteId).catch(() => null);
          const uid = session?.uid || currentSession?.user?.uid || '';
          // No cloud copy for this session: a guest, or a device that lost
          // the claim at session open (its audio stays local, never written
          // into another device's part numbering).
          if (!uid || !session?.cloudClaimed) break;
          await NzRecJobs.enqueueJob({
            type: 'rec-audio',
            dedupKey: `up:${noteId}:${index}`,
            ref: { noteId, slot: index },
            payload: { mime: REC.mime.split(';')[0] },
            uid,
          });
        } catch (error) { console.warn('Audio upload job:', error); }
      }
    }
    // A session row that still says "recording" when this page loaded was
    // interrupted (refresh, closed tab, crash). Before the v1 restore runs,
    // each interrupted part is rebuilt from its COMMITTED slices — the
    // EBML-aware recovery keeps every complete second and discards only the
    // incomplete final region — and written back as an ordinary held part, so
    // the existing restore/send path picks it up unchanged. A part whose
    // audio cannot be rebuilt stays lost and is reported as such, never
    // guessed at.
    async function recRecoverInterrupted() {
      let sessions = [];
      try { sessions = await NzRecJournal.listSessions(); } catch { return; }
      for (const session of sessions) {
        if (session.deletedAt || session.capture !== 'recording') continue;
        if (!notes.some(item => item.id === session.noteId)) {
          await NzRecJournal.removeSession(session.noteId).catch(() => {});
          continue;
        }
        try {
          await NzRecJournal.updateSession(session.noteId, { capture: 'recovered' });
          if (session.cloudClaimed) await NzRecCloud.syncSession(session.noteId, { capture: 'recovered' });
          const slots = await NzRecJournal.listSlots(session.noteId);
          for (const slot of slots) {
            const existing = await NzRecJournal.getPartRow(session.noteId, slot).catch(() => null);
            if (existing?.blob) continue;   // already a held part with its audio
            const built = await NzRecJournal.rebuildPart(session.noteId, slot).catch(() => null);
            if (!built?.blob) { console.warn(`Recovery: part ${slot + 1} of ${session.noteId} has committed slices but none could be rebuilt — its audio stays lost.`); continue; }
            await NzRecJournal.savePart({
              key: recJournalKey(session.noteId, slot), noteId: session.noteId, index: slot,
              blob: built.blob, text: '', wall: session.startedAt || Date.now(), mark: null, status: SEG_STATUS.FAILED,
            }).catch(error => console.warn('Recovery write failed:', error));
          }
          // Completed parts of an interrupted session still owe their upload
          // job when the tab died right after the last part finished (only
          // for sessions that had a signed-in workspace).
          const rows = (await NzRecJournal.getAllParts().catch(() => [])).filter(row => row.noteId === session.noteId);
          for (const row of rows) {
            if (!row.blob || !session.uid || !session.cloudClaimed) continue;
            try {
              await NzRecJobs.enqueueJob({
                type: 'rec-audio', dedupKey: `up:${session.noteId}:${row.index}`,
                ref: { noteId: session.noteId, slot: row.index },
                payload: { mime: session.mime || 'audio/webm' }, uid: session.uid,
              });
            } catch (error) { console.warn('Audio upload job:', error); }
          }
        } catch (error) { console.warn('Session recovery:', error); }
      }
    }
    // A held part also gets a durable transcribe job: if this tab dies
    // mid-send, the queue still owns the part. Idempotent (dedupKey per
    // note+part); the handler resolves through the ordinary send path.
    // Signed-in sessions only: a guest's held parts keep the existing
    // protection (the v1 journal rows plus the 30 s live re-flush), and a
    // guest is never claimed backed up.
    function recQueueTranscribeJob(index) {
      if (!REC.noteId || !currentSession?.user?.uid) return;
      void NzRecJobs.enqueueJob({
        type: 'rec-transcribe',
        dedupKey: `tr:${REC.noteId}:${index}`,
        ref: { noteId: REC.noteId, slot: index, index },
        payload: { index },
        uid: currentSession.user.uid,
      }).catch(error => console.warn('Transcribe job:', error));
    }
    // ---- Durable queue handlers ---------------------------------------------
    // rec-transcribe: re-run one held part through the ordinary send pipeline.
    // Outcomes: the part is gone (sent, discarded, note deleted) → terminal
    // skip; the session is not open on this tab → defer (the restore on the
    // next load reopens it); the part is still held after another attempt →
    // defer, so an offline device does not burn retry attempts while the
    // in-session flush keeps its own cadence.
    NzRecJobs.addHandler('rec-transcribe', async job => {
      const index = job.ref?.index;
      if (index == null) return { skip: true, reason: 'no-part' };
      const note = notes.find(item => item.id === job.ref.noteId);
      if (!note || note.tombstoned) return { skip: true, reason: 'note-gone' };
      if (REC.noteId !== job.ref.noteId) return { defer: true, reason: 'session-closed' };
      if (!REC.segBlobs[index]) return { skip: true, reason: 'already-sent' };
      const sent = await recSendPart(index, REC.gen);
      return sent ? { sent: true, index } : { defer: true, reason: 'still-held' };
    });
    // rec-audio: upload one finished part's audio to the cloud workspace. The
    // audio comes from the journal (part row, else committed slices), never
    // from memory, so the job works whether or not the session is open.
    // Idempotent: the sha256 in the cloud meta makes a retry a no-op.
    NzRecJobs.addHandler('rec-audio', async job => {
      const noteId = job.ref?.noteId, slot = job.ref?.slot;
      if (!noteId || slot == null) return { skip: true, reason: 'bad-ref' };
      const note = notes.find(item => item.id === noteId);
      if (!note || note.tombstoned) return { skip: true, reason: 'note-gone' };
      const built = await NzRecJournal.rebuildPart(noteId, slot).catch(() => null);
      if (!built?.blob || built.blob.size < 500) return { skip: true, reason: 'no-audio' };
      const sha = await NzRecCloud.sha256Hex(built.blob);
      const out = await NzRecCloud.putPartAudio(noteId, slot, built.blob, { mime: built.blob.type || job.payload?.mime || 'audio/webm', sha });
      if (out.mode === 'failed') throw new Error(out.error || 'cloud upload failed');
      return out;
    });
    // One queue loop for the whole app (auth-aware, Web-Locked), and the lazy
    // cloud config load. Both are no-ops for a guest or an offline
    // device. If either fails to start, local recording must continue
    // anyway — a broken cloud queue can never abort the rest of this module
    // (a throw here would leave every later top-level const in this file in
    // the temporal dead zone, breaking the recorder UI for the whole page
    // load). Cloud sync degrades; capture never does.
    try {
      NzRecJobs.init({ onUid: () => (!window.nzAuthNoUser && currentSession?.mode === 'cloud') ? (currentSession.user?.uid || '') : '' });
      NzRecCloud.init();
    } catch (error) {
      console.warn('Durable cloud queue did not start (local recording unaffected):', error);
    }
    const recHeldIndices = () => REC.segBlobs.map((blob, index) => blob ? index : -1).filter(index => index >= 0);
    function recHoldPart(index, error) {
      recPartMove(index, 'hold');
      REC.errors++;
      if (!navigator.onLine) {
        REC.notice = 'You are offline. Recording carries on here, and the waiting parts send when you are back online.';
      } else if (error?.code === 'no-key') {
        REC.notice = error.message;
      } else {
        REC.notice = `The stretch at ${recClockOf(recWallOf(index))} could not be sent. It is held on this device and will be sent again automatically.`;
      }
      recJournalSave(index);
      updateRecLive();
    }
    // The nearest part before this one that has any words (a silent or failed part is empty).
    function recPreviousText(index) {
      for (let i = index - 1; i >= 0; i--) { const text = REC.segTexts[i]; if (text && text.trim()) return text; }
      return '';
    }
    // A model that is given the end of the previous part as context can hand it back:
    // the same line, word for word, at the top of this part, after the audio was
    // silent or quiet. Such lines are dropped. Only the first lines of a part are
    // checked, so a sentence that is really said again later is kept.
    const recDropEcho = (previous, current) => NzVoice.dropEcho(previous, current);
    // A muted or silent part is not sent. A model asked to transcribe silence tends
    // to repeat whatever it heard last, which is the repeated transcript after the
    // mic was muted. Measured on the decoded audio: no sound above the noise floor.
    async function recIsSilent(blob) {
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx || !blob || !blob.size) return false;
        const ctx = new AudioCtx();
        const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
        ctx.close?.();
        return NzVoice.isSilent([...Array(buffer.numberOfChannels)].map((_, c) => buffer.getChannelData(c)));
      } catch (error) {
        console.warn('Could not measure this part, so it is sent:', error);
        return false;
      }
    }
    // Sends one part. Resolves true once it is transcribed; a part that cannot be
    // sent is held instead and resolves false.
    async function recSendPart(index, gen = REC.gen) {
      const blob = REC.segBlobs[index];
      if (!blob) return true;
      if (gen !== REC.gen) return false;   // the session was discarded: its parts are not written anywhere
      if (!navigator.onLine) { recHoldPart(index, null); return false; }
      try {
        const silent = await recIsSilent(blob);
        if (gen !== REC.gen) return false;
        const transcribed = silent ? '' : await recTranscribePart(blob, index);
        if (gen !== REC.gen) return false;   // discarded while it was being transcribed
        const cleaned = recCleanPart(recCanonicalPart(transcribed));
        const before = recPreviousText(index);
        const text = recDropEcho(before, recTrimOverlap(before, cleaned));
        if (!text) REC.notice = `The stretch at ${recClockOf(recWallOf(index))} had no clear speech. Check the microphone and the room noise.`;
        // A part with no speaker turn used to look exactly like the feature
        // being gone, because the transcript simply rendered as paragraphs.
        else if (!REC.notice && !recHasLabels(text) && text.length > 240) REC.notice = `The words at ${recClockOf(recWallOf(index))} came back without speaker labels. They are kept as plain text.`;
        REC.segTexts[index] = text;
        recLiveTranscript();          // settles the Voice numbering before any label is read
        recRememberVoiceClips(text, blob);
        REC.segBlobs[index] = null;
        recPartMove(index, 'done');
        REC.processed++;
        await recJournalSave(index);
        recSaveNote(REC.status === REC_STATUS.DONE);
        return true;
      } catch (error) {
        console.warn(`Part ${index + 1} could not be sent:`, error);
        if (gen !== REC.gen) return false;
        recHoldPart(index, error);
        return false;
      }
    }
    // Sends every held part, oldest first, one at a time: each part's words are
    // joined to the part before it, so a later part never goes out before an
    // earlier one that is still held. Only one flush runs at a time.
    function recFlushHeld(manual = false) {
      if (REC.discarding || !recHeldIndices().length) return REC.queue;
      if (!navigator.onLine) {
        if (manual) { REC.notice = 'You are offline. The waiting parts send when you are back online.'; updateRecLive(); }
        return REC.queue;
      }
      if (REC.flushing) return REC.flushing;
      const gen = REC.gen;   // only parts of this session are sent by this flush
      const run = REC.queue.then(async () => {
        for (const index of recHeldIndices()) {
          if (REC.discarding || gen !== REC.gen || !navigator.onLine) break;
          recPartMove(index, 'send');
          updateRecLive();
          if (!(await recSendPart(index, gen))) break;   // later parts wait for this one
        }
        if (gen === REC.gen && !recHeldIndices().length && !REC.discarding) {
          if (REC.status === REC_STATUS.DONE) {
            recSaveNote(true, REC.liveNotes);
            recSaveTranscriptNote();
            // The journal is kept on a normal finish (audio retention): the
            // part blobs and committed slices stay on this device, and the
            // durable rec-audio jobs make sure the cloud has its copy.
            void recCloseDurableSession();
          }
          // Parts join the note one at a time, so "every part is transcribed"
          // is only true once the queue has actually worked through.
          const pendingParts = REC.expectedParts ? Math.max(0, REC.expectedParts - REC.processed) : 0;
          REC.notice = pendingParts ? `${pendingParts} part${pendingParts === 1 ? '' : 's'} still being transcribed` : 'Every part is transcribed.';
        }
      }).finally(() => { if (REC.flushing === run) REC.flushing = null; updateRecLive(); });
      REC.flushing = REC.queue = run;
      return run;
    }
    // Back online: send what was held, straight away. While a connection keeps
    // failing, the same check runs once a minute.
    window.addEventListener('online', () => { if (recHeldIndices().length) recFlushHeld(); });
    // Held parts are never given up on: they are retried every 30 seconds for as long as they are held.
    setInterval(() => { if (navigator.onLine && REC.noteId && REC.status !== REC_STATUS.FINALIZING && recHeldIndices().length) recFlushHeld(); }, 30000);
    // After a reload the held parts are still on this device. Their note is
    // reopened as a finished session, so the waiting parts can be sent from it.
    async function recRestoreHeld(attempt = 0) {
      if (REC.status !== REC_STATUS.IDLE || REC.noteId) return;
      if (!notes.length && attempt < 20) { setTimeout(() => recRestoreHeld(attempt + 1), 1000); return; }
      await recRecoverInterrupted();   // rebuild interrupted parts from committed slices
      let rows = [];
      try { rows = await recJournalRun('readonly', store => store.getAll()) || []; } catch { return; }
      const sessions = new Map();
      rows.forEach(row => { if (!sessions.has(row.noteId)) sessions.set(row.noteId, []); sessions.get(row.noteId).push(row); });
      const held = [...sessions.entries()].find(([noteId, list]) => list.some(row => row.blob) && notes.some(item => item.id === noteId));
      if (!held) return;
      const [noteId, list] = held;
      const note = notes.find(item => item.id === noteId);
      const size = Math.max(...list.map(row => row.index)) + 1;
      REC.noteId = noteId; REC.mode = recModeOfNote(note);
      REC.startedAt = note.createdAt || Date.now();
      REC.segTexts = []; REC.segBlobs = []; REC.segStatuses = []; REC.segWall = []; REC.segMarks = [];
      for (let index = 0; index < size; index++) {
        const row = list.find(item => item.index === index);
        REC.segTexts[index] = row?.text || '';
        REC.segBlobs[index] = row?.blob || null;
        REC.segStatuses[index] = row?.blob ? SEG_STATUS.FAILED : SEG_STATUS.COMPLETED;
        REC.segWall[index] = row?.wall || REC.startedAt;
        REC.segMarks[index] = row?.mark ?? null;
      }
      REC.segIdx = size; REC.expectedParts = size; REC.processed = list.filter(row => !row.blob).length;
      REC.stoppedMs = Math.max(0, ...list.map(row => row.mark || 0)); REC.baseMs = REC.stoppedMs;
      REC.gen = (REC.gen || 0) + 1; REC.queue = Promise.resolve(); REC.flushing = null;
      recMove('restore');
      REC.notice = `${recHeldIndices().length} part${recHeldIndices().length === 1 ? '' : 's'} from an earlier recording are waiting to be sent.`;
      // Transcript state after a reload: a stored transcript that already
      // differs from what the machine would write was edited by the user and
      // wins from now on (the machine appends only new parts, never rewrites).
      const restoredNote = notes.find(item => item.id === REC.noteId);
      if (restoredNote) {
        const machine = recTranscriptForNote();
        const storedSection = recTranscriptSectionOf(restoredNote.body);
        if (storedSection != null && storedSection.trim() && storedSection.trim() !== machine.trim()) {
          const bodyState = recTxState('txBodyState');
          bodyState.userOwned = true; bodyState.lastWritten = storedSection.trim(); bodyState.lastPartCount = REC.segIdx;
        }
        const txNote = notes.find(item => item.id === `${REC.noteId}-tx`);
        if (txNote) {
          const txSection = String(txNote.body || '').replace(/^>[^\n]*\n*/, '').trim();
          const noteState = recTxState('txNoteState');
          if (txSection && txSection !== machine.trim()) { noteState.userOwned = true; noteState.lastWritten = txSection; noteState.lastPartCount = REC.segIdx; }
          else if (txSection) noteState.lastWritten = txSection;
        }
      }
      recSaveNote(true, REC.liveNotes);
      updateRecLive();
      // Held parts get a durable transcribe job too: a send that outlives this
      // tab (or a reload mid-send) is picked up by the queue, idempotently.
      for (const index of recHeldIndices()) recQueueTranscribeJob(index);
      if (navigator.onLine) recFlushHeld();
    }
    setTimeout(() => recRestoreHeld(), 1500);
    function enqueuePart(blob, index) {
      const gen = REC.gen;
      REC.queue = REC.queue.then(async () => {
        if (REC.discarding || gen !== REC.gen) return;
        if (REC.segMarks[index] == null) REC.segMarks[index] = recElapsed();   // when this part closed
        if (!blob || blob.size < 500) { REC.processed++; return; }   // a tiny fragment at the end is not speech
        // The part is written to this device first, so it survives a dropped
        // connection, a rate limit or a closed tab.
        REC.segBlobs[index] = blob;
        recPartMove(index, 'queue');
        await recJournalSave(index);
        await recSweepPartSlices(index);   // the part row now holds the whole part
        await recSendPart(index, gen);
        updateRecLive();
      });
      return REC.queue;
    }
    // Once the part row durably holds the whole part blob, this part's ~1 s
    // slices are redundant — they exist to recover parts that never
    // completed, and a completed part keeps its audio in the part row. The
    // drop is verified, not assumed: the row's blob is re-read and matched
    // against the part just written before any slice is removed.
    async function recSweepPartSlices(index) {
      const noteId = REC.noteId; if (!noteId) return;
      try {
        const row = await NzRecJournal.getPartRow(noteId, index);
        if (row?.blob && row.blob.size >= (REC.segBlobs[index]?.size || 0)) {
          await NzRecJournal.discardSlices(noteId, index);
        }
      } catch (error) { console.warn('Slice sweep:', error); }
    }
    let recSliceWarnAt = 0;
    function startPart() {
      const recorder = new MediaRecorder(REC.stream, { mimeType: REC.mime, audioBitsPerSecond: 32000 });
      const index = REC.segIdx++;
      // The chunks belong to this recorder alone. A shared buffer would be
      // cleared by the next part before this one's stop event runs, so a part
      // could be sent with the wrong audio or none at all.
      const chunks = [];
      // Durability: the recorder now timeslices at ~1 s. Each slice is the
      // same stream as before (the part blob on stop is the concatenation of
      // these very chunks), and each one is committed to the journal's slice
      // store BEFORE it is counted. A part rebuilt after a crash is made only
      // from committed slices, so the audio never depends on memory. A failed
      // commit is logged and the slice stays in memory only — it degrades the
      // recovery granularity, it never stops the recording.
      const noteId = REC.noteId;
      const mime = REC.mime.split(';')[0];
      let sliceSeq = 0;
      recorder.ondataavailable = event => {
        if (!event.data?.size) return;
        chunks.push(event.data);
        const seq = sliceSeq++;
        NzRecJournal.commitSlice({ noteId, slot: index, seq, blob: event.data, mime, at: Date.now() })
          .catch(error => {
            // While storage is broken this fires for every ~1 s slice with
            // the same message — one warning per 30 s is enough.
            if (Date.now() - recSliceWarnAt < 30000) return;
            recSliceWarnAt = Date.now();
            console.warn('Slice commit failed (kept in memory only):', error);
          });
      };
      recorder.onstop = () => { const blob = new Blob(chunks, { type: mime }); enqueuePart(blob, index); };
      recorder.start(1000);
      REC.recorder = recorder;
      REC.partStartAt = Date.now();
      REC.segWall[index] = REC.partStartAt;   // the wall clock this part began at
      REC.expectedParts = index + 1;
    }
    function endPart() {
      const recorder = REC.recorder; REC.recorder = null;
      if (!recorder || recorder.state === 'inactive') return Promise.resolve();
      return new Promise(resolve => { recorder.addEventListener('stop', () => resolve(), { once: true }); recorder.stop(); });
    }
    function clearRecTimers() {
      clearInterval(REC.timer); REC.timer = 0;
      clearTimeout(REC.partTimer); REC.partTimer = 0;
      REC.partDeadline = 0;
    }
    // The length of the part that is recording right now. The first part is short
    // so the transcript starts quickly; every later part is exactly the length
    // chosen for this recording.
    function recPartTarget() {
      const index = Math.max(0, REC.segIdx - 1);
      return index === 0 && REC.partMs > REC_CHUNK_FIRST ? REC_CHUNK_FIRST : REC.partMs;
    }
    function recRollPart() {
      if (REC.status !== REC_STATUS.RECORDING) return;
      const target = recPartTarget();       // the length this part was supposed to have
      const spent = Date.now() - REC.partStartAt;
      endPart(); startPart();
      // A timeout that fires late (a background tab is allowed to delay timers
      // until the next wake-up) must not make every following part longer: the
      // next deadline starts from the part that just began.
      if (spent > target + 3000) {
        REC.notice = `Part ${Math.max(1, REC.segIdx - 1)} ran ${fmtClock(spent)} instead of ${fmtClock(target)} because the tab was in the background. Back to ${recChunkLabel(REC.partMs)} now.`;
        updateRecLive();
      }
      recSchedulePart();
    }
    function recSchedulePart() {
      clearTimeout(REC.partTimer); REC.partTimer = 0;
      if (REC.status !== REC_STATUS.RECORDING) { REC.partDeadline = 0; return; }
      const target = recPartTarget();
      const spent = Date.now() - REC.partStartAt;
      REC.partDeadline = REC.partStartAt + target;
      REC.partTimer = setTimeout(recRollPart, Math.max(200, target - spent));
    }
    function recTick() {
      const clock = $('#rec-clock');
      if (clock) clock.textContent = fmtClock(recElapsed());
      if (REC.status !== REC_STATUS.RECORDING) return;
      // Catches a delayed timeout as soon as the page runs again. Measured
      // against the part's own start so a lost or late timeout cannot stack up.
      if (REC.partStartAt && Date.now() - REC.partStartAt >= recPartTarget()) recRollPart();
    }
    function recRunTimers() {
      clearRecTimers();
      // One length for the whole recording, fixed when it starts: changing the
      // setting mid-recording must not produce parts of two different lengths.
      REC.partMs = REC.partMs || recChunkMs();
      REC.timer = setInterval(recTick, 250);
      recSchedulePart();
    }
    function openRecorder() {
      if (!currentSession) return;
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { toast('This browser cannot record audio. Use Chrome or Edge on https.', 'error', 6000); return; }
      if (!hasAudioProvider()) { 
        toast('Recording needs NotezAi or your own Gemini/Groq key. Check AI source in NotezAi settings.', 'error', 6000); 
        return; 
      }
      // A finished session stays on screen: that is where Continue, New session
      // and Discard live. Opening the recorder never throws it away silently.
      REC.dialog = { set hidden(value) { if (value) nzaiClose(); else dockShow('voice'); }, get hidden() { return !nzai.open || nzai.dock !== 'voice'; } };
      dockShow('voice');
    }
    // Forgets the recording session but keeps the note it produced (if any).
    function recResetSession() {
      REC.gen = (REC.gen || 0) + 1;   // parts still in flight from the old session are dropped
      recMove('reset');
      REC.name = '';
      REC.segTexts = []; REC.segBlobs = []; REC.segStatuses = []; REC.segMarks = []; REC.segWall = [];
      REC.speakerClips = {}; REC.renames = {}; REC.segIdx = 0; REC.processed = 0; REC.expectedParts = 0;
      REC.failovers = 0; REC.liveNotes = ''; REC.provider = ''; REC.failedOn = new Set();
      REC.notice = ''; REC.errors = 0; REC.queue = Promise.resolve(); REC.audioSaved = false;
      REC.noteId = ''; REC.baseMs = 0; REC.stoppedMs = 0; REC.partMs = 0; REC.sttModel = '';
      REC.partStartAt = 0; REC.partDeadline = 0; REC.partTimer = 0;
      clearRecTimers();
    }
    const REC_VOICE_CLASS = ['voice-a', 'voice-b', 'voice-c', 'voice-d'];
    function recTimeline() {
      recLiveTranscript();   // decides the Voice numbering; only the flag is used here
      const parts = REC.segTexts.map((text, index) => ({ index, text: text || '', status: REC.segStatuses[index] || SEG_STATUS.PENDING })).filter(part => part.text.trim() || part.status === SEG_STATUS.FAILED || part.status === SEG_STATUS.NEEDS_RETRY);
      if (!parts.length) return `<div class="rec-empty">${REC.status === REC_STATUS.IDLE ? 'The live transcript appears here as you record.' : 'Listening… the first part appears within about 30 seconds.'}</div>`;
      const lastIndex = parts[parts.length - 1].index;
      return parts.map(part => {
        // A model stamps most turns but not every one. A line without a stamp
        // borrows the last clock above it (or the start of its part), so the
        // column reads as one clock instead of a row of gaps.
        let lastClock = recClockOf(recWallOf(part.index));
        const lines = recNormalizeLabels(part.text).split('\n').filter(line => line.trim()).map(line => {
          const speaker = recSpeakerOf(line);
          if (!speaker) return `<p class="rec-line"><span class="rec-text">${esc(recScrubSpk(recUnmark(line)).trim())}</span></p>`;
          const n = recSpeakerIndex(speaker.name);
          const clock = recStampWall(part.index, speaker.stamp) || lastClock;
          lastClock = clock;
          return `<p class="rec-line"><span class="rec-stamp">${esc(clock)}</span><span class="rec-speaker ${REC_VOICE_CLASS[n % 4]}">${esc(speaker.name)}</span><span class="rec-text">${esc(speaker.text)}</span></p>`;
        }).join('');
        const statusClass = part.status === SEG_STATUS.FAILED ? ' failed' : part.status === SEG_STATUS.IN_PROGRESS ? ' in-progress' : part.status === SEG_STATUS.NEEDS_RETRY ? ' needs-retry' : '';
        const statusLabel = part.status === SEG_STATUS.FAILED ? 'Failed' : part.status === SEG_STATUS.IN_PROGRESS ? 'In progress' : part.status === SEG_STATUS.NEEDS_RETRY ? 'Needs retry' : '';
        // A clock range, not a chunk number: when this stretch of speech started
        // and when it ended, in the reader's own timezone.
        const startWall = recWallOf(part.index);
        const partEnd = REC.segMarks[part.index] ?? recElapsed();
        const partStart = part.index > 0 ? (REC.segMarks[part.index - 1] || 0) : 0;
        const endWall = REC.segWall[part.index + 1] || (part.index === lastIndex && REC.status === REC_STATUS.RECORDING ? Date.now() : startWall + Math.max(0, partEnd - partStart));
        const isLive = part.index === lastIndex && REC.status === REC_STATUS.RECORDING;
        return `<section class="rec-part${isLive ? ' current' : ''}${statusClass}"><header><b>${esc(recClockOf(startWall))}</b><span>${esc(recClockOf(endWall))}</span>${statusLabel ? `<i>${esc(statusLabel)}</i>` : ''}</header>${lines}</section>`;
      }).join('');
    }
    // ---- voice-note history ------------------------------------------------
    // Every session the recorder saved is a note whose body starts with the
    // recording header. The history reads those notes back, so a session is
    // never lost just because the panel was closed: the transcript, the AI
    // notes, the speakers and the times are all still there.
    const recIsSession = note => /^>\s*Recording\b/m.test(String(note?.body || ''));
    // A heading is matched loosely: an older build, or a model writing the note
    // body, can produce "### Transcript" or a trailing space.
    const REC_HEADING = name => new RegExp(`^#{1,6}\\s*${name}\\s*$`, 'm');
    function recSavedParts(note) {
      const body = String(note?.body || '');
      const at = body.search(REC_HEADING('Transcript'));
      if (at < 0) return { lines: [], notes: '' };
      const rest = body.slice(at).replace(/^#{1,6}\s*Transcript[^\n]*\n?/, '');
      const notesAt = rest.search(REC_HEADING('AI notes'));
      const transcript = notesAt < 0 ? rest : rest.slice(0, notesAt);
      const aiNotes = notesAt < 0 ? '' : rest.slice(notesAt).replace(/^#{1,6}\s*AI notes[^\n]*\n?/, '').trim();
      // "_Listening…_" is what an empty transcript holds; it is not a line.
      const lines = transcript.split('\n').map(line => line.trim())
        .filter(line => line && !/^_?\s*Listening/.test(line) && !/^_?\s*The live transcript/.test(line));
      return { lines, notes: aiNotes };
    }
    // A saved line starts with "[14:05:12]" (this build) or "[00:12]" (sessions
    // saved before the clock change). The short form is turned into a real time
    // from the note's own start, so an older recording still reads as a clock.
    function recSavedClock(line, note) {
      const stamp = (String(line).match(/^\[([\d:]{3,12})\]/) || [])[1];
      if (!stamp) return '';
      const bits = stamp.split(':').map(Number);
      if (bits.length === 3) return stamp;
      const start = Number(note?.createdAt) || Date.now();
      return recClockOf(start + (bits[0] * 60 + (bits[1] || 0)) * 1000);
    }
    const recClockMs = clock => {
      const bits = String(clock || '').split(':').map(Number);
      if (bits.length < 2 || bits.some(Number.isNaN)) return null;
      return ((bits[0] * 60 + bits[1]) * 60 + (bits[2] || 0)) * 1000;
    };
    // Parsing every transcript on each render would get slower with every
    // lesson recorded, so a session is read once per edit and kept.
    const recSessionCache = new Map();
    function recSessionList() {
      return (Array.isArray(notes) ? notes : []).filter(recIsSession).map(note => {
        const key = `${note.id}:${note.updatedAt || 0}`;
        if (recSessionCache.has(key)) return recSessionCache.get(key);
        const built = recSessionOf(note);
        if (recSessionCache.size > 60) recSessionCache.clear();
        recSessionCache.set(key, built);
        return built;
      }).sort((a, b) => (b.note.createdAt || 0) - (a.note.createdAt || 0));
    }
    function recSessionOf(note) {
      const { lines, notes: aiNotes } = recSavedParts(note);
      const zero = recSpkZeroIn(lines.join('\n') || aiNotes);
      const voices = new Set(), clocks = [];
      recWithSpkZero(zero, () => lines.forEach(line => {
        const speaker = recSpeakerOf(line);
        if (speaker) voices.add(speaker.name);
        const clock = recSavedClock(line, note);
        if (clock) clocks.push(clock);
      }));
      const first = clocks[0] || '', last = clocks[clocks.length - 1] || '';
      const start = recClockMs(first), end = recClockMs(last);
      const span = start != null && end != null && end > start ? recLengthLabel(end - start) : '';
      const when = note.createdAt ? new Date(note.createdAt) : null;
      const day = when ? when.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }) : '';
      const time = first || (when ? recClockOf(when) : '');
      // The recorder names a session after its date, which the left column
      // already shows; a title the user typed is kept as it is.
      const rawTitle = String(note.title || '').trim();
      const autoTitle = /^(Class|Meeting) recording(?:\s*·.*)?$/i.exec(rawTitle);
      return {
        note, lines, aiNotes,
        title: autoTitle ? `${autoTitle[1]} recording` : rawTitle || 'Recording',
        day, time, span, zero,
        voices: [...voices].length,
        mode: recTitleWord(recModeOfNote(note))
      };
    }
    function recHistoryLine(line, note) {
      const speaker = recSpeakerOf(line);
      const clock = recSavedClock(line, note);
      if (!speaker) return `<p class="rec-line"><span class="rec-text">${esc(recScrubSpk(recUnmark(line).replace(/^\[[\d:]{3,12}\]\s*/, '')))}</span></p>`;
      const n = recSpeakerIndex(speaker.name);
      return `<p class="rec-line"><span class="rec-stamp">${esc(clock)}</span><span class="rec-speaker ${REC_VOICE_CLASS[n % 4]}">${esc(speaker.name)}</span><span class="rec-text">${esc(speaker.text)}</span></p>`;
    }
    function recHistoryHtml() {
      if (REC.status !== REC_STATUS.IDLE && REC.status !== REC_STATUS.DONE) return '';
      const sessions = recSessionList();
      if (!sessions.length) return '';
      const rows = sessions.map(session => {
        const open = REC.histOpen.has(session.note.id);
        const words = session.lines.length || session.aiNotes.split('\n').filter(line => line.trim()).length;
        const meta = [session.mode, session.span, `${words} line${words === 1 ? '' : 's'}`,
          session.voices ? `${session.voices} voice${session.voices === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ');
        const empty = !session.lines.length && !session.aiNotes;
        const body = open ? recWithSpkZero(session.zero, () => `<div class="rec-hist-body">
            ${session.lines.length ? `<div class="rec-hist-scroll">${session.lines.map(line => recHistoryLine(line, session.note)).join('')}</div>` : ''}
            ${empty ? `<p class="rec-muted rec-hist-empty">This session has no words in it yet.</p>` : ''}
            ${session.aiNotes ? `<div class="rec-hist-notes ai-md">${markdownToHtml(session.aiNotes)}</div>` : ''}
            <div class="rec-actions"><button type="button" class="ai-action" data-rec="open-sess" data-id="${esc(session.note.id)}">Open the note</button></div>
          </div>`) : '';
        return `<article class="rec-hist-item${open ? ' open' : ''}">
            <button type="button" class="rec-hist-head" data-rec="sess" data-id="${esc(session.note.id)}" aria-expanded="${open}" aria-label="${esc(`${session.day} ${session.time}, ${session.title}`)}">
              <span class="rec-hist-when"><b>${esc(session.day)}</b><span>${esc(session.time)}</span></span>
              <span class="rec-hist-meta"><b>${esc(session.title)}</b><small>${esc(meta)}</small></span>
              <span class="rec-hist-chev" aria-hidden="true"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7 10 5 5 5-5"/></svg></span>
            </button>${body}</article>`;
      }).join('');
      return `<section class="rec-hist" aria-label="Voice-note history">
          <header class="rec-hist-top"><b>Voice-note history</b><span>${sessions.length} session${sessions.length === 1 ? '' : 's'} on this device</span></header>
          ${rows}
        </section>`;
    }
    function recProviderStrip() {
      const failed = REC.failedOn || new Set();
      // Managed AI hides the backend's provider chain behind one chip and shows
      // which provider actually served the last part.
      if (aiUsesManaged()) {
        const via = REC.provider ? `via ${recLabel(REC.provider)}` : 'Managed AI';
        return `<span class="rec-prov ${REC.provider ? 'used' : 'standby'}"><i></i><b>NotezAi</b><small>${via}</small></span>`;
      }
      return ['gemini', 'groq'].filter(id => aiKey(id)).map(id => {
        const state = REC.provider === id && (REC.status === REC_STATUS.RECORDING || REC.status === REC_STATUS.FINALIZING) ? 'active' : failed.has(id) && REC.provider !== id ? 'stopped' : REC.provider === id ? 'used' : 'standby';
        const label = { active: 'Working', used: 'Last used', stopped: 'Stopped, switched', standby: 'Standby' }[state];
        return `<span class="rec-prov ${state}"><i></i><b>${recLabel(id)}</b><small>${label}</small></span>`;
      }).join('') || '<span class="rec-prov standby"><b>No key</b></span>';
    }
    function recLiveHtml() {
      const pending = REC.expectedParts ? Math.max(0, REC.expectedParts - REC.processed) : 0;
      const failedCount = recHeldIndices().length;   // parts held on this device, waiting to send
      const notes = REC.liveNotes ? markdownToHtml(REC.liveNotes) : `<p class="rec-muted">${REC.status === REC_STATUS.IDLE ? 'Notes are written as the recording goes on. Each refresh adds to the last.' : 'Notes are written when the recording finishes, after the speakers are labelled.'}</p>`;
      const notice = REC.notice ? `<div class="ai-notice rec-notice" role="status">${esc(REC.notice)}</div>` : '';
      if (REC.status === REC_STATUS.IDLE) return `<div class="rec-strip">${recProviderStrip()}</div>${notice}`;
      const tab = REC.tab === 'notes' ? 'notes' : 'transcript';
      const tabs = `<div class="rec-tabs" role="tablist" aria-label="Live view"><button type="button" role="tab" aria-selected="${tab === 'transcript'}" data-rec="tab" data-tab="transcript">Transcript<small>${pending ? `${pending} in progress` : REC.processed ? 'Up to date' : 'Listening'}</small></button><button type="button" role="tab" aria-selected="${tab === 'notes'}" data-rec="tab" data-tab="notes">Notes<small>${REC.failovers ? `${REC.failovers} switch${REC.failovers === 1 ? '' : 'es'}` : 'Live'}</small></button></div>`;
      const pane = tab === 'transcript' ? `${recSpeakerPanel()}<div class="rec-scroll" id="rec-transcript">${recTimeline()}</div>` : `<div class="rec-scroll ai-md">${notes}</div>`;
      return `<div class="rec-strip">${recProviderStrip()}</div>${recStatusLine(failedCount)}${tabs}<section class="rec-card">${pane}</section>`;
    }
    // Re-drawn often while recording. A speaker name being typed keeps its text and its place.
    function updateRecLive() {
      const el = $('#rec-live'); if (!el) return;
      const focused = el.querySelector('[data-rec-speaker]:focus');
      const kept = focused ? { label: focused.dataset.recSpeaker, value: focused.value, at: focused.selectionStart } : null;
      el.innerHTML = recLiveHtml();
      if (!kept) return;
      const input = [...el.querySelectorAll('[data-rec-speaker]')].find(node => node.dataset.recSpeaker === kept.label);
      if (input) { input.value = kept.value; input.focus(); try { input.setSelectionRange(kept.at, kept.at); } catch { /* not supported */ } }
    }
    // The title a recording gets when no name is typed.
    function recAutoTitle(when = new Date()) {
      const mode = recTitleWord(REC.mode);
      return `${mode} recording · ${when.toLocaleDateString()} ${when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    }
    // Typing keeps the name for the note; leaving the box renames a note that already exists.
    function recNameCommit(value) {
      REC.name = value;
      const note = REC.noteId && notes.find(item => item.id === REC.noteId);
      if (!note) return;
      note.title = value.trim() || recAutoTitle(new Date(REC.startedAt || Date.now()));
      note.updatedAt = Date.now();
      persistNote(note).catch(() => toast('Saved locally; sync is queued.', 'error'));
      renderEverything();
    }
    document.addEventListener('input', event => { if (event.target?.id === 'rec-name') REC.name = event.target.value; });
    // The user's own instructions for the transcriber and the notes writer. Kept on
    // this device only, so they are there the next time the recorder opens.
    const REC_INSTRUCTIONS_KEY = 'notez-rec-instructions';
    const REC_INSTRUCTIONS_MAX = 1200;
    function recSavedInstructions() { try { return localStorage.getItem(REC_INSTRUCTIONS_KEY) || ''; } catch { return ''; } }
    function recRememberInstructions(value) { try { localStorage.setItem(REC_INSTRUCTIONS_KEY, value); } catch { /* not kept in private windows */ } }
    document.addEventListener('input', event => {
      if (event.target?.id !== 'rec-instructions') return;
      REC.instructions = event.target.value.slice(0, REC_INSTRUCTIONS_MAX);
      recRememberInstructions(REC.instructions);
    });
    document.addEventListener('change', event => { if (event.target?.id === 'rec-name') recNameCommit(event.target.value); });
    document.addEventListener('change', event => { if (event.target?.matches?.('[data-rec-speaker]')) recRenameSpeaker(event.target.dataset.recSpeaker, event.target.value); });
    // The settings drawer stays open or closed across redraws.
    document.addEventListener('toggle', event => { if (event.target?.matches?.('details.rec-more')) REC.moreOpen = event.target.open; }, true);
    function recBodyHtml() {
      const status = REC.status;
      const stateLabel = { idle: 'Ready', recording: 'Recording', paused: 'Paused', finishing: 'Finishing', done: 'Saved' }[status] || 'Ready';
      const ic = d => `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</g></svg>`;
      const clock = `<span class="rec-clock" id="rec-clock">${fmtClock(recElapsed())}</span>`;
      const modeSeg = status === REC_STATUS.IDLE ? `<fieldset class="rec-modes"><legend class="nzai-label">Recording type</legend><div class="rec-mode-grid" role="radiogroup">${REC_MODE_IDS.map(id => `<label class="rec-mode-opt"><input type="radio" name="rec-mode" id="rec-mode-${id}" value="${id}" ${REC.mode === id ? 'checked' : ''}><span>${esc(recModeName(id))}</span></label>`).join('')}</div><p class="rec-muted rec-mode-hint">${esc(NzVoice.modeOf(REC.mode).hint)}</p></fieldset>` : '';
      const intro = status === REC_STATUS.IDLE ? `<p class="rec-sub">Record a lecture, meeting, call or conversation. You get a live transcript with speakers, and notes written as you go.</p>${modeSeg}` : '';
      const stage = (() => {
        if (status === REC_STATUS.IDLE) return `<div class="rec-stage idle"><button type="button" class="rec-rec" data-rec="start" aria-label="Start recording" ${REC.starting ? 'disabled aria-busy="true"' : ''}><i></i></button><div class="rec-stage-t"><b>${REC.starting ? 'Waiting for the microphone…' : 'Start recording'}</b><small>${REC.starting ? 'Allow the microphone in your browser' : 'Saved to your library from the first second'}</small></div></div>`;
        const meter = status === REC_STATUS.RECORDING ? `<div class="rec-meter" aria-hidden="true"><i id="rec-level" style="width:0%"></i></div>` : '';
        const mid = status === REC_STATUS.PAUSED ? `<button type="button" class="rec-ctl" data-rec="resume">${ic('<path d="M7 4l13 8-13 8Z"/>')}<span>Resume</span></button>` : status === REC_STATUS.RECORDING ? `<button type="button" class="rec-ctl" data-rec="pause">${ic('<path d="M8 5v14M16 5v14"/>')}<span>Pause</span></button>` : '';
        const ctl = status === REC_STATUS.RECORDING || status === REC_STATUS.PAUSED ? `<div class="rec-ctls">${mid}<button type="button" class="rec-ctl stop" data-rec="stop">${ic('<rect x="6" y="6" width="12" height="12" rx="2"/>')}<span>Stop</span></button><button type="button" class="rec-ctl quiet" data-rec="discard" aria-label="Discard this recording" title="Discard this recording">${ic('<path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/><path d="M10 11v5M14 11v5"/>')}</button><button type="button" class="rec-ctl quiet" data-rec="close" aria-label="Hide panel while recording continues" title="Hide panel (recording continues)">${ic('<path d="m6 9 6 6 6-6"/>')}</button></div>` : '';
        return `<div class="rec-stage ${status}"><div class="rec-state ${status}"><i></i><b>${stateLabel}</b></div>${status === REC_STATUS.DONE ? '' : clock}${meter}${ctl}</div>`;
      })();
      const tail = (() => {
        if (status === REC_STATUS.IDLE) return `<details class="rec-more" ${REC.moreOpen ? 'open' : ''}><summary>Notes and transcript settings</summary><div class="rec-more-body"><label class="nzai-label" for="rec-enhance">Notes style</label><select class="nzai-field" id="rec-enhance">${[['auto', recAutoLabel()], ['summary', 'Summary and action items'], ['quiz', 'Quiz from this lecture'], ['clean', 'Clean transcript only'], ['custom', 'Follow my instructions'], ['none', 'Transcript only (no AI notes)']].map(([v, l]) => `<option value="${v}" ${(REC.choice || 'auto') === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
          <label class="nzai-label" for="rec-chunk">Transcript length</label>
          <select class="nzai-field" id="rec-chunk">${recChunkChoices().map(ms => `<option value="${ms}" ${recChunkMs() === ms ? 'selected' : ''}>${ms === REC_CHUNK_DEFAULT ? '40 s · recommended' : ms === REC_CHUNK_CHOICES[0] ? '20 s · fastest updates' : recChunkLabel(ms)}</option>`).join('')}</select>
          <p class="rec-muted" id="rec-chunk-hint">${recChunkHint(recChunkMs())} Longer parts use fewer requests; the first part is always 20 seconds so the transcript starts straight away.</p>
          <p class="rec-muted" id="rec-stt-hint">${recSttHint()}</p>
          <div class="rec-actions" style="margin-top:8px"><button type="button" class="ai-action" data-rec="voices"><span>Voices${recVoiceCount() ? ` (${recVoiceCount()})` : ''}</span></button></div><p class="rec-muted">Teach a voice once and every recording labels that person by name. Tell everyone you are recording, and get their agreement first.</p></div></details>`;
        if (status === REC_STATUS.FINALIZING) return `<div class="rec-actions"><button type="button" class="ai-action" data-rec="close">Hide panel</button></div>`;
        if (status === REC_STATUS.DONE) return `<div class="rec-actions"><button type="button" class="ai-action primary big" data-rec="open">Open note</button><button type="button" class="ai-action big" data-rec="continue" title="Keep recording into this same note">Continue recording</button><button type="button" class="ai-action" data-rec="names">Name speakers</button><button type="button" class="ai-action" data-rec="download">Download transcript</button><button type="button" class="ai-action" data-rec="voices">Voices</button><button type="button" class="ai-action" data-rec="new">New session</button><button type="button" class="ai-action rec-danger" data-rec="discard">Discard</button><button type="button" class="ai-action" data-rec="close">Close</button></div>`;
        return '';
      })();
      const live = `<div id="rec-live" class="rec-live">${recLiveHtml()}</div>`;
      // Ready to record: the past sessions come up before the settings, because
      // reading yesterday's lesson is the more likely next move. A session that
      // has just finished keeps its own actions first, history under them.
      const guide = status === REC_STATUS.IDLE ? `<div class="rec-name"><label class="nzai-label" for="rec-instructions">Instructions for the AI</label><textarea class="nzai-field" id="rec-instructions" rows="3" maxlength="${REC_INSTRUCTIONS_MAX}" placeholder="e.g. Sir is the teacher: label his voice Teacher. Everyone else is a Student. Skip gossip and jokes in the notes.">${esc(REC.instructions ?? recSavedInstructions())}</textarea><p class="rec-muted">Read by the transcriber, which labels each voice, and by the notes writer. Teach a voice in Voices for the most accurate names.</p></div>` : '';
      const naming = [REC_STATUS.IDLE, REC_STATUS.RECORDING, REC_STATUS.PAUSED].includes(status) ? `<div class="rec-name"><label class="nzai-label" for="rec-name">Name this recording</label><input class="nzai-field" id="rec-name" type="text" maxlength="80" autocomplete="off" placeholder="${esc(recAutoTitle())}" value="${esc(REC.name || '')}"></div>` : '';
      return `${intro}${naming}${guide}${stage}${live}${tail}`;
    }
    let recMeterCtx = null, recMeterRaf = 0;
    function recStartMeter(stream) {
      try {
        recMeterCtx = new (window.AudioContext || window.webkitAudioContext)();
        const source = recMeterCtx.createMediaStreamSource(stream), analyser = recMeterCtx.createAnalyser();
        analyser.fftSize = 512; source.connect(analyser);
        const data = new Uint8Array(analyser.fftSize);
        const frame = () => {
          analyser.getByteTimeDomainData(data);
          let peak = 0; for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
          const level = $('#rec-level'); if (level) level.style.width = Math.min(100, peak / 128 * 140) + '%';
          recMeterRaf = requestAnimationFrame(frame);
        };
        frame();
      } catch { /* the level meter is cosmetic */ }
    }
    function recStopMeter() { cancelAnimationFrame(recMeterRaf); try { recMeterCtx?.close(); } catch {} recMeterCtx = null; }
    // While a recording is running the panel is a fixed-height screen: the
    // transcript takes the height that is left. The class is what the layout keys on.
    function recRender() {
      const body = $('#rec-body'); if (!body) return;
      body.classList.toggle('is-live', [REC_STATUS.RECORDING, REC_STATUS.PAUSED, REC_STATUS.FINALIZING].includes(REC.status));
      body.innerHTML = recBodyHtml();
    }
    const REC_MIC = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } };
    // Opens the microphone and starts capturing. `fresh` creates a new note; the
    // other path continues an earlier recording in the same note.
    function recBeginCapture(fresh) {
      if (!recMove('begin')) return;
      recRender();
      navigator.mediaDevices.getUserMedia(REC_MIC).then(stream => {
        // The microphone prompt can be open for a while; if the session was
        // discarded in the meantime, do not revive it.
        if (!recMove('granted')) {
          recMove('denied');
          try { stream.getTracks().forEach(track => track.stop()); } catch { /* not started */ }
          return;
        }
        // Remember where the clock stopped before it is cleared for the new capture.
        const resumeFrom = REC.stoppedMs || REC.baseMs;
        REC.stream = stream; REC.mime = recMime();
        REC.pausedMs = 0; REC.pausedAt = 0; REC.stoppedMs = 0;
        if (fresh) {
          REC.gen = (REC.gen || 0) + 1;
          REC.choice = $('#rec-enhance')?.value || 'auto';
          REC.instructions = String($('#rec-instructions')?.value ?? recSavedInstructions()).trim().slice(0, REC_INSTRUCTIONS_MAX);
          REC.baseMs = 0; REC.partMs = 0; REC.sttModel = ''; REC.segTexts = []; REC.segBlobs = []; REC.segStatuses = []; REC.segMarks = []; REC.segWall = []; REC.speakerClips = {}; REC.renames = {}; REC.segIdx = 0;
          REC.processed = 0; REC.expectedParts = 0; REC.failovers = 0; REC.liveNotes = ''; REC.provider = '';
          REC.notice = ''; REC.errors = 0; REC.queue = Promise.resolve(); REC.failedOn = new Set();
          REC.startedAt = Date.now();
          const when = new Date();
          const note = normalizeNote({ id: uid(), title: (REC.name || '').trim() || recAutoTitle(when), subject: (currentFolderPath || recFolderOf(REC.mode)).split('/')[0], folderPath: currentFolderPath || recFolderOf(REC.mode), tags: ['RECORDING', 'LIVE'], kind: 'markdown', body: recNoteBody('', '', false), createdAt: Date.now(), updatedAt: Date.now(), lastViewedAt: Date.now() });
          REC.noteId = note.id; notes = [note, ...notes]; addFolderPath(note.folderPath); persistNote(note).catch(() => {}); renderEverything();
        } else {
          // Continue: the clock picks up where the last recording stopped and the
          // part numbering carries on, so the note reads as one uninterrupted
          // session instead of three stitched ones.
          REC.baseMs = resumeFrom;
          REC.startedAt = Date.now();
          REC.partMs = 0;              // a new capture reads the current setting again
          REC.notice = '';
          recSaveNote(false);
        }
        recOpenDurableSession();   // session row + cloud claim (fire and forget)
        startPart(); recRunTimers(); recStartMeter(stream); recRender();
      }).catch(error => {
        recMove('denied');
        console.error('Recording could not start:', error);
        recRender();
        toast(error?.name === 'NotAllowedError' ? 'Microphone access was blocked. Allow it in your browser settings.' : 'Could not open the microphone.', 'error', 6000);
      });
    }
    function recStart() {
      if (REC.status !== REC_STATUS.IDLE) return;
      recBeginCapture(true);
    }
    // Continue an earlier recording in the same note.
    function recContinue() {
      if (REC.status !== REC_STATUS.DONE || !REC.noteId) return;
      if (recHeldIndices().length) { toast('Send or discard the waiting parts of the earlier recording first.', 'info', 5000); return; }
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { toast('This browser cannot record audio. Use Chrome or Edge on https.', 'error', 6000); return; }
      if (!hasAudioProvider()) { toast('Recording needs NotezAi or your own Gemini/Groq key. Check AI source in NotezAi settings.', 'error', 6000); return; }
      recBeginCapture(false);
    }
    // Throw the recording away: stop the microphone, drop the parts, delete the
    // note the session created.
    async function recDiscard() {
      if (!REC.noteId && REC.status !== REC_STATUS.RECORDING && REC.status !== REC_STATUS.PAUSED) return;
      if (!(await uiConfirm({ title: 'Discard this recording?', message: 'Its transcript and notes will be deleted. Anything you already copied out is safe, everything else is gone.', confirmLabel: 'Discard recording', danger: true }))) return;
      const noteId = REC.noteId;
      if (!recMove('discard')) return;
      REC.noteId = '';   // in-flight parts stop writing to a note that is about to go
      recRender();
      clearRecTimers();
      await endPart();
      recStopMeter();
      try { REC.stream?.getTracks().forEach(track => track.stop()); } catch { /* already stopped */ }
      REC.stream = null;
      await Promise.race([REC.queue, recSleep(15000)]);   // let requests in flight settle, never hang the panel
      recResetSession();
      recRender();
      if (noteId) {
        // Explicit, confirmed deletion. The cloud copy goes first, with the
        // tombstone written LAST so no other device can resurrect the session;
        // then the local journal and the note itself.
        try { await NzRecCloud.discardSession(noteId); } catch (error) { console.warn('Cloud discard failed (local delete goes on):', error); }
        // forgetSession drops parts + slices + session row + this session's
        // queued jobs in one go.
        try { await NzRecJournal.forgetSession(noteId); } catch (error) { console.warn('Journal cleanup failed:', error); }
        await deleteNote(noteId, { confirm: false });
      }
      toast('Recording discarded.', 'success', 3000);
    }
    function recPause() { if (REC.status !== REC_STATUS.RECORDING) return; endPart(); recMove('pause'); REC.pausedAt = Date.now(); clearRecTimers(); recRender(); }
    function recResume() { if (REC.status !== REC_STATUS.PAUSED) return; REC.pausedMs += Date.now() - REC.pausedAt; REC.pausedAt = 0; recMove('resume'); startPart(); recRunTimers(); recRender(); }
    async function recStop() {
      if (REC.status !== REC_STATUS.RECORDING && REC.status !== REC_STATUS.PAUSED) return;
      if (REC.discarding) return;
      REC.stoppedMs = recElapsed();
      if (REC.status === REC_STATUS.RECORDING) { REC.pausedAt = 0; }
      recMove('stop'); clearRecTimers(); recRender();
      // Finishing must always end: whatever fails on the way (a recorder that
      // will not close, a transcript that is still in flight, an AI route that
      // is out of reach) is logged, and the panel still lands on Saved with
      // whatever was transcribed. It never sits on "Finishing" forever.
      try {
        await endPart();                                   // the last part is finalised before the microphone is released
        recStopMeter(); REC.stream?.getTracks().forEach(track => track.stop()); REC.stream = null;
        await Promise.race([REC.queue, recSleep(180000)]); // parts are transcribed first; a stuck part cannot block the note for more than 3 minutes
        recSaveNote(true, REC.liveNotes);
        if (recLiveTranscript() && REC.choice !== 'none') {
          try {
            // A summary is a nicety, the transcript is the record: never let it
            // hold the panel on "Finishing" for longer than a minute and a half.
            await Promise.race([
              recRefreshNotes(true),
              recSleep(90000).then(() => { throw Object.assign(new Error('The notes summary timed out.'), { code: 'timeout' }); })
            ]);
            recSaveNote(true, REC.liveNotes);
          } catch (error) { console.warn('Final notes failed:', error); REC.notice = 'The notes summary could not be written this time. The transcript is saved.'; }
        }
      } catch (error) {
        console.warn('Finishing the recording hit an error:', error);
      } finally {
        try { recStopMeter(); REC.stream?.getTracks().forEach(track => track.stop()); REC.stream = null; } catch { /* released already */ }
        try { recSaveNote(true, REC.liveNotes); } catch (error) { console.warn('Saving the finished note failed:', error); }
      }
      const note = notes.find(item => item.id === REC.noteId);
      if (note) { note.body = note.body.replace(/^> Recording finished/, '> Recording finished'); persistNote(note).catch(() => {}); }
      recSaveTranscriptNote();
      const voices = recDetectVoices(recLiveTranscript());
      // The journal is never cleared on a normal finish (audio retention):
      // the part blobs and committed slices stay on this device, the session
      // row says capture stopped, and every completed part gets its durable
      // cloud-upload job (idempotent — a part already uploaded is skipped).
      if (REC.noteId) void recCloseDurableSession();
      recMove('finished'); recRender(); renderEverything();
      toast('Recording finished and saved to your library.', 'success', 4500);
      if (voices.length && note) recOfferNames(note.id, voices);
    }
    // The transcript of a recording is kept as its own note, beside the notes, so
    // it can be read, searched or copied on its own. One per recording, updated
    // in place when parts arrive late.
    function recSaveTranscriptNote() {
      const source = notes.find(item => item.id === REC.noteId); if (!source || REC.discarding) return;
      const machineTranscript = recTranscriptForNote(); if (!machineTranscript.trim()) return;
      const id = `${source.id}-tx`;
      let note = notes.find(item => item.id === id);
      // Same commit rule as the note body: an edited transcript note is kept,
      // new parts are appended below with a machine marker.
      const section = note ? recCommitSection('txNoteState', String(note.body || '').replace(/^>[^\n]*\n*/, '')) : machineTranscript;
      const body = `> Transcript of "${source.title}" · ${new Date(REC.startedAt || Date.now()).toLocaleString()}\n\n${section}`.slice(0, recNoLimits() ? undefined : 200000);
      if (note) { note.body = body; note.updatedAt = Date.now(); }
      else {
        note = normalizeNote({ id, title: `Transcript · ${source.title}`, subject: source.subject, folderPath: source.folderPath, body, tags: ['TRANSCRIPT'] });
        notes = [note, ...notes]; addFolderPath(source.folderPath);
      }
      persistNote(note).catch(() => toast('Saved locally; sync is queued.', 'error'));
      renderEverything();
    }
    // Downloads the transcript as a plain text file.
    function recDownloadTranscript() {
      const text = recTranscriptForNote();
      if (!text.trim()) { toast('There is no transcript yet.', 'info', 3000); return; }
      const source = notes.find(item => item.id === REC.noteId);
      const name = String(source?.title || 'transcript').replace(/[^\p{L}\p{N} _-]+/gu, '').trim() || 'transcript';
      const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
      const link = document.createElement('a'); link.href = url; link.download = `${name}.txt`;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }
    function recClick(event) {
      const act = event.target.closest('[data-rec]')?.dataset.rec; if (!act) return;
      if (act === 'start') return recStart();
      if (act === 'continue') return recContinue();
      if (act === 'new') {
        if (recHeldIndices().length) { toast('Send or discard the waiting parts of the earlier recording first.', 'info', 5000); return; }
        recResetSession(); return recRender();
      }
      if (act === 'discard') { recDiscard(); return; }
      if (act === 'tab') { REC.tab = event.target.closest('[data-rec]').dataset.tab; return updateRecLive(); }
      
    // The Send button: every part still held on this device is sent now.
    function recRetryFailedSegments() {
      if (!recHeldIndices().length) { toast('Nothing is waiting to be sent.', 'info', 3000); return; }
      if (!navigator.onLine) { toast('You are offline. The parts send when you are back online.', 'info', 4000); return; }
      recFlushHeld(true);
    }
    if (act === 'pause') return recPause();
      if (act === 'resume') return recResume();
      if (act === 'stop') return recStop();
      if (act === 'voices') { if (typeof nzVoiceLibrary === 'function') nzVoiceLibrary(); return; }
      if (act === 'names') { const note = notes.find(item => item.id === REC.noteId); const voices = note ? recDetectVoices(note.body) : []; if (voices.length) recOfferNames(REC.noteId, voices); else toast('No speaker labels found in this note yet.'); return; }
      if (act === 'open') { const note = notes.find(item => item.id === REC.noteId); nzaiClose(); if (note) openNote(note.id); return; }
      if (act === 'close') {
        nzaiClose(); return;   // recording keeps running in the background
      }
      if (act === 'retry') { recRetryFailedSegments(); return; }
      if (act === 'download') { recDownloadTranscript(); return; }
      if (act === 'sess') { const id = event.target.closest('[data-rec]').dataset.id; if (!id) return; if (REC.histOpen.has(id)) REC.histOpen.delete(id); else REC.histOpen.add(id); return recRender(); }
      if (act === 'open-sess') { const id = event.target.closest('[data-rec]').dataset.id; const note = notes.find(item => item.id === id); if (!note) return; nzaiClose(); openNote(note.id); return; }
    }
    // Recording keeps going if the dialog is hidden; reopen it from Import to see progress.
    function bytesToB64Safe(bytes) { let bin = ''; const chunk = 0x8000; for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk)); return btoa(bin); }
    const RECORD_LABEL_PASS = `Below is a transcript of a classroom or meeting part with no speaker labels. Split it into turns and put a label at the start of every turn: "Voice 1:", "Voice 2:" and so on, using context — who asks, who answers, greetings, who is addressed by name, and changes of topic. Keep the same label for the same person throughout. If only one person is speaking, label every turn "Voice 1:". Do not change, correct, merge, split or drop any spoken word, and do not translate. Output only the labelled transcript.`;
    // Full large-v3 first, turbo second. Turbo keeps only 4 of the 32 decoder
    // layers, which is why it drops words and whole sentences on real audio;
    // both models share the same free allowance, so the slower build is free.
    const GROQ_STT_MODELS = ['whisper-large-v3', 'whisper-large-v3-turbo'];
    async function recTranscribeGroq(blob, hint = '') {
      const key = aiKey('groq'); if (!key) throw new Error('Add a Groq key to transcribe with Whisper.');
      let lastError = null;
      for (const model of GROQ_STT_MODELS) {
        const form = new FormData(); form.append('file', blob, 'part.webm'); form.append('model', model); form.append('response_format', 'json'); form.append('temperature', '0');
        // Whisper takes 224 tokens of context. The tail of the previous part
        // makes it continue a cut-off sentence instead of starting cold.
        if (hint) form.append('prompt', hint.slice(-600));
        const response = await aiFetch('https://api.groq.com/openai/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          const error = Object.assign(new Error(data?.error?.message || `Transcription failed (${response.status})`), { status: response.status });
          // A rejected key or a rate limit says nothing about this clip, so the
          // other build would fail the same way.
          if ([401, 403, 429].includes(response.status)) throw error;
          lastError = error; continue;
        }
        // An empty reply on a 20-second part means this build gave up on the
        // clip, not that nobody spoke. The other build gets a turn.
        const text = String(data.text || '').trim();
        if (text) return text;
      }
      if (lastError) throw lastError;
      return '';
    }
    const recWords = text => (String(text || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
    // The speaker-labelling pass is an LLM step, and one that summarises instead
    // of relabelling silently deletes speech. Words matter more than labels.
    function recKeepsWords(raw, labelled) {
      const source = recWords(raw);
      if (!source.length) return true;
      const pool = new Map();
      recWords(labelled).forEach(word => pool.set(word, (pool.get(word) || 0) + 1));
      let kept = 0;
      source.forEach(word => { const count = pool.get(word) || 0; if (count > 0) { kept++; pool.set(word, count - 1); } });
      return kept / source.length >= 0.8;
    }
    const RECORD_MODES = {
      class: 'Write in-depth classroom notes from this transcript, for a student who missed the lesson. Include: the topics in the order they were taught; every important concept, definition, fact, formula, date, name and example, explained accurately in full sentences; the teacher\'s key points and what they stressed; homework, tests, deadlines and plans that were given; and the questions asked with their answers. Leave out gossip, jokes, personal talk and chatter that is not about the lesson. Use a Markdown heading per topic, bullets for facts, and a "To revise" list at the end. Use only what the transcript says; never add outside facts. If something is unclear, say so in a few words.',
      custom: 'Write notes from this transcript, following the user\'s instructions below. Use Markdown. Use only what is in the transcript.',
      meeting: 'Write formal meeting minutes from this transcript: date and time if said; attendees (by name or Voice label); agenda items in order; the discussion under each item in short, accurate points; decisions made; action items with owner and deadline when stated; open questions; and the next meeting. Use Markdown headings. Use only what was said, and mark anything unclear as unclear.',
      summary: 'Write a short summary of this transcript, followed by key points and action items (owner if stated). Use Markdown. Use only what is in the transcript.',
      quiz: 'Write a five-question multiple-choice quiz from this transcript. For each question give four options (a to d), the correct letter, and a one-line explanation. Use only what the transcript says. Use Markdown with a heading for each question.',
      clean: 'Clean up this transcript: fix punctuation, capitalisation and obvious mis-hearings where the meaning is clear. Keep every Voice label and every turn in order. Do not summarise or add anything. Output only the cleaned transcript.'
    };
    function recSplitForAi(text, limit) {
      const parts = []; let current = '';
      for (const line of String(text).split('\n')) { if (current.length + line.length > limit && current) { parts.push(current); current = ''; } current += (current ? '\n' : '') + line; }
      if (current) parts.push(current);
      return parts;
    }
    async function recEnhance(transcript, instruction, progress) {
      const pieces = recSplitForAi(transcript, 12000);
      if (pieces.length === 1) return recTextCall(`${instruction}\n\n<transcript>\n${pieces[0]}\n</transcript>`, { temperature: 0.3 });
      const partials = [];
      for (let i = 0; i < pieces.length; i++) {
        progress(`Writing notes for part ${i + 1} of ${pieces.length}`);
        partials.push(await recTextCall(`${instruction}\n\nThis is part ${i + 1} of ${pieces.length} of a longer recording. Cover only this part.\n\n<transcript>\n${pieces[i]}\n</transcript>`, { temperature: 0.3 }));
      }
      progress('Combining the notes');
      return recTextCall(`Combine these partial notes from one recording into a single, well organised set of notes. Remove repeats. Keep every Voice label.\n\n${partials.join('\n\n---\n\n')}`, { temperature: 0.3 });
    }
    function recDetectVoices(text) {
      const found = new Set();
      String(text || '').split('\n').forEach(line => {
        const speaker = recSpeakerOf(line);
        if (speaker && /^Voice\s+\d+$/i.test(speaker.name)) found.add(speaker.name);
      });
      return [...found].sort((x, y) => Number(x.match(/\d+/)[0]) - Number(y.match(/\d+/)[0]));
    }
    // Replaces one speaker label ("Voice 2:") with a name. Used on a note body and on the parts of a recording, so the names survive every later save.
    function recRenameVoice(text, voice, name) {
      const label = String(voice).replace(/\s+/g, '\\s+');
      return String(text || '').replace(new RegExp(`(^|\\n)((?:\\[[\\d:]+\\]\\s*)?\\s*\\**\\s*)${label}(\\s*\\**\\s*):`, 'gi'), (_, lead, pre, post) => `${lead}${pre}${name}${post}:`);
    }
    function recOfferNames(noteId, voices) {
      const note = notes.find(item => item.id === noteId); if (!note) return;
      const rows = voices.map(voice => `<label class="rec-name-row"><span>${esc(voice)}</span><input class="nzai-field" data-voice="${esc(voice)}" placeholder="Name (e.g. Teacher, Ali)" value=""></label>`).join('');
      showModal('names-dialog', 'Name the speakers?', `<p class="rec-small" style="margin:0 0 10px">Give each voice a name. Names replace the labels in this note only, and you can skip this.</p>${rows}<div class="nzai-actions" style="margin-top:12px"><button type="button" class="nzai-primary" data-names="apply">Apply names</button><button type="button" data-names="skip">Skip</button></div>`, dialog => {
        dialog.onclick = event => {
          const act = event.target.closest('[data-names]')?.dataset.names; if (!act) return;
          if (act === 'apply') {
            let body = note.body;
            const learned = [];
            dialog.querySelectorAll('[data-voice]').forEach(input => {
              const name = input.value.trim().replace(/[:\n]/g, ' ').slice(0, 40); if (!name) return;
              const label = input.dataset.voice.replace(/\s+/g, '\\s+');
              body = recRenameVoice(body, input.dataset.voice, name);
              if (REC.noteId === note.id) REC.segTexts = REC.segTexts.map(text => recRenameVoice(text, input.dataset.voice, name));
              learned.push([input.dataset.voice, name]);
            });
            // Taught in the background: future transcripts label this voice by
            // name without asking again. No message, no extra step.
            recLearnNamedVoices(learned);
            note.body = body; note.updatedAt = Date.now();
            persistNote(note).catch(() => toast('Saved locally; sync is queued.', 'error'));
            if (REC.noteId === note.id) recSaveTranscriptNote();   // the transcript note gets the names too
            renderEverything(); if (currentPage === 'reader') openNote(note.id);
            toast('Speaker names applied.');
          }
          dialog.hidden = true;
        };
      });
    }
    const recCss = document.createElement('style');
    recCss.textContent = `.rec-opt{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;cursor:pointer;font:600 12px system-ui,sans-serif}.rec-opt input{accent-color:var(--nz-accent)}.rec-status{display:flex;align-items:center;gap:10px;margin:12px 0 6px}.rec-dot{width:10px;height:10px;border-radius:50%;background:rgba(128,148,170,.5)}.rec-dot.live{background:var(--nz-accent);animation:nzPulse 1.2s infinite}.rec-dot.busy{background:var(--nz-accent);animation:nzPulse 1s infinite}@keyframes nzPulse{50%{opacity:.35}}.rec-clock{font:700 26px ui-monospace,monospace;font-variant-numeric:tabular-nums}.rec-state{font-size:12px;opacity:.7}.rec-meter{height:6px;border-radius:9px;background:rgba(128,148,170,.2);overflow:hidden;margin:8px 0 12px}.rec-meter i{display:block;height:100%;background:var(--nz-accent);transition:width .1s}.rec-small{font-size:11.5px;opacity:.7;margin:8px 0}.rec-name-row{display:grid;grid-template-columns:110px 1fr;gap:10px;align-items:center;margin-bottom:8px;font-size:13px}.rec-live-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:10px 0}.rec-live-h{font-size:11px;letter-spacing:.06em;text-transform:uppercase;opacity:.6}.rec-live-box{margin-top:4px;min-height:120px;max-height:220px;overflow:auto;padding:9px 10px;border-radius:10px;border:1px solid rgba(128,148,170,.25);font-size:12px;line-height:1.5}.rec-live-box div{margin-bottom:4px}.rec-provider{display:flex;justify-content:space-between;gap:10px;font-size:11.5px;opacity:.8;margin-top:4px}.rec-notice{margin-top:8px}.rec-part.failed{opacity:.6;background:rgba(217,83,79,.08);border-left:3px solid #d9534f}.rec-part.in-progress{background:rgba(139,195,74,.08);border-left:3px solid #8bc34a}.rec-part.needs-retry{background:rgba(255,193,7,.08);border-left:3px solid #ffc107}@media(max-width:560px){.rec-live-grid{grid-template-columns:1fr}}`;
    document.head.appendChild(recCss);

    // ================= Reliability: error log, friendly failures, diagnostics =================
    const NZ_ERRORS = [];
    function nzLogError(kind, error) {
      const message = String(error?.message || error || 'Unknown error').replace(/\s+/g, ' ').slice(0, 220);
      NZ_ERRORS.unshift({ t: new Date().toISOString(), kind, message });
      NZ_ERRORS.splice(20);
    }
    window.addEventListener('error', event => {
      if (event.filename && !event.filename.includes('index.html') && !event.filename.startsWith('blob:')) return;   // ignore third-party noise
      nzLogError('error', event.error || event.message);
    });
    window.addEventListener('unhandledrejection', event => {
      nzLogError('promise', event.reason);
      const text = String(event.reason?.message || '');
      if (/Failed to fetch|NetworkError|network/i.test(text) && !navigator.onLine) return;   // offline is already shown
    });
    // Recording indicator: visible from anywhere in the app while a recording runs.
    const recPill = document.createElement('button');
    recPill.id = 'rec-pill'; recPill.type = 'button'; recPill.hidden = true;
    recPill.setAttribute('aria-label', 'Recording in progress. Open voice notes.');
    recPill.innerHTML = '<i></i><b>Recording</b><span id="rec-pill-clock">00:00</span>';
    recPill.addEventListener('click', () => dockShow('voice'));
    document.body.appendChild(recPill);
    setInterval(() => {
      const live = REC.status === REC_STATUS.RECORDING || REC.status === REC_STATUS.PAUSED || REC.status === REC_STATUS.FINALIZING;
      recPill.hidden = !live;
      if (live) { recPill.querySelector('b').textContent = REC.status === REC_STATUS.PAUSED ? 'Paused' : REC.status === REC_STATUS.FINALIZING ? 'Finishing' : 'Recording'; recPill.querySelector('#rec-pill-clock').textContent = fmtClock(recElapsed()); }
      const badge = $('#dock-rec-badge'); if (badge) badge.hidden = !live;
    }, 500);
    // ================= Reading comfort (saved on this device) =================
    const READ_DEFAULTS = { size: 14, lh: 1.86, w: 914 };
    function readingSettings() { try { return { ...READ_DEFAULTS, ...(JSON.parse(localStorage.getItem('notez-reading-v1')) || {}) }; } catch { return { ...READ_DEFAULTS }; } }
    function applyReading(next) {
      const merged = { ...readingSettings(), ...next };
      merged.size = Math.max(12, Math.min(22, Number(merged.size) || 14));
      merged.lh = Math.max(1.4, Math.min(2.4, Number(merged.lh) || 1.86));
      merged.w = Math.max(560, Math.min(1200, Number(merged.w) || 914));
      document.documentElement.style.setProperty('--read-size', merged.size + 'px');
      document.documentElement.style.setProperty('--read-lh', String(merged.lh));
      document.documentElement.style.setProperty('--read-w', merged.w + 'px');
      try { localStorage.setItem('notez-reading-v1', JSON.stringify(merged)); } catch {}
      return merged;
    }
    applyReading({});
    function readingSettingsHtml() {
      const r = readingSettings();
      return `<div class="read-settings">
        <div class="read-row"><label for="rd-size"><b>Text size</b><small style="display:block;opacity:.7">${r.size}px</small></label><input type="range" id="rd-size" min="12" max="22" step="1" value="${r.size}" data-read="size"></div>
        <div class="read-row"><label for="rd-lh"><b>Line spacing</b><small style="display:block;opacity:.7">${r.lh.toFixed(2)}</small></label><input type="range" id="rd-lh" min="1.4" max="2.4" step="0.05" value="${r.lh}" data-read="lh"></div>
        <div class="read-row"><label for="rd-w"><b>Column width</b><small style="display:block;opacity:.7">${r.w}px</small></label><input type="range" id="rd-w" min="560" max="1200" step="20" value="${r.w}" data-read="w"></div>
        <div class="read-preview" id="rd-preview" style="font-size:${r.size}px;line-height:${r.lh}">The quick brown fox explains photosynthesis. Light energy becomes chemical energy in the chloroplast.</div>
        <div class="hub-row" style="border:0;padding:0"><div><small>Changes apply immediately to every note.</small></div><button type="button" class="nzai-primary hub-btn" data-hub="read-reset">Reset</button></div></div>`;
    }
    // ================= Selection actions in the reader: Ask · Explain · Flashcard =================
    const selBar = document.createElement('div');
    selBar.id = 'sel-bar'; selBar.hidden = true; selBar.setAttribute('role', 'toolbar'); selBar.setAttribute('aria-label', 'Selection actions');
    selBar.innerHTML = '<button type="button" data-sel="ask">Ask NotezAi</button><button type="button" data-sel="explain">Explain</button><button type="button" data-sel="card">Flashcard</button><button type="button" data-sel="copy">Copy</button>';
    document.body.appendChild(selBar);
    let selectedText = '';
    function showSelectionBar() {
      const sel = window.getSelection(); const view = $('#viewer-content');
      if (!sel || sel.isCollapsed || !view || !sel.anchorNode || !view.contains(sel.anchorNode)) { selBar.hidden = true; return; }
      const text = sel.toString().replace(/\s+/g, ' ').trim();
      if (text.length < 3) { selBar.hidden = true; return; }
      selectedText = text.slice(0, 1600);
      // Not every environment implements geometry on a Range; fall back to the
      // middle of the viewport so the bar still appears.
      let range = null;
      try { range = sel.getRangeAt(0); } catch {}
      const rect = range && typeof range.getBoundingClientRect === 'function'
        ? range.getBoundingClientRect()
        : { left: window.innerWidth / 2, top: 140, width: 0, height: 0 };
      selBar.hidden = false;
      selBar.style.left = Math.max(120, Math.min(window.innerWidth - 120, rect.left + rect.width / 2)) + 'px';
      selBar.style.top = Math.max(70, rect.top) + 'px';
    }
    document.addEventListener('mouseup', () => setTimeout(showSelectionBar, 10));
    document.addEventListener('keyup', event => { if (event.shiftKey || String(event.key || '').startsWith('Arrow')) setTimeout(showSelectionBar, 10); });
    document.addEventListener('mousedown', event => { if (!event.target.closest('#sel-bar')) selBar.hidden = true; });
    async function selectionAction(kind) {
      const note = notes.find(item => item.id === activeId);
      if (!selectedText) return;
      selBar.hidden = true;
      if (kind === 'copy') { try { await navigator.clipboard.writeText(selectedText); toast('Copied.'); } catch { toast('Your browser blocked clipboard access.', 'error'); } return; }
      if (!aiReady()) { toast('Add a Gemini or Groq key in NotezAi settings to use selection actions.', 'error', 5200); return; }
      if (kind === 'ask') {
        openNotezAi(note || null);
        setTimeout(() => { const input = $('#nzai-input'); if (input) { input.value = `About this passage: “${selectedText}”\n\nWhat does it mean, and how does it connect to the rest of the note?`; input.dispatchEvent(new Event('input', { bubbles: true })); input.focus(); } }, 120);
        return;
      }
      if (kind === 'explain') { openNotezAi(note || null); setTimeout(() => nzaiAsk(`Explain this passage simply, with one example:\n\n“${selectedText}”`), 120); return; }
      if (kind === 'card') {
        toast('Making a flashcard…');
        try {
          const answer = await aiGenerate(`Make one flashcard from this passage. Reply with exactly two lines:\nQ: a clear question the passage answers\nA: the answer, in one or two sentences.\n\nPassage:\n${selectedText}`, { temperature: 0.2 });
          const body = answer.text.trim();
          const stamp = Date.now();
          const created = normalizeNote({ id: uid(), title: `Flashcard · ${(note?.title || 'Notes').slice(0, 50)}`, subject: 'Flashcards', folderPath: 'Flashcards', tags: ['flashcard'], kind: 'markdown', body: `${body}\n\n> From: ${note?.title || 'a note'}`, createdAt: stamp, updatedAt: stamp, lastViewedAt: 0 });
          notes = [created, ...notes]; addFolderPath('Flashcards'); persistNote(created).catch(() => {}); renderEverything();
          toast('Flashcard saved in the Flashcards folder. Study it from the note menu.', 'success', 5200);
        } catch (error) { toast(`Could not make a flashcard: ${aiErrorMessage(error)}`, 'error', 6000); }
      }
    }
    selBar.addEventListener('click', event => { const kind = event.target.closest('[data-sel]')?.dataset.sel; if (kind) selectionAction(kind); });
    // ================= Small delights: celebrations, exam countdown, due nudge =================
    function celebrate(message) {
      const colours = ['var(--nz-accent)', '#e6c04a', '#6cb8ea', '#d9534f', '#9c7d14'];
      const layer = document.createElement('div');
      layer.className = 'nz-confetti'; layer.setAttribute('aria-hidden', 'true');
      for (let i = 0; i < 46; i++) {
        const piece = document.createElement('i');
        piece.style.left = (Math.random() * 100) + '%';
        piece.style.background = colours[i % colours.length];
        piece.style.animationDelay = (Math.random() * 0.35) + 's';
        piece.style.transform = `rotate(${Math.random() * 360}deg)`;
        layer.appendChild(piece);
      }
      document.body.appendChild(layer);
      setTimeout(() => layer.remove(), 2600);
      toast(message, 'success', 4800);
    }
    const nudgeStyle = document.createElement('style');
    nudgeStyle.textContent = `.nz-confetti{position:fixed;inset:0;pointer-events:none;z-index:4000;overflow:hidden}.nz-confetti i{position:absolute;top:-12px;width:9px;height:14px;border-radius:2px;animation:nzFall 2.4s cubic-bezier(.2,.6,.4,1) forwards}@keyframes nzFall{to{transform:translateY(110vh) rotate(540deg);opacity:.9}}@media (prefers-reduced-motion: reduce){.nz-confetti{display:none}}.home-nudge{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;margin:0 0 18px;padding:13px 16px;border-radius:14px;border:1px solid color-mix(in srgb,var(--nz-accent) 35%,transparent);background:color-mix(in srgb,var(--nz-accent) 8%,transparent)}.home-nudge b{font-size:13px}.home-nudge small{display:block;font-size:11.5px;opacity:.75;margin-top:2px}.home-nudge button{white-space:nowrap}`;
    document.head.appendChild(nudgeStyle);
    function examInfo() {
      try { const data = JSON.parse(localStorage.getItem('notez-focus-v1')) || {}; if (!data.exam) return null; const days = Math.round((new Date(data.exam + 'T00:00:00') - new Date(new Date().setHours(0, 0, 0, 0))) / 864e5); return { days, date: data.exam }; } catch { return null; }
    }
    function renderHomeNudge() {
      const anchor = $('#week-digest') || $('.dashboard-stats'); if (!anchor || !currentSession) return;
      let bar = $('#home-nudge');
      if (!bar) { bar = document.createElement('section'); bar.id = 'home-nudge'; bar.className = 'home-nudge'; anchor.before(bar); }
      const due = (Array.isArray(notes) ? notes : []).filter(note => isReviewDue(note)).length;
      const exam = examInfo();
      const conflicts = readConflicts().length;
      const parts = [];
      if (exam) parts.push(exam.days > 0 ? `<b>${exam.days} day${exam.days === 1 ? '' : 's'} to your exam</b>` : exam.days === 0 ? '<b>Exam day. Good luck.</b>' : '<b>Your exam date has passed</b>');
      if (due) parts.push(`${due} note${due === 1 ? ' is' : 's are'} due for review`);
      if (conflicts) parts.push(`<b>${conflicts} sync conflict${conflicts === 1 ? '' : 's'} to review</b>`);
      if (!parts.length) { bar.hidden = true; return; }
      bar.hidden = false;
      const actions = [
        conflicts ? '<button type="button" class="nzai-primary hub-btn" data-nudge="conflicts">Review conflicts</button>' : '',
        due ? '<button type="button" class="nzai-primary hub-btn" data-nudge="study">Start review</button>' : ''
      ].join('');
      bar.innerHTML = `<div><b>${parts.join(' · ')}</b><small>${due ? 'A 10-minute session keeps your memory fresh.' : conflicts ? 'Nothing was lost: each conflict kept both versions.' : 'Nothing is due. Use the time to read ahead.'}</small></div><div style="display:flex;gap:6px;flex-wrap:wrap">${actions}</div>`;
    }
    setInterval(renderHomeNudge, 30000);
    document.addEventListener('click', event => {
      const tag = event.target.closest('[data-tagfilter]'); if (!tag) return;
      event.preventDefault(); event.stopPropagation();
      navigateToPage('notes', 'all');
      const input = $('#search-input'); if (input) { input.value = 'tag:' + tag.dataset.tagfilter.replace(/\s+/g, '-'); input.dispatchEvent(new Event('input', { bubbles: true })); }
    }, true);
    document.addEventListener('click', event => {
      if (event.target.closest('[data-nudge=study]')) startStudySession?.();
      if (event.target.closest('[data-nudge=conflicts]')) showConflicts();
    });
    // ================= Main UI: command strip on Home, recent notes in the sidebar =================
    function renderHomeCommands() {
      const welcome = $('.dashboard-welcome'); if (!welcome) return;
      let strip = $('#home-commands');
      if (!strip) {
        strip = document.createElement('nav');
        strip.id = 'home-commands'; strip.className = 'home-commands'; strip.setAttribute('aria-label', 'Quick actions');
        strip.innerHTML = [
          ['new', 'N', 'New note', 'Start a blank page', 'N'],
          ['record', 'REC', 'Record a lecture', 'Live notes with speakers', ''],
          ['ask', 'AI', 'Ask NotezAi', 'Chat about your library', 'Alt A'],
          ['paste', 'CB', 'Paste as note', 'Clipboard text, one click', 'Alt Shift N']
        ].map(([id, ico, label, hint, key]) => `<button type="button" class="home-cmd" data-cmd="${id}"><span class="home-cmd-ico" aria-hidden="true">${ico}</span><b>${label}</b><small>${hint}</small>${key ? `<kbd>${key}</kbd>` : ''}</button>`).join('');
        welcome.after(strip);
        strip.addEventListener('click', event => {
          const id = event.target.closest('[data-cmd]')?.dataset.cmd; if (!id) return;
          if (id === 'new') openEditor();
          else if (id === 'record') openRecorder();
          else if (id === 'ask') openNotezAi(null);
          else if (id === 'paste') quickCaptureFromClipboard();
        });
      }
      strip.hidden = !currentSession;
    }
    // Home order: daily study card first, then "pick up where you left off", then everything else.
    function orderHomeCards() {
      const home = $('#home-view'), welcome = $('.dashboard-welcome');
      if (!home || !welcome) return;
      let ref = welcome;
      const folderSection = $('#home-folder-grid')?.closest('.home-section');
      for (const el of [$('#week-card'), $('#home-spotlight'), $('#home-commands'), $('#home-nudge'), $('#week-digest'), folderSection]) {
        if (!el || el.parentElement !== home) continue;
        if (ref.nextElementSibling !== el) ref.after(el);
        ref = el;
      }
    }
    function renderSideRecent() {
      const tree = $('#folder-tree'); const anchor = tree?.closest('.nav-section, .sidebar-section') || tree?.parentElement; if (!anchor) return;
      let box = $('#side-recent');
      if (!box) { box = document.createElement('div'); box.id = 'side-recent'; box.className = 'side-recent'; (anchor.parentElement?.contains(anchor) ? anchor : tree).before(box); box.addEventListener('click', event => { const id = event.target.closest('[data-recent]')?.dataset.recent; if (id) openNote(id); }); }
      const recent = (Array.isArray(notes) ? notes : []).filter(note => Number(note.lastViewedAt) > 0).sort((a, b) => b.lastViewedAt - a.lastViewedAt).slice(0, 4);
      box.hidden = !recent.length || !currentSession;
      box.innerHTML = recent.length ? `<div class="side-recent-h">Recent</div>${recent.map(note => `<button type="button" data-recent="${esc(note.id)}" title="${esc(note.title)}"><i class="side-kind" aria-hidden="true"></i><span>${esc(note.title)}</span><small>${new Date(note.lastViewedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}</small></button>`).join('')}` : '';
    }
    // ================= Sync conflicts: keep both versions, never overwrite silently =================
    const SYNCED_KEY = uidValue => `notez-synced-v1-${uidValue}`;
    const CONFLICT_KEY = uidValue => `notez-conflicts-v1-${uidValue}`;
    function readSyncedMap(uidValue) { try { return JSON.parse(localStorage.getItem(SYNCED_KEY(uidValue))) || {}; } catch { return {}; } }
    function writeSyncedMap(uidValue, list) { const map = {}; list.forEach(note => { map[note.id] = note.updatedAt; }); try { localStorage.setItem(SYNCED_KEY(uidValue), JSON.stringify(map)); } catch {} }
    function readConflicts() { const uidValue = currentSession?.mode === 'cloud' ? currentSession.user.uid : ''; if (!uidValue) return []; try { return JSON.parse(localStorage.getItem(CONFLICT_KEY(uidValue))) || []; } catch { return []; } }
    function writeConflicts(list) { const uidValue = currentSession?.mode === 'cloud' ? currentSession.user.uid : ''; if (!uidValue) return; try { localStorage.setItem(CONFLICT_KEY(uidValue), JSON.stringify(list.slice(0, 50))); } catch {} }
    // A conflict: this device has an unsynced edit, and the cloud copy changed since this device last synced the note.
    function isNoteConflict(localNote, remoteNote, syncedMap, isPending) {
      if (!localNote || !remoteNote || !isPending) return false;
      if (localNote.updatedAt === remoteNote.updatedAt) return false;
      const known = syncedMap[localNote.id];
      if (known === undefined) return true;
      return remoteNote.updatedAt !== known;
    }
    function showConflicts() {
      const list = readConflicts();
      const rows = list.length ? list.map(item => `<div class="hist-row"><div class="hist-open" style="cursor:default"><b>${esc(item.title)}</b><small>Your offline edit was saved as a separate copy · ${new Date(item.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</small></div><div style="display:flex;gap:6px;padding-right:6px;flex-wrap:wrap"><button type="button" class="ai-action" data-cf="open" data-id="${esc(item.copyId)}">Open copy</button><button type="button" class="ai-action" data-cf="keep" data-id="${esc(item.copyId)}">Keep both</button><button type="button" class="ai-action danger" data-cf="delete" data-id="${esc(item.copyId)}">Delete copy</button></div></div>`).join('') : '<p style="opacity:.8;margin:0">No conflicts. Every edit reached the cloud cleanly.</p>';
      showModal('conflicts-dialog', 'Sync conflicts', `<p class="rec-small" style="margin:0 0 10px">Two devices edited the same note. The cloud version stayed in place. Your offline edit is kept as a copy, so nothing was lost. Compare them, then keep or delete the copy.</p><div style="max-height:56dvh;overflow:auto;display:grid;gap:8px">${rows}</div>`, dialog => {
        dialog.firstElementChild.style.width = 'min(640px,100%)';
        dialog.onclick = async event => {
          const btn = event.target.closest('[data-cf]'); if (!btn) return;
          const id = btn.dataset.id, act = btn.dataset.cf;
          if (act === 'open') { dialog.hidden = true; openNote(id); return; }
          if (act === 'keep') { writeConflicts(readConflicts().filter(item => item.copyId !== id)); dialog.hidden = true; showConflicts(); renderHomeNudge(); return; }
          if (act === 'delete') {
            const copy = notes.find(note => note.id === id);
            if (copy) {
              const snaps = await snapshotNotesForUndo([copy]);
              notes = notes.filter(note => note.id !== id);
              keepInTrash(snaps);
              const cloudUid = currentSession?.mode === 'cloud' ? currentSession.user.uid : '';
              if (cloudUid) { setCloudDeletion(cloudUid, id, { filePath: '', deletedAt: Date.now() }); markPending(cloudUid, id, false); writeCloudCache(cloudUid, notes); } else localNotesWrite();
              renderEverything();
            }
            writeConflicts(readConflicts().filter(item => item.copyId !== id));
            dialog.hidden = true; showConflicts(); renderHomeNudge();
          }
        };
      });
    }
    // ================= Bulk AI on selected notes: one summary, or tags for each (you approve first) =================
    function ensureBulkAiButtons() {
      const anchor = $('#bulk-star'); if (!anchor) return;
      const bar = anchor.parentElement; if (!bar || bar.querySelector('[data-bulk-ai]')) return;
      bar.insertAdjacentHTML('afterbegin', '<button type="button" class="bulk-ai" data-bulk-ai="summary" title="Write one summary of the selected notes">Summarise together (AI)</button><button type="button" class="bulk-ai" data-bulk-ai="tags" title="Suggest tags for each selected note">Suggest tags (AI)</button>');
      bar.addEventListener('click', event => {
        const kind = event.target.closest('[data-bulk-ai]')?.dataset.bulkAi;
        if (kind) void runBulkAi(kind);
      });
    }
    async function runBulkAi(kind) {
      const targets = notes.filter(note => selectedNoteIds.has(note.id));
      if (!targets.length) { toast('Select at least one note first.', 'error'); return; }
      if (!aiReady()) { toast('Add a Gemini or Groq key in NotezAi settings first.', 'error', 5200); return; }
      try {
        if (kind === 'summary') {
          const budget = aiActive() === 'groq' ? 9000 : 40000;
          const perNote = Math.max(800, Math.floor(budget / targets.length));
          const parts = [];
          for (const note of targets) {
            const text = ((await notesTextForAi(note)) || '').trim().slice(0, perNote) || '(this note has no readable text)';
            parts.push(`## ${note.title}\n${text}`);
          }
          toast(`Summarising ${targets.length} notes…`, 'success', 3000);
          const answer = await recTextCall(`Write one combined study summary of these ${targets.length} notes. Give a short section per note (use its title as the heading) with the key points, then a "Connections" section and a "To revise" list. Use only what the notes say.\n\n${parts.join('\n\n')}`, { temperature: 0.3 });
          const stamp = Date.now(), folder = currentFolderPath || 'AI summaries';
          const created = normalizeNote({ id: uid(), title: `Summary · ${targets.length} notes`, subject: folder.split('/')[0], folderPath: folder, tags: ['ai-summary'], kind: 'markdown', body: `> Written by NotezAi from: ${targets.map(note => note.title).join(', ')}\n\n${answer}`, createdAt: stamp, updatedAt: stamp, lastViewedAt: stamp });
          notes = [created, ...notes]; addFolderPath(folder); persistNote(created).catch(() => {}); renderEverything();
          toast('Summary saved as a new note.', 'success', 4500);
          openNote(created.id);
          return;
        }
        if (kind === 'tags') {
          const suggestions = [];
          for (const note of targets) {
            const text = ((await notesTextForAi(note)) || '').trim().slice(0, 3000) || note.title;
            const out = await recTextCall(`Suggest 3 to 5 short topic tags for this note. Reply with only the tags, comma separated, lowercase, no # symbols.\n\nTitle: ${note.title}\n\n${text}`, { temperature: 0 });
            const tags = String(out).split(/[,\n]/).map(tag => tag.replace(/^[#\-\s*•]+|[.\s]+$/g, '').trim().toLowerCase()).filter(tag => tag && tag.length <= 30).slice(0, 5);
            if (tags.length) suggestions.push({ note, tags });
          }
          if (!suggestions.length) { toast('No tag suggestions came back. Try again.', 'error'); return; }
          const preview = suggestions.slice(0, 12).map(item => `${item.note.title}: ${item.tags.map(tag => '#' + tag).join(' ')}`).join('\n');
          if (!(await uiConfirm({ title: `Add tags to ${suggestions.length} note${suggestions.length === 1 ? '' : 's'}?`, message: `${preview}${suggestions.length > 12 ? `\n…and ${suggestions.length - 12} more` : ''}`, confirmLabel: 'Add tags' }))) return;
          const now = Date.now();
          suggestions.forEach(({ note, tags }) => { note.tags = [...new Set([...(note.tags || []), ...tags])].slice(0, 20); note.updatedAt = now; persistNote(note).catch(() => {}); });
          renderEverything();
          toast(`Tags added to ${suggestions.length} note${suggestions.length === 1 ? '' : 's'}.`, 'success');
        }
      } catch (error) {
        console.warn('Bulk AI failed:', error);
        toast(`AI could not finish: ${aiErrorMessage(error)}`, 'error', 6500);
      }
    }
    const bulkAiCss = document.createElement('style');
    bulkAiCss.textContent = `.bulk-ai{border:1px solid color-mix(in srgb,var(--nz-accent) 45%,transparent);background:color-mix(in srgb,var(--nz-accent) 10%,transparent);color:inherit;border-radius:9px;padding:7px 11px;font:600 12px system-ui,sans-serif;cursor:pointer}.bulk-ai:hover{border-color:var(--nz-accent)}@media (max-width:760px){.bulk-ai{min-height:40px}}`;
    document.head.appendChild(bulkAiCss);
    ensureFirebase().catch(error => console.info('Firebase SDK will load when sign-in is requested:', error?.message || error));
