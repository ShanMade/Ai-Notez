import asyncio
import hashlib
import json
import math
import os

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.auth import current_user
from app.config import settings
from app.main import app
import app.main as main_module
from app.vector_store import HnswIndexManager, split_chunks, user_key
from app.firebase import firebase_app, verify_id_token


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

    async def fake_generate(provider, model, api_key, prompt, system_prompt, temperature, json_mode, images, audio_transcription=False):
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


def test_managed_audio_transcribes_with_gemini_when_it_is_healthy(monkeypatch):
    calls = []

    async def fake_generate(provider, model, api_key, prompt, system_prompt, temperature, json_mode, images, audio_transcription=False):
        calls.append((provider, images[0]["mime"]))
        return {"text": "Voice 1: hello", "provider": provider, "model": model}

    async def fake_transcribe(*args, **kwargs):  # pragma: no cover - must not run
        raise AssertionError("Groq should only be used when Gemini fails")

    monkeypatch.setattr(main_module, "generate", fake_generate)
    monkeypatch.setattr(main_module, "transcribe_audio", fake_transcribe)
    monkeypatch.setattr(main_module, "configured_providers", lambda: ["gemini", "groq"])
    monkeypatch.setattr(main_module, "provider_key", lambda name: f"{name}-managed-key")
    monkeypatch.setattr(main_module, "provider_cooling_down", lambda name: False)
    monkeypatch.setattr(main_module, "cool_down", lambda provider, seconds=45: None)
    app.dependency_overrides[current_user] = lambda: {"uid": "guest-user"}
    try:
        client = TestClient(app)
        audio = client.post("/v1/ai/generate", json={"prompt": "Transcribe.", "images": [{"mime": "audio/webm", "data": "AAAA"}]})
        bad = client.post("/v1/ai/generate", json={"prompt": "Transcribe.", "images": [{"mime": "video/mp4", "data": "AAAA"}]})
    finally:
        app.dependency_overrides.clear()

    assert audio.status_code == 200
    assert calls == [("gemini", "audio/webm")]
    assert bad.status_code == 422


def test_voice_to_note_uses_the_dedicated_transcription_model(monkeypatch):
    from app.config import settings

    seen = []

    async def fake_generate(provider, model, api_key, prompt, system_prompt, temperature, json_mode, images, audio_transcription=False):
        seen.append(model)
        return {"text": "Voice 1: hello", "provider": provider, "model": model}

    monkeypatch.setattr(main_module, "generate", fake_generate)
    monkeypatch.setattr(main_module, "configured_providers", lambda: ["gemini"])
    monkeypatch.setattr(main_module, "provider_key", lambda name: f"{name}-managed-key")
    monkeypatch.setattr(main_module, "provider_cooling_down", lambda name: False)
    monkeypatch.setattr(main_module, "cool_down", lambda provider, seconds=45: None)
    app.dependency_overrides[current_user] = lambda: {"uid": "guest-user"}
    try:
        client = TestClient(app)
        client.post("/v1/ai/generate", json={"prompt": "Transcribe.", "images": [{"mime": "audio/webm", "data": "AAAA"}]})
        client.post("/v1/ai/generate", json={"prompt": "Explain osmosis."})
    finally:
        app.dependency_overrides.clear()

    # Audio gets the cheap transcription model; text keeps the chat model.
    assert seen[0] == settings.gemini_transcribe_model
    assert seen[1] != settings.gemini_transcribe_model


