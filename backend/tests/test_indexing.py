"""
Tests for the NoteZ Knowledge Index indexing service.
"""

import asyncio
import hashlib
import json
import math
import os
import tempfile
from pathlib import Path

import pytest

from app.indexing import (
    IndexingJob,
    IndexingQueue,
    IndexingStats,
    BackfillOrchestrator,
    RetrievalMetadata,
    RetrievalLogger,
    sanitize_for_indexing,
    indexing_queue,
    backfill_orchestrator,
    retrieval_logger,
)
from app.vector_store import HnswIndexManager, split_chunks, user_key
from app.config import settings


def vector_for(text: str) -> list[float]:
    """Generate a deterministic fake embedding vector for testing."""
    values = [0.0] * settings.embedding_dimensions
    for word in text.lower().split():
        position = int.from_bytes(hashlib.sha256(word.encode("utf-8")).digest()[:4], "big") % len(values)
        values[position] += 1
    magnitude = math.sqrt(sum(value * value for value in values))
    return [value / magnitude for value in values] if magnitude else values


async def fake_embed(texts: list[str]) -> list[list[float]]:
    """Fake embedding function for testing."""
    return [vector_for(text) for text in texts]


# =============================================================================
# Content Sanitization Tests
# =============================================================================

class TestContentSanitization:
    """Tests for content sanitization before indexing."""

    def test_sanitize_removes_api_keys(self):
        """Test that API keys are removed from content."""
        text = "Here is my API key: sk-1234567890abcdef1234567890abcdef12345678"
        cleaned = sanitize_for_indexing(text)
        assert "sk-1234567890abcdef1234567890abcdef12345678" not in cleaned
        assert "[REDACTED_OPENAI_KEY]" in cleaned

    def test_sanitize_removes_bearer_tokens(self):
        """Test that Bearer tokens are removed from content."""
        text = "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
        cleaned = sanitize_for_indexing(text)
        assert "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" not in cleaned
        assert "[REDACTED_TOKEN]" in cleaned

    def test_sanitize_removes_aws_keys(self):
        """Test that AWS access keys are removed from content."""
        text = "My AWS key is AKIAIOSFODNN7EXAMPLE"
        cleaned = sanitize_for_indexing(text)
        assert "AKIAIOSFODNN7EXAMPLE" not in cleaned
        assert "[REDACTED_AWS_KEY]" in cleaned

    def test_sanitize_removes_private_keys(self):
        """Test that private keys are removed from content."""
        text = "Here is my private key:\n-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBg..."
        cleaned = sanitize_for_indexing(text)
        assert "-----BEGIN PRIVATE KEY-----" not in cleaned
        assert "[REDACTED_PRIVATE_KEY]" in cleaned

    def test_sanitize_preserves_normal_content(self):
        """Test that normal content is preserved."""
        text = "This is a normal study note about quantum physics."
        cleaned = sanitize_for_indexing(text)
        assert cleaned == text

    def test_sanitize_handles_empty_content(self):
        """Test that empty content is handled correctly."""
        assert sanitize_for_indexing("") == ""
        assert sanitize_for_indexing(None) is None


# =============================================================================
# Indexing Queue Tests
# =============================================================================

