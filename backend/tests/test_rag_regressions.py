"""Regression tests for the retrieval (RAG) audit.

Each test pins a defect that was found by auditing the pipeline:

* hybrid ranking compared unbounded keyword scores with cosine similarity
* note-scoped retrieval was silently ignored by the hybrid endpoint
* metadata-only notes were embedded and returned as note content
* the retrieval logger raised on every insert (17 columns / 19 values)
* the backfill orchestrator could never run (un-awaited async lock)
* queue stats drifted into negative counts
* embedding provider fallback could change vector size under a live index
* automatic RAG re-embedded every note on every request and gave up entirely
  when embeddings were unavailable
"""

import asyncio
import hashlib
import math
import re
from contextlib import contextmanager

import pytest
from fastapi.testclient import TestClient

from app.auth import current_user
from app.config import EMBEDDING, settings
from app.indexing import (
    BackfillOrchestrator,
    IndexingQueue,
    RetrievalLogger,
    RetrievalMetadata,
)
from app.vector_store import (
    HnswIndexManager,
    has_indexable_content,
    keyword_relevance,
    note_text,
)
import app.main as main_module
from app.automatic_rag import augment_prompt


def vector_for(text: str) -> list[float]:
    values = [0.0] * EMBEDDING.dimensions
    for word in text.lower().split():
        position = int.from_bytes(hashlib.sha256(word.encode("utf-8")).digest()[:4], "big") % len(values)
        values[position] += 1
    magnitude = math.sqrt(sum(value * value for value in values))
    return [value / magnitude for value in values] if magnitude else values


async def fake_embed(texts: list[str]) -> list[list[float]]:
    return [vector_for(text) for text in texts]


@pytest.fixture
def manager(tmp_path):
    return HnswIndexManager(tmp_path / "vectors")


# =============================================================================
# Keyword scoring and hybrid fusion
# =============================================================================

class TestKeywordScoring:
    def test_stopword_only_overlap_scores_zero(self):
        assert keyword_relevance("the and for with this that", "explain the topic in my notes") == 0.0

    def test_score_is_bounded(self):
        text = "photosynthesis converts light energy into chemical energy"
        score = keyword_relevance(text, "photosynthesis light energy")
        assert 0.0 < score <= 1.0

    def test_score_reports_query_coverage(self):
        score = keyword_relevance("mitochondria only", "mitochondria cellular energy")
        assert score == pytest.approx(1 / 3)

    def test_identifier_matches_are_boosted(self):
        text = "Answer key for mcq4 is option B."
        assert keyword_relevance(text, "u3 mcq4 answers") >= 0.5

    def test_hybrid_results_use_a_comparable_scale(self, manager):
        async def run():
            await manager.upsert(
                "alice", "bio", {"title": "Biology", "body": "photosynthesis light energy"}, fake_embed
            )
            await manager.upsert(
                "alice", "noise", {"title": "Noise", "body": "the and for with this that"}, fake_embed
            )
            results = await manager.search(
                "alice", vector_for("photosynthesis light energy"), 5, "photosynthesis light energy"
            )
            assert results
            assert results[0]["id"] == "bio"
            assert "noise" not in [result["id"] for result in results]
            for result in results:
                assert 0.0 <= result["similarity"] <= 1.0
                assert 0.0 <= result["keywordScore"] <= 1.0
                assert 0.0 <= result["score"] <= 1.0 + 0.35 + 1e-9

        asyncio.run(run())

    def test_keyword_only_hit_survives_weak_semantics(self, manager):
        async def run():
            await manager.upsert(
                "alice", "mcq", {"title": "MCQ", "body": "Answer key for mcq4 is option B."}, fake_embed
            )
            results = await manager.search("alice", vector_for("zebra quantum"), 5, "u3 mcq4 answers")
            assert [result["id"] for result in results] == ["mcq"]
            assert results[0]["similarity"] == 0.0
            assert results[0]["keywordScore"] >= 0.5

        asyncio.run(run())


# =============================================================================
# Indexability and scoping
# =============================================================================

