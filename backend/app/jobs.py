"""
NoteZ AI — durable AI job queue (recording transcription).

A transcription requested over POST /v1/ai/transcribe is a ROW in SQLite, not
an in-flight request. That single fact is what the Phase 0.3 correction asks
for:

- durable: the queue survives a process restart (the file lives in
  settings.data_dir, beside the existing notez-indexing-queue.sqlite3);
- idempotent: job_key is UNIQUE ("transcribe:{noteId}:{partSlot}"), so the
  same logical request from a retrying browser cannot create a second job,
  and a finished job is never re-run;
- safe claiming: claim_next() is one BEGIN IMMEDIATE transaction that selects
  the oldest due job and marks it running with a lease; the SQLite single
  writer guarantees two workers (or two processes) can never claim the same
  job;
- retries with backoff (min(30 min, 30 s · 2^attempts)); after MAX_ATTEMPTS
  the job is terminally "failed" and only an explicit POST …/retry re-queues
  it — there is no silent duplicate transcription;
- recovery after restart: recover() at startup (and on every worker loop)
  puts "running" jobs whose lease expired back to "queued". A job still
  inside a live lease is left alone, so a running job is never lost and
  never stolen.

The connection style follows the repo's existing durable-sqlite precedent
(app/indexing.py: data_dir, timeout=30), with one deliberate improvement
learned in the P0.3a backend-job prototype: the connection is autocommit
(isolation_level=None) with busy_timeout, and every multi-statement step is
an EXPLICIT "BEGIN IMMEDIATE" — the legacy implicit-transaction mode left a
transaction open and swallowed "cannot start a transaction within a
transaction" errors silently.
"""

from __future__ import annotations

import json
import logging
import sqlite3
import time
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterator

from .config import settings

logger = logging.getLogger(__name__)

STATUSES = ("queued", "running", "done", "failed")
MAX_ATTEMPTS = 5
LEASE_SECONDS = 300
JOB_TTL_SECONDS = 7 * 24 * 3600
BACKOFF_BASE_SECONDS = 30
BACKOFF_CAP_SECONDS = 30 * 60


def backoff_seconds(attempts: int) -> int:
    return min(BACKOFF_CAP_SECONDS, BACKOFF_BASE_SECONDS * (2 ** max(0, attempts)))


@dataclass
class AiJob:
    job_id: str
    job_key: str
    uid: str
    type: str
    status: str
    attempts: int
    next_attempt: float
    lease_owner: str | None
    lease_until: float
    payload_json: str
    result_json: str | None
    error: str | None
    created_at: float
    updated_at: float

    @property
    def payload(self) -> dict[str, Any]:
        try:
            value = json.loads(self.payload_json or "{}")
            return value if isinstance(value, dict) else {}
        except (TypeError, ValueError):
            return {}

    @property
    def result(self) -> dict[str, Any] | None:
        if not self.result_json:
            return None
        try:
            value = json.loads(self.result_json)
            return value if isinstance(value, dict) else None
        except (TypeError, ValueError):
            return None


