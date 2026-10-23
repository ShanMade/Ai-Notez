# NoteZ Universal Knowledge Index - Implementation Plan

## Executive Summary

The NoteZ repository **already has a sophisticated vector indexing backend** (FastAPI + USearch + SQLite) but lacks comprehensive frontend integration, backfill capabilities, and retrieval transparency. This plan transforms the existing partial implementation into a complete, production-ready universal knowledge index.

## Architecture Map

### Current State Analysis

#### ✅ **Already Implemented (Backend)**
- **Vector Storage**: USearch HNSW index with SQLite metadata
- **Index Schema**: `note_states`, `note_chunks`, `index_revisions` tables
- **Chunking**: 1600 tokens with 200 token overlap
- **Embedding**: Batch processing, configurable providers (Gemini/Groq/Mistral)
- **API Endpoints**:
  - `POST /v1/index/notes/{note_id}` - Index single note
  - `DELETE /v1/index/notes/{note_id}` - Remove from index
  - `POST /v1/index/rebuild` - Full backfill
  - `POST /v1/index/search` - Semantic search
- **Security**: Firebase auth verification, per-user isolation
- **Versioning**: Content hash tracking, embedding model versioning

#### ❌ **Missing (Frontend)**
- Central indexing service module
- Backfill orchestration
- Status tracking UI
- Hybrid retrieval (semantic + keyword)
- Source citations in AI responses
- Retrieval metadata recording
- Comprehensive mutation path coverage

#### ⚠️ **Partial (Frontend)**
- Note save triggers indexing (via `queueSemanticIndex`)
- AI chat exists but doesn't use vector search
- No visibility into indexing status

---

## Data Flow Analysis

### Content Types to Index

| Content Type | Source | Current Storage | Index Status |
|-------------|--------|----------------|--------------|
| User notes | `notes` array | RTDB + localStorage | ⚠️ Partial |
| PDF documents | Library files | Local files + RTDB metadata | ❌ Not indexed |
| HTML documents | Library files | Local files + RTDB metadata | ❌ Not indexed |
| Text files | Library files | Local files + RTDB metadata | ❌ Not indexed |
| Markdown files | Library files | Local files + RTDB metadata | ❌ Not indexed |
| Voice transcripts | Notes with `kind: 'audio'` | RTDB notes | ⚠️ Partial |
| AI-generated notes | Recording session notes | RTDB notes | ⚠️ Partial |
| Imported notes | Bulk import | RTDB notes | ⚠️ Partial |

### Mutation Paths to Cover

#### Note Operations
1. ✅ **New note creation** - `saveNote()` → `persistNote()` → `queueSemanticIndex()`
2. ✅ **Note editing** - Autosave → `saveNote()` → `queueSemanticIndex()`
3. ❌ **Note deletion** - `deleteNote()` → No index cleanup
4. ❌ **Note restoration** - `restoreNote()` → No re-indexing
5. ❌ **Bulk import** - `importNotes()` → No indexing
6. ❌ **Folder move/rename** - Metadata only, no content change

#### Library Operations
1. ❌ **PDF import** - `importPdf()` → No text extraction/indexing
2. ❌ **File import** - Generic file import → No indexing
3. ❌ **Library file deletion** - No index cleanup

#### Sync Operations
1. ⚠️ **Cloud sync** - `syncCloudWorkspace()` → Partial (queues after sync)
2. ❌ **Offline changes** - Queued but no reconciliation
3. ❌ **Conflict resolution** - No index awareness

#### Voice Operations
1. ⚠️ **Transcription** - Saved as note → Should trigger indexing
2. ⚠️ **AI-generated lecture notes** - Saved as note → Should trigger indexing

---

## Implementation Stages

### Stage A: Architecture & Audit (COMPLETE)

**Deliverables:**
- ✅ Repository audit complete
- ✅ Architecture map documented
- ✅ All ingestion paths identified
- ✅ Vector store capability confirmed

### Stage B: Indexing Infrastructure

**Files to Create:**
1. `app/09-knowledge-index.js` - Central indexing service
2. `backend/app/indexing.py` - Backend indexing orchestration