class TestIndexContent:
    def test_metadata_only_note_is_not_indexed(self, manager):
        async def run():
            note = {"title": "Empty Note", "body": "", "folderPath": "Study", "tags": ["x"]}
            assert not has_indexable_content(note)
            assert await manager.upsert("alice", "note1", note, fake_embed) is False
            assert manager.get_index_stats("alice")["chunk_count"] == 0

        asyncio.run(run())

    def test_clearing_a_note_removes_it_from_the_index(self, manager):
        async def run():
            await manager.upsert("alice", "note1", {"title": "T", "body": "indexed content"}, fake_embed)
            await manager.upsert("alice", "note1", {"title": "T", "body": ""}, fake_embed)
            assert manager.get_note_state("alice", "note1") is None
            assert await manager.search("alice", vector_for("indexed content"), 5) == []

        asyncio.run(run())

    def test_note_scope_returns_only_that_note(self, manager):
        async def run():
            await manager.upsert(
                "alice", "open-note", {"title": "Open", "body": "alpha biology notes"}, fake_embed
            )
            await manager.upsert(
                "alice", "other", {"title": "Other", "body": "alpha biology notes extended"}, fake_embed
            )
            results = await manager.search(
                "alice", vector_for("alpha biology notes"), 5, "alpha biology notes", note_id="open-note"
            )
            assert [result["id"] for result in results] == ["open-note"]

        asyncio.run(run())

    def test_folder_scope_excludes_other_folders(self, manager):
        async def run():
            await manager.upsert(
                "alice", "a", {"title": "A", "body": "shared keyword content", "folderPath": "Bio"}, fake_embed
            )
            await manager.upsert(
                "alice", "b", {"title": "B", "body": "shared keyword content", "folderPath": "Chem"}, fake_embed
            )
            results = await manager.search(
                "alice", vector_for("shared keyword content"), 5, "shared keyword content", folder_path="Chem"
            )
            assert [result["id"] for result in results] == ["b"]

        asyncio.run(run())


# =============================================================================
# Indexing service regressions
# =============================================================================

class TestIndexingServiceRegressions:
    def test_retrieval_logger_inserts_with_matching_columns(self, tmp_path):
        logger = RetrievalLogger(tmp_path / "logs")
        metadata = RetrievalMetadata(
            query="q",
            query_hash="hash",
            retrieval_method="hybrid",
            search_scope="all",
            authorized_source_count=2,
            candidates_retrieved=2,
            final_chunks_used=1,
            sources_used=[],
            embedding_model=EMBEDDING.model,
            embedding_dimensions=EMBEDDING.dimensions,
            index_version="1.0.0",
            indexing_status="complete",
            used_retrieved_context=True,
            context_window_used=10,
            retrieval_time_ms=1.0,
            total_time_ms=2.0,
            timestamp=1.0,
            user_id="user1",
        )
        log_id = logger.log(metadata)
        assert log_id
        logs = logger.get_logs("user1")
        assert logs[0]["user_id"] == "user1"

    def test_queue_stats_never_go_negative(self, tmp_path):
        queue = IndexingQueue(tmp_path / "queue")

        async def run():
            await queue.enqueue("user1", "note1")
            await queue.enqueue("user1", "note2")
            jobs = await queue.dequeue("user1", limit=2)
            assert len(jobs) == 2
            assert (await queue.get_status("user1")).pending_notes == 0
            for job in jobs:
                await queue.complete(job.id, "user1")
            stats = await queue.get_status("user1")
            assert stats.pending_notes == 0
            assert stats.indexed_notes == 2
            assert stats.total_notes == 2

        asyncio.run(run())

    def test_backfill_runs_and_is_idempotent(self, tmp_path):
        manager = HnswIndexManager(tmp_path / "vectors")
        queue = IndexingQueue(tmp_path / "queue")
        orchestrator = BackfillOrchestrator(manager, queue)
        notes = {
            "a": {"title": "A", "body": "alpha content"},
            "b": {"title": "B", "body": "beta content"},
            "empty": {"title": "Empty", "body": ""},
        }

        async def run():
            first = await orchestrator.backfill_user("user1", notes, fake_embed)
            assert first["status"] == "completed"
            assert first["processed"] == 2
            assert first["skipped"] == 1
            second = await orchestrator.backfill_user("user1", notes, fake_embed)
            assert second["status"] == "already_completed"
            forced = await orchestrator.backfill_user("user1", notes, fake_embed, force=True)
            assert forced["status"] == "completed"
            assert forced["processed"] == 2
            status = await orchestrator.get_backfill_status("user1")
            assert status["backfill_completed"] is True
            assert status["total_notes"] == 3

        asyncio.run(run())

    def test_backfill_endpoint_completes(self, monkeypatch):
        notes = {"note-a": {"title": "Physics", "body": "quantum mechanics"}}

        async def run_backfill(uid, notes_arg, embed, batch_size=10, force=False):
            return {
                "status": "completed",
                "total_notes": 1,
                "processed": 1,
                "skipped": 0,
                "failed": 0,
                "elapsed_seconds": 0.1,
                "completed_at": "2026-01-01T00:00:00",
            }

        monkeypatch.setattr(main_module, "user_notes", lambda uid: notes)
        monkeypatch.setattr(main_module.backfill_orchestrator, "backfill_user", run_backfill)
        monkeypatch.setattr(
            main_module.backfill_orchestrator,
            "get_backfill_status",
            _async({"backfill_completed": False}),
        )
        app = main_module.app
        app.dependency_overrides[current_user] = lambda: {"uid": "test-user"}
        try:
            response = TestClient(app).post("/v1/index/backfill", json={"force": True})
        finally:
            app.dependency_overrides.clear()

        assert response.status_code == 200
        assert response.json()["status"] == "completed"