def test_a_missing_transcription_model_falls_back_to_a_chat_model(monkeypatch):
    from app.config import settings

    seen = []
    first = settings.gemini_transcribe_model

    async def fake_generate(provider, model, api_key, prompt, system_prompt, temperature, json_mode, images, audio_transcription=False):
        seen.append(model)
        if model == first:
            raise HTTPException(status_code=404, detail=f"models/{model} is not found for API version v1beta")
        return {"text": "Voice 1: hello", "provider": provider, "model": model}

    monkeypatch.setattr(main_module, "generate", fake_generate)
    monkeypatch.setattr(main_module, "configured_providers", lambda: ["gemini"])
    monkeypatch.setattr(main_module, "provider_key", lambda name: f"{name}-managed-key")
    monkeypatch.setattr(main_module, "provider_cooling_down", lambda name: False)
    monkeypatch.setattr(main_module, "cool_down", lambda provider, seconds=45: None)
    app.dependency_overrides[current_user] = lambda: {"uid": "guest-user"}
    try:
        response = TestClient(app).post(
            "/v1/ai/generate",
            json={"prompt": "Transcribe.", "images": [{"mime": "audio/webm", "data": "AAAA"}]},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert seen[0] == first
    assert len(seen) > 1 and seen[1] != first


def test_a_transcription_request_asks_for_diarization(monkeypatch):
    import app.providers as providers
    from app.config import settings

    captured = {}

    class FakeResponse:
        is_success = True

        def json(self):
            return {
                "candidates": [{
                    "content": {"parts": [
                        {"audioTranscription": {"speakerLabel": "spk_1", "text": "Good morning."}},
                        {"audioTranscription": {"speakerLabel": "spk_1", "words": [{"word": "Today"}, {"word": "we"}]}},
                        {"audioTranscription": {"speakerLabel": "spk_2", "text": "A question?"}},
                    ]},
                    "finishReason": "STOP",
                }]
            }

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, url, **kwargs):
            captured["url"] = url
            captured.update(kwargs)
            return FakeResponse()

    monkeypatch.setattr(providers.httpx, "AsyncClient", FakeClient)
    result = asyncio.run(
        providers.generate(
            "gemini",
            settings.gemini_transcribe_model,
            "gemini-key",
            "Transcribe this part.",
            "You are NotezAi.",
            0,
            False,
            [{"mime": "audio/webm", "data": "AAAA"}],
            audio_transcription=True,
        )
    )

    body = captured["json"]
    parts = body["contents"][0]["parts"]
    assert settings.gemini_transcribe_model in captured["url"]
    # The audio is the only part: a text instruction next to it is read as a
    # question about the audio rather than something to transcribe.
    assert len(parts) == 1 and parts[0]["inlineData"]["mimeType"] == "audio/webm"
    assert body["generationConfig"]["audioTranscriptionConfig"] == {"diarization": True}
    # spk_1 -> Voice 1, same voice merged, spk_2 -> Voice 2.
    assert result["text"] == "Voice 1: Good morning. Today we\nVoice 2: A question?"


