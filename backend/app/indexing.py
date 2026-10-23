"""
NoteZ Knowledge Index - Indexing Service

This module provides the central indexing orchestration for the NoteZ knowledge base.
It handles:
- Indexing queue management
- Backfill orchestration
- Status tracking
- Hybrid search (semantic + keyword)
- Retrieval metadata logging
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
import sqlite3
import time
from collections.abc import Awaitable, Callable
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

from .config import EMBEDDING, settings
from .vector_store import HnswIndexManager, has_indexable_content, user_key

logger = logging.getLogger(__name__)


# =============================================================================
# Indexing Queue and Status Tracking
# =============================================================================

@dataclass
class IndexingJob:
    """Represents a job in the indexing queue."""
    id: str
    owner_key: str
    note_id: str
    operation: str  # 'index', 'delete', 'reindex'
    status: str  # 'pending', 'processing', 'failed', 'completed'
    retry_count: int = 0
    error_message: str | None = None
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    content_hash: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class IndexingStats:
    """Indexing statistics for a user."""
    owner_key: str
    total_notes: int = 0
    indexed_notes: int = 0
    pending_notes: int = 0
    failed_notes: int = 0
    total_chunks: int = 0
    last_backfill_at: float | None = None
    last_indexed_at: float | None = None
    backfill_completed: bool = False
    embedding_model: str = ""
    index_version: str = "1.0.0"


class IndexingQueue:
    """
    Manages the indexing queue and status for users.
    Uses SQLite for persistence across restarts.
    """

    def __init__(self, data_dir: Path | None = None) -> None:
        self.data_dir = (data_dir or settings.data_dir).expanduser().resolve()
        self.queue_path = self.data_dir / "notez-indexing-queue.sqlite3"
        self._lock = asyncio.Lock()
        self._initialized = False

    def _initialize(self) -> None:
        if self._initialized:
            return
        self.data_dir.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.queue_path, timeout=30)
        try:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS indexing_queue (
                    id TEXT PRIMARY KEY,
                    owner_key TEXT NOT NULL,
                    note_id TEXT NOT NULL,
                    operation TEXT NOT NULL,
                    status TEXT NOT NULL,
                    retry_count INTEGER NOT NULL DEFAULT 0,
                    error_message TEXT,
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL,
                    content_hash TEXT,
                    metadata_json TEXT NOT NULL DEFAULT '{}'
                );
                CREATE INDEX IF NOT EXISTS idx_queue_owner ON indexing_queue(owner_key);
                CREATE INDEX IF NOT EXISTS idx_queue_status ON indexing_queue(status);
                CREATE INDEX IF NOT EXISTS idx_queue_note ON indexing_queue(owner_key, note_id);
                
                CREATE TABLE IF NOT EXISTS indexing_stats (
                    owner_key TEXT PRIMARY KEY,
                    total_notes INTEGER NOT NULL DEFAULT 0,
                    indexed_notes INTEGER NOT NULL DEFAULT 0,
                    pending_notes INTEGER NOT NULL DEFAULT 0,
                    failed_notes INTEGER NOT NULL DEFAULT 0,
                    total_chunks INTEGER NOT NULL DEFAULT 0,
                    last_backfill_at REAL,
                    last_indexed_at REAL,
                    backfill_completed BOOLEAN NOT NULL DEFAULT FALSE,
                    embedding_model TEXT NOT NULL DEFAULT '',
                    index_version TEXT NOT NULL DEFAULT '1.0.0'
                );
                """
            )
            connection.commit()
        finally:
            connection.close()
        self._initialized = True

    @contextmanager
    def _connect(self) -> Any:
        self._initialize()
        connection = sqlite3.connect(self.queue_path, timeout=30)
        connection.row_factory = sqlite3.Row
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    async def enqueue(
        self,
        uid: str,
        note_id: str,
        operation: str = "index",
        content_hash: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> IndexingJob:
        """
        Add a job to the indexing queue.
        
        Args:
            uid: User ID
            note_id: Note ID to index
            operation: 'index', 'delete', or 'reindex'
            content_hash: SHA-256 hash of content for deduplication
            metadata: Additional metadata for the job
            
        Returns:
            The created job
        """
        owner_key = user_key(uid)
        job_id = hashlib.sha256(f"{owner_key}:{note_id}:{time.time()}".encode()).hexdigest()[:32]
        now = time.time()
        
        job = IndexingJob(
            id=job_id,
            owner_key=owner_key,
            note_id=note_id,
            operation=operation,
            status="pending",
            retry_count=0,
            error_message=None,
            created_at=now,
            updated_at=now,
            content_hash=content_hash,
            metadata=metadata or {},
        )
        
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO indexing_queue (
                    id, owner_key, note_id, operation, status, retry_count,
                    error_message, created_at, updated_at, content_hash, metadata_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    job.id,
                    job.owner_key,
                    job.note_id,
                    job.operation,
                    job.status,
                    job.retry_count,
                    job.error_message,
                    job.created_at,
                    job.updated_at,
                    job.content_hash,
                    json.dumps(job.metadata),
                ),
            )
        
        await self._ensure_stats(owner_key)
        return job

    async def dequeue(self, uid: str, limit: int = 10) -> list[IndexingJob]:
        """
        Get pending jobs for a user and mark them as processing.
        
        Args:
            uid: User ID
            limit: Maximum number of jobs to dequeue
            
        Returns:
            List of jobs to process
        """
        owner_key = user_key(uid)
        now = time.time()
        
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT * FROM indexing_queue
                WHERE owner_key = ? AND status = 'pending'
                ORDER BY created_at ASC
                LIMIT ?
                """,
                (owner_key, limit),
            ).fetchall()
            
            if not rows:
                return []
            
            # Mark as processing
            job_ids = [str(row["id"]) for row in rows]
            conn.execute(
                """
                UPDATE indexing_queue
                SET status = 'processing', updated_at = ?, retry_count = retry_count + 1
                WHERE id IN ({})
                """.format(",".join("?" * len(job_ids))),
                (now, *job_ids),
            )
        
        jobs = []
        for row in rows:
            job = IndexingJob(
                id=str(row["id"]),
                owner_key=str(row["owner_key"]),
                note_id=str(row["note_id"]),
                operation=str(row["operation"]),
                status="processing",
                retry_count=int(row["retry_count"]) + 1,
                error_message=str(row["error_message"]) if row["error_message"] else None,
                created_at=float(row["created_at"]),
                updated_at=now,
                content_hash=str(row["content_hash"]) if row["content_hash"] else None,
                metadata=json.loads(str(row["metadata_json"])) if row["metadata_json"] else {},
            )
            jobs.append(job)
        
        return jobs

    async def complete(self, job_id: str, uid: str) -> bool:
        """
        Mark a job as completed.
        
        Args:
            job_id: Job ID
            uid: User ID (for verification)
            
        Returns:
            True if job was updated
        """
        owner_key = user_key(uid)
        now = time.time()
        
        with self._connect() as conn:
            cursor = conn.execute(
                """
                UPDATE indexing_queue
                SET status = 'completed', updated_at = ?, error_message = NULL
                WHERE id = ? AND owner_key = ?
                """,
                (now, job_id, owner_key),
            )
            updated = cursor.rowcount > 0
        
        if updated:
            await self._mark_indexed(owner_key)
        
        return updated

    async def fail(
        self,
        job_id: str,
        uid: str,
        error_message: str,
        retry: bool = True,
    ) -> bool:
        """
        Mark a job as failed.
        
        Args:
            job_id: Job ID
            uid: User ID (for verification)
            error_message: Error description
            retry: Whether to allow retry
            
        Returns:
            True if job was updated
        """
        owner_key = user_key(uid)
        now = time.time()
        max_retries = 5
        
        with self._connect() as conn:
            # Check current retry count
            row = conn.execute(
                "SELECT retry_count FROM indexing_queue WHERE id = ? AND owner_key = ?",
                (job_id, owner_key),
            ).fetchone()
            
            if not row:
                return False
            
            current_retries = int(row["retry_count"])

            if current_retries >= max_retries or not retry:
                status = "failed"
            else:
                # Allow retry
                status = "pending"
            
            conn.execute(
                """
                UPDATE indexing_queue
                SET status = ?, updated_at = ?, error_message = ?, retry_count = retry_count + 1
                WHERE id = ? AND owner_key = ?
                """,
                (status, now, error_message[:500], job_id, owner_key),
            )
        
        await self._ensure_stats(owner_key)
        return True

    async def get_status(self, uid: str) -> IndexingStats:
        """Return live queue statistics.

        Counters used to be incremented and decremented in place, which drifted
        (negative pending counts, totals that never reset). The queue table is
        now the source of truth, with one status per note (its newest job).
        """
        owner_key = user_key(uid)

        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT status, COUNT(*) AS total FROM (
                    SELECT note_id, status,
                           ROW_NUMBER() OVER (
                               PARTITION BY note_id ORDER BY created_at DESC, id DESC
                           ) AS position
                    FROM indexing_queue
                    WHERE owner_key = ?
                )
                WHERE position = 1
                GROUP BY status
                """,
                (owner_key,),
            ).fetchall()
            counts = {str(row["status"]): int(row["total"]) for row in rows}
            record = conn.execute(
                "SELECT * FROM indexing_stats WHERE owner_key = ?",
                (owner_key,),
            ).fetchone()

        total_notes = sum(counts.values())
        return IndexingStats(
            owner_key=owner_key,
            total_notes=total_notes,
            indexed_notes=counts.get("completed", 0),
            pending_notes=counts.get("pending", 0),
            failed_notes=counts.get("failed", 0),
            total_chunks=int(record["total_chunks"]) if record else 0,
            last_backfill_at=float(record["last_backfill_at"]) if record and record["last_backfill_at"] else None,
            last_indexed_at=float(record["last_indexed_at"]) if record and record["last_indexed_at"] else None,
            backfill_completed=bool(record["backfill_completed"]) if record else False,
            embedding_model=str(record["embedding_model"]) if record else "",
            index_version=str(record["index_version"]) if record else "1.0.0",
        )

    async def get_backfill_record(self, uid: str) -> dict[str, Any]:
        """Return the stored result of the last backfill run."""
        owner_key = user_key(uid)
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM indexing_stats WHERE owner_key = ?",
                (owner_key,),
            ).fetchone()
        if not row:
            return {}
        return {
            "total_notes": int(row["total_notes"]),
            "indexed_notes": int(row["indexed_notes"]),
            "pending_notes": int(row["pending_notes"]),
            "failed_notes": int(row["failed_notes"]),
            "last_backfill_at": float(row["last_backfill_at"]) if row["last_backfill_at"] else None,
            "backfill_completed": bool(row["backfill_completed"]),
            "embedding_model": str(row["embedding_model"]),
            "index_version": str(row["index_version"]),
        }

    async def _ensure_stats(self, owner_key: str) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO indexing_stats (owner_key) VALUES (?)
                ON CONFLICT(owner_key) DO NOTHING
                """,
                (owner_key,),
            )

    async def _mark_indexed(self, owner_key: str) -> None:
        await self._ensure_stats(owner_key)
        with self._connect() as conn:
            conn.execute(
                "UPDATE indexing_stats SET last_indexed_at = ? WHERE owner_key = ?",
                (time.time(), owner_key),
            )

    async def get_pending_count(self, uid: str) -> int:
        """Get the number of pending jobs for a user."""
        owner_key = user_key(uid)
        
        with self._connect() as conn:
            row = conn.execute(
                "SELECT COUNT(*) as count FROM indexing_queue WHERE owner_key = ? AND status = 'pending'",
                (owner_key,),
            ).fetchone()
            return int(row["count"]) if row else 0

    async def clear_queue(self, uid: str) -> int:
        """
        Clear all pending jobs for a user.
        
        Returns:
            Number of jobs cleared
        """
        owner_key = user_key(uid)
        
        with self._connect() as conn:
            cursor = conn.execute(
                "DELETE FROM indexing_queue WHERE owner_key = ? AND status = 'pending'",
                (owner_key,),
            )
            count = cursor.rowcount
        
        await self._ensure_stats(owner_key)
        return count


# =============================================================================
# Backfill Orchestrator
# =============================================================================

class BackfillOrchestrator:
    """
    Orchestrates the backfill of existing notes into the vector index.
    """

    def __init__(
        self,
        index_manager: HnswIndexManager,
        queue: IndexingQueue,
    ) -> None:
        self.index_manager = index_manager
        self.queue = queue
        self._backfill_locks: dict[str, asyncio.Lock] = {}

    def _get_lock(self, owner_key: str) -> asyncio.Lock:
        # Runs on the single application event loop, so a plain setdefault is
        # atomic enough. The previous coroutine was used with ``async with``
        # directly, which raised TypeError and broke every backfill request.
        return self._backfill_locks.setdefault(owner_key, asyncio.Lock())

    async def backfill_user(
        self,
        uid: str,
        notes: dict[str, dict],
        embed: Callable[[list[str]], Awaitable[list[list[float]]]],
        batch_size: int = 10,
        force: bool = False,
    ) -> dict[str, Any]:
        """
        Backfill all notes for a user.

        Args:
            uid: User ID
            notes: Dictionary of note_id -> note data
            embed: Function to generate embeddings
            batch_size: Number of notes to process in each batch
            force: Force re-indexing even if already indexed

        Returns:
            Dictionary with backfill statistics
        """
        owner_key = user_key(uid)

        # Serialize concurrent backfills for the same user.
        async with self._get_lock(owner_key):
            record = await self.queue.get_backfill_record(uid)
            if record.get("backfill_completed") and not force:
                return {
                    "status": "already_completed",
                    "total_notes": record.get("total_notes", len(notes)),
                    "indexed_notes": record.get("indexed_notes", 0),
                    "processed": 0,
                    "skipped": 0,
                    "failed": 0,
                    "elapsed_seconds": 0.0,
                    "completed_at": None,
                    "message": "Backfill already completed for this user.",
                }

            total_notes = len(notes)
            processed = 0
            failed = 0
            skipped = 0
            errors: list[dict[str, str]] = []
            start_time = time.time()

            note_items = list(notes.items())
            for offset in range(0, len(note_items), max(1, batch_size)):
                batch = note_items[offset:offset + max(1, batch_size)]

                for note_id, note in batch:
                    if not has_indexable_content(note):
                        skipped += 1
                        continue
                    try:
                        # upsert already compares the stored content hash and
                        # embedding model, so the duplicate state check (and its
                        # swallowed exceptions) is gone.
                        if force:
                            # A forced backfill must re-embed even unchanged
                            # notes; upsert is idempotent by content hash.
                            await self.index_manager.delete(uid, note_id)
                        changed = await self.index_manager.upsert(uid, note_id, note, embed)
                        if changed:
                            processed += 1
                        else:
                            skipped += 1
                    except Exception as exc:
                        failed += 1
                        if len(errors) < 10:
                            errors.append({"note_id": note_id, "error": str(exc)[:200]})
                        logger.error("Failed to index note %s: %s", note_id, type(exc).__name__)

                done = processed + skipped + failed
                elapsed = time.time() - start_time
                logger.info(
                    "Backfill progress for %s: %s/%s (%.1f%%) in %.1fs",
                    owner_key,
                    done,
                    total_notes,
                    (done / total_notes * 100) if total_notes else 100.0,
                    elapsed,
                )

            now = time.time()
            with self.queue._connect() as conn:
                conn.execute(
                    """
                    INSERT INTO indexing_stats (
                        owner_key, total_notes, indexed_notes, pending_notes,
                        failed_notes, last_backfill_at, backfill_completed,
                        embedding_model, index_version
                    ) VALUES (?, ?, ?, 0, ?, ?, TRUE, ?, ?)
                    ON CONFLICT(owner_key) DO UPDATE SET
                        total_notes = excluded.total_notes,
                        indexed_notes = excluded.indexed_notes,
                        pending_notes = 0,
                        failed_notes = excluded.failed_notes,
                        last_backfill_at = excluded.last_backfill_at,
                        backfill_completed = TRUE,
                        embedding_model = excluded.embedding_model,
                        index_version = excluded.index_version
                    """,
                    (
                        owner_key,
                        total_notes,
                        processed,
                        failed,
                        now,
                        EMBEDDING.model,
                        "1.0.0",
                    ),
                )

            return {
                "status": "completed",
                "total_notes": total_notes,
                "processed": processed,
                "skipped": skipped,
                "failed": failed,
                "errors": errors,
                "elapsed_seconds": time.time() - start_time,
                "completed_at": datetime.fromtimestamp(now).isoformat(),
            }

    async def get_backfill_status(self, uid: str) -> dict[str, Any]:
        """
        Get the current backfill status for a user.

        Args:
            uid: User ID

        Returns:
            Dictionary with backfill status
        """
        record = await self.queue.get_backfill_record(uid)
        last_backfill_at = record.get("last_backfill_at")
        return {
            "backfill_completed": bool(record.get("backfill_completed")),
            "last_backfill_at": datetime.fromtimestamp(last_backfill_at).isoformat() if last_backfill_at else None,
            "total_notes": int(record.get("total_notes") or 0),
            "indexed_notes": int(record.get("indexed_notes") or 0),
            "pending_notes": int(record.get("pending_notes") or 0),
            "failed_notes": int(record.get("failed_notes") or 0),
            "embedding_model": str(record.get("embedding_model") or ""),
            "index_version": str(record.get("index_version") or "1.0.0"),
        }


# =============================================================================
# Retrieval Metadata Logging
# =============================================================================

@dataclass
class RetrievalMetadata:
    """Metadata about a retrieval operation."""
    query: str
    query_hash: str
    retrieval_method: str  # 'none', 'keyword', 'semantic', 'hybrid', 'full_document'
    search_scope: str  # 'all', 'folder', 'note', 'selection'
    authorized_source_count: int
    candidates_retrieved: int
    final_chunks_used: int
    sources_used: list[dict[str, Any]]
    embedding_model: str
    embedding_dimensions: int
    index_version: str
    indexing_status: str  # 'complete', 'partial', 'pending', 'failed'
    used_retrieved_context: bool
    context_window_used: int
    retrieval_time_ms: float
    total_time_ms: float
    timestamp: float
    user_id: str


class RetrievalLogger:
    """
    Logs retrieval metadata for transparency and debugging.
    """

    def __init__(self, data_dir: Path | None = None) -> None:
        self.data_dir = (data_dir or settings.data_dir).expanduser().resolve()
        self.log_path = self.data_dir / "notez-retrieval-logs.sqlite3"
        self._initialized = False

    def _initialize(self) -> None:
        if self._initialized:
            return
        self.data_dir.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.log_path, timeout=30)
        try:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS retrieval_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    query_hash TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    retrieval_method TEXT NOT NULL,
                    search_scope TEXT NOT NULL,
                    authorized_source_count INTEGER NOT NULL,
                    candidates_retrieved INTEGER NOT NULL,
                    final_chunks_used INTEGER NOT NULL,
                    sources_used_json TEXT NOT NULL,
                    embedding_model TEXT NOT NULL,
                    embedding_dimensions INTEGER NOT NULL,
                    index_version TEXT NOT NULL,
                    indexing_status TEXT NOT NULL,
                    used_retrieved_context BOOLEAN NOT NULL,
                    context_window_used INTEGER NOT NULL,
                    retrieval_time_ms INTEGER NOT NULL,
                    total_time_ms INTEGER NOT NULL,
                    timestamp REAL NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_retrieval_user ON retrieval_logs(user_id);
                CREATE INDEX IF NOT EXISTS idx_retrieval_hash ON retrieval_logs(query_hash);
                CREATE INDEX IF NOT EXISTS idx_retrieval_timestamp ON retrieval_logs(timestamp);
                """
            )
            connection.commit()
        finally:
            connection.close()
        self._initialized = True

    @contextmanager
    def _connect(self) -> Any:
        self._initialize()
        connection = sqlite3.connect(self.log_path, timeout=30)
        connection.row_factory = sqlite3.Row
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def log(self, metadata: RetrievalMetadata) -> str:
        """
        Log a retrieval operation.
        
        Args:
            metadata: RetrievalMetadata to log
            
        Returns:
            The generated log ID
        """
        with self._connect() as conn:
            cursor = conn.execute(
                """
                INSERT INTO retrieval_logs (
                    query_hash, user_id, retrieval_method, search_scope,
                    authorized_source_count, candidates_retrieved, final_chunks_used,
                    sources_used_json, embedding_model, embedding_dimensions,
                    index_version, indexing_status, used_retrieved_context,
                    context_window_used, retrieval_time_ms, total_time_ms, timestamp
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    metadata.query_hash,
                    metadata.user_id,
                    metadata.retrieval_method,
                    metadata.search_scope,
                    metadata.authorized_source_count,
                    metadata.candidates_retrieved,
                    metadata.final_chunks_used,
                    json.dumps(metadata.sources_used),
                    metadata.embedding_model,
                    metadata.embedding_dimensions,
                    metadata.index_version,
                    metadata.indexing_status,
                    metadata.used_retrieved_context,
                    metadata.context_window_used,
                    int(metadata.retrieval_time_ms),
                    int(metadata.total_time_ms),
                    metadata.timestamp,
                ),
            )
            return str(cursor.lastrowid)

    def get_logs(
        self,
        uid: str,
        limit: int = 100,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        """
        Get retrieval logs for a user.
        
        Args:
            uid: User ID
            limit: Maximum number of logs to return
            offset: Offset for pagination
            
        Returns:
            List of retrieval log entries
        """
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT * FROM retrieval_logs
                WHERE user_id = ?
                ORDER BY timestamp DESC
                LIMIT ? OFFSET ?
                """,
                (uid, limit, offset),
            ).fetchall()
        
        logs = []
        for row in rows:
            logs.append({
                "id": int(row["id"]),
                "user_id": str(row["user_id"]),
                "query_hash": str(row["query_hash"]),
                "retrieval_method": str(row["retrieval_method"]),
                "search_scope": str(row["search_scope"]),
                "authorized_source_count": int(row["authorized_source_count"]),
                "candidates_retrieved": int(row["candidates_retrieved"]),
                "final_chunks_used": int(row["final_chunks_used"]),
                "sources_used": json.loads(str(row["sources_used_json"])),
                "embedding_model": str(row["embedding_model"]),
                "embedding_dimensions": int(row["embedding_dimensions"]),
                "index_version": str(row["index_version"]),
                "indexing_status": str(row["indexing_status"]),
                "used_retrieved_context": bool(row["used_retrieved_context"]),
                "context_window_used": int(row["context_window_used"]),
                "retrieval_time_ms": int(row["retrieval_time_ms"]),
                "total_time_ms": int(row["total_time_ms"]),
                "timestamp": float(row["timestamp"]),
            })
        
        return logs