def _async(value):
    async def inner(*args, **kwargs):
        return value

    return inner


# =============================================================================
# Embedding profile
# =============================================================================

class TestEmbeddingProfile:
    def test_index_and_profile_share_one_dimension(self):
        from app.config import resolve_embedding_profile

        assert EMBEDDING.dimensions == resolve_embedding_profile().dimensions
        assert HnswIndexManager._new_index is not None
        index = HnswIndexManager()._new_index()
        assert index.ndim == EMBEDDING.dimensions

    def test_fallback_uses_the_fallback_provider_dimensions(self):
        from app.config import resolve_embedding_profile

        with frozen_settings(
            embedding_key="",
            gemini_key="",
            groq_key="gsk-test",
            embedding_provider="gemini",
            embedding_dimensions=768,
        ):
            profile = resolve_embedding_profile()
        assert profile.provider == "groq"
        assert profile.dimensions == 1024
        assert profile.model == settings.groq_embedding_model

    def test_stale_index_is_reset_when_the_model_changes(self, tmp_path):
        from app import vector_store
        from app.config import EmbeddingProfile

        async def run():
            manager = HnswIndexManager(tmp_path / "vectors")
            await manager.upsert("alice", "note1", {"title": "A", "body": "content"}, fake_embed)
            assert manager.get_index_stats("alice")["note_count"] == 1

            async def embed_512(texts):
                return [vector_for(text)[:512] for text in texts]

            with frozen_settings(EMBEDDING=EmbeddingProfile("gemini", "other-model", 512, "k")):
                # The next write wipes the incompatible vectors instead of failing.
                await manager.upsert("alice", "note1", {"title": "A", "body": "content"}, embed_512)
            assert manager.get_index_stats("alice")["note_count"] == 1

        asyncio.run(run())


# =============================================================================
# Automatic RAG behaviour
# =============================================================================

class FakeIndex:
    def __init__(self, results=None, indexed=None):
        self.results = results or []
        self.indexed = indexed or []
        self.upserts = []
        self.deleted = []

    async def upsert(self, uid, note_id, note, embed_texts):
        self.upserts.append(note_id)

    def list_indexed_notes(self, uid, limit=None):
        return self.indexed[:limit] if limit else self.indexed

    async def delete(self, uid, note_id):
        self.deleted.append(note_id)
        return True

    def get_index_stats(self, uid):
        return {"note_count": len(self.upserts) + len(self.indexed)}

    async def search(self, uid, vector, limit, query):
        return self.results[:limit]