**Files to Modify:**
1. `app/01-config-and-core.js` - Add indexing configuration
2. `app/02-storage-and-notes.js` - Trigger indexing on mutations
3. `app/03-library-and-folders.js` - Trigger indexing on library changes
4. `app/06-ai-and-recording.js` - Trigger indexing on voice operations
5. `backend/app/main.py` - Add indexing endpoints
6. `backend/app/vector_store.py` - Enhance with hybrid search

**New Backend Endpoints:**
```python
GET /v1/index/status - Get indexing status for user
GET /v1/index/stats - Get index statistics
POST /v1/index/backfill - Trigger backfill with progress
POST /v1/index/query - Hybrid search (semantic + keyword)
```

### Stage C: Mutation Path Integration

**Coverage Matrix:**

| Mutation Path | Trigger Location | Index Action |
|--------------|-----------------|--------------|
| Create note | `saveNote()` | `enqueueForIndexing()` |
| Edit note | `saveNote()` | `enqueueForIndexing()` |
| Delete note | `deleteNote()` | `removeFromIndex()` |
| Restore note | `restoreNote()` | `enqueueForIndexing()` |
| Import notes | `importNotes()` | Batch `enqueueForIndexing()` |
| Import PDF | `importPdf()` | Extract text → `enqueueForIndexing()` |
| Import file | `importFile()` | Extract text → `enqueueForIndexing()` |
| Folder move | `renameFolder()` | Update metadata only |
| Cloud sync | `syncCloudWorkspace()` | Reconcile queue |
| Transcription | `saveTranscript()` | `enqueueForIndexing()` |
| AI notes | `saveAiNotes()` | `enqueueForIndexing()` |

### Stage D: Retrieval Integration

**Components:**
1. Hybrid search engine (semantic + keyword + BM25)
2. Reranking pipeline
3. Source citation extraction
4. Context window management
5. Retrieval metadata logging

**Integration Points:**
- `nzaiSendMessage()` - Inject retrieved context
- `nzaiGenerateResponse()` - Add citations
- New `retrieveRelevantContext()` function

### Stage E: UI & Diagnostics

**New UI Components:**
1. Index status panel in settings
2. Backfill progress indicator
3. Per-note indexing status
4. Retrieval metadata viewer
5. Source citation display

---

## Technology Choices

### Vector Store: ✅ USearch HNSW (Keep Existing)
- **Rationale**: Already implemented, efficient, file-based, no external dependencies
- **Enhancement**: Add hybrid search capabilities

### Embedding Provider: ✅ Configurable (Keep Existing)
- **Primary**: Gemini `gemini-embedding-001` (768 dim)
- **Fallback**: Groq `text-embedding-3-small` (1024 dim)
- **Fallback**: Mistral `mistral-embedding` (1024 dim)

### Chunking Strategy: ✅ Keep Existing
- **Size**: 1600 tokens
- **Overlap**: 200 tokens
- **Max chunks per note**: Configurable (default 100)

### Index Schema: ✅ Keep Existing with Enhancements
```sql
-- Existing (keep):
note_states: owner_key, note_id, content_hash, embedding_model, chunk_count
note_chunks: id, owner_key, note_id, position, content_hash, title, folder_path, chunk_text, embedding
index_revisions: owner_key, revision, indexed_revision

-- New tables:
indexing_queue: id, owner_key, note_id, operation, status, retry_count, error, created_at
indexing_stats: owner_key, total_notes, indexed_notes, pending_notes, failed_notes, last_backfill_at
retrieval_logs: id, owner_key, query, retrieval_method, results_count, sources_used, timestamp
```

---

## Security Requirements

### ✅ Already Implemented
- Firebase auth verification on all backend endpoints
- Per-user isolation via `owner_key` (SHA-256 of UID)
- Content hash verification before retrieval
- Rate limiting per user

### 🔧 To Enhance
- Add request signing for frontend → backend communication
- Implement index access logging (audit trail)
- Add IP-based rate limiting for public endpoints
- Implement content filtering (remove secrets before indexing)

### Content Filtering Rules

**DO INDEX:**
- Note titles, bodies, tags
- PDF text content
- HTML readable text
- Transcript text
- AI-generated notes

