from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()


def _integer(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        return max(minimum, min(maximum, int(os.getenv(name, default))))
    except (TypeError, ValueError):
        return default


@dataclass(frozen=True)
class Settings:
    database_url: str = os.getenv("FIREBASE_DATABASE_URL", "")
    firebase_project_id: str = os.getenv("FIREBASE_PROJECT_ID", "ai-notez")
    firebase_api_key: str = os.getenv("FIREBASE_API_KEY", "")
    firebase_auth_domain: str = os.getenv("FIREBASE_AUTH_DOMAIN", "")
    firebase_storage_bucket: str = os.getenv("FIREBASE_STORAGE_BUCKET", "")
    firebase_messaging_sender_id: str = os.getenv("FIREBASE_MESSAGING_SENDER_ID", "")
    firebase_app_id: str = os.getenv("FIREBASE_APP_ID", "")
    firebase_service_account_json: str = os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON", "")
    data_dir: Path = Path(
        os.getenv("NOTEZ_DATA_DIR", str(Path(__file__).resolve().parent.parent / "data"))
    ).expanduser()
    cors_origins: tuple[str, ...] = tuple(
        origin.strip().rstrip("/")
        for origin in os.getenv("NOTEZ_CORS_ORIGINS", "").split(",")
        if origin.strip()
    )
    default_provider: str = os.getenv("AI_DEFAULT_PROVIDER", "gemini").lower()
    mistral_enabled: bool = os.getenv("AI_MISTRAL_ENABLED", "false").lower() in {"true", "1", "yes"}
    gemini_models: tuple[str, ...] = tuple(
        item.strip() for item in os.getenv(
            "AI_GEMINI_MODELS",
            "gemini-2.5-flash,gemini-2.5-flash-lite,gemini-3.5-flash-lite,gemini-3.1-flash-lite",
        ).split(",") if item.strip()
    )
    # Voice-to-Note has its own model. Gemini 3.5 Transcribe is the dedicated
    # speech-to-text model: it labels up to eight speakers natively and returns
    # the transcript in one pass, which is why it replaced 3.5 Flash-Lite as the
    # default. The live variant (gemini-3.5-transcribe-live) is streaming only
    # and cannot diarize, so it is not used here.
    gemini_transcribe_model: str = os.getenv("AI_GEMINI_TRANSCRIBE_MODEL", "gemini-3.5-transcribe")
    # TEMPORARY: the free-tier transcribe model is the only model used for
    # Voice-to-Note audio, so there are no fallbacks while it is tested. Set
    # AI_GEMINI_TRANSCRIBE_FALLBACKS to bring the chain back.
    gemini_transcribe_fallbacks: tuple[str, ...] = tuple(
        item.strip() for item in os.getenv("AI_GEMINI_TRANSCRIBE_FALLBACKS", "").split(",") if item.strip()
    )
    groq_models: tuple[str, ...] = tuple(
        item.strip() for item in os.getenv(
            "AI_GROQ_MODELS",
            "openai/gpt-oss-120b,llama-3.3-70b-versatile,openai/gpt-oss-20b,meta-llama/llama-4-scout-17b-16e-instruct,qwen/qwen3-32b,llama-3.1-8b-instant",
        ).split(",") if item.strip()
    )
    mistral_key: str = os.getenv("AI_MISTRAL_API_KEY", "")
    mistral_models: tuple[str, ...] = tuple(
        item.strip() for item in os.getenv(
            "AI_MISTRAL_MODELS",
            "mistral-large-latest,mistral-small-latest",
        ).split(",") if item.strip()
    )
    gemini_key: str = os.getenv("AI_GEMINI_API_KEY", "")
    @property
    def gemini_transcribe_models(self) -> tuple[str, ...]:
        """Every Gemini model Voice-to-Note may use, in order."""
        return tuple(dict.fromkeys(
            item for item in (self.gemini_transcribe_model, *self.gemini_transcribe_fallbacks) if item
        ))

    groq_key: str = os.getenv("AI_GROQ_API_KEY", "")
    embedding_key: str = os.getenv("AI_EMBEDDING_API_KEY", "")
    embedding_provider: str = os.getenv("AI_EMBEDDING_PROVIDER", "gemini").lower()
    embedding_model: str = os.getenv("AI_EMBEDDING_MODEL", "gemini-embedding-001")
    embedding_dimensions: int = _integer("AI_EMBEDDING_DIMENSIONS", 768, 64, 3072)
    groq_embedding_model: str = os.getenv("AI_GROQ_EMBEDDING_MODEL", "text-embedding-3-small")
    # Groq's Whisper endpoint transcribes audio when Gemini is rate limited or unavailable.
    # Full large-v3, not the turbo build: turbo keeps only 4 of the 32 decoder layers
    # and is known to drop words or whole sentences on real classroom audio, while
    # both models share the same free-tier allowance (2,000 requests a day).
    groq_transcribe_model: str = os.getenv("AI_GROQ_TRANSCRIBE_MODEL", "whisper-large-v3")
    request_timeout_seconds: int = _integer("AI_REQUEST_TIMEOUT_SECONDS", 60, 5, 180)
    max_prompt_chars: int = _integer("AI_MAX_PROMPT_CHARS", 60000, 1000, 200000)
    max_chunks_per_user: int = _integer("AI_MAX_CHUNKS_PER_USER", 20000, 100, 100000)
    max_indexed_notes: int = _integer("AI_MAX_INDEXED_NOTES", 5000, 1, 50000)
    max_search_results: int = _integer("AI_MAX_SEARCH_RESULTS", 8, 1, 25)
    min_similarity: float = float(os.getenv("AI_MIN_SIMILARITY", "0.18"))
    rag_max_index_updates: int = _integer("AI_RAG_MAX_INDEX_UPDATES", 24, 0, 500)
    rag_min_confidence: float = float(os.getenv("AI_RAG_MIN_CONFIDENCE", "0.32"))
    rag_max_excerpts: int = _integer("AI_RAG_MAX_EXCERPTS", 4, 1, 12)

settings = Settings()


@dataclass(frozen=True)
class EmbeddingProfile:
    """The embedding configuration actually used at runtime.

    The vector index is created with ``dimensions`` and every stored/query vector
    must use ``model`` and the same provider key, so this profile is the single
    source of truth. Resolving it once prevents the previous failure mode where
    the index was built with the configured dimensions but the provider silently
    switched to a model with a different output size.
    """

    provider: str
    model: str
    dimensions: int
    key: str

    @property
    def enabled(self) -> bool:
        return bool(self.key)


# Providers with a fixed embedding size; Gemini accepts a configurable one.
FIXED_EMBEDDING_DIMENSIONS = {"groq": 1024, "mistral": 1024}


def _provider_key(provider: str) -> str:
    return {
        "gemini": settings.gemini_key,
        "groq": settings.groq_key,
        "mistral": settings.mistral_key,
    }.get(provider, "")


def resolve_embedding_profile() -> EmbeddingProfile:
    provider = settings.embedding_provider
    key = settings.embedding_key or _provider_key(provider)
    if provider == "gemini" and not key:
        # No Gemini embedding credential: fall back once, at startup, so the
        # index dimensions always match the provider that will be called.
        if settings.groq_key:
            return EmbeddingProfile("groq", settings.groq_embedding_model, 1024, settings.groq_key)
        if settings.mistral_key:
            return EmbeddingProfile("mistral", "mistral-embed", 1024, settings.mistral_key)
        return EmbeddingProfile("gemini", settings.embedding_model, settings.embedding_dimensions, "")
    if provider in FIXED_EMBEDDING_DIMENSIONS:
        dimensions = FIXED_EMBEDDING_DIMENSIONS[provider]
        if settings.embedding_dimensions != dimensions:
            raise ValueError(
                f"AI_EMBEDDING_DIMENSIONS must be {dimensions} when AI_EMBEDDING_PROVIDER={provider}; "
                "change the value and rebuild the semantic index."
            )
        model = settings.groq_embedding_model if provider == "groq" else "mistral-embed"
        return EmbeddingProfile(provider, model, dimensions, key)
    return EmbeddingProfile("gemini", settings.embedding_model, settings.embedding_dimensions, key)


EMBEDDING = resolve_embedding_profile()

if settings.default_provider not in {"gemini", "groq", "mistral"}:
    raise ValueError("AI_DEFAULT_PROVIDER must be 'gemini', 'groq', or 'mistral'.")
if not settings.gemini_models or not settings.groq_models:
    raise ValueError("AI_GEMINI_MODELS and AI_GROQ_MODELS must each contain at least one model.")
if settings.embedding_provider not in {"gemini", "groq", "mistral"}:
    raise ValueError("AI_EMBEDDING_PROVIDER must be 'gemini', 'groq', or 'mistral'.")
if not 0 <= settings.rag_min_confidence <= 1:
    raise ValueError("AI_RAG_MIN_CONFIDENCE must be between 0 and 1.")
if not 0 <= settings.min_similarity <= 1:
    raise ValueError("AI_MIN_SIMILARITY must be between 0 and 1.")
