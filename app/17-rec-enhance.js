// Durable recording — pre-transcription voice enhancement.
//
// A completed recording PART is passed through a lightweight, browser-native
// chain BEFORE it is sent to the transcription provider, to improve speech
// intelligibility on quiet, muffled, or uneven classroom recordings:
//
//   decode  →  measure peak + RMS  →  adaptive loudness normalization
//           →  gentle speech high-pass (rumble removal)
//           →  conservative limiter (no clipping)
//           →  encode WAV 16-bit PCM  →  submit the ENHANCED audio
//
// Hard guarantees (Phase 0.3 corrections, in force):
//   - The ORIGINAL part audio is never modified, overwritten, or replaced.
//     It stays byte-identical in the durable journal and the cloud copy.
//     This module only produces a DERIVATIVE used for the transcription
//     request. Voice samples (saved voices + voices already heard) are NOT
//     enhanced — they are identity references and must stay untouched.
//   - The derivative is created fresh on every call and is NEVER persisted
//     anywhere. A retry therefore always enhances the pristine original,
//     never an already-enhanced file (idempotent by construction).
//   - ANY failure — unsupported browser, decode error, render error, or an
//     enhanced payload that would exceed the safe request size — falls back
//     to the ORIGINAL blob. Enhancement can never block or lose a
//     transcription.
//
// Speech preservation (Urdu, English, Roman Urdu, Punjabi, Arabic):
//   - The high-pass is gentle (default 80 Hz) so it removes electrical/handling
//     rumble without eating the low-frequency energy that carries much of the
//     intelligibility of these languages' emphatics and gutturals.
//   - There is NO noise gate and NO spectral denoising: quiet syllables and
//     soft consonants are left intact. Only level is normalized and rumble is
//     attenuated.
//   - Adaptive gain (not a fixed multiplier): quiet recordings are brought up
//     to a target loudness, loud recordings are brought down slightly, and
//     recordings already near the target are left within a dead band. Gain is
//     capped at the top (so background noise is not amplified into the signal)
//     and floored at the bottom (so loud content is not over-compressed).
//     Near-silence below a noise floor is left at unity — never amplified.
//   - No unnecessary resampling or lossy re-encode: the audio is rendered at
//     the DECODED sample rate (48 kHz — the recorder's native Opus rate — in
//     the target browsers, so no resampling occurs there; the output WAV
//     always records the actual rendered rate, never an assumption) and
//     encoded as lossless 16-bit PCM WAV (audio/wav).
//   - Mono AND stereo are both handled safely: stereo is downmixed to a
//     faithful mono average for the derivative (speech is carried in both
//     channels; the transcription provider does not use channel position).
//     This also halves the derivative's size.
//
// The derivative is a small, bounded output: mono, native rate, 16-bit PCM
// (96,000 bytes per second at 48 kHz: 40 s ≈ 3.84 MB, 60 s ≈ 5.76 MB,
// 240 s ≈ 23.04 MB raw WAV). A size guard (maxWavBytes) bounds it so the
// managed route's HTTP body — the enhanced audio's base64 + voice samples +
// prompt + JSON structure — always stays under the backend's 8,000,000-byte
// cap with margin (the verified calculation is on maxWavBytes in DEFAULTS).
// Parts whose enhanced WAV would be larger (e.g. long no-limits parts) are
// sent as the original Opus (≈ 32 kb/s — tiny, always fits). Nothing is ever
// truncated: a part is either fully enhanced and fits, or sent as the
// original, never a shortened version of either.
//
// Decode and rendering are asynchronous (decodeAudioData / startRendering
// return promises) and do not synchronously block the UI thread. Where the
// render computation runs (main thread or a dedicated audio thread) is a
// browser implementation detail — not a spec guarantee — and nothing here
// relies on it.
//
// Observability: the caller records one meta object per part (original and
// enhanced RMS/peak, applied gain, success/fallback + reason, duration, output
// format and byte size). This meta is intentionally NOT surfaced in the normal
// recording UI.

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.NzRecEnhance = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Tunable DSP + pipeline parameters. Defaults are conservative and safe for
  // multilingual classroom speech. Override per-call via the second argument
  // to enhanceForTranscription(), or persistently via configure().
  const DEFAULTS = {
    enabled: true,            // master switch (module-level); also gated by the
                              // per-user localStorage flag below.
    targetRmsDb: -18,         // loudness normalization target (RMS, dBFS).
    maxGainDb: 18,            // never amplify by more than this (caps noise lift).
    minGainDb: -6,            // never attenuate by more than this (loud content).
    gainDeadbandDb: 0.5,      // within this of the target, leave the level alone.
    noiseFloorDb: -55,        // below this RMS it is (near-)silence: no amplification.
    highpassHz: 80,           // gentle rumble cut (Hz).
    highpassQ: 0.7,           // soft filter slope.
    limiterThresholdDb: -1,   // conservative limiter: only clips into full scale.
    limiterKneeDb: 0,         // hard knee (limiter behaviour).
    limiterRatio: 20,         // high ratio above the threshold.
    limiterAttack: 0.002,     // fast enough to catch transients.
    limiterRelease: 0.15,     // slow release to avoid audible pumping.
    peakCeilingDb: -1.0,      // gain is ALSO capped so the loudest sample stays at/below
                              // the limiter threshold BEFORE the high-pass runs, leaving
                              // the limiter — and the 16-bit clamp in floatToI16 — as
                              // backstops against transient high-pass overshoot. An
                              // out-of-range 16-bit sample is impossible by construction
                              // (floatToI16 clamps to [-1, 1]); full-scale (0 dBFS) is
                              // kept well away for the same layered reason.
    sampleRate: 48000,        // REQUESTED decode rate — the recorder's native Opus rate,
                              // so no resampling occurs in the target browsers. All
                              // downstream stages (offline render, WAV header) use the
                              // ACTUAL decoded rate, never this assumption.
    sourceBitrateEst: 32000,  // recorder audioBitsPerSecond. A HEURISTIC used only for
                              // the cheap pre-decode size estimate — it can over- or
                              // under-estimate the duration depending on the actual Opus
                              // bitrate; the exact post-decode check is the authoritative
                              // gate, so no oversized payload can ever be produced.
    // Cap on the enhanced WAV (raw file bytes, 44-byte header included).
    // Verified against the managed route's ACTUAL payload construction:
    //   POST /v1/ai/generate body  = { provider?, model?, prompt, system_prompt,
    //       temperature, json, images: [{mime, data(b64)}...], voice_only? }
    //   POST /v1/ai/transcribe body = { note_id, part_slot, prompt, temperature,
    //       model, images: [...], audio_transcription }
    //   (direct-own route posts the same data to Gemini; its documented 20 MB
    //    per-request cap is looser, so the managed budget is the binding one)
    //   backend hard limit        = 8,000,000 bytes (Content-Length, main.py)
    //   safe target               = 7,600,000  (5% margin under the hard cap)
    //   - voice samples            = 1,200,000 base64 chars max (REC_CONTEXT_BUDGET,
    //                                 hard-capped in recVoiceContext: a sample that
    //                                 would exceed the remaining budget is skipped
    //                                 whole — never truncated)
    //   - prompt + context         = 131,072 (fixed template ~1.5 KB + mode setting +
    //                                 recTail(320) + voice names + user instructions;
    //                                 realistic value is a few KB — this is a worst
    //                                 case, incl. JSON-escaping headroom)
    //   - system_prompt            = 2,048 (fixed 486-char string, /v1/ai/generate only)
    //   - JSON structure/keys      = 16,384 (realistic ~1-2 KB)
    //   => audio base64 budget     = 6,250,496 chars => raw WAV <= 4,687,872 bytes
    // We choose 4,000,000 (≈ 41.7 s mono at 48 kHz) for a further ~15% margin:
    // the default 40 s part (3,840,044 bytes; 5,120,060 b64 chars) still fits,
    // anything longer is sent as the original Opus instead.
    maxWavBytes: 4000000,
  };

  let liveConfig = Object.assign({}, DEFAULTS);

  // Per-user enable flag (localStorage via the app's aiStore). Default ON.
  // Reading it at call time means it can be toggled without a reload.
  function isUserEnabled() {
    try {
      if (typeof aiStore !== 'undefined' && aiStore) {
        return aiStore.get('notez-ai-enhance', '1') !== '0';
      }
    } catch (e) { /* fall through to enabled */ }
    return true;
  }

  function now() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
  }
  const db = (v) => Math.max(-120, v <= 1e-9 ? -120 : 20 * Math.log10(v));
  const round1 = (x) => Math.round(x * 10) / 10;

  // Max-abs + RMS of one channel (or all channels when channel<0).
  function measure(buffer, channel) {
    let peak = 0, sum = 0, count = 0;
    const channels = channel < 0 ? buffer.numberOfChannels : 1;
    for (let c = 0; c < channels; c++) {
      const d = buffer.getChannelData(channel < 0 ? c : channel);
      for (let i = 0; i < d.length; i++) {
        const v = d[i];
        sum += v * v; count++;
        const a = v < 0 ? -v : v;
        if (a > peak) peak = a;
      }
    }
    return { rms: count ? Math.sqrt(sum / count) : 0, peak };
  }

  // Average all channels into a single mono AudioBuffer (no-op if already mono).
  function downmixToMono(ctx, buffer) {
    if (buffer.numberOfChannels === 1) return buffer;
    const len = buffer.length, rate = buffer.sampleRate, n = buffer.numberOfChannels;
    const mono = ctx.createBuffer(1, len, rate);
    const out = mono.getChannelData(0);
    for (let c = 0; c < n; c++) {
      const d = buffer.getChannelData(c);
      for (let i = 0; i < len; i++) out[i] += d[i];
    }
    const inv = 1 / n;
    for (let i = 0; i < len; i++) out[i] *= inv;
    return mono;
  }

  // Adaptive loudness gain for the measured mono level, in dB, plus the
  // linear factor. Unity (0 dB / 1.0) when the level is already fine or the
  // input is near-silence.
  function computeGain(meas, cfg) {
    const rmsDb = db(meas.rms);
    if (rmsDb < cfg.noiseFloorDb) return { gainDb: 0, linear: 1 }; // never lift (near-)silence
    const target = Math.pow(10, cfg.targetRmsDb / 20);
    const desired = 20 * Math.log10(target / Math.max(meas.rms, 1e-9));
    if (desired > -cfg.gainDeadbandDb && desired < cfg.gainDeadbandDb) return { gainDb: 0, linear: 1 };
    let gainDb = Math.max(cfg.minGainDb, Math.min(cfg.maxGainDb, desired));
    // Headroom guard: also cap gain so the loudest sample stays under the ceiling.
    const ceiling = Math.pow(10, cfg.peakCeilingDb / 20);
    gainDb = Math.min(gainDb, 20 * Math.log10(ceiling / Math.max(meas.peak, 1e-9)));
    return { gainDb, linear: Math.pow(10, gainDb / 20) };
  }

  function floatToI16(f32) {
    const out = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) {
      const s = Math.max(-1, Math.min(1, f32[i]));
      out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
    }
    return out;
  }

  // The enhanced payload for one completed part, or the original on any
  // failure. Returns { blob, meta }. meta.succeeded is true only when the
  // caller should use the (enhanced) returned blob in place of the original.
  async function enhanceForTranscription(blob, config) {
    const cfg = Object.assign({}, DEFAULTS, liveConfig, config || {});
    const t0 = now();
    const fail = (reason) => ({
      blob,
      meta: {
        succeeded: false, fallbackReason: reason,
        outputFormat: blob.type || 'audio/webm',
        durationMs: Math.round(now() - t0),
      },
    });

    if (!cfg.enabled || !isUserEnabled()) return fail('enhancement disabled');
    const AC = (typeof self !== 'undefined' && (self.AudioContext || self.webkitAudioContext)) ||
               (typeof window !== 'undefined' && window.AudioContext) || null;
    const OAC = (typeof self !== 'undefined' && (self.OfflineAudioContext || self.webkitOfflineAudioContext)) ||
                (typeof window !== 'undefined' && window.OfflineAudioContext) || null;
    const Wav = (typeof self !== 'undefined' && self.NzRecWav) || (typeof window !== 'undefined' && window.NzRecWav) || null;
    if (!AC || !OAC || !Wav) return fail('Web Audio not available in this browser');

    // Cheap pre-decode size estimate from the part's byte size (Opus bitrate),
    // so a very long no-limits part is not decoded into memory just to be
    // rejected by the size guard afterwards. Heuristic — the post-decode
    // check is the authoritative one.
    const estSeconds = (blob.size * 8) / cfg.sourceBitrateEst;
    if (estSeconds * cfg.sampleRate * 2 + 44 > cfg.maxWavBytes) {
      return fail('part too long for an enhanced payload; original used');
    }

    let ctx = null;
    try {
      ctx = new AC({ sampleRate: cfg.sampleRate });
      const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
      if (!decoded || !decoded.length) return fail('decoded audio is empty');
      const work = downmixToMono(ctx, decoded);

      // Exact size check on the real output (44-byte WAV header + mono 16-bit).
      if (44 + work.length * 2 > cfg.maxWavBytes) {
        return fail('part too long for an enhanced payload; original used');
      }

      const orig = measure(work, 0);
      const { gainDb, linear } = computeGain(orig, cfg);

      const rate = work.sampleRate;
      const octx = new OAC(1, work.length, rate);
      const src = octx.createBufferSource();
      src.buffer = work;
      const gainNode = octx.createGain();
      gainNode.gain.value = linear;
      const hp = octx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = cfg.highpassHz;
      hp.Q.value = cfg.highpassQ;
      const limiter = octx.createDynamicsCompressor();
      limiter.threshold.value = cfg.limiterThresholdDb;
      limiter.knee.value = cfg.limiterKneeDb;
      limiter.ratio.value = cfg.limiterRatio;
      limiter.attack.value = cfg.limiterAttack;
      limiter.release.value = cfg.limiterRelease;
      // order per spec: normalize -> high-pass -> limit
      src.connect(gainNode);
      gainNode.connect(hp);
      hp.connect(limiter);
      limiter.connect(octx.destination);
      src.start(0);
      const rendered = await octx.startRendering();

      const enh = measure(rendered, 0);
      const i16 = floatToI16(rendered.getChannelData(0));
      const wavBytes = Wav.encodeWav(i16, rendered.sampleRate, 1);
      const wavBlob = new Blob([wavBytes], { type: 'audio/wav' });

      return {
        blob: wavBlob,
        meta: {
          succeeded: true, fallbackReason: null,
          originalRmsDb: round1(db(orig.rms)), originalPeakDb: round1(db(orig.peak)),
          appliedGainDb: round1(gainDb),
          enhancedRmsDb: round1(db(enh.rms)), enhancedPeakDb: round1(db(enh.peak)),
          inputChannels: decoded.numberOfChannels,   // actual decoded shape (1 or 2)
          sampleRate: rendered.sampleRate,           // actual decoded/rendered rate
          outputFormat: 'audio/wav', outputBytes: wavBlob.size,
          durationMs: Math.round(now() - t0),
        },
      };
    } catch (error) {
      return fail('enhancement error: ' + String((error && error.message) || error));
    } finally {
      try { if (ctx && ctx.close) ctx.close(); } catch (e) { /* already closed */ }
    }
  }

  // Merge overrides into the module-level config (persisted for the session).
  function configure(overrides) {
    if (overrides && typeof overrides === 'object') liveConfig = Object.assign({}, liveConfig, overrides);
    return Object.assign({}, liveConfig);
  }

  function isSupported() {
    const AC = (typeof self !== 'undefined' && (self.AudioContext || self.webkitAudioContext)) ||
               (typeof window !== 'undefined' && window.AudioContext) || null;
    const OAC = (typeof self !== 'undefined' && (self.OfflineAudioContext || self.webkitOfflineAudioContext)) ||
                (typeof window !== 'undefined' && window.OfflineAudioContext) || null;
    return Boolean(AC && OAC && ((typeof self !== 'undefined' && self.NzRecWav) || (typeof window !== 'undefined' && window.NzRecWav)));
  }

  return { enhanceForTranscription, configure, isSupported, DEFAULTS };
});
