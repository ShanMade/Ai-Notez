# Voice-to-Note and NotezAi chat: design

Status: phase 1 done in this PR (branch `arena/ae06c496-ai-notez`). Owner: Shan.

What phase 1 wires into the recorder: the model constant, the mode setting line in the transcription prompt, the silence check, and the echo guard (`recDropEcho` now calls `NzVoice.dropEcho`). Not yet wired: `reconcile` and `dropLoops`. The recorder still uses its own label code for those, and replacing it changes live output, so it moves to phase 2 with the recorder UX.

## 1. What exists today (audit)

Voice-to-Note lives in `app/06-ai-and-recording.js` (about 1,950 lines, one closure). Problems found while reviewing it:

- **Architecture.** Recording, transcription, speaker labelling, persistence, the offline journal, and the UI render all share one closure and one mutable `REC` object. Helpers are nested in functions, so they cannot be unit tested. Session isolation needed a generation counter to stop old parts writing into a new session.
- **Model routing.** Audio parts and text passes are routed by string names and fallback lists in three places (client, `app/04` `aiCall`, `backend/app/main.py`). This needed a `voice_only` flag to keep voice notes off other providers and models.
- **Speaker identity.** Labels are rewritten with regexes in several places (`recSpeakerOf`, `recNormalizeLabels`, `recCleanPart`, `recScrubSpk`). Numbering is taken from the model per part and reconciled afterwards. Identity across parts depends on the model being told who was already heard.
- **Modes.** Only `class`, `meeting`, `custom`, `summary`, `quiz`, and `clean` exist. There is no mode for casual talk, calls, or chats, and the transcription prompt only knows "classroom lecture" or "meeting".
- **Reliability.** Silent parts (muted mic) and echoed or looping lines were handled by guards added at different times, now in separate places.
- **UX.** The recorder panel mixes setup, live transcript, notes, and history, with long Urdu and English help text. Failed parts, held parts, and the recovery path are spread across several notices.

## 2. Target architecture

Layers, from the bottom:

1. **Core (pure, tested in Node).** `app/14-voice-core.js`, exported as `window.NzVoice`:
   - `DEFAULT_MODEL` = `gemini-3.5-flash-lite`. Voice-to-Note uses this model only.
   - `MODES`: casual, class, meeting, call, chat, custom. Each has a transcription setting and a notes instruction.
   - `isSilent(channels)`: decides whether a part has no speech, from decoded samples.
   - `reconcile(parts)`: canonical speaker numbering across the whole recording (by first appearance), echo removal at part boundaries, loop removal, empty-line removal. Returns turns with time stamps.
   - `buildTranscriptPrompt(options)`: one prompt builder, with mode, known voices, instructions, and language.
2. **Session (browser).** One object per recording, with explicit states: `idle → recording → paused → finalizing → done`, and a per-part state machine: `pending → sending → done | held`. A session has a generation id. Nothing from an old generation writes into the current one.
3. **Transport.** One function `transcribePart(part, options)`. Routing: user's own Gemini key first, then the NotezAi service. Both use `gemini-3.5-flash-lite` with `voice_only`. No other provider and no other model.
4. **Persistence.** The offline journal (IndexedDB) stores every part before it is sent. Held parts retry every 30 seconds for as long as they are held.
5. **UI.** Setup (name, mode, instructions), live transcript with speaker colours, notes, and a short status line. Errors are shown once, next to the part that failed.

## 3. Speaker identification (enhanced)

Goals: the same person keeps one label through a recording and across recordings, and users can name them once.

- Canonical labels: `Voice n` numbered by first appearance in the whole recording. Model labels such as `spk_0`, `Speaker B`, or `Person 2` are mapped to these. Real names are kept as written.
- Known voices: saved voice samples from earlier recordings are sent as references, as today. The known-voice list in the prompt is kept in sync with the recording.
- Turn merging: consecutive turns by the same speaker are joined within a part, so the transcript reads as a conversation.
- Naming: naming a voice updates every turn of that voice in the note and the transcript note. It is saved for the next recording.
- Limits: diarization is still done by the model. There is no acoustic embedding on the device yet, so identity across long gaps is best-effort. The user can always correct it.

## 4. Modes

| Mode | For | Transcript setting | Notes |
|---|---|---|---|
| casual | everyday talk, voice memos | one or several people talking, informal | short summary, key points |
| class | lectures, study sessions | a classroom: one teacher, students | in-depth study notes |
| meeting | meetings | several adults, may overlap | minutes, decisions, actions |
| call | phone or video calls | two or more remote speakers, one side may be a single voice | summary, agreed points, follow-ups |
| chat | group or one-to-one chats read aloud | informal conversation | highlights, who said what |
| custom | anything else | the user's own instructions | as instructed |

The mode only changes wording (the setting line and the notes instruction). It never changes the words that are transcribed. The transcript language rules stay as they are.

## 5. Phases and acceptance

**Phase 1 (this PR):** design doc, core module with tests (`scripts/voice-core.test.mjs`), `DEFAULT_MODEL` and mode settings used by the recorder, silence check and echo guard through the core. The recorder UI still offers only Classroom and Meeting; casual, call, chat and custom are reachable through the core until phase 2 adds the picker.

Acceptance: core tests pass; the recorder still works with the same behaviour for class and meeting; a muted part is not sent; casual and call modes produce a setting line in the prompt.

**Phase 2:** recorder UX. Compact setup, a mode picker with the six modes, the speaker list with rename in place, one status line for held parts. Acceptance: browser check of setup, live, and finished states in light and dark, with the accent colour.

**Phase 3:** session state machine in the browser (`idle → … → done`, per-part states), replacing the scattered flags in `REC`. Acceptance: unit tests for the transitions; no page errors.

**Phase 4:** main NotezAi chat rebuild, after the voice work is merged. It covers the chat architecture (routing for normal questions, library answers, and voice-note follow-ups), the source and provenance display, and the chat UX. Its plan is written when phase 3 is merged. Chat must keep its current model routing until then.

## 6. Out of scope for now

- On-device diarization or speaker embeddings.
- Changing the backend's audio size or duration limits.
- Changing chat models or providers.
