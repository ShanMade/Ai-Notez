# AI-Notez

AI-Notez is a browser-based note-taking Progressive Web App (PWA) with Firebase-backed sign-in and sync, voice-note workflows, AI assistance, and a separate Python API for generation and semantic retrieval. The assistant answers with **retrieval-augmented generation (RAG)**: questions are embedded, matched against a per-user vector index, and answered only from notes that clear a confidence threshold.

**Live app:** https://ai-notez.web.app/  
**Repository:** https://github.com/ShanMade/Ai-Notez

## Features

- Create and organize notes in a focused web workspace.
- Sign in through Firebase Authentication and sync user data with Firebase Realtime Database.
- Use AI generation through configured Gemini and Groq providers; Mistral support can be enabled in backend configuration.
- Record a lecture and watch it become notes: one-minute parts by default, each transcribed as it is recorded, with the tail of the previous part carried into the next one so a sentence cut by the boundary survives, and repeated words removed instead of duplicated. The part length is a setting (20/30/45/60 s); longer parts spend far fewer requests for the same audio.
- Teach a voice once — record a name's owner for eight seconds — and every later transcript labels that person by name instead of "Voice 2".
- Semantic search over your notes through a per-user vector index (USearch HNSW, cosine similarity), fused with keyword matching so exact terms and identifiers still hit.
- RAG answers: the assistant quotes only notes above a confidence threshold, cites them as openable sources, and says so instead of inventing an answer when nothing matches.
- Read notes in an editorial reader: no card, one 46rem column, a display-serif title, section numbers in the margin, a hairline header with reading progress, and the assistant behind a bottom command bar (⌘J / Ctrl+J) that opens the docked chat beside the note — never a popup over the page. Body type switches between serif and sans, with a saved reading size.
- Read answers comfortably: the assistant panel is resizable (drag its left edge, arrow keys, or double-click to reset) and has its own text-size control, both remembered per device. LaTeX (`\( … \)`, `\[ … \]`, `$$ … $$`) is rendered with KaTeX in answers and notes.
- The NotezAi chat and Voice-to-Note panels share one surface, built phone-first: a single header row (close/back, wordmark, new chat, history, voice, text size, settings), a four-card opener that knows whether a note is in scope, a quiet answer column where sources fold into one collapsible card, a composer that grows to five lines and turns Send into Stop while an answer streams, and a recording console with a live clock, level meter, speaker-chipped transcript, and Continue / New session / Discard.
- On a phone the chat becomes the page: the header keeps only back, new chat and a ⋯ that lifts an actions sheet up from the bottom edge with history, voice, answer scope, A−/A+, settings and back-to-note. Nothing is dropped — every control is one tap away, targets are 36–38px, and the composer is 16px so iOS never zooms the viewport. On a desktop the assistant is still a column, still draggable from 340px to the full dock width, and still remembers its width and reading size per device.
- Install the app as a PWA; the service worker caches the app shell for improved repeat-load/offline behavior.
- Use a standalone FastAPI backend for AI requests, indexing, and search.

> Feature availability depends on app configuration, provider credentials, browser permissions, network access, and the deployed backend. Offline app-shell caching does not mean every AI or cloud feature works offline.

## Architecture