async def _never_embeds(texts):
    raise RuntimeError("embeddings unavailable")


def _augment(prompt, notes, index, embed_query=None, embed_texts=None):
    def load_notes(uid):
        return notes

    return asyncio.run(augment_prompt(
        "user-A", prompt, False,
        load_notes=load_notes,
        index_manager=index,
        embed_texts=embed_texts or fake_embed,
        embed_query=embed_query or (lambda query: asyncio.sleep(0, result=vector_for(query))),
        note_text=note_text,
        max_notes=100,
        max_results=5,
    ))


class TestAutomaticRagRegressions:
    def test_embeddings_unavailable_falls_back_to_live_notes(self):
        notes = {"bio": {"title": "Biology", "body": "Photosynthesis converts light energy."}}

        async def broken_query(query):
            raise RuntimeError("provider down")

        prompt, sources = _augment("USER: Explain photosynthesis.", notes, FakeIndex(), embed_query=broken_query)
        assert "Photosynthesis converts light energy." in prompt
        assert [source["id"] for source in sources] == ["bio"]
        assert "temporarily unavailable" not in prompt.lower()

    def test_unchanged_notes_are_not_re_embedded(self):
        note = {"title": "Biology", "body": "Photosynthesis converts light energy."}
        digest = hashlib.sha256(note_text(note).encode()).hexdigest()
        index = FakeIndex(indexed=[{
            "note_id": "bio",
            "content_hash": digest,
            "embedding_model": EMBEDDING.model,
            "chunk_count": 1,
        }])
        prompt, _ = _augment("USER: Explain photosynthesis.", {"bio": note}, index)
        assert index.upserts == []

    def test_index_updates_are_budgeted(self):
        from app import automatic_rag as rag_module

        notes = {
            f"n{i}": {"title": f"Note {i}", "body": f"photosynthesis detail {i}"}
            for i in range(5)
        }
        index = FakeIndex()
        with frozen_settings(module=rag_module.settings, rag_max_index_updates=2):
            _augment("USER: Explain photosynthesis.", notes, index)
        assert len(index.upserts) == 2

    def test_metadata_only_notes_are_removed_from_the_index(self):
        notes = {"keep": {"title": "Keep", "body": "real content about photosynthesis"}}
        index = FakeIndex(indexed=[{"note_id": "empty", "content_hash": "x"}])
        _augment("USER: Explain photosynthesis.", notes, index)
        assert "empty" in index.deleted


# =============================================================================
# Generation endpoint uses automatic retrieval
# =============================================================================

class TestGenerateEndpointRetrieval:
    def test_generate_returns_rag_sources_from_current_notes(self, tmp_path, monkeypatch):
        manager = HnswIndexManager(tmp_path / "vectors")
        notes = {"bio": {"title": "Biology", "body": "Mitochondria generate cellular energy."}}
        captured = {}

        async def fake_generate(provider, model, api_key, prompt, system_prompt, temperature, json_mode, images):
            captured["prompt"] = prompt
            captured["system_prompt"] = system_prompt
            return {"text": "answer", "provider": provider, "model": model}

        monkeypatch.setattr(main_module, "index_manager", manager)
        monkeypatch.setattr(main_module, "user_notes", lambda uid: notes)
        monkeypatch.setattr(main_module, "embed_texts", fake_embed)
        monkeypatch.setattr(main_module, "embed_query", lambda query: _value(vector_for(query)))
        monkeypatch.setattr(main_module, "generate", fake_generate)
        app = main_module.app
        app.dependency_overrides[current_user] = lambda: {"uid": "test-user"}
        try:
            response = TestClient(app).post(
                "/v1/ai/generate",
                json={
                    "provider": "gemini",
                    "model": "gemini-2.5-flash",
                    "prompt": "USER: Mitochondria cellular energy",
                    "api_key": "user-owned-test-key",
                },
            )
        finally:
            app.dependency_overrides.clear()

        assert response.status_code == 200
        sources = response.json()["sources"]
        assert [(source["id"], source["title"], source["folderPath"]) for source in sources] == [
            ("bio", "Biology", "")
        ]
        assert "Mitochondria generate cellular energy." in captured["prompt"]
        assert "untrusted source material" in captured["system_prompt"]