def test_an_exhausted_transcription_model_falls_back_to_the_next_one(monkeypatch):
    from app.config import settings

    seen = []

    async def fake_generate(provider, model, api_key, prompt, system_prompt, temperature, json_mode, images, audio_transcription=False):
        seen.append(model)
        if model == settings.gemini_transcribe_model:
            raise HTTPException(status_code=429, detail="Quota exceeded for this model.")
        return {"text": "Voice 1: hello", "provider": provider, "model": model}

    monkeypatch.setattr(main_module, "generate", fake_generate)
    monkeypatch.setattr(main_module, "configured_providers", lambda: ["gemini"])
    monkeypatch.setattr(main_module, "provider_key", lambda name: f"{name}-managed-key")
    monkeypatch.setattr(main_module, "provider_cooling_down", lambda name: False)
    monkeypatch.setattr(main_module, "cool_down", lambda provider, seconds=45: None)
    app.dependency_overrides[current_user] = lambda: {"uid": "guest-user"}
    try:
        response = TestClient(app).post(
            "/v1/ai/generate",
            json={"prompt": "Transcribe.", "images": [{"mime": "audio/webm", "data": "AAAA"}], "audio_transcription": True},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert seen[0] == settings.gemini_transcribe_model
    assert seen[1] == settings.gemini_transcribe_fallbacks[0]


def test_a_transcription_model_that_rejects_the_shape_falls_back(monkeypatch):
    from app.config import settings

    seen = []

    async def fake_generate(provider, model, api_key, prompt, system_prompt, temperature, json_mode, images, audio_transcription=False):
        seen.append(model)
        if model == settings.gemini_transcribe_model:
            raise HTTPException(status_code=400, detail="audioTranscriptionConfig is not supported by this API revision.")
        return {"text": "Voice 1: hello", "provider": provider, "model": model}

    monkeypatch.setattr(main_module, "generate", fake_generate)
    monkeypatch.setattr(main_module, "configured_providers", lambda: ["gemini"])
    monkeypatch.setattr(main_module, "provider_key", lambda name: f"{name}-managed-key")
    monkeypatch.setattr(main_module, "provider_cooling_down", lambda name: False)
    monkeypatch.setattr(main_module, "cool_down", lambda provider, seconds=45: None)
    app.dependency_overrides[current_user] = lambda: {"uid": "guest-user"}
    try:
        response = TestClient(app).post(
            "/v1/ai/generate",
            json={"prompt": "Transcribe.", "images": [{"mime": "audio/webm", "data": "AAAA"}], "audio_transcription": True},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert seen == [settings.gemini_transcribe_model, settings.gemini_transcribe_fallbacks[0]]


def test_the_transcription_flag_reaches_the_provider(monkeypatch):
    captured = []

    async def fake_generate(provider, model, api_key, prompt, system_prompt, temperature, json_mode, images, audio_transcription=False):
        captured.append((bool(images), audio_transcription))
        return {"text": "Voice 1: hello", "provider": provider, "model": model}

    monkeypatch.setattr(main_module, "generate", fake_generate)
    monkeypatch.setattr(main_module, "configured_providers", lambda: ["gemini"])
    monkeypatch.setattr(main_module, "provider_key", lambda name: f"{name}-managed-key")
    monkeypatch.setattr(main_module, "provider_cooling_down", lambda name: False)
    monkeypatch.setattr(main_module, "cool_down", lambda provider, seconds=45: None)
    app.dependency_overrides[current_user] = lambda: {"uid": "guest-user"}
    try:
        client = TestClient(app)
        client.post("/v1/ai/generate", json={"prompt": "Transcribe.", "images": [{"mime": "audio/webm", "data": "AAAA"}], "audio_transcription": True})
        client.post("/v1/ai/generate", json={"prompt": "Explain osmosis."})
    finally:
        app.dependency_overrides.clear()

    # Audio asks for a diarized transcript; a plain text call never does.
    assert captured == [(True, True), (False, False)]


def test_the_transcription_chain_is_transcribe_then_the_flash_lite_models():
    from app.config import settings

    assert settings.gemini_transcribe_model == "gemini-3.5-transcribe"
    assert settings.gemini_transcribe_fallbacks == ("gemini-3.5-flash-lite", "gemini-3.1-flash-lite")
    assert settings.gemini_transcribe_models == ("gemini-3.5-transcribe", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite")


def test_a_part_can_carry_its_recording_plus_eight_voice_samples():
    # One recording part + eight learned voices fit in one request.
    parts = [{"mime": "audio/webm", "data": "AAAA"}] + [
        {"mime": "audio/webm", "data": "AAAA"} for _ in range(8)
    ]
    request = main_module.GenerateRequest(prompt="Transcribe.", images=parts)
    assert len(request.images) == 9


def test_managed_audio_falls_back_to_groq_when_gemini_is_rate_limited(monkeypatch):
    # The screenshot case: Gemini rate-limited, the request was refused instead
    # of being handed to the provider that can still transcribe.
    transcribed = []

    async def fake_generate(provider, model, api_key, prompt, system_prompt, temperature, json_mode, images, audio_transcription=False):
        raise HTTPException(status_code=429, detail="The selected AI provider is rate limited.")

    async def fake_transcribe(provider, api_key, audio, mime, instruction, model=""):
        transcribed.append((provider, mime, len(audio)))
        return {"text": "Voice 1: hello", "provider": provider, "model": "whisper-large-v3-turbo"}

    monkeypatch.setattr(main_module, "generate", fake_generate)
    monkeypatch.setattr(main_module, "transcribe_audio", fake_transcribe)
    monkeypatch.setattr(main_module, "configured_providers", lambda: ["gemini", "groq"])
    monkeypatch.setattr(main_module, "provider_key", lambda name: f"{name}-managed-key")
    monkeypatch.setattr(main_module, "provider_cooling_down", lambda name: False)
    monkeypatch.setattr(main_module, "cool_down", lambda provider, seconds=45: None)
    app.dependency_overrides[current_user] = lambda: {"uid": "guest-user"}
    try:
        response = TestClient(app).post(
            "/v1/ai/generate",
            json={"prompt": "Transcribe.", "images": [{"mime": "audio/webm", "data": "AAAA"}]},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json()["provider"] == "groq"
    assert transcribed == [("groq", "audio/webm", 3)]


def test_a_cooling_provider_is_still_tried_instead_of_failing_everything(monkeypatch):
    # Every provider cooling down used to return 503 before a single attempt.
    attempts = []

    async def fake_generate(provider, model, api_key, prompt, system_prompt, temperature, json_mode, images, audio_transcription=False):
        attempts.append(provider)
        return {"text": "ok", "provider": provider, "model": model}

    monkeypatch.setattr(main_module, "generate", fake_generate)
    monkeypatch.setattr(main_module, "configured_providers", lambda: ["gemini"])
    monkeypatch.setattr(main_module, "provider_key", lambda name: f"{name}-managed-key")
    monkeypatch.setattr(main_module, "provider_cooling_down", lambda name: True)
    app.dependency_overrides[current_user] = lambda: {"uid": "guest-user"}
    try:
        response = TestClient(app).post("/v1/ai/generate", json={"prompt": "Explain photosynthesis."})
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert attempts == ["gemini"]


def test_managed_generation_tries_the_next_provider_on_any_failure(monkeypatch):
    attempts = []

    async def fake_generate(provider, model, api_key, prompt, system_prompt, temperature, json_mode, images, audio_transcription=False):
        attempts.append(provider)
        if provider == "gemini":
            raise HTTPException(status_code=502, detail="The selected AI provider rejected its configured credential.")
        return {"text": "answer", "provider": provider, "model": model}

    monkeypatch.setattr(main_module, "generate", fake_generate)
    monkeypatch.setattr(main_module, "configured_providers", lambda: ["gemini", "groq"])
    monkeypatch.setattr(main_module, "provider_key", lambda name: f"{name}-managed-key")
    monkeypatch.setattr(main_module, "provider_cooling_down", lambda name: False)
    app.dependency_overrides[current_user] = lambda: {"uid": "guest-user"}
    try:
        response = TestClient(app).post("/v1/ai/generate", json={"prompt": "Explain photosynthesis."})
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json()["provider"] == "groq"
    assert attempts == ["gemini", "groq"]


def test_groq_transcription_uses_the_whisper_endpoint(monkeypatch):
    import app.providers as providers

    captured = {}

    class FakeResponse:
        is_success = True

        def json(self):
            return {"text": "hello world"}

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, url, **kwargs):
            captured["url"] = url
            captured.update(kwargs)
            return FakeResponse()

    async def fake_generate(provider, model, api_key, prompt, system_prompt, temperature, json_mode, images, audio_transcription=False):
        captured["prompt"] = prompt
        return {"text": "Voice 1: hello world", "provider": "groq", "model": model}

    monkeypatch.setattr(providers.httpx, "AsyncClient", FakeClient)
    monkeypatch.setattr(providers, "generate", fake_generate)

    result = asyncio.run(
        providers.transcribe_audio("groq", "groq-key", b"audio-bytes", "audio/webm", "Transcribe this part.")
    )

    assert captured["url"].endswith("/openai/v1/audio/transcriptions")
    assert captured["data"]["model"] == settings.groq_transcribe_model
    assert captured["files"]["file"][2] == "audio/webm"
    assert "hello world" in captured["prompt"]          # the raw transcript is formatted, not dropped
    assert result["provider"] == "groq"
    assert result["text"] == "Voice 1: hello world"


def test_groq_transcription_walks_the_enabled_chat_models(monkeypatch):
    import app.providers as providers

    tried = []
    retired = providers.MODEL_DEFAULTS["groq"][0]

    class FakeResponse:
        is_success = True

        def json(self):
            return {"text": "hello world"}

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, url, **kwargs):
            return FakeResponse()

    async def fake_generate(provider, model, api_key, prompt, system_prompt, temperature, json_mode, images, audio_transcription=False):
        tried.append(model)
        if model == retired:
            raise HTTPException(status_code=502, detail="The requested model is decommissioned.")
        return {"text": "Voice 1: hello world", "provider": "groq", "model": model}

    monkeypatch.setattr(providers.httpx, "AsyncClient", FakeClient)
    monkeypatch.setattr(providers, "generate", fake_generate)

    result = asyncio.run(providers.transcribe_audio("groq", "key", b"audio", "audio/webm", "Transcribe."))

    assert tried[0] == retired
    assert len(tried) > 1            # a retired model does not fail the transcription
    assert result["text"] == "Voice 1: hello world"
    assert result["model"].endswith(tried[1])


def test_whisper_defaults_to_the_full_model_not_turbo():
    from app.config import settings

    # turbo keeps 4 decoder layers of 32 and is what drops words on long audio.
    assert settings.groq_transcribe_model == "whisper-large-v3"


def test_whisper_retries_the_other_build_when_a_part_comes_back_empty(monkeypatch):
    import app.providers as providers

    asked = []

    class FakeResponse:
        is_success = True
        status_code = 200
        headers = {}

        def __init__(self, text):
            self._text = text

        def json(self):
            return {"text": self._text}

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, url, **kwargs):
            asked.append(kwargs["data"]["model"])
            # The full model returns nothing for this clip; the turbo build hears it.
            return FakeResponse("" if len(asked) == 1 else "hello world")

    async def fake_generate(provider, model, api_key, prompt, system_prompt, temperature, json_mode, images, audio_transcription=False):
        return {"text": "Voice 1: hello world", "provider": "groq", "model": model}

    monkeypatch.setattr(providers.httpx, "AsyncClient", FakeClient)
    monkeypatch.setattr(providers, "generate", fake_generate)
    result = asyncio.run(
        providers.transcribe_audio("groq", "key", b"audio", "audio/webm", "Transcribe.")
    )

    assert asked == ["whisper-large-v3", "whisper-large-v3-turbo"]
    assert result["text"] == "Voice 1: hello world"


def test_a_labeller_that_drops_words_falls_back_to_the_raw_transcript(monkeypatch):
    import app.providers as providers

    raw = "the teacher explained osmosis and diffusion in detail"

    class FakeResponse:
        is_success = True
        status_code = 200
        headers = {}

        def json(self):
            return {"text": raw}

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, url, **kwargs):
            return FakeResponse()

    async def summarizing_generate(provider, model, api_key, prompt, system_prompt, temperature, json_mode, images):
        # A chat model that "relabels" by summarising.
        return {"text": "Voice 1: osmosis and diffusion", "provider": "groq", "model": model}

    monkeypatch.setattr(providers.httpx, "AsyncClient", FakeClient)
    monkeypatch.setattr(providers, "generate", summarizing_generate)

    result = asyncio.run(
        providers.transcribe_audio("groq", "key", b"audio", "audio/webm", "Transcribe.")
    )

    assert result["text"] == raw                     # no spoken words were lost
    assert "+" not in result["model"]