```mermaid
flowchart TD
    subgraph CLIENT["Client — browser / installed PWA"]
        UI["UI modules<br/>index.html · styles/app.css · app/*.js"]
        SW["Service worker<br/>app-shell cache"]
    end

    subgraph FIREBASE["Firebase"]
        AUTH["Authentication<br/>email · Google · anonymous guest"]
        DB[("Realtime Database<br/>notes, folders, tags, review state")]
    end

    subgraph BACKEND["FastAPI backend — backend/app"]
        EDGE["Auth + limits<br/>ID token verification<br/>30 chat/min · 60 embed/min"]
        GEN["Generation<br/>provider failover chain"]
        RAG["Automatic RAG<br/>automatic_rag.py"]
    end

    subgraph RETRIEVAL["Retrieval pipeline — per user"]
        Q["1 Understand<br/>inventory · follow-up resolution"]
        EMB["2 Embed query<br/>768 or 1024 dims"]
        VDB[("3 USearch HNSW<br/>cosine · one index per user")]
        GATE["4 Verify + gate<br/>content hash · min 0.32 cosine"]
        CTX["5 Ground the prompt<br/>max 4 excerpts + attributes"]
    end

    subgraph PROVIDERS["AI providers"]
        GEM["Gemini"]
        GROQ["Groq"]
        MIS["Mistral — optional"]
    end

    UI -->|HTTPS + ID token| EDGE
    UI <-->|read / write| DB
    UI -->|sign-in| AUTH
    AUTH -->|verify token| EDGE
    SW -.->|offline reload| UI
    EDGE --> RAG
    EDGE --> GEN
    RAG --> Q --> EMB --> VDB --> GATE --> CTX
    RAG -.->|no index or embedding down| DB
    CTX -->|grounded prompt| GEN
    GEN -->|default| GEM
    GEN -.->|rate limited or rejected| GROQ
    GEN -.->|opt-in| MIS
    GEN -->|answer + sources| UI

    classDef client fill:#eef2ff,stroke:#6366f1,stroke-width:1.5px,color:#1e1b4b
    classDef firebase fill:#fff7ed,stroke:#f59e0b,stroke-width:1.5px,color:#7c2d12
    classDef backend fill:#ecfdf5,stroke:#10b981,stroke-width:1.5px,color:#064e3b
    classDef retrieval fill:#eff6ff,stroke:#3b82f6,stroke-width:1.5px,color:#1e3a8a
    classDef provider fill:#faf5ff,stroke:#a855f7,stroke-width:1.5px,color:#4c1d95

    class UI,SW client
    class AUTH,DB firebase
    class EDGE,GEN,RAG backend
    class Q,EMB,VDB,GATE,CTX retrieval
    class GEM,GROQ,MIS provider
```