**DO NOT INDEX:**
- API keys, passwords, tokens
- Firebase configuration
- Binary file contents
- Application metadata
- UI preferences
- System prompts
- Embedding vectors themselves

**Filter Implementation:**
```javascript
function sanitizeForIndexing(text) {
  // Remove potential secrets
  const secretPatterns = [
    /(?:api|secret|password|token|key|credential)[_:\s-]*(?:["']?)([A-Za-z0-9\-_]{20,})/gi,
    /Bearer\s+[A-Za-z0-9\-_]+/gi,
    /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/i,
    /sk-[a-zA-Z0-9]{40,}/g,  // OpenAI keys
    /xox[baprs]-[a-zA-Z0-9]{10,}/g,  // Slack tokens
    /AKIA[0-9A-Z]{16}/g,  // AWS access keys
  ];
  
  let clean = text;
  secretPatterns.forEach(pattern => {
    clean = clean.replace(pattern, '[REDACTED]');
  });
  
  return clean;
}
```

---

## Backfill Strategy

### Phase 1: Cloud Users
1. User requests backfill via UI or API
2. Backend enumerates all notes from RTDB
3. Process in batches of 10 notes at a time
4. Store progress in `indexing_stats` table
5. Resume on failure or interruption
6. Report completion with statistics

### Phase 2: Local Demo Users
1. Index locally using IndexedDB
2. Store vectors in IndexedDB with USearch-WASM
3. Sync to backend when user signs in
4. Merge local and cloud indices

### Batch Processing Algorithm
```python
async def backfill_user(uid: str, batch_size: int = 10) -> dict:
    """
    Backfill all notes for a user with progress tracking.
    """
    owner_key = user_key(uid)
    
    # Get current progress
    with connect() as conn:
        stats = conn.execute(
            "SELECT * FROM indexing_stats WHERE owner_key = ?",
            (owner_key,)
        ).fetchone()
        
        if stats and stats['last_backfill_at']:
            # Resume from last position
            processed = set(conn.execute(
                "SELECT note_id FROM note_states WHERE owner_key = ?",
                (owner_key,)
            ).fetchall())
        else:
            processed = set()
    
    # Get all notes from RTDB
    notes = await user_notes(uid)
    total = len(notes)
    
    # Process in batches
    results = {
        'total': total,
        'processed': 0,
        'failed': 0,
        'skipped': 0,
        'errors': []
    }
    
    for note_id, note in notes.items():
        if note_id in processed:
            results['skipped'] += 1
            continue
            
        try:
            await index_manager.upsert(uid, note_id, note, embed_texts)
            results['processed'] += 1
            
            # Update progress every batch
            if results['processed'] % batch_size == 0:
                update_backfill_progress(owner_key, results)
                
        except Exception as e:
            results['failed'] += 1
            results['errors'].append({
                'note_id': note_id,
                'error': str(e)
            })
    
    # Final update
    update_backfill_progress(owner_key, results, completed=True)
    
    return results
```

---

## Hybrid Retrieval Design

### Architecture

```
Query Processing Flow:
┌─────────────────────────────────────────────────────────────┐
│                        User Query                              │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Query Analysis                             │
│  - Extract keywords (TF-IDF, n-grams)                          │
│  - Generate query embedding                                   │
│  - Determine retrieval strategy                               │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              │                               │
              ▼                               ▼
┌─────────────────────┐           ┌─────────────────────┐
│   Semantic Search    │           │   Keyword Search     │
│  - Vector similarity │           │  - BM25 ranking      │
│  - Top-k nearest     │           │  - Exact matches     │
│  - Cosine similarity │           │  - Phrase search     │
└─────────────────────┘           └─────────────────────┘
              │                               │
              └───────────────┬───────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Result Fusion                              │
│  - Deduplicate by note_id                                      │
│  - Rerank by combined score                                    │
│  - Apply filters (folder, permissions, etc.)                   │
│  - Limit to context window                                    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Context Construction                        │
│  - Extract relevant passages                                   │
│  - Add source citations                                        │
│  - Format for LLM prompt                                      │
│  - Track retrieval metadata                                    │
└─────────────────────────────────────────────────────────────┘
```

### Scoring Formula