def test_transcript_coverage_counts_repeated_words():
    import app.providers as providers

    assert providers.transcript_keeps_words("say it again and again", "Voice 1: say it again and again")
    assert not providers.transcript_keeps_words("say it again and again", "Voice 1: say it again")


def test_transcription_rejects_unsupported_providers_and_empty_audio(monkeypatch):
    import app.providers as providers

    with pytest.raises(HTTPException) as unsupported:
        asyncio.run(providers.transcribe_audio("mistral", "key", b"audio", "audio/webm", "Transcribe."))
    assert unsupported.value.status_code == 422

    with pytest.raises(HTTPException) as empty:
        asyncio.run(providers.transcribe_audio("groq", "key", b"", "audio/webm", "Transcribe."))
    assert empty.value.status_code == 422


def test_chunking_is_bounded_and_user_identifiers_are_opaque():
    chunks = split_chunks("word " * 1000)

    assert len(chunks) > 1
    assert all(0 < len(chunk) <= 1600 for chunk in chunks)
    assert user_key("alice") != "alice"
    assert user_key("alice") != user_key("bob")


def test_firebase_credential_loading_from_json_env(monkeypatch):
    """Test loading Firebase Admin credentials from FIREBASE_SERVICE_ACCOUNT_JSON environment variable."""
    import firebase_admin
    
    # Reset the global _app state
    import app.firebase as fb_module
    fb_module._app = None
    
    # Mock service account JSON
    mock_json = json.dumps({
        "type": "service_account",
        "project_id": "ai-notez",
        "private_key_id": "test-key-id",
        "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7...\n-----END PRIVATE KEY-----\n",
        "client_email": "test@ai-notez.iam.gserviceaccount.com",
        "client_id": "123456789",
        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
        "token_uri": "https://oauth2.googleapis.com/token",
        "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
        "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/test%40ai-notez.iam.gserviceaccount.com"
    })
    
    # Set the environment variable
    monkeypatch.setenv("FIREBASE_SERVICE_ACCOUNT_JSON", mock_json)
    monkeypatch.setenv("FIREBASE_PROJECT_ID", "ai-notez")
    monkeypatch.setenv("FIREBASE_DATABASE_URL", "https://ai-notez-default-rtdb.firebaseio.com")
    
    # Import config to pick up the new env vars
    from app.config import Settings
    test_settings = Settings()
    
    # Temporarily replace settings
    monkeypatch.setattr("app.firebase.settings", test_settings)
    
    try:
        # Clear any existing Firebase app
        if firebase_admin._apps:
            for name in list(firebase_admin._apps.keys()):
                firebase_admin.delete_app(firebase_admin.get_app(name))
        
        # This should initialize with JSON credentials
        app_instance = firebase_app()
        assert app_instance is not None
        assert app_instance.project_id == "ai-notez"
    finally:
        # Clean up
        if firebase_admin._apps:
            for name in list(firebase_admin._apps.keys()):
                firebase_admin.delete_app(firebase_admin.get_app(name))
        fb_module._app = None


