// Tests for the Voice-to-Note core (app/14-voice-core.js).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const V = require('../app/14-voice-core.js');

test('the default model is Gemini 3.5 Flash-Lite', () => {
  assert.equal(V.DEFAULT_MODEL, 'gemini-3.5-flash-lite');
});

test('every mode has a setting and a notes instruction, and casual is the fallback', () => {
  for (const [id, mode] of Object.entries(V.MODES)) {
    assert.ok(mode.setting.length > 20, `${id} setting`);
    assert.ok(mode.notes.length > 20, `${id} notes`);
  }
  for (const id of ['casual', 'class', 'meeting', 'call', 'chat', 'custom']) assert.ok(V.MODES[id], id);
  assert.equal(V.modeOf('nope'), V.MODES.casual);
});

test('parseLine reads stamps, labels and bullets', () => {
  assert.deepEqual(V.parseLine('[00:12] Voice 1: hello'), { stamp: '00:12', speaker: 'Voice 1', text: 'hello' });
  assert.deepEqual(V.parseLine('- **spk_0**: hi'), { stamp: '', speaker: 'spk_0', text: 'hi' });
  assert.deepEqual(V.parseLine('plain words'), { stamp: '', speaker: '', text: 'plain words' });
  assert.deepEqual(V.parseLine('\u200Fspk0: rtl line').speaker, 'spk0');
});

test('labelNumber maps every label style to its number', () => {
  assert.equal(V.labelNumber('Voice 3'), 3);
  assert.equal(V.labelNumber('spk_1'), 1);
  assert.equal(V.labelNumber('Speaker B'), 2);
  assert.equal(V.labelNumber('Person 2'), 2);
  assert.equal(V.labelNumber('Ayesha'), null);
  assert.equal(V.labelNumber('spk_0'), 0);
});

test('speaker map numbers voices by first appearance, across labels', () => {
  const map = V.makeSpeakerMap();
  assert.equal(map.canonical('spk_0'), 'Voice 1');
  assert.equal(map.canonical('Speaker B'), 'Voice 2');
  assert.equal(map.canonical('spk_0'), 'Voice 1');
  assert.equal(map.canonical('Ayesha'), 'Ayesha');
  assert.equal(map.count(), 2);
});

test('isSilent: silence and near-silence are silent, speech is not', () => {
  const silence = [new Float32Array(16000)];
  const hum = [new Float32Array(16000).fill(0.0005)];
  const speech = [Float32Array.from({ length: 16000 }, (_, i) => 0.3 * Math.sin(i / 5))];
  assert.equal(V.isSilent(silence), true);
  assert.equal(V.isSilent(hum), true);
  assert.equal(V.isSilent(speech), false);
  assert.equal(V.isSilent([]), false, 'no data is not silent, so it is sent');
});

test('dropEcho removes the echoed opening of a part, but keeps real repeats later', () => {
  const previous = '[00:20] Voice 1: Assalamu Alaikum';
  assert.equal(V.dropEcho(previous, '[00:05] Voice 1: Assalamu Alaikum\n[00:10] Voice 1: how are you'), '[00:10] Voice 1: how are you');
  assert.equal(V.dropEcho('Voice 1: Assalamu Alaikum.', 'Voice 1: assalamu alaikum!'), '');
  const later = 'Voice 1: one\nVoice 1: two\nVoice 1: three\nVoice 1: Assalamu Alaikum';
  assert.equal(V.dropEcho('Voice 1: Assalamu Alaikum', later), later);
});

test('dropLoops keeps at most two copies of a line in a row', () => {
  const looped = ['A: thank you', 'A: thank you', 'A: thank you', 'A: thank you', 'B: ok'];
  assert.deepEqual(V.dropLoops(looped), ['A: thank you', 'A: thank you', 'B: ok']);
  assert.equal(V.dropLoops(['Voice 1: yes', 'Voice 1: yes', 'Voice 2: no']).length, 3);
});

test('reconcile: one numbering across parts; echoes and loops are removed', () => {
  const parts = [
    '[00:01] spk_0: hello there\n[00:05] Speaker B: hi',
    // The model numbers the same first person as Voice 1 in part 2, and says something new.
    '[00:08] Voice 1: hello there\n[00:12] Voice 2: how is the class',
  ];
  const { turns, voices } = V.reconcile(parts);
  assert.equal(voices, 2);
  const text = V.renderTurns(turns);
  assert.match(text, /\[00:01\] Voice 1: hello there/);
  assert.match(text, /\[00:05\] Voice 2: hi/);
  assert.match(text, /\[00:12\] Voice 2: how is the class/);
  assert.equal(text.split('hello there').length - 1, 1, 'the echoed opening is not repeated');
});

test('reconcile: a silent part adds nothing, and a named speaker keeps its name', () => {
  const { turns } = V.reconcile(['[00:01] Ayesha: good morning', '', '[00:40] Ayesha: next topic']);
  assert.deepEqual(turns.map(t => t.speaker), ['Ayesha', 'Ayesha']);
  assert.equal(turns.length, 2);
});

test('reconcile: consecutive lines of one speaker in one part are joined', () => {
  const { turns } = V.reconcile(['Voice 1: first half\nVoice 1: second half']);
  assert.equal(turns.length, 1);
  assert.equal(turns[0].text, 'first half second half');
});

test('the prompt names the mode, the known voices and the user instructions', () => {
  const prompt = V.buildTranscriptPrompt({ mode: 'call', partNumber: 3, knownVoices: 'Voice 1, Ayesha', context: 'see you then', instructions: 'Name the bank rep Ali' });
  assert.match(prompt, /part 3 of a recording/);
  assert.match(prompt, /phone or video call/);
  assert.match(prompt, /\(already used: Voice 1, Ayesha\)/);
  assert.match(prompt, /ended with: "see you then"/);
  assert.match(prompt, /Name the bank rep Ali/);
  assert.match(prompt, /no speech.*output nothing/);
});

test('the prompt for a class and for a meeting keep their setting wording', () => {
  assert.match(V.buildTranscriptPrompt({ mode: 'class' }), /classroom lecture/);
  assert.match(V.buildTranscriptPrompt({ mode: 'meeting' }), /Several adults may speak/);
});

test('class and meeting keep the exact setting wording the recorder used before', () => {
  assert.equal(V.modeOf('class').setting, 'Setting: a classroom lecture. Usually one teacher and some students.');
  assert.equal(V.modeOf('meeting').setting, 'Setting: a meeting. Several adults may speak, sometimes over each other.');
  assert.match(V.buildTranscriptPrompt({ mode: 'casual' }), /Setting: everyday conversation/);
  assert.match(V.buildTranscriptPrompt({ mode: 'call' }), /Setting: a phone or video call/);
});
