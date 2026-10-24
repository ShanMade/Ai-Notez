from __future__ import annotations

import asyncio
import re
import threading
import time
from collections import defaultdict, deque
from typing import Any

import httpx
from fastapi import HTTPException

from .config import EMBEDDING, settings


# =============================================================================
# Embedding Rate Limiter
# =============================================================================

class EmbeddingRateLimiter:
    """
    Rate limiter specifically for embedding API calls.
    Prevents overwhelming the embedding provider with too many requests.
    """
    def __init__(self, limit: int = 100, window_seconds: int = 60):
        self.limit = limit
        self.window_seconds = window_seconds
        self.calls: dict[str, deque[float]] = defaultdict(deque)
        self.lock = asyncio.Lock()

    async def check(self, provider: str) -> None:
        now = time.monotonic()
        async with self.lock:
            queue = self.calls[provider]
            while queue and queue[0] <= now - self.window_seconds:
                queue.popleft()
            if len(queue) >= self.limit:
                raise HTTPException(
                    status_code=429,
                    detail=f"Embedding rate limit reached for {provider}. Try again shortly."
                )
            queue.append(now)


embedding_limiter = EmbeddingRateLimiter()

MODEL_DEFAULTS = {
    "gemini": settings.gemini_models,
    "groq": settings.groq_models,
    "mistral": settings.mistral_models,
}

# Whisper builds Groq serves. The full large-v3 model keeps all 32 decoder layers;
# ``whisper-large-v3-turbo`` keeps 4, which is what makes it fast and what makes it
# drop words and whole sentences on long classroom audio. Both sit under the same
# free-tier allowance, so there is no quota reason to prefer turbo.
WHISPER_MODELS = ("whisper-large-v3", "whisper-large-v3-turbo")
# A formatting pass that keeps fewer than this share of the spoken words has
# silently summarised the transcript; the raw text is used instead.
TRANSCRIPT_WORD_FLOOR = 0.8


def _word_counts(text: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for word in re.findall(r"[^\W_]+", text.lower(), flags=re.UNICODE):
        counts[word] = counts.get(word, 0) + 1
    return counts


def transcript_keeps_words(raw: str, formatted: str, floor: float = TRANSCRIPT_WORD_FLOOR) -> bool:
    """True when ``formatted`` still contains the words spoken in ``raw``.

    The speaker-labelling pass is an LLM step, and an LLM asked to "keep every
    word" can still quietly summarise. Comparing the two word multisets catches
    that, so a half-transcribed part is never written into a note.
    """
    source = _word_counts(raw)
    if not source:
        return True
    available = _word_counts(formatted)
    kept = sum(min(count, available.get(word, 0)) for word, count in source.items())
    return kept / sum(source.values()) >= floor
_cooldowns: dict[str, float] = {}
_cooldown_lock = threading.Lock()


def provider_cooling_down(provider: str) -> bool:
    with _cooldown_lock:
        return _cooldowns.get(provider, 0) > time.monotonic()


def cool_down(provider: str, seconds: int = 45) -> None:
    with _cooldown_lock:
        _cooldowns[provider] = time.monotonic() + seconds


def provider_key(provider: str) -> str:
    if provider == "gemini":
        return settings.gemini_key
    if provider == "groq":
        return settings.groq_key
    if provider == "mistral":
        return settings.mistral_key
    return ""


def embedding_key() -> str:
    return EMBEDDING.key


def configured_providers() -> list[str]:
    return [provider for provider in MODEL_DEFAULTS if provider_key(provider)]


def _provider_error(response: httpx.Response) -> HTTPException:
    message = f"AI provider request failed ({response.status_code})."
    try:
        body = response.json()
        detail = body.get("error", {})
        if isinstance(detail, dict):
            message = str(detail.get("message") or message)
        elif detail:
            message = str(detail)
    except ValueError:
        pass
    if response.status_code in (401, 403):
        status_code = 502
        message = "The selected AI provider rejected its configured credential."
    elif response.status_code == 429:
        status_code = 429
        message = "The selected AI provider is rate limited."
    elif response.status_code >= 500:
        status_code = 503
        message = "The selected AI provider is temporarily unavailable."
    else:
        status_code = 502
    headers = {"X-Notez-Provider-Error": "credential"} if response.status_code in (401, 403) else None
    return HTTPException(status_code=status_code, detail=message, headers=headers)


async def generate(
    provider: str,
    model: str,
    api_key: str,
    prompt: str,
    system_prompt: str,
    temperature: float,
    json_mode: bool,
    images: list[dict[str, str]],
) -> dict[str, str]:
    if provider not in MODEL_DEFAULTS:
        raise HTTPException(status_code=422, detail="Unsupported AI provider.")
    if not api_key:
        raise HTTPException(status_code=503, detail="No credential is configured for the selected AI provider.")
    if model not in MODEL_DEFAULTS[provider]:
        raise HTTPException(status_code=422, detail="The requested model is not enabled for this provider.")

    timeout = httpx.Timeout(settings.request_timeout_seconds)
    async with httpx.AsyncClient(timeout=timeout) as client:
        if provider == "groq":
            content: Any = prompt
            if images:
                raise HTTPException(status_code=422, detail="Groq image input is not enabled by this Notez adapter.")
            response = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {api_key}"},
                json={
                    "model": model,
                    "temperature": temperature,
                    "messages": [
                        {"role": "system", "content": f"{system_prompt}\n\nThe actual generation provider is Groq and the model is {model}."},
                        {"role": "user", "content": content},
                    ],
                },
            )
            if not response.is_success:
                raise _provider_error(response)
            data = response.json()
            text = str(data.get("choices", [{}])[0].get("message", {}).get("content") or "").strip()
            if data.get("choices", [{}])[0].get("finish_reason") == "length":
                raise HTTPException(status_code=502, detail="The AI answer was cut off.")
        elif provider == "mistral":
            response = await client.post(
                "https://api.mistral.ai/v1/chat/completions",
                headers={"Authorization": f"Bearer {api_key}"},
                json={
                    "model": model,
                    "temperature": temperature,
                    "messages": [
                        {"role": "system", "content": f"{system_prompt}\n\nThe actual generation provider is Mistral and the model is {model}."},
                        {"role": "user", "content": prompt},
                    ],
                },
            )
            if not response.is_success:
                raise _provider_error(response)
            data = response.json()
            text = str(data.get("choices", [{}])[0].get("message", {}).get("content") or "").strip()
            if data.get("choices", [{}])[0].get("finish_reason") == "length":
                raise HTTPException(status_code=502, detail="The AI answer was cut off.")
        else:
            parts: list[dict[str, Any]] = [{"text": prompt}]
            for image in images:
                parts.append({"inlineData": {"mimeType": image["mime"], "data": image["data"]}})
            response = await client.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                params={"key": api_key},
                json={
                    "systemInstruction": {"parts": [{"text": f"{system_prompt}\n\nThe actual generation provider is Gemini and the model is {model}."}]},
                    "contents": [{"role": "user", "parts": parts}],
                    "generationConfig": {
                        "temperature": temperature,
                        **({"responseMimeType": "application/json"} if json_mode else {}),
                    },
                },
            )
            if not response.is_success:
                raise _provider_error(response)
            data = response.json()
            candidate = (data.get("candidates") or [{}])[0]
            text = "".join(part.get("text", "") for part in candidate.get("content", {}).get("parts", []))
            text = text.strip()
            finish = candidate.get("finishReason")
            if text and finish and finish != "STOP":
                raise HTTPException(status_code=502, detail="The AI answer was cut off.")
            if not text and data.get("promptFeedback", {}).get("blockReason"):
                raise HTTPException(status_code=422, detail="The request was blocked by the provider's safety filters.")
    if not text:
        raise HTTPException(status_code=502, detail="The AI provider returned an empty answer.")
    return {"text": text, "provider": provider, "model": model}


