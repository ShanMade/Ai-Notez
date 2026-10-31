// Durable recording — EBML-aware WebM recovery.
//
// Corrects the Phase 0.3 "search for 0x1F43B675" proposal. Recovery NEVER
// scans for element signatures: it walks the EBML element tree strictly by
// (element ID, size-varint) pairs, exactly as a decoder's demuxer does:
//   - an element boundary is only ever read where the parent's element walk
//     places the cursor — payload bytes of an element are skipped as a whole
//     (id + size + size bytes), so a 0x1F43B675 sequence inside an opus
//     payload is structurally unreachable and can never be mistaken for a
//     Cluster boundary;
//   - an element is COMPLETE iff header(id+sizevint) + size bytes fit in the
//     available stream; anything past that is truncation, not a boundary;
//   - the recovered output is ALWAYS a byte prefix of the input (the "last
//     decodable prefix" property), cut only at element boundaries.
//
// Modes:
//   strict  — cut before the first incomplete element (top-level: before an
//             incomplete final Cluster). Always safe.
//   salvage — strict, plus: if the final Cluster is truncated, keep it with
//             its size rewritten to "unknown" (0x01FFFFFFFFFFFFFF) and cut
//             after its last complete child element (SimpleBlock/Blockgroup).
//             An unknown-size Cluster terminates at EOF by spec, so the
//             result is structurally valid. Only applied when the cluster's
//             children parse cleanly; otherwise falls back to strict.
//
// The logic below is the P0.3a prototype (lib/ebml.js, 114/114 test cases)
// ported into the app unchanged apart from the public name.

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.NzRecRecovery = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const EBML_HEADER = 0x1a45dfa3;
  const SEGMENT = 0x18538067;
  const INFO = 0x1549a966;
  const TRACKS = 0x1654ae6b;
  const CLUSTER = 0x1f43b675;
  const CUES = 0x1c53bb6b;
  // Canonical unknown-size VarInt (EBML spec special case): first byte 0x01
  // followed by 0xFF bytes (8-byte form 0x01FFFFFFFFFFFFFF as used by real
  // Matroska files for Segment/Cluster unknown lengths).
  const UNKNOWN_SIZE_8B = [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];

  function hex(n) { return '0x' + n.toString(16).toUpperCase(); }

  /** Classify the first byte of an EBML varint → byte length, or 0 if invalid. */
  function vintLen(b0) {
    if (b0 & 0x80) return 1;
    if (b0 & 0x40) return 2;
    if (b0 & 0x20) return 3;
    if (b0 & 0x10) return 4;
    return 0; // 0000xxxx reserved → not a varint
  }

  /** Read a size-varint. Returns {complete, length?, value|null, unknown?}.
   *  Handles the EBML special case: first byte 0x01 followed by 0xFF bytes
   *  (2..8 bytes total) = unknown/undefined size (the canonical
   *  0x01FFFFFFFFFFFFFF form used for Segment/Cluster in real WebM files). */
  function readSize(buf, pos) {
    if (pos >= buf.length) return { complete: false };
    if (buf[pos] === 0x01) {
      // Consume the 0xFF run (canonical form is 8 bytes total: 0x01 + 7x0xFF).
      let L = 1;
      while (L < 8 && pos + L < buf.length && buf[pos + L] === 0xff) L++;
      if (L < 2) return { complete: false, invalid: true }; // lone 0x01 is not a size
      if (L < 8 && pos + L >= buf.length) return { complete: false }; // run truncated at EOF
      if (L === 8 && pos + L < buf.length && buf[pos + 8] === 0xff) return { complete: false, invalid: true };
      return { length: L, value: null, unknown: true, complete: true };
    }
    const L = vintLen(buf[pos]);
    if (!L) return { complete: false, invalid: true };
    if (pos + L > buf.length) return { complete: false };
    let value = buf[pos] & ((1 << (8 - L)) - 1);
    for (let i = 1; i < L; i++) value = value * 256 + buf[pos + i];
    const unknown = value === (1 << (7 * L)) - 1;
    return { length: L, value: unknown ? null : value, unknown, complete: true };
  }

  /** Read an element ID (marker bits kept). Returns {complete, length?, id?}. */
  function readId(buf, pos) {
    if (pos >= buf.length) return { complete: false };
    const L = vintLen(buf[pos]);
    if (!L) return { complete: false, invalid: true };
    if (pos + L > buf.length) return { complete: false };
    let id = buf[pos];
    for (let i = 1; i < L; i++) id = id * 256 + buf[pos + i];
    return { length: L, id, complete: true };
  }

  /**
   * Parse one element head at `pos` without recursing into children.
   * Complete means: id + size varint readable. `fits` means the content also
   * lies within the buffer (for known sizes).
   */
  function parseElementHead(buf, pos) {
    const idR = readId(buf, pos);
    if (!idR.complete) return { complete: false, reason: 'truncated-id', at: pos };
    if (idR.invalid) return { complete: false, reason: 'invalid-id', at: pos };
    const sizeR = readSize(buf, pos + idR.length);
    if (!sizeR.complete) return { complete: false, reason: 'truncated-size', at: pos, id: idR.id };
    if (sizeR.invalid) return { complete: false, reason: 'invalid-size', at: pos, id: idR.id };
    const contentStart = pos + idR.length + sizeR.length;
    const contentEnd = sizeR.unknown ? Infinity : contentStart + sizeR.value;
    return {
      complete: true,
      id: idR.id,
      idLen: idR.length,
      sizeVintLen: sizeR.length,
      headerStart: pos,
      headerEnd: contentStart,
      size: sizeR.unknown ? Infinity : sizeR.value,
      unknownSize: !!sizeR.unknown,
      contentStart,
      contentEnd,
      fits: sizeR.unknown ? true : contentEnd <= buf.length,
    };
  }

  /** Walk children of the element content [start,end). Heads only, in order.
   *  A trailing incomplete child is reported as {complete:false, truncatedAt}. */
  function walkChildren(buf, start, end) {
    const out = [];
    let pos = start;
    while (pos < end) {
      const head = parseElementHead(buf, pos);
      if (!head.complete || !head.fits) {
        out.push({ complete: false, truncatedAt: pos, reason: head.reason || 'extends-past-eof', id: head.id });
        break;
      }
      out.push(head);
      if (head.unknownSize) { pos = end; }
      else pos = head.contentEnd;
    }
    return out;
  }

  /** Salvage a truncated final cluster: rewrite its size varint to unknown
   *  (0x01FFFFFFFFFFFFFF) and cut after the last complete child element. */
  function salvageCluster(buf, clusterStart) {
    const head = parseElementHead(buf, clusterStart);
    if (!head.complete || head.id !== CLUSTER) return null;
    const kids = walkChildren(buf, head.contentStart, buf.length);
    let lastCompleteEnd = head.contentStart, keptKids = 0;
    for (const k of kids) {
      if (!k.complete) break;
      lastCompleteEnd = k.contentEnd;
      keptKids++;
    }
    if (!keptKids) return null;
    const newHeaderLen = 4 /*id*/ + 8 /*unknown-size vint (0x01FFFFFFFFFFFFFF)*/;
    const out = new Uint8Array(lastCompleteEnd);
    out.set(buf.subarray(0, clusterStart), 0);
    out.set(new Uint8Array([0x1f, 0x43, 0xb6, 0x75, ...UNKNOWN_SIZE_8B]), clusterStart);
    out.set(buf.subarray(head.contentStart, lastCompleteEnd), clusterStart + newHeaderLen);
    return {
      cut: lastCompleteEnd,
      keptKids,
      lostBytes: buf.length - lastCompleteEnd,
      bytes: out,
      clusterStart,
    };
  }

  /**
   * Full recovery. Returns report + `bytes` (always a byte prefix of input).
   * `ok` means the result is structurally complete (EBML header, Segment,
   * Info, Tracks and at least one complete Cluster) — a validity claim the
   * caller can make without a decoder.
   */
  function recover(buf, opts) {
    const mode = (opts && opts.mode) || 'strict';
    const issues = [];
    const fail = (reason, extra) => Object.assign(
      { ok: false, reason, mode, cut: 0, bytes: new Uint8Array(0), totalBytes: buf.length, issues: [reason], clusters: 0, infoSeen: false, tracksSeen: false },
      extra || {});

    const top = parseElementHead(buf, 0);
    if (!top.complete) return fail('no-ebml-header: ' + top.reason);
    if (top.id !== EBML_HEADER) return fail('not-ebml: first element ' + hex(top.id));
    if (!top.fits) return fail('ebml-header-incomplete');

    const seg = parseElementHead(buf, top.contentEnd);
    if (!seg.complete) return fail('no-segment: ' + seg.reason);
    if (seg.id !== SEGMENT) return fail('segment-wrong-id: ' + hex(seg.id));
    if (!seg.fits && !seg.unknownSize) return fail('segment-size-exceeds-file');

    const segEnd = seg.unknownSize ? buf.length : seg.contentEnd;
    let cut = buf.length;
    let infoSeen = false, tracksSeen = false, clusters = 0, salvaged = null;
    let stopReason = 'clean-eof';
    let lastClusterHead = null;

    for (const el of walkChildren(buf, seg.contentStart, segEnd)) {
      if (!el.complete) {
        const at = el.truncatedAt;
        if (el.id === CLUSTER) {
          if (mode === 'salvage') {
            const s = salvageCluster(buf, at);
            if (s) { salvaged = s; cut = s.cut; stopReason = 'salvaged-partial-cluster'; }
            else { cut = at; stopReason = 'truncated-final-cluster'; }
          } else { cut = at; stopReason = 'truncated-final-cluster'; }
        } else if (el.id === INFO || el.id === TRACKS) {
          issues.push(el.id === INFO ? 'Info' : 'Tracks' + ' element truncated — codec/track info incomplete, file unrecoverable');
          cut = 0;
          stopReason = el.id === INFO ? 'truncated-info' : 'truncated-tracks';
        } else {
          // Cues/Tags or unknown tail elements truncated at EOF: safe to drop.
          cut = at;
          stopReason = 'dropped-tail-element(' + (el.id ? hex(el.id) : '?') + ')';
        }
        break;
      }
      if (el.id === INFO) infoSeen = true;
      else if (el.id === TRACKS) tracksSeen = true;
      else if (el.id === CLUSTER) { clusters++; lastClusterHead = el; }
    }

    // Post-pass: a final UNKNOWN-size Cluster is only provably truncated when
    // its children do not complete exactly at EOF (a well-formed unknown-size
    // cluster ends with complete children). A known-size truncated cluster was
    // already caught above.
    if (lastClusterHead && lastClusterHead.unknownSize) {
      const kids = walkChildren(buf, lastClusterHead.contentStart, buf.length);
      const lastKid = kids[kids.length - 1];
      // !lastKid: file ends with the cluster header and ZERO children —
      // indistinguishable from "died before the first child"; cutting before
      // it is lossless (an empty cluster carries no audio).
      if (!lastKid || !lastKid.complete) {
        if (mode === 'salvage') {
          const s = salvageCluster(buf, lastClusterHead.headerStart);
          if (s) { salvaged = s; cut = s.cut; stopReason = 'salvaged-partial-cluster'; }
          else { cut = lastClusterHead.headerStart; clusters--; stopReason = 'truncated-final-cluster(unknown-size)'; }
        } else { cut = lastClusterHead.headerStart; clusters--; stopReason = 'truncated-final-cluster(unknown-size)'; }
      }
    }

    const bytes = buf.slice(0, cut);
    if (cut > 0 && !infoSeen) issues.push('Info missing before cut');
    if (cut > 0 && !tracksSeen) issues.push('Tracks missing before cut');
    return {
      ok: cut > 0 && infoSeen && tracksSeen,
      mode, stopReason, bytes, cut,
      totalBytes: buf.length,
      droppedBytes: buf.length - cut,
      clusters, infoSeen, tracksSeen, salvaged, issues,
    };
  }

  /** Structural validity check (no decoder): every top-level element complete,
   *  required elements present. */
  function structuralCheck(bytes) {
    const issues = [];
    const top = parseElementHead(bytes, 0);
    if (!top.complete || top.id !== EBML_HEADER || !top.fits) return { ok: false, issues: ['missing/incomplete EBML header'], clusters: 0 };
    const seg = parseElementHead(bytes, top.contentEnd);
    if (!seg.complete || seg.id !== SEGMENT) return { ok: false, issues: ['missing Segment'], clusters: 0 };
    const segEnd = seg.unknownSize ? bytes.length : Math.min(seg.contentEnd, bytes.length);
    if (seg.contentEnd > bytes.length && !seg.unknownSize) return { ok: false, issues: ['Segment size exceeds file'], clusters: 0 };
    let info = false, tracks = false, clusters = 0;
    for (const el of walkChildren(bytes, seg.contentStart, segEnd)) {
      if (!el.complete) { issues.push('incomplete top-level element at ' + el.truncatedAt + (el.id ? ' (' + hex(el.id) + ')' : '')); break; }
      if (el.id === INFO) info = true;
      else if (el.id === TRACKS) tracks = true;
      else if (el.id === CLUSTER) clusters++;
    }
    if (!info) issues.push('Info missing');
    if (!tracks) issues.push('Tracks missing');
    if (!clusters) issues.push('no clusters');
    return { ok: issues.length === 0, issues, clusters };
  }

  return {
    IDs: { EBML_HEADER, SEGMENT, INFO, TRACKS, CLUSTER, CUES },
    vintLen, readSize, readId, parseElementHead, walkChildren,
    recover, salvageCluster, structuralCheck, hex,
  };
});
