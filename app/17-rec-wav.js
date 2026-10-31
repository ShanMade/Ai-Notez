// Durable recording — PCM/WAV chunking & reconstruction.
//
// Corrects the Phase 0.3 PCM fallback design: concatenating complete WAV
// files does NOT produce a valid WAV (each has its own RIFF/fmt/data
// headers). This module implements:
//   - encodeWav(samples, rate, channels)  → one valid 44-byte-header WAV
//   - parseWav(bytes)                     → validated {rate, channels, bits, samples, ...}
//   - chunkPcm(samples, perChunk)         → N Int16Arrays (1 s each at 16 kHz)
//   - makeChunkWav(chunk, rate)           → each chunk as an INDEPENDENT valid WAV
//   - reconstructWav(chunkWavs)           → strip/validate each header, concat raw
//                                           PCM, write ONE header (the correct method)
// Incompatible chunks (rate/channel/bits mismatch, non-PCM) are rejected,
// never stitched together.
//
// The logic below is the P0.3a prototype (lib/pcm-wav.js, 8/8 test cases)
// ported into the app unchanged apart from the public name.

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.NzRecWav = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function encodeWav(samples, sampleRate, channels) {
    channels = channels || 1;
    const dataSize = samples.length * 2;
    const out = new Uint8Array(44 + dataSize);
    const dv = new DataView(out.buffer);
    const ws = (o, s) => { for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i); };
    ws(0, 'RIFF'); dv.setUint32(4, 36 + dataSize, true); ws(8, 'WAVE');
    ws(12, 'fmt '); dv.setUint32(16, 16, true);
    dv.setUint16(20, 1, true);                       // PCM
    dv.setUint16(22, channels, true);
    dv.setUint32(24, sampleRate, true);
    dv.setUint32(28, sampleRate * channels * 2, true);
    dv.setUint16(32, channels * 2, true);
    dv.setUint16(34, 16, true);
    ws(36, 'data'); dv.setUint32(40, dataSize, true);
    for (let i = 0; i < samples.length; i++) dv.setInt16(44 + i * 2, samples[i], true);
    return out;
  }

  function parseWav(bytes) {
    const issues = [];
    if (bytes.length < 44) return { ok: false, issues: ['too short'] };
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const tag = (o) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
    if (tag(0) !== 'RIFF') { issues.push('bad RIFF tag: ' + tag(0)); }
    if (tag(8) !== 'WAVE') { issues.push('bad WAVE tag: ' + tag(8)); }
    let fmt = null, data = null, dataStart = 0;
    let pos = 12;
    while (pos + 8 <= bytes.length) {
      const id = tag(pos);
      const sz = dv.getUint32(pos + 4, true);
      if (id === 'fmt ') {
        fmt = {
          audioFormat: dv.getUint16(pos + 8, true),
          channels: dv.getUint16(pos + 10, true),
          sampleRate: dv.getUint32(pos + 12, true),
          byteRate: dv.getUint32(pos + 16, true),
          blockAlign: dv.getUint16(pos + 20, true),
          bitsPerSample: dv.getUint16(pos + 22, true),
        };
        if (fmt.audioFormat !== 1) issues.push('non-PCM format ' + fmt.audioFormat);
        if (fmt.bitsPerSample !== 16) issues.push('bitsPerSample ' + fmt.bitsPerSample);
      } else if (id === 'data') {
        dataStart = pos + 8;
        data = { size: sz };
      }
      pos += 8 + sz + (sz & 1);
    }
    if (!fmt) issues.push('no fmt chunk');
    if (!data) issues.push('no data chunk');
    const dataLen = data ? Math.min(data.size, bytes.length - dataStart) : 0;
    const samples = new Int16Array(Math.floor(dataLen / 2));
    if (fmt) for (let i = 0; i < samples.length; i++) samples[i] = dv.getInt16(dataStart + i * 2, true);
    return {
      ok: issues.length === 0 && !!fmt && !!data,
      issues,
      sampleRate: fmt ? fmt.sampleRate : 0,
      channels: fmt ? fmt.channels : 0,
      bitsPerSample: fmt ? fmt.bitsPerSample : 0,
      dataBytes: dataLen,
      sampleCount: samples.length,
      data,
      samples,
    };
  }

  function chunkPcm(samples, perChunk) {
    const out = [];
    for (let i = 0; i < samples.length; i += perChunk) out.push(samples.subarray(i, i + perChunk));
    return out;
  }

  function makeChunkWav(chunk, sampleRate) { return encodeWav(chunk, sampleRate, 1); }

  /** Correct reconstruction: validate + strip each header, concat raw PCM,
   *  emit ONE header. Refuses inconsistent chunk parameters. */
  function reconstructWav(chunkWavs) {
    const issues = [];
    const parsed = chunkWavs.map(parseWav);
    for (let i = 0; i < parsed.length; i++) {
      if (!parsed[i].ok) issues.push('chunk ' + i + ' invalid: ' + parsed[i].issues.join(','));
    }
    if (issues.length) return { ok: false, issues, wav: null, data: null, sampleCount: 0, sampleRate: 0 };
    const rate = parsed[0].sampleRate, ch = parsed[0].channels;
    parsed.forEach((p, i) => {
      if (p.sampleRate !== rate) issues.push('chunk ' + i + ' rate mismatch ' + p.sampleRate);
      if (p.channels !== ch) issues.push('chunk ' + i + ' channel mismatch ' + p.channels);
    });
    if (issues.length) return { ok: false, issues, wav: null, data: null, sampleCount: 0, sampleRate: 0 };
    const total = parsed.reduce((a, p) => a + p.sampleCount, 0);
    const data = new Int16Array(total);
    let o = 0;
    for (const p of parsed) { data.set(p.samples, o); o += p.sampleCount; }
    return { ok: true, issues: [], wav: encodeWav(data, rate, ch), data, sampleCount: total, sampleRate: rate, channels: ch };
  }

  function verifyAgainstReference(reconstructed, referenceSamples, sampleRate) {
    const r = reconstructed.data;
    let exact = r && r.length === referenceSamples.length;
    let firstDiff = -1;
    if (exact) for (let i = 0; i < r.length; i++) { if (r[i] !== referenceSamples[i]) { exact = false; firstDiff = i; break; } }
    return {
      exact,
      firstDiff,
      refSamples: referenceSamples.length,
      recSamples: r ? r.length : 0,
      refDuration: referenceSamples.length / sampleRate,
      recDuration: (r ? r.length : 0) / sampleRate,
      channelsOk: reconstructed.channels === 1,
      rateOk: reconstructed.sampleRate === sampleRate,
    };
  }

  return { encodeWav, parseWav, chunkPcm, makeChunkWav, reconstructWav, verifyAgainstReference };
});
