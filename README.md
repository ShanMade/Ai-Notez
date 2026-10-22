# Notez

Notez is a study-focused note-taking app built as a browser-based product that helps students and learners organize notes, review material, and use AI-assisted workflows without breaking focus. The current implementation is a Firebase-backed web app with a local-first note experience and cloud sync.

## Problem it aims to solve

Students and knowledge workers often have notes spread across apps, files, folders, and browser tabs. Notez tries to provide a calmer, more focused workspace for:

- storing lecture notes and study material
- organizing content by subject or folder
- revisiting material through review flows
- asking for summaries or study guidance when needed
- handling transcripts, PDFs, and reference material in one place

## Verified features

The current codebase supports these features as implemented:

- note creation, editing, and organization
- folder-based note management
- note search and browsing
- study review / review reminders
- note prioritization and favoriting
- AI-assisted study flows and note actions via the app UI
- library-style attachment handling
- PDF reading and support for document attachments
- transcription and recording workflow hooks
- Firebase Authentication and Realtime Database sync
- offline-friendly app shell via service worker

## Technology stack

- frontend: vanilla JavaScript, HTML, CSS
- hosting: Firebase Hosting
- authentication: Firebase Authentication
- database: Firebase Realtime Database
- app shell: service worker for offline behavior
- note and content handling: client-side app logic with local persistence and cloud sync

## Architecture overview

The app is structured as a static front-end with modular JavaScript files:

- `index.html` contains the app shell and layout
- `app/01-config-and-core.js` initializes core app state and Firebase config
- `app/02-storage-and-notes.js` handles note storage, rendering, and folder logic
- `app/03-library-and-folders.js` manages file/library flows and PDF viewing
- `app/04-reader-and-html.js` covers reading, export, and interaction behaviors
- `app/05-sync-and-auth.js` covers authentication and AI features in the app
- `app/06-ai-and-recording.js` includes AI-related flows, study scheduling, and recording/voice features
- `sw.js` provides offline caching support
- `firebase.json` and `database.rules.json` define hosting and database rules

The browser app remains client-heavy. An optional Python FastAPI backend provides AI provider routing and per-user semantic search; its local SQLite metadata store and USearch HNSW indexes contain derived note chunks and embeddings, while Firebase Realtime Database remains the source of truth.

## Live app

https://ai-notez.web.app/

## Local development

There is no package manager or build step in the current workspace. The app is served as a static site.

1. Open a terminal in this project directory.
2. Start a local server:

```bash
python -m http.server 8000
```

3. Open the app in a browser:

```text
http://localhost:8000
```

If you want to deploy through Firebase Hosting, the project already includes `firebase.json` and `database.rules.json`.

## Firebase configuration

The project uses a public Firebase web config in `app/01-config-and-core.js`:

```js
const firebaseConfig = {
  apiKey: "...",
  authDomain: "ai-notez.firebaseapp.com",
  databaseURL: "https://ai-notez-default-rtdb.firebaseio.com",
  projectId: "ai-notez",
  storageBucket: "ai-notez.firebasestorage.app",
  messagingSenderId: "...",
  appId: "..."
};
```

This setup is standard for client-side Firebase web apps, but keep in mind:

- do not commit private admin credentials or service-account files
- do not place backend secrets in frontend code
- keep Firebase rules restrictive and test them with real users before production use
- rotate any credentials if the project is moved to a different Firebase account

For a fresh project setup:

1. create a Firebase project in the Firebase console
2. enable Authentication and Realtime Database
3. update the config values in `app/01-config-and-core.js` to match your project
4. deploy with Firebase Hosting if you want to publish the app

Example:

```bash
firebase login
firebase deploy
```

## AI provider configuration and security

The hosted app uses the FastAPI backend at `https://ai-notez.fastapicloud.dev` for AI requests first; users do not need to enter provider API keys in the app. Configure `AI_GEMINI_API_KEY` or `AI_GROQ_API_KEY` as a secret in FastAPI Cloud's backend environment variables, and set `NOTEZ_CORS_ORIGINS` to the exact hosted frontend origin (for example, `https://ai-notez.web.app`). The browser sends authenticated requests to the backend, which uses its server-side provider credentials. Do not put provider secrets in the frontend or repository.

Direct Gemini/Groq BYOK remains available in local setups where the backend URL is blank.

## Optional local AI backend and semantic search

The backend is a separate FastAPI service in `backend/`. It keeps the current app's Firebase Authentication and Realtime Database model:

- Realtime Database at `users/{uid}/notes/{noteId}` remains authoritative; no existing records are migrated, overwritten, or duplicated.
- AI chat history and existing BYOK keys remain in their current browser-local storage.
- The backend verifies Firebase ID tokens and reads only the authenticated user's note paths.
- SQLite stores local index metadata and chunk embeddings; USearch maintains a persistent HNSW vector index per authenticated user. These are derived local files under `backend/data/`, not a replacement for Firebase or a shared database.
- Note saves enqueue index updates; NotezAi settings offers a rebuild for existing notes. Search is scoped to the verified Firebase UID and rechecks current Realtime Database content before returning a result.
- The hosted `notez-ai-api-base-url` meta value points to `https://ai-notez.fastapicloud.dev`. With the backend URL set, authenticated AI requests use backend-managed credentials; the app does not send or prompt for a user's provider key. In local setups where that meta value is blank, direct BYOK requests continue.

### Local development on Windows

Use Python 3.12 on Windows. USearch publishes a prebuilt Windows wheel, so installing this backend does not require compiling `hnswlib` or installing Visual Studio C++ Build Tools. Firebase Admin needs credentials for token verification and Realtime Database reads; store any service-account JSON outside this repository and never commit it.

```powershell
Set-Location C:\Users\Shan\Desktop\Notez\backend
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
$venv = Join-Path $HOME '.venvs\notez-backend'
if (-not (Test-Path "$venv\Scripts\python.exe")) { py -3.12 -m venv $venv }
$python = "$venv\Scripts\python.exe"
& $python -m pip install --upgrade pip
& $python -m pip install -r requirements.txt
$env:GOOGLE_APPLICATION_CREDENTIALS = 'C:\path\outside\the\repo\firebase-admin.json'
```

Using the environment's `python.exe` directly avoids PowerShell activation-policy issues. Configure `FIREBASE_DATABASE_URL`, `FIREBASE_PROJECT_ID`, exact frontend origins in `NOTEZ_CORS_ORIGINS`, and any app-managed AI or embedding keys in `.env`. Keep `.env` private. The default `NOTEZ_DATA_DIR=./data` stores the SQLite database and HNSW index files locally; add enough free disk space and back up this directory if you need to retain the derived index.

```powershell
Set-Location C:\Users\Shan\Desktop\Notez\backend
& "$HOME\.venvs\notez-backend\Scripts\python.exe" -m uvicorn app.main:app --host 127.0.0.1 --port 8787 --reload
```

In a second PowerShell window, serve the frontend from the repository root:

```powershell
Set-Location C:\Users\Shan\Desktop\Notez
py -m http.server 8000
```

For local testing, set the `notez-ai-api-base-url` meta value in `index.html` to `http://127.0.0.1:8787`, then open `http://localhost:8000`. Add `localhost` to Firebase Authentication's authorized domains if needed, and include `http://localhost:8000` in `NOTEZ_CORS_ORIGINS`. The backend binds only to loopback and is not publicly exposed. `GET http://127.0.0.1:8787/healthz` should report `{"status":"ok","vectorStore":"usearch-hnsw"}`.

Run the backend tests directly through the virtual-environment interpreter:

```powershell
& "$HOME\.venvs\notez-backend\Scripts\python.exe" -m pytest -q tests
```

Use one Uvicorn worker per data directory. The index is local to a backend instance; do not share one SQLite/HNSW directory between multiple backend processes. Rebuilds read notes from Realtime Database and may incur embedding-provider usage. The embedding model and `AI_EMBEDDING_DIMENSIONS` setting must agree. `AI_GEMINI_API_KEY`, `AI_GROQ_API_KEY`, and `AI_EMBEDDING_API_KEY` are backend-only variables. Do not place app-managed keys in `index.html`. CORS origins are comma-separated exact origins.

## Known limitations

- the AI backend is optional and must be started separately; this setup does not deploy a backend service
- the local HNSW index requires writable, persistent disk on the backend host; if the directory is lost, rebuild the derived index from Realtime Database
- there is no browser/frontend regression suite; the backend has focused automated tests
- chats remain browser-local and are not migrated to a server-side chat store
- semantic indexing requires a Gemini embedding credential; streaming and server-side Groq audio transcription are not provided by the API
- Firebase config values are embedded in the client and should be reviewed before broader public use

## Current development roadmap

Potential next steps include backend streaming, global quotas, managed speech transcription, and durable server-side chat history. These are not included in the current implementation.

## Testing and smoke checks

The backend test suite runs with `py -m pytest -q tests` from `backend\`. A practical browser smoke check is:

1. load the app locally
2. create a test note
3. search for it
4. open it and edit it
5. confirm folders and filters behave correctly
6. verify the Firebase auth flow works for your configured project
7. confirm the service worker does not break loading

## Notes on repository status

No license file is present in this workspace, so no license is documented here. If the project is published publicly, choose and add a license before release if that suits the intended distribution model.

## Screenshots and previews

No dedicated product screenshots or design assets are included in the current workspace beyond the app icon and platform metadata. This README therefore avoids referencing non-existent media.