class AiJobQueue:
    """SQLite-backed queue for AI jobs. All methods are synchronous (plain
    sqlite3); callers from async code must use asyncio.to_thread. An asyncio
    lock serialises callers within one process; the BEGIN IMMEDIATE claim is
    what makes it safe across processes."""

    def __init__(self, data_dir: Path | None = None) -> None:
        self.data_dir = (data_dir or settings.data_dir).expanduser().resolve()
        self.path = self.data_dir / "notez-jobs.sqlite3"
        self._ready = False

    # -- connection ---------------------------------------------------------

    def _connect(self) -> sqlite3.Connection:
        if not self._ready:
            self.data_dir.mkdir(parents=True, exist_ok=True)
            bootstrap = sqlite3.connect(self.path, timeout=30)
            try:
                bootstrap.executescript(
                    """
                    CREATE TABLE IF NOT EXISTS ai_jobs (
                        job_id TEXT PRIMARY KEY,
                        job_key TEXT NOT NULL UNIQUE,
                        uid TEXT NOT NULL,
                        type TEXT NOT NULL,
                        status TEXT NOT NULL,
                        attempts INTEGER NOT NULL DEFAULT 0,
                        next_attempt REAL NOT NULL DEFAULT 0,
                        lease_owner TEXT,
                        lease_until REAL NOT NULL DEFAULT 0,
                        payload_json TEXT NOT NULL DEFAULT '{}',
                        result_json TEXT,
                        error TEXT,
                        created_at REAL NOT NULL,
                        updated_at REAL NOT NULL
                    );
                    CREATE INDEX IF NOT EXISTS idx_ai_jobs_status ON ai_jobs(status, next_attempt, created_at);
                    CREATE INDEX IF NOT EXISTS idx_ai_jobs_uid ON ai_jobs(uid);
                    CREATE INDEX IF NOT EXISTS idx_ai_jobs_key ON ai_jobs(job_key);
                    """
                )
                bootstrap.commit()
            finally:
                bootstrap.close()
            self._ready = True
        connection = sqlite3.connect(self.path, timeout=30, isolation_level=None)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA busy_timeout = 30000")
        return connection

    @contextmanager
    def _cursor(self) -> Iterator[sqlite3.Cursor]:
        connection = self._connect()
        try:
            with connection:  # commits on success, rolls back on exception
                yield connection.cursor()
        finally:
            connection.close()

    @staticmethod
    def _row(row: sqlite3.Row) -> AiJob:
        return AiJob(
            job_id=row["job_id"], job_key=row["job_key"], uid=row["uid"],
            type=row["type"], status=row["status"], attempts=row["attempts"],
            next_attempt=row["next_attempt"], lease_owner=row["lease_owner"],
            lease_until=row["lease_until"], payload_json=row["payload_json"],
            result_json=row["result_json"], error=row["error"],
            created_at=row["created_at"], updated_at=row["updated_at"],
        )

    _SELECT = """
        SELECT job_id, job_key, uid, type, status, attempts, next_attempt,
               lease_owner, lease_until, payload_json, result_json, error,
               created_at, updated_at
        FROM ai_jobs
    """

    # -- API ------------------------------------------------------------------

    def create_or_get(self, job_id: str, job_key: str, uid: str, type: str, payload: dict[str, Any]) -> tuple[AiJob, bool]:
        """Idempotent create. When a job with the same job_key already exists
        it is returned (created=False) whatever its state — a done job is
        never re-run, a failed one is only re-queued through retry()."""
        now = time.time()
        with self._cursor() as cursor:
            cursor.execute("BEGIN IMMEDIATE")
            cursor.execute(f"{self._SELECT} WHERE job_key = ?", (job_key,))
            row = cursor.fetchone()
            if row:
                return self._row(row), False
            cursor.execute(
                """
                INSERT INTO ai_jobs (job_id, job_key, uid, type, status, attempts,
                                     next_attempt, payload_json, created_at, updated_at)
                VALUES (?, ?, ?, ?, 'queued', 0, 0, ?, ?, ?)
                """,
                (job_id, job_key, uid, type, json.dumps(payload, ensure_ascii=False), now, now),
            )
            cursor.execute(f"{self._SELECT} WHERE job_id = ?", (job_id,))
            return self._row(cursor.fetchone()), True

    def get(self, job_id: str) -> AiJob | None:
        with self._cursor() as cursor:
            cursor.execute(f"{self._SELECT} WHERE job_id = ?", (job_id,))
            row = cursor.fetchone()
            return self._row(row) if row else None

    def claim_next(self, owner: str, uid: str | None = None, lease_seconds: int = LEASE_SECONDS) -> AiJob | None:
        """Claim the oldest due job. The whole select-and-mark is one
        BEGIN IMMEDIATE transaction, so exactly one caller can win a job."""
        now = time.time()
        with self._cursor() as cursor:
            cursor.execute("BEGIN IMMEDIATE")
            query = f"{self._SELECT} WHERE status = 'queued' AND next_attempt <= ?"
            args: list[Any] = [now]
            if uid:
                query += " AND uid = ?"
                args.append(uid)
            query += " ORDER BY created_at ASC LIMIT 1"
            cursor.execute(query, args)
            row = cursor.fetchone()
            if not row:
                return None
            cursor.execute(
                """
                UPDATE ai_jobs
                SET status = 'running', attempts = attempts + 1,
                    lease_owner = ?, lease_until = ?, updated_at = ?
                WHERE job_id = ?
                """,
                (owner, now + lease_seconds, now, row["job_id"]),
            )
            cursor.execute(f"{self._SELECT} WHERE job_id = ?", (row["job_id"],))
            return self._row(cursor.fetchone())

    def renew(self, job_id: str, owner: str, lease_seconds: int = LEASE_SECONDS) -> bool:
        with self._cursor() as cursor:
            cursor.execute("BEGIN IMMEDIATE")
            cursor.execute(
                """
                UPDATE ai_jobs
                SET lease_until = ?, updated_at = ?
                WHERE job_id = ? AND status = 'running' AND lease_owner = ?
                """,
                (time.time() + lease_seconds, time.time(), job_id, owner),
            )
            return cursor.rowcount == 1

    def complete(self, job_id: str, owner: str, result: dict[str, Any]) -> bool:
        with self._cursor() as cursor:
            cursor.execute("BEGIN IMMEDIATE")
            cursor.execute(
                """
                UPDATE ai_jobs
                SET status = 'done', result_json = ?, error = NULL,
                    lease_owner = NULL, lease_until = 0, updated_at = ?
                WHERE job_id = ? AND status = 'running' AND lease_owner = ?
                """,
                (json.dumps(result, ensure_ascii=False), time.time(), job_id, owner),
            )
            return cursor.rowcount == 1

    def fail(self, job_id: str, owner: str, error: str) -> bool:
        """Give a job back. Under MAX_ATTEMPTS it re-queues with backoff; at
        the limit it becomes terminally 'failed' (an explicit /retry is the
        only way back)."""
        now = time.time()
        with self._cursor() as cursor:
            cursor.execute("BEGIN IMMEDIATE")
            cursor.execute(f"SELECT attempts FROM ai_jobs WHERE job_id = ?", (job_id,))
            row = cursor.fetchone()
            if not row:
                return False
            attempts = int(row["attempts"])
            if attempts >= MAX_ATTEMPTS:
                cursor.execute(
                    """
                    UPDATE ai_jobs
                    SET status = 'failed', error = ?, lease_owner = NULL,
                        lease_until = 0, updated_at = ?
                    WHERE job_id = ? AND status = 'running' AND lease_owner = ?
                    """,
                    (error[:2000], now, job_id, owner),
                )
            else:
                cursor.execute(
                    """
                    UPDATE ai_jobs
                    SET status = 'queued', error = ?, lease_owner = NULL,
                        lease_until = 0, next_attempt = ?, updated_at = ?
                    WHERE job_id = ? AND status = 'running' AND lease_owner = ?
                    """,
                    (error[:2000], now + backoff_seconds(attempts), now, job_id, owner),
                )
            return cursor.rowcount == 1

    def retry(self, job_id: str) -> AiJob | None:
        """Explicit re-queue of a failed job (resets the attempt count)."""
        now = time.time()
        with self._cursor() as cursor:
            cursor.execute("BEGIN IMMEDIATE")
            cursor.execute(
                """
                UPDATE ai_jobs
                SET status = 'queued', attempts = 0, next_attempt = 0,
                    error = NULL, lease_owner = NULL, lease_until = 0, updated_at = ?
                WHERE job_id = ? AND status = 'failed'
                """,
                (now, job_id),
            )
            if cursor.rowcount != 1:
                return None
            cursor.execute(f"{self._SELECT} WHERE job_id = ?", (job_id,))
            return self._row(cursor.fetchone())

    def recover(self) -> int:
        """Crash recovery: 'running' jobs whose lease expired go back to
        'queued' (attempts preserved, backoff applied). A live lease is never
        stolen — if another worker is genuinely mid-transcription, its job
        finishes normally."""
        now = time.time()
        with self._cursor() as cursor:
            cursor.execute("BEGIN IMMEDIATE")
            cursor.execute(
                """
                SELECT job_id, attempts FROM ai_jobs
                WHERE status = 'running' AND lease_until > 0 AND lease_until <= ?
                """,
                (now,),
            )
            rows = cursor.fetchall()
            for row in rows:
                cursor.execute(
                    """
                    UPDATE ai_jobs
                    SET status = 'queued', lease_owner = NULL, lease_until = 0,
                        next_attempt = ?, error = 'lease expired — recovered', updated_at = ?
                    WHERE job_id = ?
                    """,
                    (now + backoff_seconds(int(row["attempts"])), now, row["job_id"]),
                )
            return len(rows)

    def purge(self, ttl_seconds: int = JOB_TTL_SECONDS) -> int:
        """Drop done/failed jobs older than the TTL (their results are no
        longer addressable; the audio and notes live in Firebase/IndexedDB)."""
        cutoff = time.time() - ttl_seconds
        with self._cursor() as cursor:
            cursor.execute("BEGIN IMMEDIATE")
            cursor.execute("DELETE FROM ai_jobs WHERE status IN ('done', 'failed') AND updated_at < ?", (cutoff,))
            return cursor.rowcount

    def stats(self) -> dict[str, int]:
        with self._cursor() as cursor:
            cursor.execute("SELECT status, COUNT(*) AS n FROM ai_jobs GROUP BY status")
            counts = {row["status"]: row["n"] for row in cursor.fetchall()}
        return {status: counts.get(status, 0) for status in STATUSES}


ai_job_queue = AiJobQueue()
