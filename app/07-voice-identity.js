// ================= Voice identity: teach a voice once, keep the name =================
//
// Speaker labels in a transcript are useless if they start from "Voice 1" in
// every recording. A voice learned here is stored as
//   { id, name, about, sampleId }
// where `about` is a one-line description written by the model from the clip,
// and `sampleId` points at a short reference clip in a private IndexedDB store.
//
// Both the description and the clip travel with the first part of every later
// transcription, so the model labels the turn "Ali:" instead of "Voice 2:".
// Everything stays on this device: nothing is uploaded beyond the model call
// that is already happening.

const NZ_VOICES_KEY = 'notez-voices-v1';
const NZ_VOICE_DB = 'notez-voice-samples-v1';
const NZ_VOICE_STORE = 'samples';
const NZ_VOICE_MAX = 8;            // reference clips attached to one request
const NZ_VOICE_CLIP_MS = 8000;     // a short clip is enough to match a voice
const NZ_VOICE_CLIP_BPS = 16000;   // small on purpose: it is uploaded per recording
const NZ_VOICE_DESCRIBE = [
  'This is a short sample of one person speaking.',
  'Describe the voice so it can be recognised later. Reply with ONE line of at most 28 words:',
  'apparent gender, rough age range, pitch, pace, accent and any distinctive quality.',
  'Do not transcribe it, do not guess a name, and do not greet. Output only that line.'
].join(' ');

const nzVoices = () => {
  try {
    const list = JSON.parse(localStorage.getItem(NZ_VOICES_KEY) || '[]');
    return Array.isArray(list) ? list.filter(voice => voice && voice.name) : [];
  } catch { return []; }
};
function nzVoiceStore(list) {
  try { localStorage.setItem(NZ_VOICES_KEY, JSON.stringify((list || []).slice(0, 24))); } catch { /* private mode */ }
  nzVoiceRefresh();   // the recorder panel shows the count
}
const nzVoiceNames = () => nzVoices().map(voice => voice.name);
const nzVoiceFind = name => nzVoices().find(voice => voice.name.toLowerCase() === String(name || '').trim().toLowerCase());
function nzVoiceRefresh() {
  const label = document.querySelector('[data-rec="voices"] span');
  if (label) label.textContent = `Voices${nzVoices().length ? ` (${nzVoices().length})` : ''}`;
}