async def transcribe_audio(
    provider: str,
    api_key: str,
    audio: bytes,
    mime: str,
    instruction: str,
    model: str = "",
) -> dict[str, str]:
    """Transcribe an audio part with a provider that is not Gemini.

    Gemini accepts audio inline through `generate`. Groq needs its dedicated
    Whisper endpoint, so the plain transcript is passed through a Groq chat model
    afterwards to get the same speaker-labelled shape the Gemini path returns.
    """
    if provider != "groq":
        raise HTTPException(status_code=422, detail="This provider cannot transcribe audio.")
    if not api_key:
        raise HTTPException(status_code=503, detail="No credential is configured for Groq.")
    if not audio:
        raise HTTPException(status_code=422, detail="The audio part was empty.")

    # One part is 30 seconds of audio, so an empty reply never means "nothing was
    # said" — it means this Whisper build gave up on this clip. Try the other
    # build before reporting a gap in the transcript.
    models = [settings.groq_transcribe_model, *[item for item in WHISPER_MODELS if item != settings.groq_transcribe_model]]
    raw = ""
    used_model = settings.groq_transcribe_model
    last_error: HTTPException | None = None
    answered = False
    timeout = httpx.Timeout(settings.request_timeout_seconds)
    async with httpx.AsyncClient(timeout=timeout) as client:
        for whisper_model in [item for item in models if item]:
            response = await client.post(
                "https://api.groq.com/openai/v1/audio/transcriptions",
                headers={"Authorization": f"Bearer {api_key}"},
                files={"file": ("part.webm", audio, mime or "audio/webm")},
                data={
                    "model": whisper_model,
                    "response_format": "json",
                    "temperature": "0",
                },
            )
            if not response.is_success:
                error = _provider_error(response)
                # A rejected key or a rate limit says nothing about this clip, and
                # the other Whisper build would fail the same way. Anything else
                # (retired model, oversized part) is worth retrying on the other.
                if error.status_code == 429 or (error.headers or {}).get("X-Notez-Provider-Error") == "credential":
                    raise error
                last_error = error
                continue
            answered = True
            try:
                raw = str(response.json().get("text") or "").strip()
            except ValueError as exc:  # pragma: no cover - defensive
                raise HTTPException(status_code=502, detail="The transcriber returned an unreadable reply.") from exc
            used_model = whisper_model
            if raw:
                break
    if not raw:
        if not answered and last_error is not None:
            raise last_error
        raise HTTPException(
            status_code=502,
            detail=f"The transcriber returned an empty transcript ({used_model}).",
        )

    # The formatting pass is the only place a retired Groq chat model can bite,
    # so walk the enabled models instead of failing the whole transcription.
    candidates = [model] if model else list(MODEL_DEFAULTS["groq"])
    last_error: HTTPException | None = None
    for chat_model in candidates:
        if not chat_model:
            continue
        try:
            formatted = await generate(
                "groq",
                chat_model,
                api_key,
                (
                    "Below is a raw transcript of one part of a classroom or meeting recording, "
                    "with no speaker labels and no timestamps.\n\n"
                    f"{instruction}\n\n<transcript>\n{raw}\n</transcript>"
                ),
                "You format transcripts. Keep every spoken word exactly; never add, correct or invent content.",
                0.0,
                False,
                [],
            )
        except HTTPException as exc:
            last_error = exc
            # A rejected key or a rate limit will not improve on another model.
            if exc.status_code in {401, 403, 429}:
                raise
            continue
        labelled = formatted["text"]
        if not transcript_keeps_words(raw, labelled):
            # The labeller summarised instead of relabelling. Every spoken word
            # matters more than speaker turns, so keep the raw transcript.
            return {"text": raw, "provider": "groq", "model": used_model}
        return {
            "text": labelled,
            "provider": "groq",
            "model": f"{used_model} + {formatted['model']}",
        }
    raise last_error or HTTPException(status_code=502, detail="Groq could not format the transcript.")


