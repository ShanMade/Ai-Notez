// Voice-to-Note core: pure functions, no DOM, no network. Tested in Node
// (scripts/voice-core.test.mjs). The recorder in app/06 calls these; see
// docs/voice-and-chat-design.md for the architecture.
(function (root) {
  'use strict';

  // Voice-to-Note runs on this model only. No other Gemini model, no other provider.
  const DEFAULT_MODEL = 'gemini-3.5-flash-lite';

  // Each mode changes wording only: the setting line of the transcription prompt and
  // the notes instruction. It never changes which words are transcribed.
  const MODES = {
    casual: {
      label: 'Casual talk',
      hint: 'Everyday talk or a voice memo. A short summary and any follow-ups.',
      setting: 'Setting: everyday conversation or a voice memo. One or several people talking informally, sometimes interrupting each other.',
      notes: 'Write a short summary of this conversation, then the key points, and any plans or follow-ups people agreed to. Use only what is in the transcript.',
    },
    class: {
      label: 'Class',
      hint: 'A lecture or lesson. In-depth notes for someone who missed it.',
      setting: 'Setting: a classroom lecture. Usually one teacher and some students.',
      notes: 'Write in-depth classroom notes from this transcript, for a student who missed the lesson: topics in the order they were taught, every important concept, definition, fact, formula, date, name and example, explained accurately. Use Markdown. Use only what is in the transcript.',
    },
    meeting: {
      label: 'Meeting',
      hint: 'Several people, sometimes at once. Minutes with decisions and actions.',
      setting: 'Setting: a meeting. Several adults may speak, sometimes over each other.',
      notes: 'Write formal meeting minutes from this transcript: date and time if said; attendees (by name or Voice label); agenda items in order; the discussion under each item in short points; decisions made; action items with owner and deadline if stated. Use Markdown. Use only what is in the transcript.',
    },
    call: {
      label: 'Call',
      hint: 'A phone or video call, with a remote side. Summary and agreed follow-ups.',
      setting: 'Setting: a phone or video call. Speakers may be remote and far from the microphone, and one side may be a single voice.',
      notes: 'Write a summary of this call: what it was about, what each side said or asked, what was agreed, and the follow-ups with owners if stated. Use Markdown. Use only what is in the transcript.',
    },
    chat: {
      label: 'Chat',
      hint: 'Friends or colleagues talking. The highlights, and who said what.',
      setting: 'Setting: an informal chat between friends or colleagues, read aloud or recorded in the room. Speakers may use slang and switch languages.',
      notes: 'Write the highlights of this chat: the main topics, who said what on each, and anything decided or promised. Use Markdown. Use only what is in the transcript.',
    },
    custom: {
      label: 'Custom',
      hint: 'Your own format. Describe it in Instructions.',
      setting: 'Setting: a recording of the user\'s choice.',
      notes: 'Write notes from this transcript, following the user\'s instructions. Use Markdown. Use only what is in the transcript.',
    },
  };

  const modeOf = id => MODES[id] || MODES.casual;

  // ---- speaker labels ---------------------------------------------------
  // A label is what a model writes before a turn: "[00:12] Voice 1: words".
  // Models also write spk_0, Speaker B, Person 2, bold labels, or a dash.
  const LABEL_RE = /^\s*(?:[-*•–]\s+)?(?:\[([\d:]{3,12})\]\s*)?\**\s*((?:voice|speaker|person|spk)[\s_:-]*(?:[0-9\u0660-\u0669]{1,2}|[A-Za-z])|[^:\uFF1A\n]{1,40}?)\s*\**\s*(?:[:\uFF1A]\s*|\s+[-–—]\s+)(.*)$/i;
  const BIDI_ANY = /[\u00ad\u180e\u200b-\u200f\u061c\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]+/g;

  const digits = text => String(text || '').replace(/[\u0660-\u0669]/g, d => String(d.charCodeAt(0) - 0x0660));

  // Reads one line into { stamp, speaker, text }. speaker is the raw label, or ''.
  function parseLine(line) {
    const clean = String(line ?? '').replace(BIDI_ANY, '');
    const match = clean.match(LABEL_RE);
    if (!match) return { stamp: '', speaker: '', text: clean.trim() };
    return { stamp: match[1] || '', speaker: match[2].trim(), text: match[3].trim() };
  }

  // The number a raw label stands for (0 is a real number, spk_0), or null when the
  // label is a real name.
  function labelNumber(raw) {
    const text = String(raw || '').replace(/\*+/g, '').trim();
    const spk = /^spk[\s_:-]*([0-9\u0660-\u0669]{1,2})$/i.exec(text);
    if (spk) return Number(digits(spk[1]));
    const numbered = /^(?:voice|speaker|person)[\s_:-]*([0-9\u0660-\u0669]{1,2})$/i.exec(text);
    if (numbered) return Number(digits(numbered[1]));
    const letter = /^(?:speaker|person)\s*([A-Za-z])$/i.exec(text);
    if (letter) return letter[1].toUpperCase().charCodeAt(0) - 64;
    return null;
  }

  // Canonical speaker names for one recording. Numbered labels become "Voice n"
  // in order of first appearance across all parts, so the same person keeps the
  // same name even when a model numbers the voices differently in each part.
  // Real names (Teacher, Ayesha) are kept as written.
  // `zeroBased` is true when the recording's labels start from 0 (spk_0, Voice 0):
  // then every numbered label moves up by one, so spk_0 and Voice 1 are one person.
  function makeSpeakerMap() {
    const numbers = new Map();   // label key -> canonical number
    const names = new Map();     // lower-case real name -> canonical name
    return {
      canonical(raw, zeroBased = false) {
        const text = String(raw || '').replace(/\*+/g, '').trim();
        if (!text) return '';
        const number = labelNumber(text);
        if (number !== null) {
          const key = zeroBased ? number + 1 : number;
          if (!numbers.has(key)) numbers.set(key, numbers.size + 1);
          return `Voice ${numbers.get(key)}`;
        }
        // A letter label such as "Speaker B" is numbered above; anything else is a name.
        const key = text.toLowerCase();
        if (!names.has(key)) names.set(key, text);
        return names.get(key);
      },
      count() { return numbers.size; },
    };
  }

  // ---- silence ----------------------------------------------------------
  // A part with no speech is not sent to the model. A model asked to transcribe
  // silence tends to repeat whatever it heard last. `channels` is an array of
  // Float32Array sample buffers.
  const SILENCE_RMS = 0.002;
  function isSilent(channels) {
    let sum = 0, count = 0;
    for (const data of channels || []) {
      for (let i = 0; i < data.length; i += 4) { sum += data[i] * data[i]; count++; }
    }
    return count > 0 && Math.sqrt(sum / count) < SILENCE_RMS;
  }

  // ---- repetition -------------------------------------------------------
  // The words a line says, without its stamp or label, lower-cased and joined.
  function spokenKey(line) {
    const { text } = parseLine(line);
    return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).join(' ');
  }

  // A part can hand back the end of the part before it, because the model is given
  // that text as context. Lines at the top of the part that repeat the last lines
  // of the previous part are dropped. Only the first lines are checked, so a real
  // repeat later in the part is kept.
  function dropEcho(previous, current) {
    const recent = new Set(String(previous || '').split('\n').slice(-8).map(spokenKey).filter(Boolean));
    const lines = String(current || '').split('\n');
    return lines.filter((line, i) => {
      const key = spokenKey(line);
      return !(i < 3 && key && recent.has(key));
    }).join('\n').trim();
  }

  // A model that falls into a loop writes the same line again and again. Two copies
  // of a line can be real speech; a third copy in a row is not.
  function dropLoops(lines) {
    const out = [];
    let run = 0, previous = null;
    for (const line of lines) {
      const key = spokenKey(line);
      run = key && key === previous ? run + 1 : 0;
      previous = key;
      if (run < 2) out.push(line);
    }
    return out;
  }

  // ---- reconcile ---------------------------------------------------------
  // Joins the raw text of every part, in order, into one transcript of turns.
  // Each turn is { stamp, speaker, text, part }. Lines with no speaker keep an
  // empty speaker. Turns are merged when the same speaker continues in the same part.
  function reconcile(parts) {
    const speakers = makeSpeakerMap();
    const turns = [];
    let previousText = '';
    const zeroBased = (parts || []).some(raw => String(raw || '').split('\n').some(line => {
      const { speaker } = parseLine(line);
      return speaker && labelNumber(speaker.replace(/\*+/g, '').trim()) === 0;
    }));
    (parts || []).forEach((raw, partIndex) => {
      const lines = dropLoops(dropEcho(previousText, String(raw || '')).split('\n'));
      let last = null;
      for (const line of lines) {
        const parsed = parseLine(line);
        if (!parsed.text) continue;   // a label with no words is not a turn
        const speaker = parsed.speaker ? speakers.canonical(parsed.speaker, zeroBased) : (last ? last.speaker : '');
        if (last && last.part === partIndex && speaker && speaker === last.speaker && !parsed.stamp) {
          last.text = `${last.text} ${parsed.text}`.trim();
          continue;
        }
        last = { stamp: parsed.stamp, speaker, text: parsed.text, part: partIndex };
        turns.push(last);
      }
      previousText = lines.join('\n');
    });
    return { turns, voices: speakers.count() };
  }

  // Renders turns back to the note format: "[00:12] Voice 1: words".
  function renderTurns(turns) {
    return turns.map(turn => {
      const stamp = turn.stamp ? `[${turn.stamp}] ` : '';
      return turn.speaker ? `${stamp}${turn.speaker}: ${turn.text}` : `${stamp}${turn.text}`;
    }).join('\n');
  }

  // ---- prompt -----------------------------------------------------------
  // The transcription prompt for one part. Wording is fixed; the mode, the known
  // voices, the context from the previous part and the user's instructions change.
  function buildTranscriptPrompt(options) {
    const o = options || {};
    const mode = modeOf(o.mode);
    const lines = [
      `Transcribe audio part ${Number(o.partNumber || 1)} of a recording, word for word.`,
      mode.setting,
      'Accuracy rules: write every sentence you can hear, in order. Never summarise, never skip a sentence, never paraphrase and never correct the speaker\'s grammar. ' + (o.languageRule || 'Keep the original language and never translate.') + ' Use [inaudible] only for a word you truly cannot hear.',
    ];
    if (o.context) lines.push(`The part before this one ended with: "${o.context}"\nIf this part starts in the middle of a word or a sentence, continue it from there. Do not repeat those closing words.`);
    lines.push('Speaker labels: every line of speech starts with a speaker label, exactly like "[00:12] Voice 1: words". Use the known name below when the voice matches one of them; otherwise use "Voice 1", "Voice 2" and so on. Keep the same label for the same person and continue the numbering already used' + (o.knownVoices ? ` (already used: ${o.knownVoices})` : '') + '. If you cannot tell the voices apart, label every line "Voice 1:" — never write a line of speech without a label.');
    lines.push('If the part has no speech (silence, room noise or a muted microphone), output nothing at all.');
    if (o.instructions) lines.push(`Instructions from the user for this recording. Follow them when labelling voices and choosing names. They never change the words spoken:\n"""${o.instructions}"""`);
    lines.push('Output only the transcript.');
    return lines.join('\n');
  }

  const api = {
    DEFAULT_MODEL, MODES, modeOf, parseLine, labelNumber, makeSpeakerMap, isSilent, SILENCE_RMS,
    spokenKey, dropEcho, dropLoops, reconcile, renderTurns, buildTranscriptPrompt,
  };
  root.NzVoice = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