# =============================================================================
# Hybrid endpoint
# =============================================================================

class TestHybridEndpoint:
    def _indexed_manager(self, tmp_path, monkeypatch):
        manager = HnswIndexManager(tmp_path / "vectors")

        async def run():
            await manager.upsert(
                "test-user", "open", {"title": "Open note", "body": "alpha biology content"}, fake_embed
            )
            await manager.upsert(
                "test-user", "other", {"title": "Other note", "body": "alpha biology content extended"}, fake_embed
            )

        asyncio.run(run())
        monkeypatch.setattr(main_module, "index_manager", manager)
        return manager

    def test_endpoint_honors_note_scope_and_logs_without_error(self, tmp_path, monkeypatch):
        self._indexed_manager(tmp_path, monkeypatch)
        notes = {
            "open": {"title": "Open note", "body": "alpha biology content"},
            "other": {"title": "Other note", "body": "alpha biology content extended"},
        }
        monkeypatch.setattr(main_module, "user_note", lambda uid, note_id: notes.get(note_id))
        monkeypatch.setattr(main_module, "embed_query", lambda query: _value(vector_for(query)))
        app = main_module.app
        app.dependency_overrides[current_user] = lambda: {"uid": "test-user"}
        try:
            response = TestClient(app).post(
                "/v1/index/search/hybrid",
                json={"query": "alpha biology content", "limit": 5, "scope": "note", "note_id": "open"},
            )
        finally:
            app.dependency_overrides.clear()

        assert response.status_code == 200
        body = response.json()
        assert [result["id"] for result in body["results"]] == ["open"]
        assert body["retrievalMetadata"]["scope"] == "note"
        assert "contentHash" not in body["results"][0]

    def test_endpoint_drops_stale_index_entries(self, tmp_path, monkeypatch):
        self._indexed_manager(tmp_path, monkeypatch)
        edited = {"title": "Open note", "body": "edited after indexing", "folderPath": "Bio"}
        monkeypatch.setattr(main_module, "user_note", lambda uid, note_id: edited)
        monkeypatch.setattr(main_module, "embed_query", lambda query: _value(vector_for(query)))
        app = main_module.app
        app.dependency_overrides[current_user] = lambda: {"uid": "test-user"}
        try:
            response = TestClient(app).post(
                "/v1/index/search/hybrid",
                json={"query": "alpha biology content", "limit": 5},
            )
        finally:
            app.dependency_overrides.clear()

        assert response.status_code == 200
        assert response.json()["results"] == []


async def _value(result):
    return result


@contextmanager
def frozen_settings(module=None, **overrides):
    """Temporarily override attributes on frozen dataclass instances.

    ``app.config`` may have been reloaded by another test module, so the live
    module attribute is patched rather than the object imported at collection
    time.
    """
    from app import config as config_module

    live_settings = module or config_module.settings
    previous = []
    targets = []
    for name, value in overrides.items():
        if name == "EMBEDDING":
            from app import vector_store

            targets.append((vector_store, "EMBEDDING", value))
            previous.append((vector_store, "EMBEDDING", vector_store.EMBEDDING))
        else:
            targets.append((live_settings, name, value))
            previous.append((live_settings, name, getattr(live_settings, name)))
    try:
        for target, name, value in targets:
            object.__setattr__(target, name, value)
        yield
    finally:
        for target, name, value in previous:
            object.__setattr__(target, name, value)


# =============================================================================
# Query intelligence: vague follow-ups and attribute questions
# =============================================================================