# =============================================================================
# Content Filtering
# =============================================================================

def sanitize_for_indexing(text: str) -> str:
    """
    Remove potentially sensitive information from text before indexing.
    
    Args:
        text: Text to sanitize
        
    Returns:
        Sanitized text safe for indexing
    """
    if not text:
        return text
    
    # Specific credential formats must run before the generic catch-all,
    # otherwise every key is reported as the same unhelpful [REDACTED_KEY].
    secret_patterns = [
        # Private keys
        (r"-----BEGIN\s+(?:RSA\s+|EC\s+|DSA\s+|OPENSSH\s+)?PRIVATE\s+KEY-----", "[REDACTED_PRIVATE_KEY]"),

        # Known provider formats
        (r"sk-[a-zA-Z0-9]{20,}", "[REDACTED_OPENAI_KEY]"),
        (r"xox[baprs]-[a-zA-Z0-9]{10,}", "[REDACTED_SLACK_TOKEN]"),
        (r"AKIA[0-9A-Z]{16}", "[REDACTED_AWS_KEY]"),
        (r"pkey-[a-zA-Z0-9]{20,}", "[REDACTED_PKEY]"),
        (r"Bearer\s+[A-Za-z0-9\-_]+", "[REDACTED_TOKEN]"),

        # Labelled secrets: keep the label and quotes, replace only the value.
        (
            r"(?P<label>(?:api[_-]?key|secret[_-]?key|password|token|client[_-]?secret)(?:\s*[:=]\s*))"
            r"(?P<quote>[\"']?)[A-Za-z0-9\-_.]{16,}(?P=quote)",
            r"\g<label>\g<quote>[REDACTED_KEY]\g<quote>",
        ),

        # Generic long tokens: require both letters and digits so ordinary
        # long words, URLs, and hashes of prose are not destroyed.
        (
            r"(?<![\w-])(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{32,}(?![\w-])",
            "[REDACTED]",
        ),
    ]

    clean = text
    for pattern, replacement in secret_patterns:
        clean = re.sub(pattern, replacement, clean, flags=re.IGNORECASE)
    
    return clean


# =============================================================================
# Module Initialization
# =============================================================================

# Global instances
index_manager = HnswIndexManager()
indexing_queue = IndexingQueue()
backfill_orchestrator = BackfillOrchestrator(index_manager, indexing_queue)
retrieval_logger = RetrievalLogger()