```python
def hybrid_score(semantic_score: float, keyword_score: float, 
                is_exact_match: bool = False) -> float:
    """
    Combine semantic and keyword scores.
    
    Args:
        semantic_score: Cosine similarity (0-1)
        keyword_score: BM25 or TF-IDF score (normalized 0-1)
        is_exact_match: Whether query phrase appears verbatim
    """
    # Weight configuration
    SEMANTIC_WEIGHT = 0.7
    KEYWORD_WEIGHT = 0.3
    EXACT_MATCH_BOOST = 0.2
    
    base_score = (SEMANTIC_WEIGHT * semantic_score + 
                  KEYWORD_WEIGHT * keyword_score)
    
    if is_exact_match:
        base_score = min(1.0, base_score + EXACT_MATCH_BOOST)
    
    return base_score
```

### Reranking with Cross-Encoder (Future Enhancement)

For higher quality, implement a lightweight cross-encoder reranker:

```python
async def rerank_results(
    query: str,
    results: list[dict],
    top_k: int = 5
) -> list[dict]:
    """
    Rerank top results using cross-encoder for better relevance.
    """
    if len(results) <= top_k:
        return results
    
    # Use a lightweight cross-encoder model
    pairs = [(query, result['text']) for result in results[:top_k * 2]]
    
    scores = await cross_encoder_score(pairs)
    
    # Re-rank by cross-encoder score
    for result, score in zip(results[:top_k * 2], scores):
        result['cross_encoder_score'] = score
    
    reranked = sorted(
        results[:top_k * 2],
        key=lambda x: x['cross_encoder_score'],
        reverse=True
    )[:top_k]
    
    return reranked
```

---

## Retrieval Metadata Schema

### Record Structure

```typescript
interface RetrievalMetadata {
  // Query information
  query: string;
  queryHash: string;  // SHA-256 of query
  
  // Retrieval configuration
  retrievalMethod: 'none' | 'keyword' | 'semantic' | 'hybrid' | 'full_document';
  searchScope: 'all' | 'folder' | 'note' | 'selection';
  authorizedSourceCount: number;
  
  // Results
  candidatesRetrieved: number;
  finalChunksUsed: number;
  sourcesUsed: Array<{
    id: string;
    title: string;
    folderPath: string;
    similarity: number;
    keywordScore: number;
    hybridScore: number;
  }>;
  
  // Model information
  embeddingModel: string;
  embeddingDimensions: number;
  indexVersion: string;
  
  // Status
  indexingStatus: 'complete' | 'partial' | 'pending' | 'failed';
  
  // Context usage
  usedRetrievedContext: boolean;
  contextWindowUsed: number;  // Tokens used for context
  
  // Timing
  retrievalTimeMs: number;
  totalTimeMs: number;
  
  // Timestamp
  timestamp: number;
}
```

### Storage

```python
# Backend: SQLite table
CREATE TABLE retrieval_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_key TEXT NOT NULL,
    query_hash TEXT NOT NULL,
    retrieval_method TEXT NOT NULL,
    search_scope TEXT NOT NULL,
    authorized_source_count INTEGER NOT NULL,
    candidates_retrieved INTEGER NOT NULL,
    final_chunks_used INTEGER NOT NULL,
    sources_used_json TEXT NOT NULL,  -- JSON array
    embedding_model TEXT NOT NULL,
    embedding_dimensions INTEGER NOT NULL,
    index_version TEXT NOT NULL,
    indexing_status TEXT NOT NULL,
    used_retrieved_context BOOLEAN NOT NULL,
    context_window_used INTEGER NOT NULL,
    retrieval_time_ms INTEGER NOT NULL,
    total_time_ms INTEGER NOT NULL,
    timestamp INTEGER NOT NULL,
    FOREIGN KEY (owner_key) REFERENCES index_revisions(owner_key)
);

# Frontend: IndexedDB store
const retrievalLogsStore = db.createObjectStore('retrieval-logs', {
  keyPath: 'id',
  autoIncrement: true
});
```

---

## Source Citation Format

### Inline Citations

```markdown
The capital of France is Paris [1].

The process of photosynthesis converts light energy into chemical energy [2, p. 45].

According to the lecture notes, the exam will cover chapters 1-3 [3, Lecture 5, 2024-01-15].
```