def test_firebase_credential_loading_from_file_path(monkeypatch, tmp_path):
    """Test loading Firebase Admin credentials from GOOGLE_APPLICATION_CREDENTIALS file path."""
    import firebase_admin
    import app.firebase as fb_module
    
    # Reset the global _app state
    fb_module._app = None
    
    # Create a temporary credentials file
    cred_file = tmp_path / "service-account.json"
    cred_data = {
        "type": "service_account",
        "project_id": "ai-notez",
        "private_key_id": "test-key-id",
        "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7...\n-----END PRIVATE KEY-----\n",
        "client_email": "test@ai-notez.iam.gserviceaccount.com",
        "client_id": "123456789",
        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
        "token_uri": "https://oauth2.googleapis.com/token",
        "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
        "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/test%40ai-notez.iam.gserviceaccount.com"
    }
    cred_file.write_text(json.dumps(cred_data))
    
    # Set the environment variable to point to the file
    monkeypatch.setenv("GOOGLE_APPLICATION_CREDENTIALS", str(cred_file))
    monkeypatch.setenv("FIREBASE_SERVICE_ACCOUNT_JSON", "")
    monkeypatch.setenv("FIREBASE_PROJECT_ID", "ai-notez")
    monkeypatch.setenv("FIREBASE_DATABASE_URL", "https://ai-notez-default-rtdb.firebaseio.com")
    
    # Import config to pick up the new env vars
    from app.config import Settings
    test_settings = Settings()
    
    # Temporarily replace settings
    monkeypatch.setattr("app.firebase.settings", test_settings)
    
    try:
        # Clear any existing Firebase app
        if firebase_admin._apps:
            for name in list(firebase_admin._apps.keys()):
                firebase_admin.delete_app(firebase_admin.get_app(name))
        
        # This should fall back to file path
        app_instance = firebase_app()
        assert app_instance is not None
        assert app_instance.project_id == "ai-notez"
    finally:
        # Clean up
        if firebase_admin._apps:
            for name in list(firebase_admin._apps.keys()):
                firebase_admin.delete_app(firebase_admin.get_app(name))
        fb_module._app = None


