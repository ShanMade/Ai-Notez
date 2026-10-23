# Retrieval (RAG) audit — findings and fixes

Audited the full retrieval pipeline: the chat entry point, automatic prompt augmentation, the vector
store, the indexing service, the embedding adapters, and the browser caller.
All backend tests: **79 passed** (`cd backend && python -m pytest -q`).

## How retrieval is supposed to work

```
browser  --POST /v1/ai/generate-->  augment_prompt()  --load-->  Firebase Realtime DB (source of truth)
                                          |                            |
                                          |-- upsert changed notes --> vector index (usearch HNSW + SQLite)
                                          |-- embed query --> cosine + keyword search
                                          |-- verify content hash against Firebase
                                          '-- append verified excerpts (+ [n] sources) to the prompt
```

The index is a cache; Firebase is authoritative.

## Critical defects (retrieval was broken or silently degraded)

| # | Symptom | Root cause | Fix |
|---|---|---|---|
| 1 | `POST /v1/index/search/hybrid` returned **500 on every call** | `RetrievalLogger.log()` inserted **19 values into a 17-column table**, and the handler's `except` block called an undefined `logger` (`NameError`) | Corrected the placeholder count, added the module logger, fixed `get_logs()` to return `user_id` |
| 2 | `POST /v1/index/backfill` always raised `TypeError` | `BackfillOrchestrator._get_lock` was `async def` but used as `async with self._get_lock(...)` | Made the lock accessor synchronous; rewrote the backfill loop (idempotent counters, `force` actually re-embeds) |
| 3 | Queue stats reported **negative** pending/indexed counts | `_update_stats()` incremented/decremented stored counters, so any missed/duplicated transition drifted forever | Stats are now derived from the `indexing_queue` table (newest job per note); counters are no longer mutated |
| 4 | Embedding silently broke after a provider/model change | Index dimensions came from `settings.embedding_dimensions`, while `embed_texts()` could switch provider at call time (`gemini` → groq/mistral = 1024 dims). Every vector was then rejected, and old SQLite blobs could not be re-added | Added a single resolved `EmbeddingProfile` (`config.EMBEDDING`) used by the index, the validators, and the provider calls. Mismatched provider/dimension config now fails fast at startup; a stale index is reset and rebuilt automatically |
| 5 | "Chat with this note" answered from unrelated notes | The hybrid endpoint accepted `scope`, `note_id`, `folder_path` but **ignored them**; global HNSW oversampling could miss the open note | Scoped searches now score only the requested note/folder chunks; scope is honored end-to-end |
| 6 | Deleted/edited notes could be cited as sources | Only `/v1/index/search` verified hashes against Firebase; the hybrid endpoint returned raw index text | Shared `_verified_results()` verifies every hit in parallel and drops stale/deleted notes on both endpoints |

## Retrieval-quality defects

| # | Symptom | Root cause | Fix |
|---|---|---|---|
| 7 | Generic keyword noise outranked strong semantic matches | `extract_keywords()` returned an **unbounded** score (≈1 point per matching word, `\b[a-zA-Z]{2,}\b` matched almost everything) and was compared against cosine similarity (≤1). Returned `similarity` could exceed 1 | Bounded `keyword_relevance()` (query-term coverage + identifier/quote boosts, stop-words removed, 0–1). Hybrid results are fused as `similarity + 0.35 × keywordScore`, with keyword-only hits gated at 50% coverage and a separate `score` field |
| 8 | Metadata-only notes (title/tags, empty body) appeared as note "content" | `note_text()` includes metadata, so a note with no body still produced a chunk | `has_indexable_content()` / `note_body()`; empty notes are never embedded, and clearing a note's body removes it from the index |
| 9 | First question in a fresh library retrieved almost nothing; later questions were slow | Every request re-ran `upsert` for **every** note (one SQLite query per note, embeddings when stale), with no bound | One bulk state read; only changed notes are embedded; notes are prioritised by local relevance and capped at `AI_RAG_MAX_INDEX_UPDATES` (default 24) per request |
| 10 | A single failing note, rate limit, or missing embedding key disabled retrieval entirely ("retrieval is temporarily unavailable") | The whole augmentation ran in one `try` and any exception aborted everything | Per-note error isolation; embeddings-down now degrades to keyword retrieval over the live notes instead of giving up |
| 11 | Retrieval quality below what Gemini can provide | Documents and queries were embedded with no `taskType`, so both landed in the document space | Documents use `RETRIEVAL_DOCUMENT`, queries use `RETRIEVAL_QUERY`; query embeddings no longer consume two rate-limit slots |
| 12 | Blocking SQLite work on the event loop | The hybrid keyword pass scanned up to `max_chunks_per_user` rows inside an `async def` | Keyword scans and searches run in worker threads |

## Browser side (`app/04-reader-and-html.js`)

* The `wantsLibrary` guard skipped client-side retrieval for questions phrased "from my notes" / "across all
  notes" — exactly the questions that need note context in BYOK mode. Guard removed.
* The `/v1/index/search` fallback did not request guest access, so managed-AI guests saw a spurious
  "Sign in to use the Notez AI backend" warning and lost retrieval. Now `allowGuest=true`.