class TestIndexingQueue:
    """Tests for the indexing queue."""

    @pytest.fixture
    def queue(self, tmp_path):
        """Create a fresh indexing queue for each test."""
        return IndexingQueue(tmp_path / "queue")

    def test_enqueue_job(self, queue):
        """Test enqueuing a job."""
        async def run():
            job = await queue.enqueue("user1", "note1", "index")
            assert job.noteId == "note1"
            assert job.operation == "index"
            assert job.status == "pending"
            assert job.uid == "user1"
        
        asyncio.run(run())

    def test_dequeue_job(self, queue):
        """Test dequeuing jobs."""
        async def run():
            await queue.enqueue("user1", "note1", "index")
            await queue.enqueue("user1", "note2", "index")
            
            jobs = await queue.dequeue("user1", limit=1)
            assert len(jobs) == 1
            assert jobs[0].noteId == "note1"
            assert jobs[0].status == "processing"
        
        asyncio.run(run())

    def test_complete_job(self, queue):
        """Test completing a job."""
        async def run():
            job = await queue.enqueue("user1", "note1", "index")
            await queue.dequeue("user1")
            
            result = await queue.complete(job.id, "user1")
            assert result is True
            
            # Check stats were updated
            stats = await queue.get_status("user1")
            assert stats.indexed_notes >= 1
        
        asyncio.run(run())

    def test_fail_job_with_retry(self, queue):
        """Test failing a job with retry."""
        async def run():
            job = await queue.enqueue("user1", "note1", "index")
            await queue.dequeue("user1")
            
            result = await queue.fail(job.id, "user1", "Test error", retry=True)
            assert result is True
            
            # Job should be back in pending state
            stats = await queue.get_status("user1")
            assert stats.pending_notes >= 1
        
        asyncio.run(run())

    def test_fail_job_without_retry(self, queue):
        """Test failing a job without retry."""
        async def run():
            # Enqueue and process multiple times to exceed retry count
            job = await queue.enqueue("user1", "note1", "index")
            for _ in range(3):
                await queue.dequeue("user1")
                await queue.fail(job.id, "user1", "Test error", retry=False)
            
            # Job should be in failed state
            stats = await queue.get_status("user1")
            assert stats.failed_notes >= 1
        
        asyncio.run(run())

    def test_get_status(self, queue):
        """Test getting queue status."""
        async def run():
            await queue.enqueue("user1", "note1", "index")
            await queue.enqueue("user1", "note2", "index")
            
            stats = await queue.get_status("user1")
            assert stats.pending_notes >= 2
            assert stats.total_notes >= 2
        
        asyncio.run(run())

    def test_clear_queue(self, queue):
        """Test clearing the queue."""
        async def run():
            await queue.enqueue("user1", "note1", "index")
            await queue.enqueue("user1", "note2", "index")
            
            count = await queue.clear_queue("user1")
            assert count == 2
            
            stats = await queue.get_status("user1")
            assert stats.pending_notes == 0
        
        asyncio.run(run())


# =============================================================================
# Backfill Orchestrator Tests
# =============================================================================

class TestBackfillOrchestrator:
    """Tests for the backfill orchestrator."""

    @pytest.fixture
    def orchestrator(self, tmp_path):
        """Create a fresh backfill orchestrator for each test."""
        index_manager = HnswIndexManager(tmp_path / "vectors")
        queue = IndexingQueue(tmp_path / "queue")
        return BackfillOrchestrator(index_manager, queue)

    def test_backfill_user(self, orchestrator):
        """Test backfilling a user's notes."""
        async def run():
            notes = {
                "note1": {"title": "Note 1", "body": "Content 1"},
                "note2": {"title": "Note 2", "body": "Content 2"},
            }
            
            result = await orchestrator.backfill_user(
                "user1",
                notes,
                fake_embed,
                batch_size=2,
            )
            
            assert result["status"] == "completed"
            assert result["total_notes"] == 2
            assert result["processed"] == 2
            assert result["failed"] == 0
        
        asyncio.run(run())

    def test_backfill_skips_unchanged(self, orchestrator):
        """Test that backfill skips unchanged notes."""
        async def run():
            notes = {
                "note1": {"title": "Note 1", "body": "Content 1"},
            }
            
            # First backfill
            await orchestrator.backfill_user("user1", notes, fake_embed)
            
            # Second backfill with same content
            result = await orchestrator.backfill_user("user1", notes, fake_embed)
            
            assert result["status"] == "already_completed"
        
        asyncio.run(run())

    def test_backfill_force_reindex(self, orchestrator):
        """Test that force=True reindexes even if already indexed."""
        async def run():
            notes = {
                "note1": {"title": "Note 1", "body": "Content 1"},
            }
            
            # First backfill
            await orchestrator.backfill_user("user1", notes, fake_embed)
            
            # Second backfill with force
            result = await orchestrator.backfill_user(
                "user1",
                notes,
                fake_embed,
                force=True,
            )
            
            assert result["status"] == "completed"
            assert result["processed"] >= 1
        
        asyncio.run(run())

    def test_get_backfill_status(self, orchestrator):
        """Test getting backfill status."""
        async def run():
            # Initially not completed
            status = await orchestrator.get_backfill_status("user1")
            assert status["backfill_completed"] is False
            
            # After backfill
            notes = {"note1": {"title": "Note 1", "body": "Content 1"}}
            await orchestrator.backfill_user("user1", notes, fake_embed)
            
            status = await orchestrator.get_backfill_status("user1")
            assert status["backfill_completed"] is True
        
        asyncio.run(run())


