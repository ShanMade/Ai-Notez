/**
 * LEGACY / NOT LOADED - not part of the shipped retrieval path.
 *
 * index.html does not include this file. The supported RAG flow is:
 *   frontend -> POST /v1/ai/generate -> backend/app/automatic_rag.py
 *
 * This module was written against an older app shell and assumes globals that
 * no longer exist (a script-scope `currentSession`, `window.notezAiApiBaseUrl`)
 * plus a Firebase `accessToken` property that does not exist. It also posted to
 * /v1/index/notes without the note id in the path. Do not add it to index.html
 * without rewriting those parts; the backend /v1/index/* routes below are the
 * supported interface.
 */
/**
 * NoteZ Knowledge Index - Frontend Service
 * 
 * This module provides the central indexing service for the NoteZ frontend.
 * It handles:
 * - Indexing queue management
 * - Triggering backend indexing operations
 * - Status tracking and UI updates
 * - Content preparation for indexing
 * - Integration with all mutation paths
 */

// =============================================================================
// Configuration and State
// =============================================================================

const KnowledgeIndex = {
  // State
  enabled: false,
  initialized: false,
  backendAvailable: false,
  indexingInProgress: false,
  
  // Configuration
  config: {
    // API endpoints
    indexNoteEndpoint: '/v1/index/notes',
    deleteIndexEndpoint: '/v1/index/notes',
    rebuildIndexEndpoint: '/v1/index/rebuild',
    indexStatusEndpoint: '/v1/index/status',
    indexStatsEndpoint: '/v1/index/stats',
    hybridSearchEndpoint: '/v1/index/search/hybrid',
    
    // Settings
    autoIndex: true,
    batchSize: 10,
    retryDelay: 1000,  // 1 second
    maxRetries: 3,
    
    // Content limits
    maxContentLength: 200000,  // 200K characters
    maxChunkSize: 1600,  // tokens
    maxChunksPerNote: 100,
  },
  
  // Statistics
  stats: {
    totalNotes: 0,
    indexedNotes: 0,
    pendingNotes: 0,
    failedNotes: 0,
    lastBackfillAt: null,
    backfillCompleted: false,
  },
  
  // Queue
  queue: [],
  processing: new Set(),
  failed: new Map(),
  
  // Callbacks
  callbacks: {
    onStatusChange: null,
    onIndexComplete: null,
    onIndexError: null,
  },
  
  // Timers
  timers: {
    retryTimer: null,
    statusTimer: null,
  },
};

// =============================================================================
// Initialization
// =============================================================================

/**
 * Initialize the knowledge index service.
 * Must be called after Firebase auth is available.
 */
async function initKnowledgeIndex() {
  if (KnowledgeIndex.initialized) return;
  
  KnowledgeIndex.enabled = true;
  KnowledgeIndex.backendAvailable = await checkBackendAvailable();
  
  // Load saved state
  loadIndexState();
  
  // Start periodic status checks
  startStatusMonitor();
  
  // Check if backfill is needed
  checkBackfillStatus();
  
  KnowledgeIndex.initialized = true;
  console.log('[KnowledgeIndex] Initialized');
  
  // Register with existing systems
  registerWithNoteSystem();
  registerWithLibrarySystem();
  registerWithVoiceSystem();
}

/**
 * Check if the backend is available.
 */
async function checkBackendAvailable() {
  try {
    const response = await fetch('/v1/healthz', {
      method: 'GET',
      headers: getAuthHeaders(),
    });
    return response.ok;
  } catch (error) {
    console.warn('[KnowledgeIndex] Backend not available:', error);
    return false;
  }
}

/**
 * Get authentication headers for backend requests.
 */