### Citation Metadata

```typescript
interface SourceCitation {
  id: string;  // Unique citation ID
  noteId: string;  // Source note ID
  noteTitle: string;
  folderPath: string;
  pageNumber?: number;  // For PDFs
  section?: string;  // For structured documents
  timestamp?: string;  // For transcripts
  similarity: number;  // Retrieval similarity score
  textPreview: string;  // First 100 chars of cited text
}
```

### Response Format with Citations

```json
{
  "text": "The capital of France is Paris [1].\n\nAccording to your Biology notes, photosynthesis occurs in the chloroplasts [2].",
  "citations": [
    {
      "id": "1",
      "noteId": "abc123",
      "noteTitle": "Geography Facts",
      "folderPath": "School/Geography",
      "similarity": 0.95,
      "textPreview": "Paris is the capital and most populous city of France..."
    },
    {
      "id": "2",
      "noteId": "def456",
      "noteTitle": "Biology - Cell Structures",
      "folderPath": "School/Biology",
      "similarity": 0.88,
      "textPreview": "Photosynthesis is the process by which green plants..."
    }
  ],
  "retrievalMetadata": {
    "retrievalMethod": "hybrid",
    "candidatesRetrieved": 25,
    "finalChunksUsed": 2,
    "sourcesUsed": ["abc123", "def456"],
    "embeddingModel": "gemini-embedding-001",
    "indexVersion": "v1.2.0"
  }
}
```

---

## Implementation Timeline

### Week 1: Infrastructure & Backend
- [ ] Enhance vector_store.py with hybrid search
- [ ] Add indexing queue and status tracking
- [ ] Implement backfill orchestration
- [ ] Add retrieval logging
- [ ] Implement content filtering

### Week 2: Frontend Integration
- [ ] Create app/09-knowledge-index.js
- [ ] Integrate with note mutation paths
- [ ] Integrate with library operations
- [ ] Integrate with voice/transcription
- [ ] Add indexing status UI

### Week 3: Retrieval & AI Integration
- [ ] Implement hybrid search in backend
- [ ] Add retrieval metadata logging
- [ ] Integrate with NotezAi chat
- [ ] Add source citations
- [ ] Implement context window management

### Week 4: Testing & Polish
- [ ] Write comprehensive tests
- [ ] Fix regressions
- [ ] Optimize performance
- [ ] Add error handling
- [ ] Documentation

---

## Risk Assessment

### High Priority Risks

1. **Embedding Cost**
   - **Impact**: High - Could make indexing expensive
   - **Mitigation**: Batch processing, caching, configurable limits
   - **Estimate**: ~$0.0001 per note (Gemini embeddings)

2. **Index Size**
   - **Impact**: Medium - Large libraries may exceed memory
   - **Mitigation**: USearch HNSW is memory-efficient, SQLite for overflow
   - **Estimate**: ~10MB per 1000 notes

3. **Sync Conflicts**
   - **Impact**: Medium - Offline changes may conflict
   - **Mitigation**: Content hash verification, last-write-wins with versioning

### Medium Priority Risks

4. **Performance**
   - **Impact**: Medium - Slow retrieval on large indices
   - **Mitigation**: HNSW is O(log n), caching, query optimization

5. **Privacy**
   - **Impact**: High - Cross-user data leakage
   - **Mitigation**: Strict owner_key isolation, auth verification

6. **Data Loss**
   - **Impact**: High - Index corruption
   - **Mitigation**: SQLite transactions, index rebuild capability

### Low Priority Risks

7. **Browser Compatibility**
   - **Impact**: Low - IndexedDB limitations
   - **Mitigation**: Feature detection, graceful degradation

8. **Offline Functionality**
   - **Impact**: Low - Limited offline indexing
   - **Mitigation**: Queue for sync, local IndexedDB fallback

---

## Cost Analysis

### Embedding Costs (Per 1000 Notes)