# =============================================================================
# Retrieval Logger Tests
# =============================================================================

class TestRetrievalLogger:
    """Tests for the retrieval logger."""

    @pytest.fixture
    def logger(self, tmp_path):
        """Create a fresh retrieval logger for each test."""
        return RetrievalLogger(tmp_path / "logs")

    def test_log_retrieval(self, logger):
        """Test logging a retrieval operation."""
        metadata = RetrievalMetadata(
            query="test query",
            query_hash="abc123",
            retrieval_method="semantic",
            search_scope="all",
            authorized_source_count=10,
            candidates_retrieved=5,
            final_chunks_used=3,
            sources_used=[{"noteId": "note1", "title": "Note 1"}],
            embedding_model="test-model",
            embedding_dimensions=768,
            index_version="1.0.0",
            indexing_status="complete",
            used_retrieved_context=True,
            context_window_used=100,
            retrieval_time_ms=100.0,
            total_time_ms=150.0,
            timestamp=1000.0,
            user_id="user1",
        )
        
        log_id = logger.log(metadata)
        assert log_id is not None
        assert len(log_id) > 0

    def test_get_logs(self, logger):
        """Test retrieving logs for a user."""
        # Log some retrievals
        for i in range(5):
            metadata = RetrievalMetadata(
                query=f"query {i}",
                query_hash=f"hash{i}",
                retrieval_method="semantic",
                search_scope="all",
                authorized_source_count=10,
                candidates_retrieved=5,
                final_chunks_used=3,
                sources_used=[],
                embedding_model="test-model",
                embedding_dimensions=768,
                index_version="1.0.0",
                indexing_status="complete",
                used_retrieved_context=True,
                context_window_used=100,
                retrieval_time_ms=100.0,
                total_time_ms=150.0,
                timestamp=1000.0 + i,
                user_id="user1",
            )
            logger.log(metadata)
        
        logs = logger.get_logs("user1", limit=3)
        assert len(logs) == 3
        assert all(log["user_id"] == "user1" for log in logs)


# =============================================================================
# Integration Tests
# =============================================================================