def test_firebase_credential_loading_malformed_json(monkeypatch):
    """Test that malformed JSON in FIREBASE_SERVICE_ACCOUNT_JSON raises a clear error."""
    import app.firebase as fb_module
    
    # Reset the global _app state
    fb_module._app = None
    
    # Clear any existing Firebase apps first
    import firebase_admin
    if firebase_admin._apps:
        for name in list(firebase_admin._apps.keys()):
            firebase_admin.delete_app(firebase_admin.get_app(name))
    
    # Set malformed JSON
    monkeypatch.delenv("FIREBASE_SERVICE_ACCOUNT_JSON", raising=False)
    monkeypatch.setenv("FIREBASE_SERVICE_ACCOUNT_JSON", "not valid json")
    monkeypatch.delenv("FIREBASE_PROJECT_ID", raising=False)
    monkeypatch.setenv("FIREBASE_PROJECT_ID", "ai-notez")
    monkeypatch.delenv("FIREBASE_DATABASE_URL", raising=False)
    monkeypatch.setenv("FIREBASE_DATABASE_URL", "")
    
    # Reload config to pick up the new env vars
    import importlib
    import app.config
    importlib.reload(app.config)
    test_settings = app.config.Settings()
    monkeypatch.setattr("app.firebase.settings", test_settings)
    
    try:
        with pytest.raises(RuntimeError, match="Invalid FIREBASE_SERVICE_ACCOUNT_JSON"):
            firebase_app()
    finally:
        fb_module._app = None


