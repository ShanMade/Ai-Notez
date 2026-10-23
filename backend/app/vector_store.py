from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import math
import os
import re
import sqlite3
import threading
from array import array
from html.parser import HTMLParser
from collections.abc import Awaitable, Callable, Sequence
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

import numpy as np
from fastapi import HTTPException
from usearch.index import Index

from .config import EMBEDDING, settings


# =============================================================================
# Keyword Search Utilities
# =============================================================================

# Task words and function words carry no retrieval signal. Dropping them keeps
# keyword scores comparable between notes instead of rewarding generic text.
_KEYWORD_STOPWORDS = frozenset(
    """
    a about above after again against all also am an and any are as at be because been before
    being below between both but by can cannot could did do does doing down during each few for
    from further had has have having he her here hers herself him himself his how i if in into is
    it its itself just me more most my myself no nor not now of off on once only or other our ours
    ourselves out over own same she should so some such than that the their theirs them themselves
    then there these they this those through to too under until up very was we were what when where
    which while who whom why will with would you your yours yourself yourselves
    answer brief briefly concise contain contains describe detail elaborate explain give list
    mention mentioned note notes please provide question say show summarize summary tell topic write
    wrote anything something everything thing things library
    """.split()
)

# Fraction of the query's meaningful terms that must appear in a note before it
# is eligible as a keyword-only retrieval candidate.
KEYWORD_ONLY_THRESHOLD = 0.5
# How much a keyword match can add on top of a cosine similarity. Keeping it
# below 1 keeps fused scores interpretable while still letting an exact
# identifier match outrank a weak semantic match.
KEYWORD_WEIGHT = 0.35
_IDENTIFIER = re.compile(r"\b[a-z]+[-_]?\d+[a-z0-9_-]*\b", re.I)


def _terms(text: str) -> set[str]:
    return {
        term
        for term in re.findall(r"[a-z0-9]+", text.lower())
        if len(term) > 2 and term not in _KEYWORD_STOPWORDS
    }


def content_terms(text: str) -> set[str]:
    """Meaningful lowercase terms in ``text`` (stop-words removed)."""
    return _terms(text)


def keyword_relevance(text: str, query: str) -> float:
    """Score keyword relevance in a bounded [0, 1] range.

    The previous implementation returned unbounded scores (one point per
    matching word) and was merged with cosine similarities of at most 1, so
    ordinary keyword hits always outranked strong semantic matches. Coverage of
    the query's meaningful terms keeps the two signals comparable.
    """
    if not text or not query:
        return 0.0
    query_terms = content_terms(query)
    if not query_terms:
        return 0.0
    text_lower = text.lower()
    text_terms = content_terms(text)
    if not text_terms:
        return 0.0

    coverage = len(query_terms & text_terms) / len(query_terms)
    bonus = 0.0
    for phrase in re.findall(r'"([^"]+)"', query):
        phrase = phrase.strip().lower()
        if phrase and phrase in text_lower:
            bonus += 0.25
    for identifier in set(_IDENTIFIER.findall(query)):
        if identifier.lower() in text_lower:
            bonus += 0.25
    return min(1.0, coverage + bonus)

logger = logging.getLogger(__name__)

CHUNK_SIZE = 1600
CHUNK_OVERLAP = 200
EMBED_BATCH_SIZE = 64


def user_key(uid: str) -> str:
    return hashlib.sha256(uid.encode("utf-8")).hexdigest()