class TestQueryIntelligence:
    def test_fragments_are_detected(self):
        from app.automatic_rag import _is_vague

        for fragment in ("largest?", "and the second one?", "that", "more"):
            assert _is_vague(fragment), fragment
        for question in ("Explain photosynthesis from my notes", "Which note mentions Newton?"):
            assert not _is_vague(question), question

    def test_follow_up_is_resolved_against_the_previous_turn(self):
        from app.automatic_rag import _contextual_query

        prompt = "USER: summarise the physics note\nASSISTANT: It covers photons.\nUSER: largest?"
        query, fragment = _contextual_query("largest?", prompt)
        assert fragment is True
        assert query.startswith("summarise the physics note")
        assert "largest?" in query

    def test_self_contained_question_is_not_rewritten(self):
        from app.automatic_rag import _contextual_query

        prompt = "USER: earlier question\nASSISTANT: ok\nUSER: explain the photoelectric effect"
        query, fragment = _contextual_query("explain the photoelectric effect", prompt)
        assert query == "explain the photoelectric effect"
        assert fragment is False

    def test_attribute_intent_detection(self):
        from app.automatic_rag import _attribute_intent

        assert _attribute_intent("which note is the largest?") == "largest"
        assert _attribute_intent("what is my shortest note") == "smallest"
        assert _attribute_intent("what did I edit most recently") == "recent"
        assert _attribute_intent("explain photosynthesis") is None


class TestAttributeAnswers:
    NOTES = {
        "big": {"title": "Physics — photoelectric effect", "body": "word " * 400, "folderPath": "Physics"},
        "small": {"title": "Ch5 Culture of Pakistan", "body": "culture " * 40, "folderPath": "Pakistan Studies"},
        "notes-a": {"title": "Notes", "body": "quantum " * 90, "folderPath": "Physics"},
    }

    def test_largest_question_uses_computed_attributes_not_similarity(self):
        # Every semantic hit is weak; the old code injected them anyway and the
        # model answered "you have three notes in your lab".
        index = FakeIndex(results=[
            {"id": "small", "title": "Ch5", "text": "culture", "contentHash": "x", "similarity": 0.24},
            {"id": "notes-a", "title": "Notes", "text": "quantum", "contentHash": "x", "similarity": 0.21},
            {"id": "big", "title": "Physics", "text": "word", "contentHash": "x", "similarity": 0.19},
        ])
        prompt, sources = _augment("USER: largest?", dict(self.NOTES), index)
        assert "NOTE ATTRIBUTES" in prompt
        first = prompt.split("NOTE ATTRIBUTES", 1)[1]
        assert "400 words" in first       # physics body: "word " * 400
        assert "90 words" in first        # quantum notes
        assert "40 words" in first        # culture notes
        # Weak semantic hits are never injected as note content.
        assert "contentHash" not in prompt
        assert first.index("Physics — photoelectric effect") < first.index("Ch5 Culture of Pakistan")
        assert [source["id"] for source in sources][0] == "big"
        assert "Culture of Pakistan" not in prompt.split("NOTE ATTRIBUTES", 1)[0]

    def test_attribute_report_orders_and_formats_notes(self):
        from app.automatic_rag import _attribute_report
        from app.vector_store import note_body

        report, sources = _attribute_report(dict(self.NOTES), "largest", 5, note_body)
        assert "Notes with readable content: 3" in report
        assert report.index("[1] Physics — photoelectric effect") < report.index("[2] Notes")
        assert sources[0]["id"] == "big"
        assert "words" in sources[0]["snippet"]

    def test_sources_carry_a_snippet_for_the_ui(self):
        note = {"title": "Biology", "body": "Mitochondria generate cellular energy."}
        digest = hashlib.sha256(note_text(note).encode()).hexdigest()
        index = FakeIndex(results=[{
            "id": "bio", "title": "Biology", "text": "Mitochondria generate cellular energy.",
            "contentHash": digest, "similarity": 0.62,
        }])
        _, sources = _augment("USER: explain mitochondria cellular energy", {"bio": note}, index)
        assert sources[0]["snippet"].startswith("Mitochondria generate")
        assert sources[0]["similarity"] >= 0.6

    def test_citation_numbers_match_source_order_when_report_and_excerpts_combine(self):
        # An attribute answer can also quote strong hits. The bracket numbers in
        # the prompt must line up with the order of `sources` (the UI renders one
        # chip per source in that order), and a note must never appear twice.
        notes = {note_id: dict(note) for note_id, note in self.NOTES.items()}
        index = FakeIndex(results=[
            {
                "id": note_id,
                "title": notes[note_id]["title"],
                "text": notes[note_id]["body"],
                "contentHash": hashlib.sha256(note_text(notes[note_id]).encode()).hexdigest(),
                "similarity": similarity,
            }
            for note_id, similarity in (("notes-a", 0.66), ("big", 0.61))
        ])
        prompt, sources = _augment("USER: largest?", notes, index)
        ids = [source["id"] for source in sources]
        assert ids[0] == "big"                      # computed attributes decide the ranking
        assert len(ids) == len(set(ids))            # no duplicate chips
        assert "[1] Physics — photoelectric effect" in prompt
        cited = re.findall(r'^\[(\d+)\] "([^"]+)"', prompt, re.M)
        assert cited, "expected at least one quoted excerpt"
        for number, title in cited:
            assert sources[int(number) - 1]["title"] == title

    def test_excerpt_header_includes_note_attributes(self):
        note = {"title": "Biology", "body": "Mitochondria generate cellular energy.", "folderPath": "Science"}
        digest = hashlib.sha256(note_text(note).encode()).hexdigest()
        index = FakeIndex(results=[{
            "id": "bio", "title": "Biology", "folderPath": "Science",
            "text": "Mitochondria generate cellular energy.",
            "contentHash": digest, "similarity": 0.62,
        }])
        prompt, _ = _augment("USER: explain mitochondria cellular energy", {"bio": note}, index)
        assert "4 words" in prompt          # content-only word count
        assert "folder=Science" in prompt
        assert "match=0.62" in prompt