Solid arrows are the request path; dashed arrows are fallbacks and background paths. The numbered nodes are
the retrieval pipeline described in [How a question is answered](#how-a-question-is-answered).

<details>
<summary>Diagram as text (screen readers, or if the diagram does not load)</summary>

```text
Client — browser / installed PWA
├── UI modules            index.html · styles/app.css · app/*.js
├── Service worker        app-shell cache
│
├──► Firebase Authentication   email · Google · anonymous guest
├──► Firebase Realtime Database  notes, folders, tags, review state
└──► FastAPI backend  (backend/app)
     ├── Auth + limits       ID token verification · 30 chat/min · 60 embed/min
     ├── Generation          provider failover chain
     └── Automatic RAG       automatic_rag.py
          ├── 1 Understand   inventory · follow-up resolution
          ├── 2 Embed query  768 or 1024 dims
          ├── 3 USearch HNSW cosine · one index per user
          ├── 4 Verify + gate content hash · min 0.32 cosine
          └── 5 Ground prompt max 4 excerpts + attributes

AI providers: Gemini (default) → Groq (rate limited or rejected) → Mistral (opt-in)
```

</details>

### Main components

- **Frontend:** `index.html`, `styles/app.css`, `styles/reader-v2.css` (the reader's editorial layer), the ordered JavaScript modules in `app/`, and `vendor/katex/` (KaTeX for math rendering).
- **Identity and synced data:** Firebase Authentication and Firebase Realtime Database.
- **Backend API:** FastAPI/Uvicorn under `backend/app/`. It verifies Firebase ID tokens for protected routes, exposes AI generation and retrieval endpoints, and applies request limits.
- **AI providers:** Provider adapters and model selection live in `backend/app/providers.py`; credentials are configured through environment variables.
- **Retrieval (RAG):** `backend/app/automatic_rag.py` turns a question into a grounded prompt, `backend/app/indexing.py` handles indexing and the queue, and `backend/app/vector_store.py` owns chunking, the USearch HNSW index and hybrid ranking. Backend metadata and index files are stored under `NOTEZ_DATA_DIR`. The browser calls the hybrid search endpoint from `app/09-knowledge-index.js`.
- **Hosting/deployment:** Firebase Hosting serves the static frontend. The Python API must be deployed separately to a Python-capable host and configured with the correct API base URL and CORS origins.

## Repository layout

```text
.
├── index.html
├── styles/
│   └── app.css
├── app/                     # Frontend JavaScript modules
├── backend/
│   ├── app/
│   │   ├── main.py          # FastAPI routes and request handling
│   │   ├── auth.py          # Firebase token verification
│   │   ├── config.py        # Environment-based settings
│   │   ├── firebase.py      # Firebase data access
│   │   ├── providers.py     # AI and embedding provider adapters
│   │   ├── indexing.py      # Indexing and retrieval orchestration
│   │   └── vector_store.py  # Vector index operations
│   ├── RAG_AUDIT.md         # Retrieval audit notes and tuning guidance
│   ├── tests/
│   ├── pyproject.toml
│   └── requirements.txt
├── .github/workflows/deploy.yml
├── firebase.json
├── database.rules.json
├── manifest.webmanifest
├── sw.js
└── README.md
```

## Run the frontend locally

The frontend is static, so it does not require a JavaScript build step.

1. Clone the repository.
2. Serve the repository root using a local HTTP server (rather than opening `index.html` as a `file://` URL).
3. Open the local URL in your browser.
4. Configure Firebase and the backend endpoint using the same mechanism as the deployed app. Authentication, sync, and AI features will not work until their services are configured.

For example, if Python is installed, run this from the repository root:

```bash
python -m http.server 8000
```

Then visit `http://localhost:8000`. This only serves the static files; it does **not** start the API.

## Run the backend locally

The backend targets **Python 3.12**.

```bash
cd backend
python -m venv .venv
```

Activate the virtual environment:

- **Windows PowerShell:** `.venv\\Scripts\\Activate.ps1`
- **macOS/Linux:** `source .venv/bin/activate`

Install dependencies and create your environment file:

```bash
python -m pip install -r requirements.txt
copy .env.example .env
```

The `copy` command is for Windows. On macOS/Linux, use `cp .env.example .env`. If you place `.env.example` at the repository root instead, adjust the copy path accordingly; keep real credentials out of Git.

Run the API from the `backend` directory:

```bash
uvicorn app.main:app --reload
```

The health endpoint is available at `http://127.0.0.1:8000/healthz`. Interactive API documentation is normally available at `http://127.0.0.1:8000/docs`.

### Environment variables

See [`backend/.env.example`](backend/.env.example) for a template. Common settings include:

| Variable | Purpose |
|---|---|
| `FIREBASE_PROJECT_ID` | Firebase project ID |
| `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_DATABASE_URL`, `FIREBASE_STORAGE_BUCKET`, `FIREBASE_MESSAGING_SENDER_ID`, `FIREBASE_APP_ID` | Firebase web configuration served by the backend |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Service-account JSON used by server-side Firebase verification/access; keep it secret |
| `AI_DEFAULT_PROVIDER` | Default provider: `gemini`, `groq`, or `mistral` |
| `AI_GEMINI_API_KEY`, `AI_GROQ_API_KEY`, `AI_MISTRAL_API_KEY` | Provider credentials |
| `AI_MISTRAL_ENABLED` | Enable Mistral support when set to `true` |
| `AI_EMBEDDING_API_KEY`, `AI_EMBEDDING_PROVIDER`, `AI_EMBEDDING_MODEL`, `AI_EMBEDDING_DIMENSIONS` | Embedding provider and vector configuration |
| `NOTEZ_CORS_ORIGINS` | Comma-separated allowed browser origins |
| `NOTEZ_DATA_DIR` | Directory for local backend index/metadata data |
| `AI_GEMINI_TRANSCRIBE_MODEL` | Model used for Voice-to-Note audio; defaults to `gemini-3.5-transcribe`, the dedicated speech-to-text model with speaker diarization |
| `AI_GEMINI_TRANSCRIBE_FALLBACKS` | Ordered models tried when the transcription model is missing or out of quota; defaults to `gemini-3.5-flash-lite,gemini-3.1-flash-lite` |
| `AI_GROQ_TRANSCRIBE_MODEL` | Whisper model for Voice-to-Note fallback transcription; defaults to `whisper-large-v3` (the full model, not turbo) |
| `AI_REQUEST_TIMEOUT_SECONDS`, `AI_MAX_PROMPT_CHARS`, `AI_MAX_CHUNKS_PER_USER`, `AI_MAX_INDEXED_NOTES`, `AI_MAX_SEARCH_RESULTS`, `AI_MIN_SIMILARITY`, `AI_RAG_MAX_INDEX_UPDATES`, `AI_RAG_MIN_CONFIDENCE`, `AI_RAG_MAX_EXCERPTS` | Backend timeouts, limits, and retrieval tuning |

Only set provider credentials for services you intend to use. Never commit real `.env` files, service-account JSON, or API keys.

When `AI_EMBEDDING_PROVIDER` is `groq` or `mistral`, `AI_EMBEDDING_DIMENSIONS` must be `1024` (their fixed
output size); the backend refuses to start with a mismatched value instead of failing at retrieval time.

### Voice-to-Note transcription

A recording is cut into parts of **60 seconds by default**, and the length is a setting (20 / 30 / 45 / 60
s, stored as `localStorage['notez-rec-chunk-v1']`). Each part is transcribed as soon as it is recorded, so
the transcript appears while the lecture is still running, and the next part always receives the tail of
what was already heard.

Why 60 s is the ceiling and the default: the binding limit is not tokens, it is **requests**. Gemini counts
audio at 32 tokens a second, so a one-minute part is ~1,900 audio tokens and ~3,000 tokens with the prompt —
one request a minute is about 3,000 tokens per minute, roughly 1.5% of a 200,000 tokens-per-minute
allowance. The request count is what actually runs out: at 20-second parts a 500-request day covers about
2.8 hours of audio, at 60-second parts it covers 8.3 hours. Past 60 s the first sentence takes too long to
appear, a failed part costs a whole minute of retry, and the upload stops being cheap on a phone line. Below
60 s the transcript is fresher but the allowance drains proportionally faster.

The first part is always capped at 20 seconds, whatever the setting, so the first words appear quickly and
the chosen length only applies from the second part. Live notes refresh about once every 90 seconds of audio
at any length (`REC_NOTES_EVERY`), so bigger parts do not double the number of note calls.

The length is frozen when the recording starts and every part is closed on a deadline measured from **its
own** start (`recSchedulePart`), not from a repeating timer, so a slow phone or a background tab cannot
stretch a 60-second part into 70 seconds, and pausing or resuming cannot mix two lengths into one
recording. A tab that is asleep is allowed to delay the timer that closes a part; on the way back
`visibilitychange` closes the overdue part immediately and the next part starts again at the chosen length.
A part that did overrun is reported as such rather than passed off as on time, and the timeline labels each
part with its real length (`recLengthLabel`), not with a timestamp that reads like a duration.

Once a recording stops, the panel offers **Continue recording** (same note; the clock and the part numbers
carry on from where they stopped), **New session** (the finished note stays in the library and a fresh
session begins) and **Discard** (asks first, stops the microphone, waits for parts in flight, then deletes
the note the session created). A quiet discard icon sits in the recording controls too, so a wrong start
does not have to be cleaned up in the library. That tail is what makes a cut-off sentence survive a part boundary: the model is told
how the previous part ended, so it continues the sentence instead of starting cold, and any words it
repeats are removed before the part is stored (`recTrimOverlap`). A part that ends mid-sentence tolerates a
two-word echo; a part that ends at a full stop only trims an echo of three words or more, because there it
is far more likely to be real speech.

Transcription uses **Gemini 3.5 Transcribe** (`gemini-3.5-transcribe`, `AI_GEMINI_TRANSCRIBE_MODEL`), the
dedicated speech-to-text model. It is asked for a **diarized** transcript
(`generationConfig.audioTranscriptionConfig.diarization: true`) and returns speaker turns directly, as
`audioTranscription` parts carrying a `speakerLabel` (`spk_1`) and the spoken words. The client turns those
into `Voice 1: words` lines, merging consecutive turns of the same voice, so the transcript arrives already
labelled by the model instead of relying on a chat model's guess. The audio is the only part in that
request: a text instruction next to it is read as a question *about* the audio rather than something to
transcribe, and a transcription model takes no system instruction or temperature.

The Live variant (`gemini-3.5-transcribe-live`) is **not** used: it streams over a WebSocket and, per
Google's own feature table, cannot diarize, which is the one thing Voice-to-Note needs from it.

Free-tier quotas are counted **per model**, so a model that is out of requests for the day is skipped for
the next one instead of ending the transcript: `gemini-3.5-transcribe` → `gemini-3.5-flash-lite` →
`gemini-3.1-flash-lite` (`AI_GEMINI_TRANSCRIBE_FALLBACKS`). The model that answered is remembered for the
rest of the session, so a spent model costs one request rather than one per part, and the recorder shows the
chain it will use.

The chat models cannot diarize, so their prompt carries the accuracy rules that matter for a transcript:
every sentence in order, no summarising, no paraphrasing, no translating, and `[inaudible]` only for a word
that cannot be heard, with `[00:12] Voice 1: words` as the requested shape. A part that comes back from one
of those models without a recognised label gets one **text-only labelling pass** (`recLabelPart`,
`RECORD_LABEL_PASS`): the audio is never sent again, the pass runs on the chat model, and it is kept only if
it adds labels *and* keeps every spoken word (`recKeepsWords`, 80% floor). A model that summarises instead
of labelling cannot delete speech. When even that fails, the panel says so instead of quietly showing a wall
of text. Labels are parsed generously: `Voice 2`, `Speaker 2`, `Speaker B` (A=1), `spk_2`, `**Voice 1:**`,
`[00:12] Voice 1:`, a colon or a dash, and a learned name written with a trailing full stop or different
case all count as a speaker turn.

Audio parts sent to `POST /v1/ai/generate` are transcribed by Gemini, and fall over to Groq's Whisper
endpoint (`AI_GROQ_TRANSCRIBE_MODEL`, default `whisper-large-v3`) when Gemini is rate limited or rejects its
credential — the resulting transcript is then formatted by a Groq chat model so speaker labels and structure
stay the same. A provider that is cooling down after a rate limit is tried last rather than skipped, so a
single 429 never becomes "all providers failed". The browser keeps each failed part's audio and offers a
retry instead of discarding it.

The default is the full `whisper-large-v3`, not `whisper-large-v3-turbo`: turbo keeps 4 of the model's 32
decoder layers and is known to drop words and whole sentences on long, noisy classroom audio, while both
builds sit under the same free-tier allowance (2,000 requests and 28,800 audio-seconds a day). Two guards
stop a fallback from quietly losing speech:

- If a 30-second part comes back empty, the other Whisper build is asked before the part is reported as
  having no speech.
- If the speaker-labelling pass returns fewer than 80% of the spoken words (an LLM step can summarise
  instead of relabelling), the raw transcript is kept and the labels are dropped.

### Learned voices

`app/07-voice-identity.js` turns speaker labels from a guess into a name. Teaching a voice records (or
accepts) a short clip, asks Gemini to describe it in one line, and stores the pair:

```js
{ id, name: 'Sir Ahmed', about: 'adult male, low pitch, measured pace, Urdu-accented English' }
```

The clip goes to a private IndexedDB store (`notez-voice-samples-v1`) and the profile to
`localStorage['notez-voices-v1']`; both stay on this device and are never synced with notes. From then on:

- every transcription prompt lists the known voices by name with their description, so turns are labelled
  `Sir Ahmed:` instead of `Voice 2:`;
- the first part and every thirtieth part (about once a minute) also carry the reference clips themselves,
  which is what makes matching reliable rather than descriptive;
- the live transcript renders a learned name as a speaker chip with the same colouring as a voice number,
  and the prompt forbids inventing a name that is not on the list.

Naming a speaker is enough to teach the voice. When someone fills in **Name speakers** after a recording,
each named voice is saved in the background — the audio of the part where that voice first spoke is kept
during the recording for exactly this, so the identity is stored with a real reference clip. Nothing is
asked, nothing is announced, and the name is written before the description is requested, so a closed tab
never loses it. A voice already on the list keeps its stored clip instead of being overwritten, and a name
given with no audio still becomes a text-only identity that later transcriptions respect.

Open it from **Voices** in the recorder panel, or from **Voice settings** in the settings hub (both open the
same library). Up to eight clips are attached to one request, and each clip is capped at 700 KB.

The older `notez-voice-profiles-v1` entries are folded into the library once, on first load: their names and
descriptions carry over (that screen never stored audio, so those entries start text-only).

### Retrieval settings

The `AI_RAG_*` variables tune the pipeline described in
[Semantic search and RAG](#semantic-search-and-rag). `AI_RAG_MIN_CONFIDENCE` (default `0.32`) is the cosine
score a note must reach before its text is quoted, `AI_RAG_MAX_EXCERPTS` (default `4`) caps how many notes
are quoted per answer, and `AI_RAG_MAX_INDEX_UPDATES` (default `24`) caps how many changed notes are
re-embedded per chat request. `AI_MIN_SIMILARITY` (default `0.18`) is the floor applied to individual
chunk hits before ranking, in both RAG and the search endpoints.

## Semantic search and RAG

AI-Notez answers from your notes with **retrieval-augmented generation (RAG)**: the backend embeds the
question, searches a per-user vector index, verifies every hit against Firebase, and only then hands the
model the passages it is allowed to quote.

### How a question is answered

1. **Understand the query.** `POST /v1/ai/generate` reads the last user turn. Library-inventory questions
   are answered from the authoritative note list instead of similarity search, and short follow-ups such as
   “largest?” are resolved against the previous turn before anything is embedded.
2. **Embed.** The question is embedded with the configured embedding model (`gemini-embedding-001` by
   default, 768 dimensions; Groq and Mistral use a fixed 1024).
3. **Search.** USearch HNSW returns the nearest chunks by cosine similarity; semantic hits below
   `AI_MIN_SIMILARITY` (default `0.18`) are discarded. Hybrid search then blends the remaining hits
   with bounded keyword relevance: `score = similarity + 0.35 × keyword relevance`, where keyword relevance
   is the share of the query's meaningful terms a chunk contains, plus a small bonus for quoted phrases and
   identifiers such as `chapter-3` or `fig2`.
4. **Verify.** Each hit is checked against the live Firebase note. A hit whose content hash no longer matches
   is dropped, so a deleted or edited note can never be quoted from a stale index — Firebase stays the source
   of truth and the index is only a cache.
5. **Gate on confidence.** A note is quoted only when it reaches `AI_RAG_MIN_CONFIDENCE` (default `0.32`)
   **and** stays within `0.15` of the best hit. Weaker results produce an explicit "no confident match"
   instruction, so the model asks a clarifying question instead of inventing an answer or a note count.
6. **Ground the model.** Up to `AI_RAG_MAX_EXCERPTS` (default `4`) excerpts are passed in, each with computed
   attributes — title, folder, subject, word and character count, last update and the cosine score — plus a
   rule block that forbids reporting retrieval counts. Comparative questions (“largest”, “shortest”, “most
   recent”) are answered from those attributes rather than from loose similarity.
7. **Cite.** Notes that were used come back as `sources`, which the chat renders as openable chips instead of
   a wall of links.

### The vector database

The vector database is [USearch](https://github.com/unum-cloud/usearch) — one HNSW graph per user, searched
by cosine similarity — with chunk text, content hashes and the indexing queue kept in SQLite beside it.

| Detail | Implementation |
|---|---|
| Index type | USearch HNSW, `metric="cos"`, `f32`, dimensions pinned to the active embedding profile |
| Scope | One index per user, keyed by a hash of the Firebase uid — retrieval never crosses accounts |
| Scoped search | Note- and folder-scoped queries score every chunk of that scope directly in SQLite, so a question about the open note cannot miss it |
| Chunking | 1,600 characters per chunk with 200 characters of overlap, split on word boundaries |
| Metadata | SQLite (`notez-vectors.sqlite3`): chunk text, content hash, embedding model, chunk counts and the indexing queue |
| Storage | `NOTEZ_DATA_DIR` — `indexes/<owner>.usearch` plus the SQLite file; persist this directory to survive restarts |
| Freshness | At most `AI_RAG_MAX_INDEX_UPDATES` (default `24`) changed notes are re-embedded per chat request; unchanged notes are skipped by content hash |
| Limits | Up to `AI_MAX_INDEXED_NOTES` (5,000) notes and `AI_MAX_CHUNKS_PER_USER` (20,000) chunks per user; a note above the chunk cap is rejected with `413` |

Changing `AI_EMBEDDING_PROVIDER`, `AI_EMBEDDING_MODEL` or `AI_EMBEDDING_DIMENSIONS` invalidates the stored
vectors, so the affected user's chunks are dropped and re-embedded by the next note save, rebuild or
backfill instead of serving vectors the new model can never match.

### Index and search endpoints

| Endpoint | Purpose |
|---|---|
| `POST /v1/index/notes/{note_id}` | Embed and upsert one note; if the embedding provider is rate limited the note stays saved and a later rebuild or backfill indexes it |
| `DELETE /v1/index/notes/{note_id}` | Remove a note from the index |
| `POST /v1/index/rebuild` | Rebuild the caller's index from their current notes |
| `POST /v1/index/backfill` | Queue a background backfill of notes that are not indexed yet |
| `GET /v1/index/status` | Queue, backfill and index status for the caller |
| `GET /v1/index/stats` | Note and chunk counts, revision and the indexed note list |
| `POST /v1/index/search` | Semantic search, hybrid by default |
| `POST /v1/index/search/hybrid` | Semantic plus keyword search with `scope` set to `all`, `folder` or `note` |

All of these require a Firebase ID token. Generation is limited to 30 requests per user per minute and
embedding work to 60 operations per user per minute, counted in process — see
[Security and operational notes](#security-and-operational-notes) for multi-instance caveats.

### When embeddings are unavailable

If no embedding key is configured, the embedding provider is rate limited, or the index is still empty,
retrieval falls back to keyword matching over the live Firebase notes. When nothing matches, the model is
told that no confident match exists and must ask one clarifying question rather than invent notes, titles or
counts. [`backend/RAG_AUDIT.md`](backend/RAG_AUDIT.md) records the audit behind these rules and how to tune
them.

## Tests

Backend tests are located in `backend/tests/`. From the `backend` directory, install dependencies and run:

```bash
python -m pytest
```

If pytest is not included in the runtime dependencies, install it in your development environment first. Browser-only behavior such as microphone permissions, recording, service-worker caching, and Firebase sign-in should also be tested in a real supported browser.

## Deployment

### Frontend (Firebase Hosting)

The GitHub Actions workflow is at `.github/workflows/deploy.yml`. Review that workflow before use and configure the repository secrets it expects. The current workflow references `FIREBASE_SERVICE_ACCOUNT_AI_NOTEZ`. Ensure the Firebase project and hosting target match the intended deployment.

You can also deploy manually with the Firebase CLI after installing it and authenticating:

```bash
firebase deploy --only hosting
```

Run the command from the repository root and verify the selected Firebase project before deploying.

### Backend

Firebase Hosting serves the static site; it does not run the FastAPI application. Deploy `backend/` to a Python-capable service, set the required environment variables, persist `NOTEZ_DATA_DIR` if you need the local index/metadata to survive restarts, and set `NOTEZ_CORS_ORIGINS` to the exact frontend origins. Configure the frontend to call the deployed API endpoint.

## Security and operational notes

- Firebase client configuration is not a substitute for database security rules. Review `database.rules.json` and enforce per-user access in Firebase.
- Keep service-account JSON and AI provider keys on the server. Do not commit secrets or expose service-account credentials to the frontend.
- The API uses Firebase authentication for protected operations and includes in-process request limits. For multi-instance production deployments, consider shared rate limiting and durable/shared indexing infrastructure.
- A client-side PIN or UI lock, if enabled in the app, should not be described as encryption unless the note data is actually encrypted at rest with a properly managed key.
- Test microphone access, browser compatibility, Firebase rules, CORS, provider quotas, and persistence before a production release.

## License

See [LICENSE](LICENSE).