`app/09-knowledge-index.js` is **not loaded by `index.html`** and cannot run against the current app shell
(script-scope `currentSession`, missing `window.notezAiApiBaseUrl`, non-existent Firebase `accessToken`,
and `/v1/index/notes` posted without the note id). It is documented as legacy in place. The supported
retrieval path is the backend `/v1/index/*` API plus automatic retrieval in `/v1/ai/generate`.

## Answer quality: attributes, confidence gating, and follow-ups

A screenshot of the deployed app showed the failure clearly: asking `largest?` in the reader returned
*"You have **three** notes in your lab (the Pakistan culture note, the quantum-physics note, and the
mathematics note)"* with three sources titled "Ch5 Culture of Pakistan", "Notes" and "Notes".

Cause: a one-word fragment was embedded as-is, three weakly related chunks cleared the global
`AI_MIN_SIMILARITY=0.18`, and the prompt rule "answer ONLY from the numbered notes" forced the model to
answer from them — so it described the retrieved set instead of answering the question.

Fixes in `backend/app/automatic_rag.py`:

| Problem | Fix |
|---|---|
| Fragments ("largest?", "and the second one?") were embedded with no subject | `_is_vague` + `_contextual_query`: short follow-ups are resolved against the previous user turn before embedding, and are flagged to the model as follow-ups |
| Weak matches were quoted anyway | Confidence gate: a note must reach `AI_RAG_MIN_CONFIDENCE` (default 0.32) and stay within 0.15 of the best hit. Below that no excerpt is injected; the model is told not to invent notes or counts and to ask one clarifying question |
| The model could not reason about notes beyond a few chunks | Every excerpt now carries computed attributes — word count, character count, folder, subject, last update, cosine `match` — and the stored metadata prefix is stripped so note text is not duplicated |
| Comparative questions ("largest", "shortest", "most recent", "oldest") cannot be answered by similarity | `_attribute_report` ranks the live Firebase notes deterministically by content size or timestamp and hands the model exact figures plus the interpretation used |
| The model described the retrieved set ("you have three notes…") | `RETRIEVAL_RULES` forbid reporting retrieval counts or saying "in your library/lab" unless a count was asked, require stating the interpretation for fragments, and ask for a structured answer rather than pasted excerpts |
| The UI showed three identical "Notes" chips | Sources now include `snippet` (matched excerpt, or the computed attributes for attribute answers), surfaced in the chip tooltip |

### Follow-up turns in the app

A second screenshot showed the opposite failure: after NotezAi answered *"Nothing is due for review right
now. Enjoy the break."*, the user typed `ok` and got *"I'm not sure what you have due today — could you let
me know what assignments, tasks, or deadlines you're referring to?"*.

Two defects in the app's chat plumbing, plus two related gaps:

| Problem | Fix |
|---|---|
| `nzaiTranscript` sent `chat.messages.slice(-7, -1)` from a snapshot taken **before** the current message was appended, so it always dropped the newest exchange — the model never saw its own last answer | Keep the last 8 messages, including the previous assistant reply |
| The transcript used `User:` / `NotezAi:` labels, which the backend's turn parser does not recognise, so `_prior_user_turns` was always empty and no short follow-up could be resolved in the real app | Send `USER:` / `ASSISTANT:` labels so follow-ups such as `largest?` resolve |
| A bare `ok` / `thanks` went through retrieval, hit the low-confidence template and came back as a clarifying question | Answered locally with a one-line acknowledgement (`nzaiAnswerAck`), and the backend skips retrieval for acknowledgements (`_is_acknowledgement` + `ACKNOWLEDGEMENT_RULES`) |
| Typed "what is due today?" was left to the model, which cannot see the on-device review queue | Answered deterministically from the same data as the Home card and the `Due` quick action (`nzaiAnswerDue`) |

Tuning: raise `AI_RAG_MIN_CONFIDENCE` for stricter, more conservative answers; lower it to retrieve more
loosely related notes. `AI_RAG_MAX_EXCERPTS` caps how many notes are quoted per turn.

## Operator notes

* **Rebuild recommended once** after deploying: existing vectors were embedded without task types.
  `POST /v1/index/rebuild` (or `POST /v1/index/backfill {"force": true}`) refreshes them.
* `AI_EMBEDDING_PROVIDER=groq|mistral` requires `AI_EMBEDDING_DIMENSIONS=1024`; any other value now stops
  startup with an explicit error instead of failing at retrieval time.
* `AI_RAG_MAX_INDEX_UPDATES` bounds embedding work per chat turn. Raise it if a large library must become
  fully searchable in fewer turns (cost: slower first answers).
* `backend/data/` (SQLite queues, retrieval logs, vector indexes) is runtime state and is now git-ignored.

## Regression tests

`backend/tests/test_rag_regressions.py` pins each fix: bounded keyword scoring and fusion, keyword-only
survival, metadata-only exclusion, note/folder scoping, retrieval-logger inserts, non-negative queue stats,
backfill execution and idempotency, the backfill endpoint, embedding-profile fallback and stale-index reset,
RAG budget/un-changed-note skipping/embedding-down fallback, and hybrid scope + stale-result rejection.