class TestLowConfidenceGate:
    def test_weak_matches_are_not_injected(self):
        note = {"title": "Culture of Pakistan", "body": "Culture and heritage notes."}
        index = FakeIndex(results=[{
            "id": "culture", "title": "Culture of Pakistan",
            "text": "Culture and heritage notes.", "contentHash": hashlib.sha256(note_text(note).encode()).hexdigest(),
            "similarity": 0.19,
        }])
        prompt, sources = _augment("USER: explain the Krebs cycle", {"culture": note}, index)
        assert "Culture and heritage notes." not in prompt
        assert sources == []
        assert "No note was similar enough" in prompt
        assert "never say 'in your library'" in prompt

    def test_low_confidence_answer_forbids_note_counts(self):
        note = {"title": "Culture of Pakistan", "body": "Culture and heritage notes."}
        index = FakeIndex(results=[{
            "id": "culture", "title": "Culture of Pakistan",
            "text": "Culture and heritage notes.", "contentHash": hashlib.sha256(note_text(note).encode()).hexdigest(),
            "similarity": 0.20,
        }])
        prompt, _ = _augment("USER: largest?", {"culture": note}, index)
        # "largest?" is an attribute question, so it is answered deterministically.
        assert "NOTE ATTRIBUTES" in prompt
        assert "Do not claim you lack access" in prompt

    def test_confident_match_still_reports_rules(self):
        note = {"title": "Biology", "body": "Mitochondria generate cellular energy."}
        index = FakeIndex(results=[{
            "id": "bio", "title": "Biology", "text": "Mitochondria generate cellular energy.",
            "contentHash": hashlib.sha256(note_text(note).encode()).hexdigest(), "similarity": 0.71,
        }])
        prompt, sources = _augment("USER: explain mitochondria cellular energy", {"bio": note}, index)
        assert sources
        assert "RULES FOR THE RETRIEVED CONTEXT" in prompt
        assert "Never report how many notes were retrieved" in prompt