function getAuthHeaders() {
  const token = currentSession?.user?.accessToken;
  const headers = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

/**
 * Get the current user ID.
 */
function getCurrentUid() {
  return currentSession?.user?.uid || '';
}

// =============================================================================
// State Management
// =============================================================================

/**
 * Save index state to localStorage.
 */
function saveIndexState() {
  try {
    const state = {
      stats: KnowledgeIndex.stats,
      queue: KnowledgeIndex.queue,
      failed: Object.fromEntries(KnowledgeIndex.failed),
      lastUpdated: Date.now(),
    };
    localStorage.setItem('notez-knowledge-index-state', JSON.stringify(state));
  } catch (error) {
    console.warn('[KnowledgeIndex] Failed to save state:', error);
  }
}

/**
 * Load index state from localStorage.
 */
function loadIndexState() {
  try {
    const saved = localStorage.getItem('notez-knowledge-index-state');
    if (saved) {
      const state = JSON.parse(saved);
      KnowledgeIndex.stats = state.stats || KnowledgeIndex.stats;
      KnowledgeIndex.queue = state.queue || KnowledgeIndex.queue;
      KnowledgeIndex.failed = new Map(Object.entries(state.failed || {}));
    }
  } catch (error) {
    console.warn('[KnowledgeIndex] Failed to load state:', error);
  }
}

// =============================================================================
// Indexing Operations
// =============================================================================

/**
 * Enqueue a note for indexing.
 * 
 * @param {string} noteId - The note ID to index
 * @param {object} note - The note data
 * @param {string} operation - 'index', 'delete', or 'reindex'
 * @param {object} options - Additional options
 */
async function enqueueForIndexing(noteId, note, operation = 'index', options = {}) {
  if (!KnowledgeIndex.enabled || !currentSession) return;
  
  const uid = getCurrentUid();
  if (!uid) return;
  
  // Skip if already in queue or processing
  const queueKey = `${operation}:${noteId}`;
  if (KnowledgeIndex.processing.has(queueKey) || 
      KnowledgeIndex.queue.some(item => item.noteId === noteId && item.operation === operation)) {
    return;
  }
  
  // Prepare content hash if available
  let contentHash = null;
  if (note && operation !== 'delete') {
    contentHash = computeContentHash(note);
  }
  
  // Create job
  const job = {
    id: generateJobId(noteId, operation),
    noteId,
    operation,
    uid,
    contentHash,
    timestamp: Date.now(),
    retryCount: 0,
    ...options,
  };
  
  // Add to queue
  KnowledgeIndex.queue.push(job);
  saveIndexState();
  
  // Trigger processing
  await processQueue();
  
  console.log(`[KnowledgeIndex] Enqueued ${operation} for note ${noteId}`);
}

/**
 * Remove a note from the index.
 * 
 * @param {string} noteId - The note ID to remove
 */
async function removeFromIndex(noteId) {
  await enqueueForIndexing(noteId, null, 'delete');
}

/**
 * Reindex a note (force re-indexing).
 * 
 * @param {string} noteId - The note ID to reindex
 * @param {object} note - The note data
 */
async function reindexNote(noteId, note) {
  await enqueueForIndexing(noteId, note, 'reindex');
}

/**
 * Process the indexing queue.
 */
async function processQueue() {
  if (!KnowledgeIndex.enabled || !KnowledgeIndex.backendAvailable) return;
  
  if (KnowledgeIndex.indexingInProgress) return;
  KnowledgeIndex.indexingInProgress = true;
  
  try {
    while (KnowledgeIndex.queue.length > 0) {
      const job = KnowledgeIndex.queue.shift();
      const queueKey = `${job.operation}:${job.noteId}`;
      
      // Skip if already processing
      if (KnowledgeIndex.processing.has(queueKey)) continue;
      
      KnowledgeIndex.processing.add(queueKey);
      saveIndexState();
      
      try {
        await processJob(job);
        KnowledgeIndex.processing.delete(queueKey);
      } catch (error) {
        KnowledgeIndex.processing.delete(queueKey);
        
        // Track failure
        job.retryCount = (job.retryCount || 0) + 1;
        if (job.retryCount >= KnowledgeIndex.config.maxRetries) {
          KnowledgeIndex.failed.set(job.id, { job, error: error.message });
          saveIndexState();
          console.error(`[KnowledgeIndex] Failed to ${job.operation} note ${job.noteId}:`, error);
          
          // Trigger error callback
          if (KnowledgeIndex.callbacks.onIndexError) {
            KnowledgeIndex.callbacks.onIndexError(job, error);
          }
        } else {
          // Requeue for retry
          job.timestamp = Date.now();
          KnowledgeIndex.queue.unshift(job);
          saveIndexState();
        }
      }
    }
  } finally {
    KnowledgeIndex.indexingInProgress = false;
    saveIndexState();
  }
}

/**
 * Process a single indexing job.
 * 
 * @param {object} job - The job to process
 */
async function processJob(job) {
  const uid = job.uid || getCurrentUid();
  if (!uid) throw new Error('No user ID');
  
  const headers = getAuthHeaders();
  const baseUrl = window.notezAiApiBaseUrl || '';
  
  switch (job.operation) {
    case 'index':
    case 'reindex':
      // Get note data if not provided
      let note = job.note;
      if (!note) {
        note = notes.find(n => n.id === job.noteId);
      }
      
      if (!note) {
        throw new Error(`Note ${job.noteId} not found`);
      }
      
      // Prepare note for indexing
      const indexData = prepareNoteForIndexing(note);
      
      // Send to backend
      const response = await fetch(`${baseUrl}${KnowledgeIndex.config.indexNoteEndpoint.replace(':note_id', job.noteId)}`, {
        method: job.operation === 'delete' ? 'DELETE' : 'POST',
        headers,
        body: JSON.stringify(indexData),
      });
      
      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Backend error: ${response.status} - ${error}`);
      }
      
      const result = await response.json();
      
      if (result.indexed) {
        // Update stats
        KnowledgeIndex.stats.indexedNotes++;
        saveIndexState();
        
        // Trigger completion callback
        if (KnowledgeIndex.callbacks.onIndexComplete) {
          KnowledgeIndex.callbacks.onIndexComplete(job.noteId);
        }
      }
      
      break;
    
    case 'delete':
      // Send delete request to backend
      const deleteResponse = await fetch(`${baseUrl}${KnowledgeIndex.config.deleteIndexEndpoint.replace(':note_id', job.noteId)}`, {
        method: 'DELETE',
        headers,
      });
      
      if (!deleteResponse.ok) {
        const error = await deleteResponse.text();
        throw new Error(`Delete error: ${deleteResponse.status} - ${error}`);
      }
      
      const deleteResult = await deleteResponse.json();
      
      if (deleteResult.deleted) {
        // Note: We don't decrement indexedNotes here as it's handled by the backend
        console.log(`[KnowledgeIndex] Removed note ${job.noteId} from index`);
      }
      
      break;
    
    default:
      throw new Error(`Unknown operation: ${job.operation}`);
  }
}

/**
 * Prepare a note for indexing by extracting and sanitizing content.
 * 
 * @param {object} note - The note to prepare
 * @returns {object} - The prepared note data for indexing
 */
function prepareNoteForIndexing(note) {
  // Extract all searchable text
  const text = extractSearchableText(note);
  
  // Sanitize for indexing (remove secrets, etc.)
  const cleanText = sanitizeForIndexing(text);
  
  if (!cleanText.trim()) {
    // No indexable content
    return null;
  }
  
  return {
    id: note.id,
    title: note.title || 'Untitled note',
    subject: note.subject || '',
    folderPath: note.folderPath || '',
    tags: note.tags || [],
    kind: note.kind || 'note',
    body: note.body || '',
    htmlReadableText: note.htmlReadableText || '',
    fileName: note.fileName || '',
    mimeType: note.mimeType || '',
    updatedAt: note.updatedAt || Date.now(),
    createdAt: note.createdAt || Date.now(),
    // Add metadata
    _notez_meta: {
      contentHash: computeContentHash(note),
      wordCount: countWords(cleanText),
      charCount: cleanText.length,
    },
  };
}

/**
 * Extract all searchable text from a note.
 * 
 * @param {object} note - The note
 * @returns {string} - Combined searchable text
 */
function extractSearchableText(note) {
  const parts = [];
  
  // Title
  if (note.title) {
    parts.push(note.title);
  }
  
  // Subject
  if (note.subject) {
    parts.push(note.subject);
  }
  
  // Folder path
  if (note.folderPath) {
    parts.push(note.folderPath);
  }
  
  // Tags
  if (note.tags && note.tags.length > 0) {
    parts.push(note.tags.join(' '));
  }
  
  // Body
  if (note.body) {
    parts.push(note.body);
  }
  
  // HTML readable text
  if (note.htmlReadableText) {
    parts.push(note.htmlReadableText);
  }
  
  // File name
  if (note.fileName) {
    parts.push(note.fileName);
  }
  
  return parts.filter(Boolean).join('\n').slice(0, KnowledgeIndex.config.maxContentLength);
}

/**
 * Sanitize text for indexing by removing potentially sensitive information.
 * 
 * @param {string} text - Text to sanitize
 * @returns {string} - Sanitized text
 */
function sanitizeForIndexing(text) {
  if (!text) return text;
  
  // Patterns for sensitive data
  const secretPatterns = [
    // API keys and tokens
    [/(?:api[_-]?|secret[_-]?|password[_-]?|token[_-]?|key[_-]?|credential[s]?)[_:\s-]*(?:["']?)([A-Za-z0-9\-_.]{20,})/gi, '[REDACTED_KEY]'],
    [/Bearer\s+[A-Za-z0-9\-_]+/gi, '[REDACTED_TOKEN]'],
    
    // Private keys
    [/-----BEGIN\s+(?:RSA\s+|EC\s+|DSA\s+|OPENSSH\s+)?PRIVATE\s+KEY-----/i, '[REDACTED_PRIVATE_KEY]'],
    
    // Specific key formats
    [/sk-[a-zA-Z0-9]{40,}/g, '[REDACTED_OPENAI_KEY]'],
    [/xox[baprs]-[a-zA-Z0-9]{10,}/g, '[REDACTED_SLACK_TOKEN]'],
    [/AKIA[0-9A-Z]{16}/g, '[REDACTED_AWS_KEY]'],
    [/pkey-[a-zA-Z0-9]{20,}/g, '[REDACTED_PKEY]'],
  ];
  
  let clean = text;
  secretPatterns.forEach(([pattern, replacement]) => {
    clean = clean.replace(pattern, replacement);
  });
  
  return clean;
}

/**
 * Compute a content hash for a note.
 * 
 * @param {object} note - The note
 * @returns {string} - SHA-256 hash of the content
 */
function computeContentHash(note) {
  const text = extractSearchableText(note);
  const clean = sanitizeForIndexing(text);
  
  // Use crypto if available, otherwise simple hash
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(clean);
    return crypto.subtle.digest('SHA-256', data).then(buf => {
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    });
  } else {
    // Fallback: simple hash
    let hash = 0;
    for (let i = 0; i < clean.length; i++) {
      const char = clean.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(16);
  }
}

/**
 * Count words in text.
 * 
 * @param {string} text - Text to count
 * @returns {number} - Word count
 */
function countWords(text) {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Generate a unique job ID.
 * 
 * @param {string} noteId - Note ID
 * @param {string} operation - Operation type
 * @returns {string} - Job ID
 */
function generateJobId(noteId, operation) {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `${operation}:${noteId}:${timestamp}:${random}`;
}

// =============================================================================
// Backfill Operations
// =============================================================================

/**
 * Trigger a backfill of all notes for the current user.
 * 
 * @param {object} options - Backfill options
 * @param {boolean} options.force - Force re-indexing
 * @param {Function} onProgress - Progress callback
 */
async function triggerBackfill(options = {}, onProgress = null) {
  if (!KnowledgeIndex.enabled || !currentSession) return;
  
  const uid = getCurrentUid();
  if (!uid) return;
  
  const headers = getAuthHeaders();
  const baseUrl = window.notezAiApiBaseUrl || '';
  
  try {
    const response = await fetch(`${baseUrl}${KnowledgeIndex.config.rebuildIndexEndpoint}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        force: options.force || false,
      }),
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Backfill failed: ${response.status} - ${error}`);
    }
    
    const result = await response.json();
    
    // Update stats
    if (result.status === 'completed' || result.status === 'already_completed') {
      KnowledgeIndex.stats.backfillCompleted = true;
      KnowledgeIndex.stats.lastBackfillAt = Date.now();
      KnowledgeIndex.stats.indexedNotes = result.indexedNotes || result.indexedChunks || 0;
      saveIndexState();
    }
    
    if (onProgress) {
      onProgress({
        status: result.status,
        total: result.totalNotes || 0,
        processed: result.processed || 0,
        skipped: result.skipped || 0,
        failed: result.failed || 0,
      });
    }
    
    return result;
  } catch (error) {
    console.error('[KnowledgeIndex] Backfill error:', error);
    throw error;
  }
}

/**
 * Check the current backfill status.
 */
async function checkBackfillStatus() {
  if (!KnowledgeIndex.enabled || !currentSession) return;
  
  const uid = getCurrentUid();
  if (!uid) return;
  
  const headers = getAuthHeaders();
  const baseUrl = window.notezAiApiBaseUrl || '';
  
  try {
    const response = await fetch(`${baseUrl}/v1/index/status`, {
      method: 'GET',
      headers,
    });
    
    if (response.ok) {
      const data = await response.json();
      KnowledgeIndex.stats = {
        ...KnowledgeIndex.stats,
        ...data.backfill,
        indexedNotes: data.index?.noteCount || data.queue?.indexedNotes || 0,
        totalNotes: data.queue?.totalNotes || 0,
        pendingNotes: data.queue?.pending || 0,
        failedNotes: data.queue?.failedNotes || 0,
      };
      saveIndexState();
    }
  } catch (error) {
    console.warn('[KnowledgeIndex] Failed to check backfill status:', error);
  }
}

/**
 * Get the current indexing status.
 * 
 * @returns {object} - Current status
 */
function getIndexStatus() {
  return {
    ...KnowledgeIndex.stats,
    queueLength: KnowledgeIndex.queue.length,
    processingCount: KnowledgeIndex.processing.size,
    failedCount: KnowledgeIndex.failed.size,
    enabled: KnowledgeIndex.enabled,
    backendAvailable: KnowledgeIndex.backendAvailable,
  };
}

// =============================================================================
// Hybrid Search
// =============================================================================

/**
 * Perform a hybrid search on the user's knowledge index.
 * 
 * @param {string} query - The search query
 * @param {object} options - Search options
 * @param {number} options.limit - Maximum results
 * @param {string} options.scope - Search scope ('all', 'folder', 'note')
 * @param {string} options.folderPath - Folder path for scoped search
 * @param {string} options.noteId - Specific note ID for search
 * @returns {Promise<object>} - Search results with metadata
 */
async function hybridSearch(query, options = {}) {
  if (!KnowledgeIndex.enabled || !currentSession) {
    return {
      results: [],
      retrievalMetadata: {
        retrievalMethod: 'none',
        message: 'Knowledge index not available',
      },
    };
  }
  
  const uid = getCurrentUid();
  if (!uid) {
    return {
      results: [],
      retrievalMetadata: {
        retrievalMethod: 'none',
        message: 'Not authenticated',
      },
    };
  }
  
  const headers = getAuthHeaders();
  const baseUrl = window.notezAiApiBaseUrl || '';
  
  const requestBody = {
    query,
    limit: options.limit || 5,
    scope: options.scope || 'all',
    folder_path: options.folderPath,
    note_id: options.noteId,
    use_hybrid: options.useHybrid !== false,  // default true
    use_keyword: options.useKeyword !== false,  // default true
  };
  
  try {
    const response = await fetch(`${baseUrl}${KnowledgeIndex.config.hybridSearchEndpoint}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Search failed: ${response.status} - ${error}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('[KnowledgeIndex] Search error:', error);
    return {
      results: [],
      retrievalMetadata: {
        retrievalMethod: 'none',
        error: error.message,
      },
    };
  }
}