async def _embed(texts: list[str], task_type: str) -> list[list[float]]:
    """Embed texts with the resolved provider/profile.

    ``task_type`` is only understood by Gemini; it keeps query and document
    embeddings in the same retrieval space (an asymmetric-embedding fix).
    """
    profile = EMBEDDING
    if not profile.key:
        raise HTTPException(status_code=503, detail="Semantic indexing is not configured with an embedding credential.")
    await embedding_limiter.check(profile.provider)

    if profile.provider == "gemini":
        requests = [
            {
                "model": f"models/{profile.model}",
                "content": {"parts": [{"text": text}]},
                "taskType": task_type,
                "outputDimensionality": profile.dimensions,
            }
            for text in texts
        ]
        async with httpx.AsyncClient(timeout=settings.request_timeout_seconds) as client:
            try:
                response = await client.post(
                    f"https://generativelanguage.googleapis.com/v1beta/models/{profile.model}:batchEmbedContents",
                    params={"key": profile.key},
                    json={"requests": requests},
                )
                if not response.is_success:
                    raise _provider_error(response)
                data = response.json()
            except httpx.TimeoutException:
                raise HTTPException(status_code=504, detail="Embedding request timed out.")
        vectors = [item.get("values", []) for item in data.get("embeddings", [])]
    elif profile.provider == "mistral":
        async with httpx.AsyncClient(timeout=settings.request_timeout_seconds) as client:
            try:
                response = await client.post(
                    "https://api.mistral.ai/v1/embeddings",
                    headers={"Authorization": f"Bearer {profile.key}"},
                    json={"model": profile.model, "input": texts},
                )
                if not response.is_success:
                    raise _provider_error(response)
                data = response.json()
            except httpx.TimeoutException:
                raise HTTPException(status_code=504, detail="Embedding request timed out.")
        vectors = [item.get("embedding", []) for item in data.get("data", [])]
    else:  # groq-compatible embeddings endpoint
        async with httpx.AsyncClient(timeout=settings.request_timeout_seconds) as client:
            try:
                response = await client.post(
                    "https://api.groq.com/openai/v1/embeddings",
                    headers={"Authorization": f"Bearer {profile.key}"},
                    json={"model": profile.model, "input": texts},
                )
                if not response.is_success:
                    raise _provider_error(response)
                data = response.json()
            except httpx.TimeoutException:
                raise HTTPException(status_code=504, detail="Embedding request timed out.")
        vectors = [item.get("embedding", []) for item in data.get("data", [])]

    if len(vectors) != len(texts) or any(len(vector) != profile.dimensions for vector in vectors):
        raise HTTPException(
            status_code=502,
            detail=f"The embedding provider returned an incompatible vector dimension. Expected {profile.dimensions}.",
        )
    return vectors


async def embed_texts(texts: list[str]) -> list[list[float]]:
    return await _embed(texts, task_type="RETRIEVAL_DOCUMENT")


async def embed_query(text: str) -> list[float]:
    vectors = await _embed([text], task_type="RETRIEVAL_QUERY")
    return vectors[0]