// ---------------------------------------------------------------- sample store
function nzVoiceDb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('IndexedDB unavailable')); return; }
    const request = indexedDB.open(NZ_VOICE_DB, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(NZ_VOICE_STORE)) request.result.createObjectStore(NZ_VOICE_STORE); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open the voice store'));
  });
}
// Samples also live in memory for this session: a browser that refuses the
// IndexedDB write (private mode, full disk) can still match voices until it is
// closed, and the current recording does not lose them.
const nzVoiceSampleMemory = new Map();
async function nzVoicePutSample(id, blob) {
  nzVoiceSampleMemory.set(id, blob);
  try {
    const db = await nzVoiceDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(NZ_VOICE_STORE, 'readwrite');
      tx.objectStore(NZ_VOICE_STORE).put(blob, id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return true;
  } catch { return false; }
}
async function nzVoiceGetSample(id) {
  if (nzVoiceSampleMemory.has(id)) return nzVoiceSampleMemory.get(id);
  try {
    const db = await nzVoiceDb();
    const blob = await new Promise((resolve, reject) => {
      const tx = db.transaction(NZ_VOICE_STORE, 'readonly');
      const request = tx.objectStore(NZ_VOICE_STORE).get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return blob;
  } catch { return null; }
}
async function nzVoiceDropSample(id) {
  nzVoiceSampleMemory.delete(id);
  try {
    const db = await nzVoiceDb();
    await new Promise(resolve => {
      const tx = db.transaction(NZ_VOICE_STORE, 'readwrite');
      tx.objectStore(NZ_VOICE_STORE).delete(id);
      tx.oncomplete = resolve; tx.onerror = resolve; tx.onabort = resolve;
    });
    db.close();
  } catch { /* nothing to clean up */ }
}

// ------------------------------------------------------------------- the model
async function nzVoiceDescribe(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const answer = await aiCall('gemini', NZ_VOICE_DESCRIBE, {
    temperature: 0,
    model: typeof recSttModel === 'function' ? recSttModel() : '',
    images: [{ mime: blob.type || 'audio/webm', data: bytesToB64Safe(bytes) }]
  });
  return String(answer.text || '').replace(/\s+/g, ' ').trim().slice(0, 220);
}

// Stores a learned voice. The description is best-effort: without it the name
// still works, because the reference clip travels with the prompt.
async function nzVoiceEnroll(name, blob) {
  const clean = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  if (!clean) throw new Error('Give the voice a name first.');
  if (!blob || blob.size < 1200) throw new Error('That clip is too short — record about 8 seconds.');
  // The clip rides along with the recording part, so it has to stay small.
  if (blob.size > 400000) throw new Error('That clip is too long — use a few seconds of speech.');
  let about = '';
  try { about = await nzVoiceDescribe(blob); } catch (error) { console.warn('Could not describe the voice sample:', error); }
  const id = 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  await nzVoicePutSample(id, new Blob([blob], { type: blob.type || 'audio/webm' }));
  const list = nzVoices().filter(voice => voice.name.toLowerCase() !== clean.toLowerCase());
  list.unshift({ id, name: clean, about, createdAt: Date.now(), updatedAt: Date.now() });
  nzVoiceStore(list);
  return { id, name: clean, about };
}

async function nzVoiceForget(id) {
  const voice = nzVoices().find(item => item.id === id);
  if (!voice) return;
  nzVoiceStore(nzVoices().filter(item => item.id !== id));
  await nzVoiceDropSample(voice.id);
}

// Learning a name without asking: this is what runs when someone names a
// speaker in a finished transcript. It never shows a message, and it never
// replaces a voice that already has a reference clip with a weaker record.
async function nzVoiceLearn(name, blob) {
  const clean = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  if (!clean) return null;
  const clip = blob && blob.size >= 1200 && blob.size <= 400000 ? blob : null;
  const list = nzVoices();
  const existing = list.find(voice => voice.name.toLowerCase() === clean.toLowerCase());
  // The identity is written before the description is asked for: a closed tab
  // must not lose the name that was just given.
  const describe = async (id, sample) => {
    try {
      const about = await nzVoiceDescribe(sample);
      if (!about) return;
      nzVoiceStore(nzVoices().map(voice => voice.id === id ? { ...voice, about, updatedAt: Date.now() } : voice));
    } catch { /* the clip still matches the voice without a description */ }
  };
  if (existing) {
    if (!clip || await nzVoiceGetSample(existing.id)) return existing;   // already as good as it gets
    await nzVoicePutSample(existing.id, clip);
    existing.updatedAt = Date.now();
    nzVoiceStore(list);
    if (!existing.about) describe(existing.id, clip);
    return existing;
  }
  const id = 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  if (clip) await nzVoicePutSample(id, clip);
  const entry = { id, name: clean, about: '', createdAt: Date.now(), updatedAt: Date.now() };
  nzVoiceStore([entry, ...list]);
  if (clip) describe(id, clip);
  return entry;
}

// Text block for the transcription prompt. Sent with every part, so the names
// survive even on the parts that carry no reference clip.
function nzVoicePrompt() {
  const list = nzVoices();
  if (!list.length) return '';
  const rows = list.map((voice, index) => `${index + 1}. ${voice.name}${voice.about ? ' — ' + voice.about : ''}`).join('\n');
  return `Known voices in this workspace, most recently taught first. Use the exact name as the speaker label when a voice matches one of these, and never invent a name that is not on this list.\n${rows}\nIf a voice matches none of them, label it "Voice 1", "Voice 2" and so on.`;
}

// Reference clips, in the same order as nzVoicePrompt(). Only the model ever
// sees them; they are capped in number and length to keep each part small.
// A part carries the recording plus these clips, and the backend refuses a
// request body over 8 MB, so the clips share a fixed budget instead of growing
// with the library.
const NZ_VOICE_BUDGET = 3_500_000;   // base64 characters, ~2.6 MB of audio
async function nzVoiceSamples(limit = NZ_VOICE_MAX) {
  const out = [];
  let used = 0;
  for (const voice of nzVoices().slice(0, limit)) {
    const blob = await nzVoiceGetSample(voice.id);
    if (!blob || !blob.size) continue;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const data = bytesToB64Safe(bytes);
    if (used + data.length > NZ_VOICE_BUDGET) continue;
    used += data.length;
    out.push({ name: voice.name, mime: blob.type || 'audio/webm', data });
  }
  return out;
}

// ---------------------------------------------------------------- teach a voice
let nzVoiceRecorder = null;
function nzVoiceStopTeaching(stream) {
  try { stream?.getTracks().forEach(track => track.stop()); } catch { /* already stopped */ }
}

function nzVoiceLibrary() {
  const rows = nzVoices().map(voice => `
    <div class="nz-voice-row">
      <div><b>${esc(voice.name)}</b><small>${esc(voice.about || 'No description saved — the reference clip is still used.')}</small></div>
      <button type="button" data-forget="${esc(voice.id)}">Forget</button>
    </div>`).join('');
  const body = `
    <p style="margin:0 0 12px;opacity:.8">Teach Notez the voice once. Every later recording labels that person's turns with their real name instead of "Voice 2".</p>
    <div class="nz-voice-list">${rows || '<p style="margin:0 0 12px;opacity:.7">No voices saved yet.</p>'}</div>
    <div style="border-top:1px solid rgba(128,148,170,.25);margin:14px 0;padding-top:14px">
      <label style="display:block;font-weight:600;margin-bottom:6px" for="nz-voice-name">Name this person</label>
      <input id="nz-voice-name" placeholder="e.g. Sir Ahmed" autocomplete="off" maxlength="40" style="width:100%;padding:9px;border-radius:9px;border:1px solid rgba(128,148,170,.4);background:transparent;color:inherit;font:inherit;margin-bottom:10px">
      <div style="display:flex;flex-wrap:wrap;gap:8px">
        <button type="button" data-teach="record" style="padding:9px 14px;border-radius:9px;border:1px solid rgba(128,148,170,.4);background:transparent;color:inherit;font:600 12px system-ui,sans-serif;cursor:pointer">Record 8 seconds</button>
        <label style="padding:9px 14px;border-radius:9px;border:1px solid rgba(128,148,170,.4);font:600 12px system-ui,sans-serif;cursor:pointer">Choose an audio file<input type="file" accept="audio/*" data-teach="file" hidden></label>
      </div>
      <p style="margin:10px 0 0;opacity:.7;font-size:11.5px">Ask the person to say a sentence or two in their normal voice. The clip stays on this device.</p>
      <div id="nz-voice-msg" role="status" style="margin-top:10px;min-height:18px;font-size:12px"></div>
    </div>`;
  showModal('voice-library', 'Voices', body, dialog => {
    const say = (text, bad = false) => {
      const box = dialog.querySelector('#nz-voice-msg');
      if (box) { box.textContent = text; box.style.color = bad ? '#d9534f' : ''; }
    };
    dialog.onclick = async event => {
      const forget = event.target.closest('[data-forget]')?.dataset.forget;
      if (forget) { await nzVoiceForget(forget); nzVoiceLibrary(); return; }
      const teach = event.target.closest('[data-teach]')?.dataset.teach;
      if (teach === 'record') {
        const name = dialog.querySelector('#nz-voice-name')?.value || '';
        if (!name.trim()) { say('Type the name first.', true); return; }
        let stream;
        try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
        catch { say('Microphone access was blocked.', true); return; }
        const chunks = [];
        const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(item => window.MediaRecorder && MediaRecorder.isTypeSupported(item)) || 'audio/webm';
        try {
          nzVoiceRecorder = new MediaRecorder(stream, { mimeType: type, audioBitsPerSecond: NZ_VOICE_CLIP_BPS });
        } catch { nzVoiceStopTeaching(stream); say('This browser cannot record audio.', true); return; }
        nzVoiceRecorder.ondataavailable = e => { if (e.data?.size) chunks.push(e.data); };
        nzVoiceRecorder.onstop = async () => {
          nzVoiceStopTeaching(stream);
          say('Listening to the voice…');
          try {
            await nzVoiceEnroll(name, new Blob(chunks, { type: type.split(';')[0] }));
            toast(`${name.trim()} learned. Future transcripts will use that name.`, 'success', 4000);
            nzVoiceLibrary();
          } catch (error) { say(error?.message || 'Could not save that voice.', true); }
        };
        nzVoiceRecorder.start();
        say('Recording… say something normal for 8 seconds.');
        setTimeout(() => { try { if (nzVoiceRecorder?.state === 'recording') nzVoiceRecorder.stop(); } catch { /* stopped */ } }, NZ_VOICE_CLIP_MS);
        return;
      }
    };
    dialog.onchange = async event => {
      const input = event.target.closest('input[type=file]');
      if (!input?.files?.length) return;
      const name = dialog.querySelector('#nz-voice-name')?.value || '';
      const say = (text, bad = false) => {
        const box = dialog.querySelector('#nz-voice-msg');
        if (box) { box.textContent = text; box.style.color = bad ? '#d9534f' : ''; }
      };
      if (!name.trim()) { say('Type the name first.', true); input.value = ''; return; }
      say('Listening to the voice…');
      try {
        await nzVoiceEnroll(name, input.files[0]);
        toast(`${name.trim()} learned. Future transcripts will use that name.`, 'success', 4000);
        nzVoiceLibrary();
      } catch (error) { say(error?.message || 'Could not save that voice.', true); }
    };
  });
}

// The app shipped an older "Voice settings" screen that saved names and
// descriptions but never used them for transcription. Those profiles are real
// user data, so they are folded into the library once (the old screen stored no
// audio, so these entries start text-only and the clip can be taught later).
function nzVoiceImportLegacy() {
  try {
    if (localStorage.getItem('notez-voices-imported-v1')) return;
    let legacy = [];
    try { legacy = JSON.parse(localStorage.getItem('notez-voice-profiles-v1') || '[]'); } catch { legacy = []; }
    if (Array.isArray(legacy) && legacy.length) {
      const list = nzVoices();
      const known = new Set(list.map(voice => voice.name.toLowerCase()));
      for (const old of legacy) {
        const name = String(old?.name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
        if (!name || known.has(name.toLowerCase())) continue;
        known.add(name.toLowerCase());
        list.push({
          id: 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          name,
          about: String(old?.description || old?.sampleText || '').replace(/\s+/g, ' ').slice(0, 220),
          createdAt: Date.now(),
          updatedAt: Date.now(),
          legacy: true
        });
      }
      nzVoiceStore(list);
    }
    localStorage.setItem('notez-voices-imported-v1', '1');
  } catch { /* a broken legacy value must not stop the app */ }
}
nzVoiceImportLegacy();

// The recorder panel and the voice library share one style block.
const nzVoiceCss = document.createElement('style');
nzVoiceCss.textContent = `.nz-voice-list{display:flex;flex-direction:column;gap:8px}.nz-voice-row{display:flex;gap:10px;align-items:flex-start;justify-content:space-between;padding:8px 10px;border-radius:10px;border:1px solid rgba(128,148,170,.28)}.nz-voice-row b{display:block;font-size:12.5px}.nz-voice-row small{display:block;opacity:.72;font-size:11.5px;line-height:1.45}.nz-voice-row button{flex:0 0 auto;border:0;background:none;color:#d9534f;font:600 11.5px system-ui,sans-serif;cursor:pointer;padding:4px 2px}`;
document.head.appendChild(nzVoiceCss);