/**
 * Retrieve relevant context for a query.
 * 
 * @param {string} query - The query
 * @param {object} options - Options
 * @returns {Promise<string>} - Formatted context for LLM prompt
 */
async function retrieveRelevantContext(query, options = {}) {
  const result = await hybridSearch(query, {
    limit: options.limit || 5,
    ...options,
  });
  
  if (!result.results || result.results.length === 0) {
    return {
      context: '',
      sources: [],
      retrievalMetadata: result.retrievalMetadata,
    };
  }
  
  // Format context for LLM
  const contextParts = result.results.map((r, index) => {
    return `Source ${index + 1} [${r.title || 'Untitled'}]:\n${r.text}\n`;
  });
  
  const context = contextParts.join('\n---\n');
  const sources = result.results.map((r, index) => ({
    id: String(index + 1),
    noteId: r.id,
    title: r.title || 'Untitled',
    folderPath: r.folderPath || '',
    similarity: r.similarity || 0,
  }));
  
  return {
    context,
    sources,
    retrievalMetadata: result.retrievalMetadata,
  };
}

// =============================================================================
// Integration with Existing Systems
// =============================================================================

/**
 * Register indexing triggers with the note system.
 */
function registerWithNoteSystem() {
  // Hook into note save
  const originalPersistNote = window.persistNote;
  if (originalPersistNote) {
    window.persistNote = async function(note, ...args) {
      const result = await originalPersistNote.apply(this, [note, ...args]);
      
      // Trigger indexing after successful save
      if (result && currentSession) {
        await enqueueForIndexing(note.id, note, 'index');
      }
      
      return result;
    };
  }
  
  // Hook into note deletion
  const originalDeleteNote = window.deleteNote;
  if (originalDeleteNote) {
    window.deleteNote = async function(noteId, ...args) {
      const result = await originalDeleteNote.apply(this, [noteId, ...args]);
      
      // Trigger index removal after deletion
      if (result && currentSession) {
        await removeFromIndex(noteId);
      }
      
      return result;
    };
  }
  
  // Hook into note restoration
  const originalRestoreNote = window.restoreNote;
  if (originalRestoreNote) {
    window.restoreNote = async function(note, ...args) {
      const result = await originalRestoreNote.apply(this, [note, ...args]);
      
      // Trigger re-indexing after restoration
      if (result && currentSession) {
        await enqueueForIndexing(note.id, note, 'reindex');
      }
      
      return result;
    };
  }
}