| Provider | Model | Cost per 1K tokens | Tokens per note* | Cost per note | Cost per 1000 notes |
|---------|-------|-------------------|------------------|---------------|---------------------|
| Gemini | gemini-embedding-001 | $0.00010 | 1600 | $0.00016 | $0.16 |
| Groq | text-embedding-3-small | $0.00001 | 1600 | $0.000016 | $0.016 |
| Mistral | mistral-embedding | $0.00010 | 1600 | $0.00016 | $0.16 |

*Assuming average note size of 1600 tokens (one chunk)

### Storage Costs

| Component | Size per note | 1000 notes | 10,000 notes |
|-----------|---------------|-----------|--------------|
| SQLite metadata | ~1KB | 1MB | 10MB |
| USearch index | ~5KB | 5MB | 50MB |
| Chunk text (compressed) | ~2KB | 2MB | 20MB |
| **Total** | **~8KB** | **8MB** | **80MB** |

### Query Costs

| Operation | Cost | Notes |
|-----------|------|-------|
| Semantic search | 1 embedding | Same as indexing cost |
| Hybrid search | 1 embedding + keyword | Minimal additional cost |
| Reranking | N/A | Uses existing embeddings |

---

## Verification Checklist

### Acceptance Criteria Tests

#### Indexing Coverage
- [ ] Existing notes are included in backfill
- [ ] New notes are indexed automatically after saving
- [ ] Edited notes replace stale chunks
- [ ] Duplicate events do not create duplicate vectors
- [ ] Stale indexing jobs cannot overwrite newer content
- [ ] Offline edits are indexed after synchronization
- [ ] Imported PDF text is searchable
- [ ] Transcripts become searchable after finalization
- [ ] Deletion removes the source from retrieval
- [ ] Restoring a source makes it searchable again

#### Retrieval Quality
- [ ] Semantic search finds conceptually related text
- [ ] Keyword search finds exact formulas and identifiers
- [ ] Hybrid retrieval improves or preserves relevant results
- [ ] AI answers cite the retrieved source correctly
- [ ] Questions with no relevant source do not produce fabricated citations

#### System Tests
- [ ] Failed embedding requests are retried and reported
- [ ] Backfill resumes without duplicating completed work
- [ ] Users cannot retrieve one another's private content
- [ ] Embedding-model changes trigger safe migration
- [ ] Large libraries can be indexed without unbounded memory usage

### Manual Verification Steps

1. **Backfill Test**
   ```bash
   # Create 100 test notes
   # Trigger backfill
   # Verify all 100 are indexed
   # Check status UI shows completion
   ```

2. **Real-time Indexing Test**
   ```bash
   # Create a note with unique text
   # Search immediately (should find it)
   # Edit the note
   # Search again (should find updated content)
   # Delete the note
   # Search again (should not find it)
   ```

3. **Retrieval Quality Test**
   ```bash
   # Create notes with known content
   # Ask questions that should match
   # Verify correct notes are retrieved
   # Verify citations are accurate
   ```

4. **Privacy Test**
   ```bash
   # Create two user accounts
   # Create notes in each
   # Verify User A cannot find User B's notes
   ```

---

## Files to Create/Modify

### New Files

```
app/09-knowledge-index.js          # Frontend indexing service
backend/app/indexing.py           # Backend orchestration
backend/tests/test_indexing.py     # Indexing tests
backend/tests/test_retrieval.py    # Retrieval tests
```

### Modified Files

```
app/01-config-and-core.js         # Add indexing config
app/02-storage-and-notes.js        # Trigger indexing on mutations
app/03-library-and-folders.js      # Trigger indexing on library changes
app/05-sync-and-auth.js           # Sync integration
app/06-ai-and-recording.js        # AI integration, voice indexing
backend/app/main.py               # New endpoints
backend/app/vector_store.py       # Hybrid search, enhanced features
backend/app/config.py             # New settings
```

---

## Next Steps

This plan is ready for implementation. The existing backend vector store provides a solid foundation. The primary work is:

1. **Frontend integration** - Connect all mutation paths to indexing
2. **Backfill orchestration** - Safe, resumable backfill for existing content
3. **Hybrid retrieval** - Combine semantic and keyword search
4. **AI integration** - Use retrieval results in NotezAi responses
5. **UI/UX** - Status tracking and diagnostics

The implementation should proceed in the order specified (Stages B-E) to ensure a solid foundation before adding complexity.