class _ReadableHTML(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.skip = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() in {"script", "style", "noscript", "svg", "head"}:
            self.skip += 1
        elif not self.skip and tag.lower() in {"p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4", "section"}:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() in {"script", "style", "noscript", "svg", "head"} and self.skip:
            self.skip -= 1
        elif not self.skip and tag.lower() in {"p", "div", "li", "tr", "h1", "h2", "h3", "h4", "section"}:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self.skip and data.strip():
            self.parts.append(data.strip())


def _readable_text(value: object) -> str:
    if not isinstance(value, str):
        return ""
    value = value.strip()
    if not value:
        return ""
    if value[:1] in {"{", "["}:
        try:
            parsed = json.loads(value)
            values: list[str] = []
            def collect(item: object) -> None:
                if isinstance(item, dict):
                    for key, child in item.items():
                        if isinstance(child, (str, int, float, bool)):
                            values.append(f"{key}: {child}")
                        else:
                            collect(child)
                elif isinstance(item, list):
                    for child in item:
                        collect(child)
            collect(parsed)
            if values:
                return "\n".join(values)
        except (ValueError, TypeError):
            pass
    if "<" in value and ">" in value:
        parser = _ReadableHTML()
        try:
            parser.feed(value)
            extracted = " ".join(" ".join(parser.parts).split())
            if extracted:
                return extracted
        except (ValueError, TypeError):
            pass
    return value


EXTRA_TEXT_KEYS = ("plainText", "extractedText", "fileText", "transcript", "markdown", "content")


def note_body(note: dict) -> str:
    """Return only the readable content of a note (never its metadata).

    Metadata-only notes used to be embedded as a single chunk containing just a
    title and folder. Those chunks cannot answer content questions but can be
    returned as if they were note text, so indexing now requires real content.
    """
    body = _readable_text(note.get("body", ""))
    readable = _readable_text(note.get("htmlReadableText", ""))
    parts = [part for part in (body, readable) if part]
    if readable and body and readable in body:
        parts = [body]
    for key in EXTRA_TEXT_KEYS:
        extra = _readable_text(note.get(key, ""))
        if extra and extra not in parts:
            parts.append(extra)
    return "\n".join(parts).strip()[:200_000]


def has_indexable_content(note: dict) -> bool:
    return bool(note_body(note).strip())


def note_text(note: dict) -> str:
    """Full searchable text (metadata header plus content) used for chunks."""
    body = _readable_text(note.get("body", ""))
    readable = _readable_text(note.get("htmlReadableText", ""))
    extra_text = []
    for key in EXTRA_TEXT_KEYS:
        extra = _readable_text(note.get(key, ""))
        if extra and extra not in {body, readable}:
            extra_text.append(extra)
    if readable:
        body = f"{body}\n{readable}".strip()
    tags = note.get("tags", [])
    if not isinstance(tags, (list, tuple)):
        tags = []
    fields = [
        str(note.get("title") or "Untitled note"),
        str(note.get("subject") or ""),
        str(note.get("folderPath") or ""),
        " ".join(str(tag) for tag in tags if isinstance(tag, (str, int, float))),
        body,
        *extra_text,
    ]
    return "\n".join(part for part in fields if part).strip()[:200_000]


def note_metadata_prefix(note: dict) -> str:
    """The metadata lines ``note_text`` puts before a note's content."""
    tags = note.get("tags", [])
    if not isinstance(tags, (list, tuple)):
        tags = []
    fields = [
        str(note.get("title") or "Untitled note"),
        str(note.get("subject") or ""),
        str(note.get("folderPath") or ""),
        " ".join(str(tag) for tag in tags if isinstance(tag, (str, int, float))),
    ]
    return "\n".join(part for part in fields if part)


def strip_note_metadata(note: dict, chunk: str) -> str:
    """Remove the metadata header from a stored chunk.

    Chunks begin with title/subject/folder/tags because that text is embedded
    with the content. Retrieved excerpts already carry those attributes in
    their own header, so the prefix must not be repeated to the model.
    """
    prefix = " ".join(note_metadata_prefix(note).split())
    text = " ".join(str(chunk or "").split())
    if prefix and text.startswith(prefix):
        return text[len(prefix):].lstrip()
    return text


def split_chunks(text: str) -> list[str]:
    clean = " ".join(text.split())
    if not clean:
        return []
    chunks: list[str] = []
    start = 0
    while start < len(clean):
        end = min(len(clean), start + CHUNK_SIZE)
        if end < len(clean):
            boundary = clean.rfind(" ", start + CHUNK_SIZE // 2, end)
            if boundary > start:
                end = boundary
        chunks.append(clean[start:end].strip())
        if end >= len(clean):
            break
        start = max(start + 1, end - CHUNK_OVERLAP)
    return chunks


class HnswIndexManager:
    def __init__(self, data_dir: Path | None = None) -> None:
        self.data_dir = (data_dir or settings.data_dir).expanduser().resolve()
        self.database_path = self.data_dir / "notez-vectors.sqlite3"
        self.index_dir = self.data_dir / "indexes"
        self._locks: dict[str, asyncio.Lock] = {}
        self._lock_guard = threading.Lock()
        self._database_lock = threading.Lock()
        self._database_ready = False
        self._indexes: dict[str, tuple[Index, int]] = {}

    def _async_lock(self, owner_key: str) -> asyncio.Lock:
        with self._lock_guard:
            return self._locks.setdefault(owner_key, asyncio.Lock())

    def _initialize_database(self) -> None:
        if self._database_ready:
            return
        with self._database_lock:
            if self._database_ready:
                return
            self.data_dir.mkdir(parents=True, exist_ok=True)
            connection = sqlite3.connect(self.database_path, timeout=30)
            try:
                connection.execute("PRAGMA journal_mode=WAL")
                connection.executescript(
                    """
                    CREATE TABLE IF NOT EXISTS note_states (
                        owner_key TEXT NOT NULL,
                        note_id TEXT NOT NULL,
                        content_hash TEXT NOT NULL,
                        embedding_model TEXT NOT NULL,
                        chunk_count INTEGER NOT NULL,
                        PRIMARY KEY (owner_key, note_id)
                    );
                    CREATE TABLE IF NOT EXISTS note_chunks (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        owner_key TEXT NOT NULL,
                        note_id TEXT NOT NULL,
                        position INTEGER NOT NULL,
                        content_hash TEXT NOT NULL,
                        title TEXT NOT NULL,
                        folder_path TEXT NOT NULL,
                        chunk_text TEXT NOT NULL,
                        embedding BLOB NOT NULL,
                        UNIQUE (owner_key, note_id, position)
                    );
                    CREATE INDEX IF NOT EXISTS note_chunks_owner_note
                        ON note_chunks (owner_key, note_id);
                    CREATE TABLE IF NOT EXISTS index_revisions (
                        owner_key TEXT PRIMARY KEY,
                        revision INTEGER NOT NULL,
                        indexed_revision INTEGER NOT NULL
                    );
                    """
                )
            finally:
                connection.close()
            self._database_ready = True

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        self._initialize_database()
        connection = sqlite3.connect(self.database_path, timeout=30)
        connection.row_factory = sqlite3.Row
        try:
            yield connection
        finally:
            connection.close()

    def _index_path(self, owner_key: str) -> Path:
        return self.index_dir / f"{owner_key}.usearch"

    def _new_index(self) -> Index:
        return Index(ndim=EMBEDDING.dimensions, metric="cos", dtype="f32")

    def _reset_owner_index(self, owner_key: str) -> bool:
        """Drop a user's index when it was built with another embedding model.

        Without this, changing the embedding provider/model (which changes the
        vector size) left every stored vector unusable: the persisted HNSW file
        could not be restored and the SQLite blobs could not be re-added. The
        index now heals itself and is rebuilt by the next upsert/rebuild.
        """
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT states.embedding_model, length(chunks.embedding) AS size
                FROM note_chunks AS chunks
                JOIN note_states AS states
                  ON states.owner_key = chunks.owner_key AND states.note_id = chunks.note_id
                WHERE chunks.owner_key = ?
                LIMIT 1
                """,
                (owner_key,),
            ).fetchone()
            if row is None:
                return False
            if row["embedding_model"] == EMBEDDING.model and int(row["size"] or 0) == EMBEDDING.dimensions * 4:
                return False
            connection.execute("BEGIN IMMEDIATE")
            connection.execute("DELETE FROM note_chunks WHERE owner_key = ?", (owner_key,))
            connection.execute("DELETE FROM note_states WHERE owner_key = ?", (owner_key,))
            connection.execute("DELETE FROM index_revisions WHERE owner_key = ?", (owner_key,))
            connection.commit()
        self._indexes.pop(owner_key, None)
        try:
            self._index_path(owner_key).unlink(missing_ok=True)
        except OSError:
            pass
        logger.info("Reset semantic index %s after an embedding model or dimension change.", owner_key)
        return True

    @staticmethod
    def _encode_vector(vector: Sequence[float]) -> bytes:
        return array("f", vector).tobytes()

    @staticmethod
    def _decode_vector(vector: bytes) -> np.ndarray:
        values = array("f")
        values.frombytes(vector)
        return np.asarray(values, dtype=np.float32)

    def _revision(self, owner_key: str) -> tuple[int, int]:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT revision, indexed_revision FROM index_revisions WHERE owner_key = ?",
                (owner_key,),
            ).fetchone()
        return (int(row["revision"]), int(row["indexed_revision"])) if row else (0, 0)

    def _load_index_at_revision(self, owner_key: str, revision: int) -> Index | None:
        cached = self._indexes.get(owner_key)
        if cached and cached[1] == revision:
            return cached[0]
        current_revision, indexed_revision = self._revision(owner_key)
        path = self._index_path(owner_key)
        if current_revision >= revision and indexed_revision == revision and path.is_file():
            try:
                return Index.restore(str(path))
            except (OSError, RuntimeError, ValueError) as exc:
                logger.warning("Could not restore HNSW index %s; rebuilding from SQLite: %s", owner_key, exc)
        return None

    def _build_index_from_database(self, owner_key: str) -> Index:
        index = self._new_index()
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT id, embedding FROM note_chunks WHERE owner_key = ? ORDER BY id",
                (owner_key,),
            ).fetchall()
        if rows:
            keys = np.asarray([int(row["id"]) for row in rows], dtype=np.uint64)
            vectors = np.stack([self._decode_vector(row["embedding"]) for row in rows])
            index.add(keys, vectors)
        return index

    def _save_index(self, owner_key: str, index: Index, revision: int) -> None:
        self.index_dir.mkdir(parents=True, exist_ok=True)
        path = self._index_path(owner_key)
        temporary = path.with_name(f"{path.name}.tmp")
        index.save(str(temporary))
        os.replace(temporary, path)
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO index_revisions (owner_key, revision, indexed_revision)
                VALUES (?, ?, ?)
                ON CONFLICT(owner_key) DO UPDATE SET indexed_revision = excluded.indexed_revision
                """,
                (owner_key, revision, revision),
            )
            connection.commit()
        self._indexes[owner_key] = (index, revision)

    def _current_index(self, owner_key: str) -> tuple[Index, int]:
        revision, indexed_revision = self._revision(owner_key)
        cached = self._indexes.get(owner_key)
        if cached and cached[1] == revision:
            return cached
        path = self._index_path(owner_key)
        if indexed_revision == revision and path.is_file():
            try:
                index = Index.restore(str(path))
                self._indexes[owner_key] = (index, revision)
                return index, revision
            except (OSError, RuntimeError, ValueError) as exc:
                logger.warning("Could not restore HNSW index %s; rebuilding from SQLite: %s", owner_key, exc)
        index = self._build_index_from_database(owner_key)
        self._save_index(owner_key, index, revision)
        return index, revision

    def _apply_index_delta(
        self,
        owner_key: str,
        previous_revision: int,
        revision: int,
        removed_ids: list[int],
        added_ids: list[int],
        added_vectors: list[list[float]],
    ) -> None:
        index = self._load_index_at_revision(owner_key, previous_revision)
        if index is None:
            index = self._build_index_from_database(owner_key)
        else:
            if removed_ids:
                index.remove(np.asarray(removed_ids, dtype=np.uint64))
            if added_ids:
                index.add(
                    np.asarray(added_ids, dtype=np.uint64),
                    np.asarray(added_vectors, dtype=np.float32),
                )
        self._save_index(owner_key, index, revision)

    async def _embed(
        self,
        chunks: list[str],
        embed: Callable[[list[str]], Awaitable[list[list[float]]]],
    ) -> list[list[float]]:
        vectors: list[list[float]] = []
        for offset in range(0, len(chunks), EMBED_BATCH_SIZE):
            batch = chunks[offset:offset + EMBED_BATCH_SIZE]
            batch_vectors = await embed(batch)
            if len(batch_vectors) != len(batch):
                raise HTTPException(status_code=502, detail="Embedding count did not match the note's chunks.")
            for vector in batch_vectors:
                if (
                    not isinstance(vector, (list, tuple))
                    or len(vector) != EMBEDDING.dimensions
                    or any(
                        not isinstance(value, (int, float)) or not math.isfinite(value)
                        for value in vector
                    )
                ):
                    raise HTTPException(status_code=502, detail="The embedding provider returned an incompatible vector.")
                vectors.append([float(value) for value in vector])
        return vectors

    def _upsert_sync(
        self,
        owner_key: str,
        note_id: str,
        note: dict,
        digest: str,
        chunks: list[str],
        vectors: list[list[float]],
    ) -> bool:
        title = str(note.get("title") or "Untitled note")
        folder_path = str(note.get("folderPath") or "")
        with self._connect() as connection:
            previous_revision, _ = self._revision(owner_key)
            existing = connection.execute(
                "SELECT id FROM note_chunks WHERE owner_key = ? AND note_id = ? ORDER BY id",
                (owner_key, note_id),
            ).fetchall()
            removed_ids = [int(row["id"]) for row in existing]
            current = connection.execute(
                "SELECT 1 FROM note_states WHERE owner_key = ? AND note_id = ?",
                (owner_key, note_id),
            ).fetchone()
            if current is None:
                note_count = connection.execute(
                    "SELECT COUNT(*) FROM note_states WHERE owner_key = ?",
                    (owner_key,),
                ).fetchone()[0]
                if note_count >= settings.max_indexed_notes:
                    raise HTTPException(status_code=413, detail="This account has reached its indexed-note limit.")
            current_chunks = connection.execute(
                "SELECT COUNT(*) FROM note_chunks WHERE owner_key = ?",
                (owner_key,),
            ).fetchone()[0]
            if current_chunks - len(removed_ids) + len(chunks) > settings.max_chunks_per_user:
                raise HTTPException(status_code=413, detail="This user's semantic index has reached its configured chunk limit.")

            connection.execute("BEGIN IMMEDIATE")
            connection.execute(
                "DELETE FROM note_chunks WHERE owner_key = ? AND note_id = ?",
                (owner_key, note_id),
            )
            connection.execute(
                """
                INSERT INTO note_states (owner_key, note_id, content_hash, embedding_model, chunk_count)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(owner_key, note_id) DO UPDATE SET
                    content_hash = excluded.content_hash,
                    embedding_model = excluded.embedding_model,
                    chunk_count = excluded.chunk_count
                """,
                (owner_key, note_id, digest, EMBEDDING.model, len(chunks)),
            )
            added_ids: list[int] = []
            for position, (chunk, vector) in enumerate(zip(chunks, vectors, strict=True)):
                cursor = connection.execute(
                    """
                    INSERT INTO note_chunks (
                        owner_key, note_id, position, content_hash, title, folder_path, chunk_text, embedding
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        owner_key,
                        note_id,
                        position,
                        digest,
                        title,
                        folder_path,
                        chunk,
                        self._encode_vector(vector),
                    ),
                )
                added_ids.append(int(cursor.lastrowid))
            revision = previous_revision + 1
            connection.execute(
                """
                INSERT INTO index_revisions (owner_key, revision, indexed_revision)
                VALUES (?, ?, ?)
                ON CONFLICT(owner_key) DO UPDATE SET revision = excluded.revision
                """,
                (owner_key, revision, previous_revision),
            )
            connection.commit()

        self._apply_index_delta(owner_key, previous_revision, revision, removed_ids, added_ids, vectors)
        return True

    async def upsert(
        self,
        uid: str,
        note_id: str,
        note: dict,
        embed: Callable[[list[str]], Awaitable[list[list[float]]]],
    ) -> bool:
        if not has_indexable_content(note):
            # Metadata-only notes (title/folder/tags but no text) are not
            # searchable content: they must not create chunks.
            return await self.delete(uid, note_id)
        text = note_text(note)
        digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
        chunks = split_chunks(text)
        if len(chunks) > settings.max_chunks_per_user:
            raise HTTPException(status_code=413, detail="This note has too many chunks.")

        owner_key = user_key(uid)
        async with self._async_lock(owner_key):
            self._reset_owner_index(owner_key)
            with self._connect() as connection:
                state = connection.execute(
                    """
                    SELECT content_hash, embedding_model, chunk_count FROM note_states
                    WHERE owner_key = ? AND note_id = ?
                    """,
                    (owner_key, note_id),
                ).fetchone()
            if (
                state
                and state["content_hash"] == digest
                and state["embedding_model"] == EMBEDDING.model
                and state["chunk_count"] == len(chunks)
            ):
                return False
            vectors = await self._embed(chunks, embed)
            return await asyncio.to_thread(
                self._upsert_sync,
                owner_key,
                note_id,
                note,
                digest,
                chunks,
                vectors,
            )

    def _delete_sync(self, owner_key: str, note_id: str) -> bool:
        with self._connect() as connection:
            previous_revision, _ = self._revision(owner_key)
            rows = connection.execute(
                "SELECT id FROM note_chunks WHERE owner_key = ? AND note_id = ?",
                (owner_key, note_id),
            ).fetchall()
            state = connection.execute(
                "SELECT 1 FROM note_states WHERE owner_key = ? AND note_id = ?",
                (owner_key, note_id),
            ).fetchone()
            if not rows and state is None:
                return False
            removed_ids = [int(row["id"]) for row in rows]
            connection.execute("BEGIN IMMEDIATE")
            connection.execute(
                "DELETE FROM note_chunks WHERE owner_key = ? AND note_id = ?",
                (owner_key, note_id),
            )
            connection.execute(
                "DELETE FROM note_states WHERE owner_key = ? AND note_id = ?",
                (owner_key, note_id),
            )
            revision = previous_revision + 1
            connection.execute(
                """
                INSERT INTO index_revisions (owner_key, revision, indexed_revision)
                VALUES (?, ?, ?)
                ON CONFLICT(owner_key) DO UPDATE SET revision = excluded.revision
                """,
                (owner_key, revision, previous_revision),
            )
            connection.commit()
        self._apply_index_delta(owner_key, previous_revision, revision, removed_ids, [], [])
        return True

    async def delete(self, uid: str, note_id: str) -> bool:
        owner_key = user_key(uid)
        async with self._async_lock(owner_key):
            return await asyncio.to_thread(self._delete_sync, owner_key, note_id)

    def _rebuild_sync(
        self,
        owner_key: str,
        prepared: dict[str, tuple[dict, str, list[str], list[list[float]]]],
    ) -> None:
        with self._connect() as connection:
            previous_revision, _ = self._revision(owner_key)
            existing_notes = connection.execute(
                "SELECT note_id FROM note_states WHERE owner_key = ?",
                (owner_key,),
            ).fetchall()
            existing_ids = {
                str(row["note_id"]) for row in existing_notes
            }
            desired_ids = set(prepared)
            changed_ids = existing_ids - desired_ids
            removed_ids: list[int] = []
            for note_id in changed_ids:
                removed_ids.extend(
                    int(row["id"])
                    for row in connection.execute(
                        "SELECT id FROM note_chunks WHERE owner_key = ? AND note_id = ?",
                        (owner_key, note_id),
                    ).fetchall()
                )
            added_ids: list[int] = []
            added_vectors: list[list[float]] = []
            for note_id, (_, digest, chunks, vectors) in prepared.items():
                state = connection.execute(
                    """
                    SELECT content_hash, embedding_model, chunk_count FROM note_states
                    WHERE owner_key = ? AND note_id = ?
                    """,
                    (owner_key, note_id),
                ).fetchone()
                if (
                    state
                    and state["content_hash"] == digest
                    and state["embedding_model"] == EMBEDDING.model
                    and state["chunk_count"] == len(chunks)
                ):
                    continue
                old_rows = connection.execute(
                    "SELECT id FROM note_chunks WHERE owner_key = ? AND note_id = ?",
                    (owner_key, note_id),
                ).fetchall()
                removed_ids.extend(int(row["id"]) for row in old_rows)
                changed_ids.add(note_id)

            if not changed_ids and not removed_ids:
                return

            connection.execute("BEGIN IMMEDIATE")
            for note_id in changed_ids:
                connection.execute(
                    "DELETE FROM note_chunks WHERE owner_key = ? AND note_id = ?",
                    (owner_key, note_id),
                )
                if note_id not in desired_ids:
                    connection.execute(
                        "DELETE FROM note_states WHERE owner_key = ? AND note_id = ?",
                        (owner_key, note_id),
                    )
            for note_id, (note, digest, chunks, vectors) in prepared.items():
                if note_id not in changed_ids:
                    continue
                title = str(note.get("title") or "Untitled note")
                folder_path = str(note.get("folderPath") or "")
                connection.execute(
                    """
                    INSERT INTO note_states (owner_key, note_id, content_hash, embedding_model, chunk_count)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(owner_key, note_id) DO UPDATE SET
                        content_hash = excluded.content_hash,
                        embedding_model = excluded.embedding_model,
                        chunk_count = excluded.chunk_count
                    """,
                    (owner_key, note_id, digest, EMBEDDING.model, len(chunks)),
                )
                for position, (chunk, vector) in enumerate(zip(chunks, vectors, strict=True)):
                    cursor = connection.execute(
                        """
                        INSERT INTO note_chunks (
                            owner_key, note_id, position, content_hash, title, folder_path, chunk_text, embedding
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            owner_key,
                            note_id,
                            position,
                            digest,
                            title,
                            folder_path,
                            chunk,
                            self._encode_vector(vector),
                        ),
                    )
                    added_ids.append(int(cursor.lastrowid))
                    added_vectors.append(vector)

            revision = previous_revision + 1
            connection.execute(
                """
                INSERT INTO index_revisions (owner_key, revision, indexed_revision)
                VALUES (?, ?, ?)
                ON CONFLICT(owner_key) DO UPDATE SET revision = excluded.revision
                """,
                (owner_key, revision, previous_revision),
            )
            connection.commit()
        self._apply_index_delta(owner_key, previous_revision, revision, removed_ids, added_ids, added_vectors)

    async def rebuild(
        self,
        uid: str,
        notes: dict[str, dict],
        embed: Callable[[list[str]], Awaitable[list[list[float]]]],
    ) -> int:
        if len(notes) > settings.max_indexed_notes:
            raise HTTPException(status_code=413, detail="This account has more notes than the configured rebuild limit.")
        prepared: dict[str, tuple[dict, str, list[str], list[list[float]]]] = {}
        total_chunks = 0
        for note_id, note in notes.items():
            if not has_indexable_content(note):
                continue
            text = note_text(note)
            chunks = split_chunks(text)
            total_chunks += len(chunks)
            if total_chunks > settings.max_chunks_per_user:
                raise HTTPException(status_code=413, detail="The semantic index has reached its configured chunk limit.")
            if chunks:
                digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
                prepared[note_id] = (note, digest, chunks, [])

        owner_key = user_key(uid)
        async with self._async_lock(owner_key):
            self._reset_owner_index(owner_key)
            with self._connect() as connection:
                existing = {
                    str(row["note_id"]): row
                    for row in connection.execute(
                        """
                        SELECT note_id, content_hash, embedding_model, chunk_count FROM note_states
                        WHERE owner_key = ?
                        """,
                        (owner_key,),
                    ).fetchall()
                }
            chunks_to_embed: list[str] = []
            changed_notes: list[str] = []
            for note_id, (_, digest, chunks, _) in prepared.items():
                state = existing.get(note_id)
                if not (
                    state
                    and state["content_hash"] == digest
                    and state["embedding_model"] == EMBEDDING.model
                    and state["chunk_count"] == len(chunks)
                ):
                    changed_notes.append(note_id)
                    chunks_to_embed.extend(chunks)
            vectors = await self._embed(chunks_to_embed, embed)
            vector_offset = 0
            for note_id in changed_notes:
                note, digest, chunks, _ = prepared[note_id]
                prepared[note_id] = (
                    note,
                    digest,
                    chunks,
                    vectors[vector_offset:vector_offset + len(chunks)],
                )
                vector_offset += len(chunks)
            await asyncio.to_thread(self._rebuild_sync, owner_key, prepared)
        return total_chunks

    @staticmethod
    def _scope_clause(note_id: str | None, folder_path: str | None) -> tuple[str, list[str]]:
        clauses: list[str] = []
        params: list[str] = []
        if note_id:
            clauses.append("note_id = ?")
            params.append(note_id)
        if folder_path:
            clauses.append("folder_path = ?")
            params.append(folder_path)
        return (" AND " + " AND ".join(clauses) if clauses else ""), params

    def _scoped_search_sync(
        self,
        owner_key: str,
        vector: list[float],
        limit: int,
        note_id: str | None = None,
        folder_path: str | None = None,
    ) -> list[dict]:
        """Exact cosine search inside one note or folder.

        A global HNSW query oversampled only ``limit * 8`` chunks, so a
        note-scoped question ("chat with this note") could miss the open note
        entirely. Scoped searches are small, so they are scored directly.
        """
        scope, params = self._scope_clause(note_id, folder_path)
        with self._connect() as connection:
            rows = connection.execute(
                f"""
                SELECT id, note_id, content_hash, title, folder_path, chunk_text, embedding
                FROM note_chunks
                WHERE owner_key = ?{scope}
                LIMIT ?
                """,
                (owner_key, *params, settings.max_chunks_per_user),
            ).fetchall()
        if not rows:
            return []
        query = np.asarray(vector, dtype=np.float32)
        norm = float(np.linalg.norm(query))
        if norm == 0 or not math.isfinite(norm):
            return []
        query = query / norm
        matrix = np.stack([self._decode_vector(row["embedding"]) for row in rows]).astype(np.float32)
        norms = np.linalg.norm(matrix, axis=1)
        norms[norms == 0] = 1.0
        similarities = (matrix / norms[:, None]) @ query
        best_by_note: dict[str, dict] = {}
        for row, similarity in zip(rows, similarities.tolist(), strict=True):
            if not math.isfinite(similarity) or similarity < settings.min_similarity:
                continue
            note_key = str(row["note_id"])
            current = best_by_note.get(note_key)
            if current is None or similarity > current["similarity"]:
                best_by_note[note_key] = {
                    "id": note_key,
                    "title": str(row["title"] or "Untitled note"),
                    "folderPath": str(row["folder_path"] or ""),
                    "text": str(row["chunk_text"]),
                    "similarity": similarity,
                    "contentHash": str(row["content_hash"]),
                }
        return sorted(best_by_note.values(), key=lambda result: result["similarity"], reverse=True)[:limit]

    def _search_sync(
        self,
        owner_key: str,
        vector: list[float],
        limit: int,
        note_id: str | None = None,
        folder_path: str | None = None,
    ) -> list[dict]:
        self._reset_owner_index(owner_key)
        if note_id or folder_path:
            return self._scoped_search_sync(owner_key, vector, limit, note_id, folder_path)
        index, _ = self._current_index(owner_key)
        if index.size == 0:
            return []
        matches = index.search(np.asarray(vector, dtype=np.float32), count=min(limit * 8, settings.max_chunks_per_user))
        keys = [int(key) for key in matches.keys.tolist()]
        distances = [float(distance) for distance in matches.distances.tolist()]
        if not keys:
            return []
        placeholders = ",".join("?" for _ in keys)
        with self._connect() as connection:
            rows = connection.execute(
                f"""
                SELECT id, note_id, content_hash, title, folder_path, chunk_text
                FROM note_chunks
                WHERE owner_key = ? AND id IN ({placeholders})
                """,
                (owner_key, *keys),
            ).fetchall()
        by_id = {int(row["id"]): row for row in rows}
        best_by_note: dict[str, dict] = {}
        for chunk_id, distance in zip(keys, distances, strict=True):
            row = by_id.get(chunk_id)
            if row is None:
                continue
            similarity = 1 - distance
            if not math.isfinite(similarity) or similarity < settings.min_similarity:
                continue
            note_key = str(row["note_id"])
            result = {
                "id": note_key,
                "title": str(row["title"] or "Untitled note"),
                "folderPath": str(row["folder_path"] or ""),
                "text": str(row["chunk_text"]),
                "similarity": similarity,
                "contentHash": str(row["content_hash"]),
            }
            current = best_by_note.get(note_key)
            if current is None or similarity > current["similarity"]:
                best_by_note[note_key] = result
        return sorted(
            best_by_note.values(),
            key=lambda result: result["similarity"],
            reverse=True,
        )[:limit]

    def _keyword_sync(
        self,
        owner_key: str,
        query_text: str,
        limit: int,
        note_id: str | None = None,
        folder_path: str | None = None,
    ) -> list[dict]:
        scope, params = self._scope_clause(note_id, folder_path)
        with self._connect() as connection:
            rows = connection.execute(
                f"""
                SELECT id, note_id, content_hash, title, folder_path, chunk_text
                FROM note_chunks
                WHERE owner_key = ?{scope}
                LIMIT ?
                """,
                (owner_key, *params, settings.max_chunks_per_user),
            ).fetchall()
        best_by_note: dict[str, dict] = {}
        for row in rows:
            score = keyword_relevance(str(row["chunk_text"]), query_text)
            if score < KEYWORD_ONLY_THRESHOLD:
                continue
            note_key = str(row["note_id"])
            current = best_by_note.get(note_key)
            if current is None or score > current["keywordScore"]:
                best_by_note[note_key] = {
                    "id": note_key,
                    "title": str(row["title"] or "Untitled note"),
                    "folderPath": str(row["folder_path"] or ""),
                    "text": str(row["chunk_text"]),
                    "keywordScore": score,
                    "contentHash": str(row["content_hash"]),
                    "is_keyword_match": True,
                }
        return sorted(best_by_note.values(), key=lambda result: result["keywordScore"], reverse=True)[:limit]

    @staticmethod
    def _fuse(semantic: list[dict], keyword: list[dict], limit: int) -> list[dict]:
        """Merge semantic and keyword hits on one comparable score scale."""
        best: dict[str, dict] = {}
        for result in semantic:
            item = dict(result)
            item["keywordScore"] = 0.0
            item["score"] = item["similarity"]
            best[item["id"]] = item
        for result in keyword:
            note_key = result["id"]
            existing = best.get(note_key)
            if existing is None:
                item = dict(result)
                item["similarity"] = 0.0
                item["score"] = KEYWORD_WEIGHT * item["keywordScore"]
                best[note_key] = item
            else:
                existing["keywordScore"] = max(existing["keywordScore"], result["keywordScore"])
                # Prefer the keyword chunk only when it is better evidence than
                # the semantically matched chunk for this note.
                if result["keywordScore"] > existing["similarity"]:
                    existing["text"] = result["text"]
                existing["score"] = existing["similarity"] + KEYWORD_WEIGHT * existing["keywordScore"]
        return sorted(best.values(), key=lambda item: item["score"], reverse=True)[:limit]

    async def search(
        self,
        uid: str,
        vector: list[float],
        limit: int,
        query_text: str = "",
        note_id: str | None = None,
        folder_path: str | None = None,
    ) -> list[dict]:
        if (
            not isinstance(vector, (list, tuple))
            or len(vector) != EMBEDDING.dimensions
            or any(
                not isinstance(value, (int, float)) or not math.isfinite(value)
                for value in vector
            )
        ):
            raise HTTPException(status_code=502, detail="The query embedding has an incompatible vector dimension.")
        owner_key = user_key(uid)
        async with self._async_lock(owner_key):
            # SQLite scans stay off the event loop; the previous keyword pass
            # read up to max_chunks_per_user rows synchronously.
            semantic = await asyncio.to_thread(
                self._search_sync, owner_key, vector, limit, note_id, folder_path
            )
            if not query_text:
                return semantic
            keyword = await asyncio.to_thread(
                self._keyword_sync, owner_key, query_text, limit, note_id, folder_path
            )
            return self._fuse(semantic, keyword, limit)

    def get_note_state(self, uid: str, note_id: str) -> dict[str, Any] | None:
        """
        Get the current state of a note in the index.
        
        Args:
            uid: User ID
            note_id: Note ID
            
        Returns:
            Dictionary with note state or None if not indexed
        """
        owner_key = user_key(uid)
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT content_hash, embedding_model, chunk_count
                FROM note_states
                WHERE owner_key = ? AND note_id = ?
                """,
                (owner_key, note_id),
            ).fetchone()
        
        if not row:
            return None
        
        return {
            "content_hash": str(row["content_hash"]),
            "embedding_model": str(row["embedding_model"]),
            "chunk_count": int(row["chunk_count"]),
        }

    def get_index_stats(self, uid: str) -> dict[str, Any]:
        """
        Get index statistics for a user.
        
        Args:
            uid: User ID
            
        Returns:
            Dictionary with index statistics
        """
        owner_key = user_key(uid)
        
        with self._connect() as connection:
            # Get note count
            note_count = connection.execute(
                "SELECT COUNT(*) FROM note_states WHERE owner_key = ?",
                (owner_key,),
            ).fetchone()[0]
            
            # Get chunk count
            chunk_count = connection.execute(
                "SELECT COUNT(*) FROM note_chunks WHERE owner_key = ?",
                (owner_key,),
            ).fetchone()[0]
            
            # Get index revision
            revision_row = connection.execute(
                "SELECT revision, indexed_revision FROM index_revisions WHERE owner_key = ?",
                (owner_key,),
            ).fetchone()
        
        return {
            "note_count": int(note_count),
            "chunk_count": int(chunk_count),
            "revision": int(revision_row["revision"]) if revision_row else 0,
            "indexed_revision": int(revision_row["indexed_revision"]) if revision_row else 0,
        }

    def list_indexed_notes(self, uid: str, limit: int = 1000, offset: int = 0) -> list[dict[str, Any]]:
        """
        List indexed notes for a user with pagination.
        
        Args:
            uid: User ID
            limit: Maximum number of notes to return
            offset: Offset for pagination
            
        Returns:
            List of indexed note metadata
        """
        owner_key = user_key(uid)
        
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT note_id, content_hash, embedding_model, chunk_count
                FROM note_states
                WHERE owner_key = ?
                ORDER BY note_id
                LIMIT ? OFFSET ?
                """,
                (owner_key, limit, offset),
            ).fetchall()
        
        notes = []
        for row in rows:
            notes.append({
                "note_id": str(row["note_id"]),
                "content_hash": str(row["content_hash"]),
                "embedding_model": str(row["embedding_model"]),
                "chunk_count": int(row["chunk_count"]),
            })
        
        return notes