/**
 * Register indexing triggers with the library system.
 */
function registerWithLibrarySystem() {
  // Hook into PDF import
  const originalImportPdf = window.importPdf;
  if (originalImportPdf) {
    window.importPdf = async function(file, ...args) {
      const result = await originalImportPdf.apply(this, [file, ...args]);
      
      // If the PDF is saved as a note, trigger indexing
      if (result && result.note && currentSession) {
        await enqueueForIndexing(result.note.id, result.note, 'index');
      }
      
      return result;
    };
  }
  
  // Hook into generic file import
  const originalImportFile = window.importFile;
  if (originalImportFile) {
    window.importFile = async function(file, ...args) {
      const result = await originalImportFile.apply(this, [file, ...args]);
      
      // If the file is saved as a note, trigger indexing
      if (result && result.note && currentSession) {
        await enqueueForIndexing(result.note.id, result.note, 'index');
      }
      
      return result;
    };
  }
}

/**
 * Register indexing triggers with the voice system.
 */
function registerWithVoiceSystem() {
  // Hook into transcript save
  const originalSaveTranscript = window.saveTranscript;
  if (originalSaveTranscript) {
    window.saveTranscript = async function(transcript, ...args) {
      const result = await originalSaveTranscript.apply(this, [transcript, ...args]);
      
      // Trigger indexing of the transcript note
      if (result && result.note && currentSession) {
        await enqueueForIndexing(result.note.id, result.note, 'index');
      }
      
      return result;
    };
  }
  
  // Hook into AI notes save
  const originalSaveAiNotes = window.saveAiNotes;
  if (originalSaveAiNotes) {
    window.saveAiNotes = async function(notes, ...args) {
      const result = await originalSaveAiNotes.apply(this, [notes, ...args]);
      
      // Trigger indexing of AI-generated notes
      if (result && currentSession) {
        for (const note of notes) {
          await enqueueForIndexing(note.id, note, 'index');
        }
      }
      
      return result;
    };
  }
}

