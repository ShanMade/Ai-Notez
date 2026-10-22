import asyncio
import hashlib
import math

import pytest
from fastapi.testclient import TestClient

from app.auth import current_user
from app.config import settings
from app.main import app
import app.main as main_module
from app.vector_store import HnswIndexManager, split_chunks, user_key


def vector_for(text: str) -> list[float]:
    values = [0.0] * settings.embedding_dimensions
    for word in text.lower().split():
        position = int.from_bytes(hashlib.sha256(word.encode("utf-8")).digest()[:4], "big") % len(values)
        values[position] += 1
    magnitude = math.sqrt(sum(value * value for value in values))
    return [value / magnitude for value in values] if magnitude else values


async def fake_embed(texts: list[str]) -> list[list[float]]:
    return [vector_for(text) for text in texts]


async def fake_embed_query(query: str) -> list[float]:
    return vector_for(query)


@pytest.fixture
def manager(tmp_path):
    return HnswIndexManager(tmp_path / "vectors")


def test_user_indexes_are_isolated_and_idempotent(manager):
    async def run():
        note = {"title": "Alice note", "body": "quantum physics"}
        assert await manager.upsert("alice", "note-a", note, fake_embed)
        assert not await manager.upsert("alice", "note-a", note, fake_embed)
        await manager.upsert("bob", "note-b", {"title": "Bob note", "body": "quantum chemistry"}, fake_embed)

        alice_results = await manager.search("alice", vector_for("quantum physics"), 5)
        bob_results = await manager.search("bob", vector_for("quantum physics"), 5)

        assert [result["id"] for result in alice_results] == ["note-a"]
        assert [result["id"] for result in bob_results] == ["note-b"]
        assert alice_results[0]["title"] == "Alice note"
        assert "Alice note" not in str(bob_results)
        assert user_key("alice") != user_key("bob")

    asyncio.run(run())


def test_note_update_and_delete_remove_old_chunks(manager):
    async def run():
        await manager.upsert("alice", "note-a", {"title": "Old", "body": "old content"}, fake_embed)
        await manager.upsert("alice", "note-a", {"title": "New", "body": "new content"}, fake_embed)

        assert await manager.search("alice", vector_for("old"), 5) == []
        assert (await manager.search("alice", vector_for("new content"), 5))[0]["title"] == "New"

        assert await manager.delete("alice", "note-a")
        assert not await manager.delete("alice", "note-a")
        assert await manager.search("alice", vector_for("new content"), 5) == []

    asyncio.run(run())


def test_rebuild_removes_notes_missing_from_realtime_database(manager):
    async def run():
        await manager.upsert("alice", "note-a", {"title": "A", "body": "alpha"}, fake_embed)
        await manager.upsert("alice", "note-b", {"title": "B", "body": "beta"}, fake_embed)

        count = await manager.rebuild(
            "alice",
            {"note-a": {"title": "A refreshed", "body": "gamma"}},
            fake_embed,
        )

        assert count == 1
        assert await manager.search("alice", vector_for("beta"), 5) == []
        assert (await manager.search("alice", vector_for("gamma"), 5))[0]["title"] == "A refreshed"

    asyncio.run(run())


def test_index_and_embeddings_survive_manager_restart(tmp_path):
    async def run():
        first = HnswIndexManager(tmp_path / "vectors")
        await first.upsert(
            "alice",
            "note-a",
            {"title": "Persistent note", "body": "durable local vector index"},
            fake_embed,
        )
        owner = user_key("alice")
        assert first._revision(owner) == (1, 1)
        assert first._index_path(owner).is_file()

        restarted = HnswIndexManager(tmp_path / "vectors")
        restarted._build_index_from_database = lambda *_: pytest.fail("Expected the persisted HNSW index to load.")
        results = await restarted.search("alice", vector_for("durable vector index"), 5)
        assert [result["id"] for result in results] == ["note-a"]
        assert results[0]["title"] == "Persistent note"

    asyncio.run(run())


def test_semantic_routes_index_and_search_authenticated_firebase_notes(manager, monkeypatch):
    note = {"title": "Physics", "body": "quantum mechanics and wave functions"}

    monkeypatch.setattr(main_module, "index_manager", manager)
    monkeypatch.setattr(main_module, "user_note", lambda uid, note_id: note)
    monkeypatch.setattr(main_module, "embed_texts", fake_embed)
    monkeypatch.setattr(main_module, "embed_query", fake_embed_query)
    app.dependency_overrides[current_user] = lambda: {"uid": "test-user"}
    try:
        client = TestClient(app)
        indexed = client.post("/v1/index/notes/note-a")
        searched = client.post(
            "/v1/index/search",
            json={"query": "quantum wave functions", "limit": 5},
        )
    finally:
        app.dependency_overrides.clear()

    assert indexed.status_code == 200
    assert indexed.json() == {"indexed": True, "noteId": "note-a"}
    assert searched.status_code == 200
    result = searched.json()["results"][0]
    assert result["id"] == "note-a"
    assert result["title"] == "Physics"
    assert result["text"]


def test_safe_config_is_authenticated_and_contains_no_credentials():
    client = TestClient(app)
    app.dependency_overrides[current_user] = lambda: {"uid": "test-user"}
    try:
        response = client.get("/v1/config")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    body = response.json()
    assert "managedProviders" in body
    assert "apiKey" not in str(body)
    assert "secret" not in str(body).lower()


def test_config_requires_a_verified_identity():
    response = TestClient(app).get("/v1/config")

    assert response.status_code == 401


def test_health_check_reports_local_hnsw_store():
    response = TestClient(app).get("/healthz")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "vectorStore": "usearch-hnsw"}


def test_generation_routes_byok_through_shared_service(monkeypatch):
    captured = {}

    async def fake_generate(provider, model, api_key, prompt, system_prompt, temperature, json_mode, images):
        captured.update(
            provider=provider,
            model=model,
            api_key=api_key,
            prompt=prompt,
            system_prompt=system_prompt,
            json_mode=json_mode,
        )
        return {"text": "answer", "provider": provider, "model": model}

    monkeypatch.setattr(main_module, "generate", fake_generate)
    app.dependency_overrides[current_user] = lambda: {"uid": "test-user"}
    try:
        response = TestClient(app).post(
            "/v1/ai/generate",
            json={
                "provider": "gemini",
                "model": "gemini-2.5-flash",
                "prompt": "Explain this note.",
                "system_prompt": "You are NotezAi.",
                "json": False,
                "api_key": "user-owned-test-key",
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json()["text"] == "answer"
    assert captured["api_key"] == "user-owned-test-key"
    assert captured["system_prompt"] == "You are NotezAi."


def test_chunking_is_bounded_and_user_identifiers_are_opaque():
    chunks = split_chunks("word " * 1000)

    assert len(chunks) > 1
    assert all(0 < len(chunk) <= 1600 for chunk in chunks)
    assert user_key("alice") != "alice"
    assert user_key("alice") != user_key("bob")