class TestIntegration:
    """Integration tests for the indexing system."""

    def test_full_indexing_workflow(self, tmp_path):
        """Test the complete indexing workflow."""
        async def run():
            # Setup
            index_manager = HnswIndexManager(tmp_path / "vectors")
            queue = IndexingQueue(tmp_path / "queue")
            orchestrator = BackfillOrchestrator(index_manager, queue)
            
            # Enqueue a note
            await queue.enqueue("user1", "note1", "index")
            
            # Process the queue
            jobs = await queue.dequeue("user1")
            assert len(jobs) == 1
            
            # Index the note
            note = {"title": "Test Note", "body": "Test content"}
            await index_manager.upsert("user1", "note1", note, fake_embed)
            
            # Complete the job
            await queue.complete(jobs[0].id, "user1")
            
            # Verify the note is searchable
            results = await index_manager.search("user1", vector_for("test content"), 5)
            assert len(results) == 1
            assert results[0]["id"] == "note1"
            
            # Verify stats
            stats = await queue.get_status("user1")
            assert stats.indexed_notes >= 1
            assert stats.pending_notes == 0
        
        asyncio.run(run())

    def test_backfill_and_search(self, tmp_path):
        """Test backfill followed by search."""
        async def run():
            # Setup
            index_manager = HnswIndexManager(tmp_path / "vectors")
            queue = IndexingQueue(tmp_path / "queue")
            orchestrator = BackfillOrchestrator(index_manager, queue)
            
            # Create notes
            notes = {
                "note1": {"title": "Physics", "body": "Newton's laws of motion"},
                "note2": {"title": "Chemistry", "body": "Periodic table of elements"},
                "note3": {"title": "Biology", "body": "Photosynthesis process"},
            }
            
            # Backfill
            result = await orchestrator.backfill_user("user1", notes, fake_embed)
            assert result["processed"] == 3
            
            # Search
            physics_results = await index_manager.search("user1", vector_for("motion"), 5)
            assert len(physics_results) >= 1
            assert any("Physics" in r["title"] for r in physics_results)
            
            chemistry_results = await index_manager.search("user1", vector_for("elements"), 5)
            assert len(chemistry_results) >= 1
            assert any("Chemistry" in r["title"] for r in chemistry_results)
        
        asyncio.run(run())


# =============================================================================
# Edge Case Tests
# =============================================================================

class TestEdgeCases:
    """Tests for edge cases and error handling."""

    def test_empty_note_content(self, tmp_path):
        """Test handling notes with empty content."""
        async def run():
            index_manager = HnswIndexManager(tmp_path / "vectors")
            
            # Try to index a note with empty content
            result = await index_manager.upsert(
                "user1",
                "note1",
                {"title": "Empty Note", "body": ""},
                fake_embed,
            )
            
            # Should return False (not indexed) because no content
            assert result is False
            
            # Verify not searchable
            results = await index_manager.search("user1", vector_for("empty"), 5)
            assert len(results) == 0
        
        asyncio.run(run())

    def test_duplicate_note_indexing(self, tmp_path):
        """Test that duplicate notes don't create duplicate chunks."""
        async def run():
            index_manager = HnswIndexManager(tmp_path / "vectors")
            
            note = {"title": "Duplicate Note", "body": "Same content"}
            
            # Index the same note twice
            result1 = await index_manager.upsert("user1", "note1", note, fake_embed)
            result2 = await index_manager.upsert("user1", "note1", note, fake_embed)
            
            # First should succeed, second should be a no-op
            assert result1 is True
            assert result2 is False
            
            # Verify only one chunk exists
            results = await index_manager.search("user1", vector_for("same content"), 5)
            assert len(results) == 1
        
        asyncio.run(run())

    def test_large_note_chunking(self, tmp_path):
        """Test that large notes are properly chunked."""
        async def run():
            index_manager = HnswIndexManager(tmp_path / "vectors")
            
            # Create a large note
            large_text = "word " * 2000  # Much larger than CHUNK_SIZE
            note = {"title": "Large Note", "body": large_text}
            
            result = await index_manager.upsert("user1", "note1", note, fake_embed)
            assert result is True
            
            # Verify chunks were created
            stats = index_manager.get_index_stats("user1")
            assert stats["chunk_count"] > 1
        
        asyncio.run(run())

    def test_unicode_content(self, tmp_path):
        """Test handling Unicode content."""
        async def run():
            index_manager = HnswIndexManager(tmp_path / "vectors")
            
            # Create a note with Unicode content
            note = {"title": "Unicode Note", "body": "Hello 世界 🌍"}
            
            result = await index_manager.upsert("user1", "note1", note, fake_embed)
            assert result is True
            
            # Verify searchable
            results = await index_manager.search("user1", vector_for("Hello"), 5)
            assert len(results) == 1
        
        asyncio.run(run())