// =============================================================================
// Status Monitoring
// =============================================================================

/**
 * Start periodic status monitoring.
 */
function startStatusMonitor() {
  // Clear existing timer
  if (KnowledgeIndex.timers.statusTimer) {
    clearInterval(KnowledgeIndex.timers.statusTimer);
  }
  
  // Check status every 30 seconds
  KnowledgeIndex.timers.statusTimer = setInterval(() => {
    if (KnowledgeIndex.enabled && currentSession) {
      checkBackfillStatus();
    }
  }, 30000);
}

/**
 * Stop status monitoring.
 */
function stopStatusMonitor() {
  if (KnowledgeIndex.timers.statusTimer) {
    clearInterval(KnowledgeIndex.timers.statusTimer);
    KnowledgeIndex.timers.statusTimer = null;
  }
}

// =============================================================================
// UI Integration
// =============================================================================

/**
 * Render the knowledge index status panel.
 * 
 * @param {HTMLElement} container - Container element
 */
function renderIndexStatus(container) {
  const status = getIndexStatus();
  
  const markup = `
    <div class="knowledge-index-status">
      <div class="ki-header">
        <h3>Knowledge Index</h3>
        <span class="ki-status-badge ${status.backendAvailable ? 'available' : 'unavailable'}">
          ${status.backendAvailable ? 'Backend Available' : 'Backend Unavailable'}
        </span>
      </div>
      
      <div class="ki-stats">
        <div class="ki-stat">
          <span class="ki-stat-label">Total Notes</span>
          <span class="ki-stat-value">${status.totalNotes}</span>
        </div>
        <div class="ki-stat">
          <span class="ki-stat-label">Indexed</span>
          <span class="ki-stat-value">${status.indexedNotes}</span>
        </div>
        <div class="ki-stat">
          <span class="ki-stat-label">Pending</span>
          <span class="ki-stat-value">${status.pendingNotes + status.queueLength}</span>
        </div>
        <div class="ki-stat">
          <span class="ki-stat-label">Failed</span>
          <span class="ki-stat-value">${status.failedNotes + status.failedCount}</span>
        </div>
      </div>
      
      <div class="ki-backfill">
        <div class="ki-backfill-label">Backfill Status</div>
        <div class="ki-backfill-value">
          ${status.backfillCompleted ? `${typeof svgIcon === 'function' ? svgIcon('check', 13) : ''} Completed` : `${typeof svgIcon === 'function' ? svgIcon('clock', 13) : ''} In Progress`}
          ${status.lastBackfillAt ? ` (${new Date(status.lastBackfillAt).toLocaleString()})` : ''}
        </div>
      </div>
      
      <div class="ki-actions">
        <button type="button" class="ki-action-btn" onclick="triggerBackfillNow()">
          ${status.backfillCompleted ? 'Rebuild Index' : 'Start Backfill'}
        </button>
        <button type="button" class="ki-action-btn" onclick="clearIndexQueue()">
          Clear Queue
        </button>
      </div>
    </div>
    
    <style>
      .knowledge-index-status {
        font-family: system-ui, -apple-system, sans-serif;
        font-size: 13px;
        padding: 16px;
        background: var(--nz-bg-secondary);
        border-radius: 12px;
        border: 1px solid var(--nz-border);
      }
      .ki-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;
      }
      .ki-header h3 {
        margin: 0;
        font-size: 14px;
        font-weight: 600;
      }
      .ki-status-badge {
        padding: 4px 8px;
        border-radius: 6px;
        font-size: 11px;
        font-weight: 500;
      }
      .ki-status-badge.available {
        background: color-mix(in srgb, var(--nz-accent) 15%, transparent);
        color: var(--nz-accent);
      }
      .ki-status-badge.unavailable {
        background: color-mix(in srgb, #d49a36 15%, transparent);
        color: #d49a36;
      }
      .ki-stats {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 12px;
        margin-bottom: 12px;
      }
      .ki-stat {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .ki-stat-label {
        font-size: 11px;
        opacity: 0.7;
      }
      .ki-stat-value {
        font-size: 18px;
        font-weight: 600;
      }
      .ki-backfill {
        margin-bottom: 12px;
        padding: 8px;
        background: var(--nz-bg-tertiary);
        border-radius: 8px;
      }
      .ki-backfill-label {
        font-size: 11px;
        opacity: 0.7;
        margin-bottom: 4px;
      }
      .ki-backfill-value {
        font-size: 13px;
      }
      .ki-actions {
        display: flex;
        gap: 8px;
      }
      .ki-action-btn {
        padding: 8px 16px;
        border-radius: 8px;
        border: 1px solid var(--nz-border);
        background: var(--nz-bg-secondary);
        color: var(--nz-text);
        cursor: pointer;
        font-size: 12px;
        font-weight: 500;
        transition: all 0.2s;
      }
      .ki-action-btn:hover {
        background: color-mix(in srgb, var(--nz-accent) 15%, var(--nz-bg-secondary));
        border-color: var(--nz-accent);
      }
    </style>
  `;
  
  container.innerHTML = markup;
}