def test_cors_origins_parsed_correctly(monkeypatch):
    """Test that CORS origins are parsed correctly from NOTEZ_CORS_ORIGINS."""
    # Clear the environment variable first to avoid picking up the .env file
    monkeypatch.delenv("NOTEZ_CORS_ORIGINS", raising=False)
    monkeypatch.setenv("NOTEZ_CORS_ORIGINS", "https://ai-notez.web.app,http://localhost:8000,https://shanmade.github.io/Ai-Notez")
    
    # Reload settings to pick up the new env var
    import importlib
    import app.config
    importlib.reload(app.config)
    test_settings = app.config.Settings()
    
    assert "https://ai-notez.web.app" in test_settings.cors_origins
    assert "http://localhost:8000" in test_settings.cors_origins
    assert "https://shanmade.github.io/Ai-Notez" in test_settings.cors_origins
    assert len(test_settings.cors_origins) == 3


def test_cors_production_origin_allowed(monkeypatch):
    """Test that the production origin is in the allowed CORS origins."""
    monkeypatch.delenv("NOTEZ_CORS_ORIGINS", raising=False)
    monkeypatch.setenv("NOTEZ_CORS_ORIGINS", "https://ai-notez.web.app,http://localhost:8000")
    
    import importlib
    import app.config
    importlib.reload(app.config)
    test_settings = app.config.Settings()
    
    assert "https://ai-notez.web.app" in test_settings.cors_origins


def test_cors_whitespace_handling(monkeypatch):
    """Test that CORS origins with whitespace are trimmed correctly."""
    monkeypatch.delenv("NOTEZ_CORS_ORIGINS", raising=False)
    monkeypatch.setenv("NOTEZ_CORS_ORIGINS", " https://ai-notez.web.app , http://localhost:8000 ")
    
    import importlib
    import app.config
    importlib.reload(app.config)
    test_settings = app.config.Settings()
    
    assert "https://ai-notez.web.app" in test_settings.cors_origins
    assert "http://localhost:8000" in test_settings.cors_origins
    assert " " not in test_settings.cors_origins[0]
