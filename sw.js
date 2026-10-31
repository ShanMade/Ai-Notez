// Notez service worker: opens offline, always tries the network first for the page itself.
const CACHE = 'notez-03cd188bffd5';
const SHELL = ['./','index.html','manifest.webmanifest','icon-192.png','icon-512.png','vendor/katex/katex.min.css','styles/app.css','styles/reader-v2.css','styles/ai-panel.css','styles/ai-studio.css','styles/ai-theme.css','styles/voice-recorder.css','styles/chat-provenance.css','vendor/katex/katex.min.js','app/08-markdown-renderer.js','app/01-config-and-core.js','app/02-storage-and-notes.js','app/03-library-and-folders.js','app/00-intent-patterns.js','app/16-chat-core.js','app/04-reader-and-html.js','app/05-sync-and-auth.js','app/14-voice-core.js','app/15-recording-state.js','app/17-rec-recovery.js','app/17-rec-wav.js','app/17-rec-journal.js','app/17-rec-jobs.js','app/17-rec-cloud.js','app/17-rec-enhance.js','app/06-ai-and-recording.js','app/07-voice-identity.js','app/10-reader-v2.js','app/11-note-connections.js','app/12-note-connections-ui.js','app/13-semantic-index.js','app/07-voice-profiles.js'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === location.origin && !url.pathname.startsWith('/__/');
  const cdn = ['www.gstatic.com', 'fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname);
  if (!sameOrigin && !cdn) return; // Firebase API/auth traffic always goes straight to the network
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put('index.html', copy)); return res; }).catch(() => caches.match('index.html')));
    return;
  }
  e.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(req);
    const fresh = fetch(req).then(res => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => cached);
    return cached || fresh;
  }));
});