/**
 * Trigger backfill from UI.
 */
async function triggerBackfillNow() {
  try {
    const result = await triggerBackfill({ force: true }, (progress) => {
      console.log('[KnowledgeIndex] Backfill progress:', progress);
      // Could update UI here
    });
    
    if (result.status === 'completed') {
      toast(`Backfill complete: ${result.processed} notes indexed`);
    } else if (result.status === 'already_completed') {
      toast('Backfill already completed');
    } else {
      toast(`Backfill: ${result.message || 'Unknown status'}`);
    }
  } catch (error) {
    toast(`Backfill failed: ${error.message}`, 'error');
  }
}

/**
 * Clear the indexing queue.
 */
async function clearIndexQueue() {
  KnowledgeIndex.queue = [];
  KnowledgeIndex.failed.clear();
  saveIndexState();
  toast('Indexing queue cleared');
}

// =============================================================================
// Public API
// =============================================================================

// Export the main object and functions
window.KnowledgeIndex = KnowledgeIndex;
window.initKnowledgeIndex = initKnowledgeIndex;
window.enqueueForIndexing = enqueueForIndexing;
window.removeFromIndex = removeFromIndex;
window.reindexNote = reindexNote;
window.triggerBackfill = triggerBackfill;
window.hybridSearch = hybridSearch;
window.retrieveRelevantContext = retrieveRelevantContext;
window.getIndexStatus = getIndexStatus;
window.renderIndexStatus = renderIndexStatus;

// Initialize when the app is ready
if (typeof document !== 'undefined') {
  // Initialize after Firebase is ready
  const initWhenReady = () => {
    if (window.currentSession && !KnowledgeIndex.initialized) {
      initKnowledgeIndex().catch(error => {
        console.error('[KnowledgeIndex] Initialization failed:', error);
      });
    }
  };
  
  // Check periodically if session becomes available
  const initInterval = setInterval(initWhenReady, 1000);
  
  // Also try immediately
  initWhenReady();
  
  // Clean up when session changes
  const originalLeaveWorkspace = window.leaveWorkspace;
  if (originalLeaveWorkspace) {
    window.leaveWorkspace = async function(...args) {
      stopStatusMonitor();
      clearInterval(initInterval);
      return originalLeaveWorkspace.apply(this, args);
    };
  }
}

console.log('[KnowledgeIndex] Module loaded');
