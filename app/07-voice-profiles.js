// =============================================================================
// Ai-Notez: Voice Profiles & Advanced Speech-to-Text System
// Professional implementation for GenAI course project
// =============================================================================

// =============================================================================
// VOICE PROFILE MANAGEMENT SYSTEM
// =============================================================================

const VOICE_PROFILES_KEY = 'notez-voice-profiles-v1';
const OWNER_VOICE_KEY = 'notez-owner-voice-v1';
const VOICE_CONTEXT_KEY = 'notez-voice-context-v1';

// Voice Profile Storage
function getVoiceProfiles() {
  try {
    const stored = localStorage.getItem(VOICE_PROFILES_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveVoiceProfiles(profiles) {
  try {
    localStorage.setItem(VOICE_PROFILES_KEY, JSON.stringify(profiles));
  } catch {
    console.warn('Could not save voice profiles');
  }
}

function getOwnerVoiceProfile() {
  try {
    const stored = localStorage.getItem(OWNER_VOICE_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

function saveOwnerVoiceProfile(profile) {
  try {
    localStorage.setItem(OWNER_VOICE_KEY, JSON.stringify(profile));
  } catch {
    console.warn('Could not save owner voice profile');
  }
}

function getVoiceContext() {
  try {
    const stored = localStorage.getItem(VOICE_CONTEXT_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

function saveVoiceContext(context) {
  try {
    localStorage.setItem(VOICE_CONTEXT_KEY, JSON.stringify(context));
  } catch {
    console.warn('Could not save voice context');
  }
}

// =============================================================================
// GEMINI SPEECH-TO-TEXT: Latest API with Real-Time Streaming
// =============================================================================

// Enhanced recording configuration
const RECORD_CONFIG = {
  segmentMs: 15000,       // Shorter segments for lower latency
  maxDurationMs: 60 * 60 * 1000,  // 1 hour max
  sampleRate: 48000,      // High quality
  bitsPerSecond: 48000
};

// Recording status constants
const RECORDING_STATUS = {
  IDLE: 'idle',
  RECORDING: 'recording',
  PAUSED: 'paused',
  TRANSCRIBING: 'transcribing',
  CATCHING_UP: 'catching-up',
  FINALIZING: 'finalizing',
  SAVED: 'saved',
  NEEDS_ATTENTION: 'needs-attention'
};

// Language settings
const RECORDING_LANGUAGES = {
  auto: { label: 'Auto-detect', code: 'auto' },
  en: { label: 'English', code: 'en' },
  ur: { label: 'Urdu', code: 'ur' },
  ur_roman: { label: 'Roman Urdu', code: 'ur-Latn' }
};

const VOICE_RECORDING_KEY = 'notez-recording-settings-v1';

// Detect supported MIME type
function getSupportedMimeType() {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  if (window.MediaRecorder && MediaRecorder.isTypeSupported) {
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }
  }
  return 'audio/webm';
}

// Speaker diarization state
const SPEAKER_STATE = {
  profiles: [],
  currentSpeakers: new Map(),
  ownerVoiceId: null,
  isRecording: false,
  isPaused: false,
  isStopping: false,
  mediaRecorder: null,
  audioChunks: [],
  processingQueue: Promise.resolve(),
  transcriptSegments: [],
  rawTranscriptSegments: [],
  liveTranscript: '',
  rawTranscript: '',
  liveNotes: '',
  startTime: 0,
  elapsedMs: 0,
  stream: null,
  segmentInterval: null,
  mimeType: null,
  mode: null,
  language: 'auto',
  status: RECORDING_STATUS.IDLE,
  segmentTiming: [],
  failedSegments: [],
  needsReview: []
};

// Initialize voice profiles from storage
function initVoiceProfiles() {
  SPEAKER_STATE.profiles = getVoiceProfiles();
  const ownerProfile = getOwnerVoiceProfile();
  if (ownerProfile) {
    SPEAKER_STATE.ownerVoiceId = ownerProfile.id;
  }
  
  // Initialize recording settings
  loadRecordingSettings();
}

// Recording settings management
function getRecordingSettings() {
  try {
    const stored = localStorage.getItem(VOICE_RECORDING_KEY);
    return stored ? JSON.parse(stored) : { language: 'auto' };
  } catch {
    return { language: 'auto' };
  }
}

function saveRecordingSettings(settings) {
  try {
    localStorage.setItem(VOICE_RECORDING_KEY, JSON.stringify(settings));
  } catch {
    console.warn('Could not save recording settings');
  }
}

function loadRecordingSettings() {
  const settings = getRecordingSettings();
  SPEAKER_STATE.language = settings.language || 'auto';
}

function setRecordingLanguage(lang) {
  if (RECORDING_LANGUAGES[lang]) {
    SPEAKER_STATE.language = lang;
    saveRecordingSettings({ language: lang });
    return true;
  }
  return false;
}

// Segment tracking with timing
function addSegmentTiming(segmentIndex, startTime, endTime, duration) {
  SPEAKER_STATE.segmentTiming[segmentIndex] = {
    startTime,
    endTime,
    duration,
    processed: false,
    processingStart: null
  };
}

// Track failed segments for retry
function markSegmentFailed(segmentIndex, error) {
  SPEAKER_STATE.failedSegments.push({
    index: segmentIndex,
    error: error?.message || String(error),
    timestamp: Date.now()
  });
}

function markSegmentNeedsReview(segmentIndex, reason) {
  SPEAKER_STATE.needsReview.push({
    index: segmentIndex,
    reason: reason,
    timestamp: Date.now()
  });
}

// Update recording status
function updateRecordingStatus(status) {
  SPEAKER_STATE.status = status;
  updateRecordingUI();
}

// Get current status label
function getStatusLabel() {
  const status = SPEAKER_STATE.status || RECORDING_STATUS.IDLE;
  const labels = {
    [RECORDING_STATUS.IDLE]: 'Ready',
    [RECORDING_STATUS.RECORDING]: 'Recording',
    [RECORDING_STATUS.PAUSED]: 'Paused',
    [RECORDING_STATUS.TRANSCRIBING]: 'Transcribing',
    [RECORDING_STATUS.CATCHING_UP]: 'Catching up',
    [RECORDING_STATUS.FINALIZING]: 'Finalizing',
    [RECORDING_STATUS.SAVED]: 'Saved',
    [RECORDING_STATUS.NEEDS_ATTENTION]: 'Needs attention'
  };
  return labels[status] || 'Ready';
}

// =============================================================================
// ENHANCED TRANSCRIPTION WITH SPEAKER IDENTIFICATION
// =============================================================================

// Speaker detection using voice characteristics
function detectSpeakerFromText(text, knownVoices = []) {
  const lines = text.split('\n').filter(line => line.trim());
  const voicePattern = /^Voice\s+(\d+)/i;
  
  const detectedVoices = new Set();
  const voiceMap = new Map();
  
  lines.forEach(line => {
    const match = line.match(voicePattern);
    if (match) {
      const voiceNum = match[1];
      detectedVoices.add(voiceNum);
      const voiceText = line.replace(voicePattern, '').replace(/^\[?\d{2}:\d{2}\]?\s*/, '').trim();
      if (!voiceMap.has(voiceNum)) {
        voiceMap.set(voiceNum, []);
      }
      voiceMap.get(voiceNum).push(voiceText);
    }
  });
  
  return { detectedVoices: Array.from(detectedVoices), voiceMap };
}

// Match detected voices to known profiles
function matchVoicesToProfiles(detectedVoices, voiceTexts) {
  const profiles = getVoiceProfiles();
  const matches = {};
  
  // Simple matching based on voice characteristics
  detectedVoices.forEach((voiceNum, index) => {
    const sampleText = voiceTexts.get(voiceNum)?.[0] || '';
    
    // Check if this matches owner's voice based on context
    const ownerProfile = getOwnerVoiceProfile();
    if (ownerProfile && ownerProfile.sampleText) {
      // Simple similarity check (can be enhanced with embeddings)
      const similarity = calculateTextSimilarity(sampleText, ownerProfile.sampleText);
      if (similarity > 0.7) {
        matches[voiceNum] = { ...ownerProfile, matchedBy: 'text-similarity' };
        return;
      }
    }
    
    // Match with stored profiles
    for (const profile of profiles) {
      if (profile.sampleText) {
        const similarity = calculateTextSimilarity(sampleText, profile.sampleText);
        if (similarity > 0.6) {
          matches[voiceNum] = { ...profile, matchedBy: 'text-similarity' };
          break;
        }
      }
    }
  });
  
  return matches;
}

// Simple text similarity for voice matching
function calculateTextSimilarity(text1, text2) {
  const words1 = text1.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const words2 = text2.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  
  const common = new Set(words1).intersection(new Set(words2));
  const total = new Set([...words1, ...words2]).size;
  
  return total > 0 ? common.size / total : 0;
}

// =============================================================================
// REAL-TIME STREAMING TRANSCRIPTION
// =============================================================================

// Enhanced transcription prompt with speaker identification
function getEnhancedTranscriptionPrompt(segmentIndex, knownVoices = []) {
  const voiceDescriptions = knownVoices.map(v => 
    `Voice ${v.id}: ${v.name || 'Unknown'} (${v.description || 'No description'})`
  ).join(', ');
  
  return `Transcribe this audio segment (${segmentIndex + 1}) with the following requirements:

1. IDENTIFY SPEAKERS: Label each speaking turn as "Voice 1:", "Voice 2:", etc. Use the same number for the same person throughout.

2. KNOWN VOICES: ${voiceDescriptions || 'None identified yet'}.
   - If you recognize a known voice, use their name instead of "Voice N"
   - The app owner's voice should be labeled as "[Owner]" or their configured name

3. TIMESTAMPS: Include [MM:SS] at the start of each speaking turn when possible

4. ACCURACY: Transcribe EXACTLY as spoken, in the original language (English, Urdu, etc.)

5. FORMAT: One turn per line, format: [00:00] Voice N: text

6. UNCLEAR AUDIO: Use [inaudible] for anything you cannot hear

7. CONTEXT: This is a ${RECORD_CONFIG.mode || 'classroom'} recording. Maintain academic/professional tone.

Output ONLY the transcript, no additional text.`;
}

// Process audio segment with enhanced transcription
async function processAudioSegment(blob, segmentIndex, knownVoices = []) {
  const prompt = getEnhancedTranscriptionPrompt(segmentIndex, knownVoices);
  
  try {
    // One path for every source: aiCall() sends the audio to NotezAi (default) or straight to Gemini with the user's own key.
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const answer = await aiCall('gemini', prompt, { temperature: 0.1, images: [{ mime: blob.type || 'audio/webm', data: bytesToB64Safe(bytes) }] });
    return answer.text || '';
  } catch (error) {
    console.error('Transcription error:', error);
    return `[Transcription error for segment ${segmentIndex}]`;
  }
}

// =============================================================================
// REAL-TIME RECORDING WITH LIVE TRANSCRIPTION
// =============================================================================

// Start enhanced recording
async function startEnhancedRecording(mode = 'class') {
  // Prevent starting if already recording or stopping
  if (SPEAKER_STATE.isRecording || SPEAKER_STATE.isStopping) {
    toast('Recording is already in progress.', 'error');
    return;
  }
  
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    toast('This browser cannot record audio. Use Chrome or Edge on HTTPS.', 'error', 6000);
    return;
  }
  
  if (!aiReady()) {
    toast('Add a Gemini or Groq key in NotezAi settings.', 'error', 6000);
    return;
  }
  
  // Clean up any previous state
  cleanupRecording();
  
  // Reset state
  SPEAKER_STATE.isRecording = true;
  SPEAKER_STATE.isPaused = false;
  SPEAKER_STATE.isStopping = false;
  SPEAKER_STATE.audioChunks = [];
  SPEAKER_STATE.transcriptSegments = [];
  SPEAKER_STATE.rawTranscriptSegments = [];
  SPEAKER_STATE.liveTranscript = '';
  SPEAKER_STATE.rawTranscript = '';
  SPEAKER_STATE.liveNotes = '';
  SPEAKER_STATE.startTime = Date.now();
  SPEAKER_STATE.mode = mode;
  SPEAKER_STATE.elapsedMs = 0;
  SPEAKER_STATE.segmentTiming = [];
  SPEAKER_STATE.failedSegments = [];
  SPEAKER_STATE.needsReview = [];
  SPEAKER_STATE.status = RECORDING_STATUS.RECORDING;
  updateRecordingStatus(RECORDING_STATUS.RECORDING);
  
  // Get user media
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: RECORD_CONFIG.sampleRate,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
    
    // Detect and use supported MIME type
    const mimeType = getSupportedMimeType();
    SPEAKER_STATE.mimeType = mimeType;
    
    // Create media recorder
    let mediaRecorder;
    try {
      mediaRecorder = new MediaRecorder(stream, {
        mimeType: mimeType,
        audioBitsPerSecond: RECORD_CONFIG.bitsPerSecond
      });
    } catch (error) {
      console.error('Failed to create MediaRecorder with preferred MIME type, falling back:', error);
      // Fallback to default
      mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm',
        audioBitsPerSecond: RECORD_CONFIG.bitsPerSecond
      });
      SPEAKER_STATE.mimeType = 'audio/webm';
    }
    
    SPEAKER_STATE.mediaRecorder = mediaRecorder;
    
    // Data available handler - collect chunks in SPEAKER_STATE
    mediaRecorder.ondataavailable = (event) => {
      if (event.data?.size > 0) {
        SPEAKER_STATE.audioChunks.push(event.data);
      }
    };
    
    // Error handler for media recorder
    mediaRecorder.onerror = (event) => {
      console.error('MediaRecorder error:', event.error);
      toast('Recording error occurred. Please check microphone permissions.', 'error', 6000);
      stopRecording();
    };
    
    // Stop handler - process segment
    mediaRecorder.onstop = async () => {
      // Only process if we have chunks and we're still in recording mode
      if (!SPEAKER_STATE.isRecording && !SPEAKER_STATE.isStopping) {
        return;
      }
      
      if (SPEAKER_STATE.audioChunks.length > 0) {
        const blob = new Blob(SPEAKER_STATE.audioChunks, { type: mimeType });
        const segmentIndex = SPEAKER_STATE.transcriptSegments.length;
        const segmentStartTime = Date.now();
        
        // Update status
        updateRecordingStatus(RECORDING_STATUS.TRANSCRIBING);
        
        // Record timing
        addSegmentTiming(segmentIndex, segmentStartTime, null, null);
        
        // Process in background
        SPEAKER_STATE.processingQueue = SPEAKER_STATE.processingQueue.then(async () => {
          try {
            const knownVoices = getVoiceProfiles();
            const rawTranscript = await processAudioSegment(blob, segmentIndex, knownVoices);
            
            // Preserve raw transcript
            SPEAKER_STATE.rawTranscriptSegments[segmentIndex] = rawTranscript;
            SPEAKER_STATE.rawTranscript = SPEAKER_STATE.rawTranscriptSegments.filter(Boolean).join('\n\n');
            
            // Extract and match speakers
            const { detectedVoices, voiceMap } = detectSpeakerFromText(rawTranscript);
            const voiceMatches = matchVoicesToProfiles(detectedVoices, voiceMap);
            
            // Apply voice labels
            const enhancedTranscript = applyVoiceLabels(rawTranscript, voiceMatches);
            
            SPEAKER_STATE.transcriptSegments[segmentIndex] = enhancedTranscript;
            SPEAKER_STATE.liveTranscript = SPEAKER_STATE.transcriptSegments.filter(Boolean).join('\n\n');
            
            // Update segment timing
            const segmentEndTime = Date.now();
            const segmentDuration = segmentEndTime - segmentStartTime;
            if (SPEAKER_STATE.segmentTiming[segmentIndex]) {
              SPEAKER_STATE.segmentTiming[segmentIndex].endTime = segmentEndTime;
              SPEAKER_STATE.segmentTiming[segmentIndex].duration = segmentDuration;
              SPEAKER_STATE.segmentTiming[segmentIndex].processed = true;
            }
            
            // Generate live notes
            await generateLiveNotes();
            
            // Update status
            updateRecordingStatus(RECORDING_STATUS.RECORDING);
            
            // Update UI
            updateRecordingUI();
          } catch (error) {
            console.error('Segment processing error:', error);
            
            // Mark as failed for retry
            markSegmentFailed(segmentIndex, error);
            
            // Update status to needs attention if there are failed segments
            if (SPEAKER_STATE.failedSegments.length > 0) {
              updateRecordingStatus(RECORDING_STATUS.NEEDS_ATTENTION);
            }
            
            SPEAKER_STATE.transcriptSegments[segmentIndex] = `[Error transcribing segment ${segmentIndex + 1}: ${error.message || 'Unknown error'}]`;
            SPEAKER_STATE.rawTranscriptSegments[segmentIndex] = '';
            updateRecordingUI();
          }
        });
        
        SPEAKER_STATE.audioChunks = []; // Clear for next segment
      }
    };
    
    // Start recording
    mediaRecorder.start();
    
    // Start segment timer
    const segmentInterval = setInterval(() => {
      if (SPEAKER_STATE.isRecording && !SPEAKER_STATE.isPaused && !SPEAKER_STATE.isStopping) {
        mediaRecorder.stop();
        mediaRecorder.start();
      }
    }, RECORD_CONFIG.segmentMs);
    
    // Store interval for cleanup
    SPEAKER_STATE.segmentInterval = segmentInterval;
    SPEAKER_STATE.stream = stream;
    
    // Update UI
    updateRecordingUI();
    toast('Recording started. Transcript appears in real-time.');
    
  } catch (error) {
    console.error('Recording error:', error);
    cleanupRecording();
    
    if (error.name === 'NotAllowedError' || error.message?.includes('permission')) {
      toast('Microphone access was blocked. Please allow microphone access in your browser settings.', 'error', 6000);
    } else if (error.name === 'NotFoundError' || error.message?.includes('not found')) {
      toast('No microphone found. Please connect a microphone.', 'error', 6000);
    } else {
      toast('Could not start recording. Please check your microphone and try again.', 'error', 6000);
    }
  }
}

// Apply voice labels to transcript
function applyVoiceLabels(transcript, voiceMatches) {
  const lines = transcript.split('\n');
  
  return lines.map(line => {
    const voicePattern = /^(Voice\s+\d+)/i;
    const match = line.match(voicePattern);
    
    if (match) {
      const voiceNum = match[1];
      const matchedProfile = voiceMatches[voiceNum.replace('Voice ', '')];
      
      if (matchedProfile) {
        // Replace with profile name
        return line.replace(voicePattern, matchedProfile.name || matchedProfile.label);
      } else if (voiceNum === 'Voice 1' && !SPEAKER_STATE.ownerVoiceId) {
        // Assume first voice is owner if not configured
        const ownerProfile = getOwnerVoiceProfile();
        if (ownerProfile) {
          return line.replace(voicePattern, `[${ownerProfile.name || 'Owner'}]`);
        }
      }
    }
    return line;
  }).join('\n');
}

// Generate live notes from transcript
async function generateLiveNotes() {
  if (!SPEAKER_STATE.liveTranscript || SPEAKER_STATE.liveTranscript.length < 50) {
    return;
  }
  
  const language = SPEAKER_STATE.language || 'auto';
  const langCode = RECORDING_LANGUAGES[language]?.code || 'auto';
  
  // Build language hint for AI
  const langHint = langCode !== 'auto' ? ` Language: ${RECORDING_LANGUAGES[language]?.label || language}.` : '';

  const mode = SPEAKER_STATE.mode || 'class';
  const context = getVoiceContext();
  const ownerProfile = getOwnerVoiceProfile();
  
  const prompt = `Analyze this transcript and create concise, actionable notes. Context: ${mode} recording.${langHint}

${ownerProfile?.context ? 'Owner context: ' + ownerProfile.context : ''}

Transcript:
${SPEAKER_STATE.liveTranscript.slice(-3000)}

Create:
1. Key points (bullet list)
2. Action items
3. Questions to research
4. Important quotes with speaker attribution

Be concise, accurate, and structured. Keep the original language of the transcript. Do not translate.`;
  
  try {
    const result = await aiGenerate(prompt, { temperature: 0.2 });
    SPEAKER_STATE.liveNotes = result.text || '';
  } catch (error) {
    console.error('Live notes generation error:', error);
  }
}

// Update recording UI
function updateRecordingUI() {
  const recPanel = document.getElementById('rec-body');
  if (!recPanel) return;
  
  const elapsed = Date.now() - SPEAKER_STATE.startTime;
  const minutes = Math.floor(elapsed / 60000);
  const seconds = Math.floor((elapsed % 60000) / 1000);
  const timeStr = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  
  const transcriptDisplay = SPEAKER_STATE.liveTranscript || 'Listening...';
  const notesDisplay = SPEAKER_STATE.liveNotes || 'Generating notes...';
  
  recPanel.innerHTML = `
    <div class="rec-header">
      <div class="rec-status">
        <span class="rec-indicator">●</span>
        <span class="rec-time">${timeStr}</span>
        <span class="rec-mode">${SPEAKER_STATE.mode === 'meeting' ? 'Meeting' : 'Class'}</span>
      </div>
      <div class="rec-actions">
        <button type="button" class="rec-btn" data-rec="stop" title="Stop recording">
          <svg viewBox="0 0 24 24" width="18" height="18"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>
        </button>
        <button type="button" class="rec-btn" data-rec="pause" title="Pause">
          <svg viewBox="0 0 24 24" width="18" height="18"><path d="M6 4h4v16H6z"/><path d="M14 4h4v16h-4z"/></svg>
        </button>
      </div>
    </div>
    
    <div class="rec-content">
      <div class="rec-section">
        <h4>Live Transcript</h4>
        <pre class="rec-transcript">${esc(SPEAKER_STATE.liveTranscript || 'Listening...')}</pre>
      </div>
      
      <div class="rec-section">
        <h4>AI Notes</h4>
        <div class="rec-notes">${markdownToHtml(SPEAKER_STATE.liveNotes || 'Notes will appear here...')}</div>
      </div>
    </div>
  `;
}

// Stop recording
function stopRecording() {
  // Prevent duplicate stop calls
  if (!SPEAKER_STATE.isRecording || SPEAKER_STATE.isStopping) return;
  
  SPEAKER_STATE.isStopping = true;
  SPEAKER_STATE.isRecording = false;
  
  // Clear segment interval first to prevent new segments
  if (SPEAKER_STATE.segmentInterval) {
    clearInterval(SPEAKER_STATE.segmentInterval);
    SPEAKER_STATE.segmentInterval = null;
  }
  
  // Stop media recorder - this will trigger onstop handler for final segment
  if (SPEAKER_STATE.mediaRecorder) {
    try {
      SPEAKER_STATE.mediaRecorder.stop();
    } catch (error) {
      console.error('Error stopping media recorder:', error);
    }
  }
  
  // Update status
  updateRecordingStatus(RECORDING_STATUS.FINALIZING);
  
  // Wait for any pending processing to complete, then save
  SPEAKER_STATE.processingQueue = SPEAKER_STATE.processingQueue.then(async () => {
    try {
      // Process any remaining audio chunks that weren't processed
      if (SPEAKER_STATE.audioChunks.length > 0) {
        const mimeType = SPEAKER_STATE.mimeType || getSupportedMimeType();
        const blob = new Blob(SPEAKER_STATE.audioChunks, { type: mimeType });
        const segmentIndex = SPEAKER_STATE.transcriptSegments.length;
        
        const knownVoices = getVoiceProfiles();
        const transcript = await processAudioSegment(blob, segmentIndex, knownVoices);
        SPEAKER_STATE.transcriptSegments[segmentIndex] = transcript;
        SPEAKER_STATE.rawTranscriptSegments[segmentIndex] = transcript;
        SPEAKER_STATE.liveTranscript = SPEAKER_STATE.transcriptSegments.filter(Boolean).join('\n\n');
        SPEAKER_STATE.rawTranscript = SPEAKER_STATE.rawTranscriptSegments.filter(Boolean).join('\n\n');
        await generateLiveNotes();
        updateRecordingUI();
        SPEAKER_STATE.audioChunks.length = 0;
      }
      
      // Ensure all segments are in order
      const orderedTranscript = SPEAKER_STATE.transcriptSegments
        .map((segment, index) => ({ index, text: segment }))
        .filter(seg => seg.text && seg.text.trim())
        .sort((a, b) => a.index - b.index)
        .map(seg => seg.text)
        .join('\n\n');
      
      const orderedRawTranscript = SPEAKER_STATE.rawTranscriptSegments
        .map((segment, index) => ({ index, text: segment }))
        .filter(seg => seg.text && seg.text.trim())
        .sort((a, b) => a.index - b.index)
        .map(seg => seg.text)
        .join('\n\n');
      
      if (orderedTranscript !== SPEAKER_STATE.liveTranscript) {
        SPEAKER_STATE.liveTranscript = orderedTranscript;
      }
      if (orderedRawTranscript !== SPEAKER_STATE.rawTranscript) {
        SPEAKER_STATE.rawTranscript = orderedRawTranscript;
      }
      
      // Save final transcript as note (only once)
      saveRecordingAsNote();
      
      // Update status
      updateRecordingStatus(RECORDING_STATUS.SAVED);
    } catch (error) {
      console.error('Error during final processing:', error);
      updateRecordingStatus(RECORDING_STATUS.NEEDS_ATTENTION);
      toast('Recording stopped but there was an error processing the final segment.', 'error', 6000);
    } finally {
      // Always cleanup
      cleanupRecording();
      SPEAKER_STATE.isStopping = false;
      updateRecordingUI();
      toast('Recording stopped. Transcript saved as note.');
    }
  });
}

// Pause recording
function pauseRecording() {
  if (!SPEAKER_STATE.isRecording || SPEAKER_STATE.isPaused || SPEAKER_STATE.isStopping) return;
  
  if (SPEAKER_STATE.mediaRecorder) {
    try {
      SPEAKER_STATE.mediaRecorder.pause();
      SPEAKER_STATE.isPaused = true;
      toast('Recording paused');
    } catch (error) {
      console.error('Error pausing recording:', error);
      toast('Could not pause recording.', 'error');
    }
  }
  
  updateRecordingUI();
}

// Resume recording
function resumeRecording() {
  if (!SPEAKER_STATE.isRecording || !SPEAKER_STATE.isPaused) return;
  
  if (SPEAKER_STATE.mediaRecorder) {
    try {
      SPEAKER_STATE.mediaRecorder.resume();
      SPEAKER_STATE.isPaused = false;
      toast('Recording resumed');
    } catch (error) {
      console.error('Error resuming recording:', error);
      toast('Could not resume recording.', 'error');
    }
  }
  
  updateRecordingUI();
}

// Save recording as note
function saveRecordingAsNote() {
  const transcript = SPEAKER_STATE.liveTranscript;
  const rawTranscript = SPEAKER_STATE.rawTranscript;
  const aiNotesText = SPEAKER_STATE.liveNotes;
  
  if (!transcript || !transcript.trim()) {
    toast('No transcript to save');
    return;
  }
  
  const mode = SPEAKER_STATE.mode || 'class';
  const timestamp = new Date(SPEAKER_STATE.startTime).toLocaleString();
  const durationMs = Date.now() - SPEAKER_STATE.startTime;
  const language = SPEAKER_STATE.language || 'auto';
  const langLabel = RECORDING_LANGUAGES[language]?.label || language;
  
  // Ensure segments are in correct order
  const orderedSegments = SPEAKER_STATE.transcriptSegments
    .map((segment, index) => ({ index, text: segment }))
    .filter(seg => seg.text && seg.text.trim())
    .sort((a, b) => a.index - b.index)
    .map(seg => seg.text);
  
  const orderedRawSegments = SPEAKER_STATE.rawTranscriptSegments
    .map((segment, index) => ({ index, text: segment }))
    .filter(seg => seg.text && seg.text.trim())
    .sort((a, b) => a.index - b.index)
    .map(seg => seg.text);
  
  const finalTranscript = orderedSegments.join('\n\n') || transcript;
  const finalRawTranscript = orderedRawSegments.join('\n\n') || rawTranscript;
  
  // Build note body with both raw and processed transcripts
  const hasRaw = finalRawTranscript && finalRawTranscript !== finalTranscript;
  const hasFailed = SPEAKER_STATE.failedSegments.length > 0;
  const hasNeedsReview = SPEAKER_STATE.needsReview.length > 0;
  
  const bodyParts = [
    `# ${mode === 'meeting' ? 'Meeting' : 'Class'} Recording`,
    '',
    `**Date:** ${timestamp}`,
    `**Duration:** ${formatDuration(durationMs)}`,
    `**Language:** ${langLabel}`,
    hasFailed ? `**Status:** Needs attention (${SPEAKER_STATE.failedSegments.length} failed segment${SPEAKER_STATE.failedSegments.length === 1 ? '' : 's'})` : '',
    '',
    '## Transcript',
    '',
    finalTranscript
  ];
  
  if (hasRaw) {
    bodyParts.push('', '## Raw Transcript (Unprocessed)', '', finalRawTranscript);
  }
  
  if (hasFailed) {
    bodyParts.push('', '## Failed Segments', '');
    SPEAKER_STATE.failedSegments.forEach((failed, i) => {
      bodyParts.push(`- **Segment ${failed.index + 1}:** ${esc(failed.error)}`);
    });
  }
  
  if (hasNeedsReview) {
    bodyParts.push('', '## Needs Review', '');
    SPEAKER_STATE.needsReview.forEach((item, i) => {
      bodyParts.push(`- **Segment ${item.index + 1}:** ${esc(item.reason)}`);
    });
  }
  
  if (aiNotesText) {
    bodyParts.push('', '## AI Notes', '', aiNotesText);
  }
  
  const note = normalizeNote({
    id: uid(),
    title: `${mode === 'meeting' ? 'Meeting' : 'Class'} Recording - ${timestamp}`,
    subject: mode === 'meeting' ? 'Meetings' : 'Classes',
    folderPath: mode === 'meeting' ? 'Meetings' : 'Classes',
    tags: ['recording', mode, 'transcript', language],
    kind: 'markdown',
    body: bodyParts.join('\n'),
    createdAt: Date.now(),
    updatedAt: Date.now()
  });
  
  // Add to global notes array
  const globalNotes = window.notes || [];
  window.notes = [note, ...globalNotes];
  addFolderPath(note.folderPath);
  persistNote(note).catch(() => toast('Saved locally; sync is queued.', 'error'));
  
  // Trigger knowledge index for the recording note
  if (typeof window.enqueueForIndexing === 'function') {
    try {
      window.enqueueForIndexing(note.id, note, 'index');
    } catch (indexError) {
      console.warn('Recording saved, but knowledge index update failed:', indexError);
    }
  }
  
  renderEverything();
  
  // Open the note
  openNote(note.id);
}

// Format duration
function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

// Cleanup recording state
function cleanupRecording() {
  // Stop all tracks from media recorder stream
  if (SPEAKER_STATE.mediaRecorder) {
    try {
      if (SPEAKER_STATE.mediaRecorder.stream) {
        SPEAKER_STATE.mediaRecorder.stream.getTracks().forEach(track => {
          try { track.stop(); } catch (e) { console.warn('Error stopping track:', e); }
        });
      }
      SPEAKER_STATE.mediaRecorder = null;
    } catch (error) {
      console.error('Error cleaning up media recorder:', error);
    }
  }
  SPEAKER_STATE.rawTranscriptSegments = [];
  SPEAKER_STATE.rawTranscript = '';
  SPEAKER_STATE.segmentTiming = [];
  SPEAKER_STATE.failedSegments = [];
  SPEAKER_STATE.needsReview = [];
  SPEAKER_STATE.status = RECORDING_STATUS.IDLE;
  SPEAKER_STATE.segmentTiming = [];
  if (SPEAKER_STATE.stream) {
    try {
      SPEAKER_STATE.stream.getTracks().forEach(track => {
        try { track.stop(); } catch (e) { console.warn('Error stopping track:', e); }
      });
      SPEAKER_STATE.stream = null;
    } catch (error) {
      console.error('Error cleaning up stream:', error);
    }
  }
  
  // Clear segment interval
  if (SPEAKER_STATE.segmentInterval) {
    clearInterval(SPEAKER_STATE.segmentInterval);
    SPEAKER_STATE.segmentInterval = null;
  }
  
  // Reset all state
  SPEAKER_STATE.isRecording = false;
  SPEAKER_STATE.isPaused = false;
  SPEAKER_STATE.isStopping = false;
  SPEAKER_STATE.audioChunks = [];
  SPEAKER_STATE.transcriptSegments = [];
  SPEAKER_STATE.liveTranscript = '';
  SPEAKER_STATE.liveNotes = '';
  SPEAKER_STATE.startTime = 0;
  SPEAKER_STATE.elapsedMs = 0;
  SPEAKER_STATE.mimeType = null;
  SPEAKER_STATE.mode = null;
}

// =============================================================================
// VOICE PROFILE SETTINGS UI
// =============================================================================

// Render voice profile settings
function renderVoiceProfileSettings() {
  const profiles = getVoiceProfiles();
  const ownerProfile = getOwnerVoiceProfile();
  const context = getVoiceContext();
  
  const html = `
    <div class="voice-settings">
      <h3>Voice Profile Settings</h3>
      <p class="settings-description">Configure your voice and speaker profiles for better transcription accuracy.</p>
      
      <div class="settings-section">
        <h4>Owner Voice Setup</h4>
        <p>Teach the app to recognize your voice for accurate labeling in transcripts.</p>
        
        <div class="voice-profile-card">
          <div class="profile-header">
            <span class="profile-icon">🎤</span>
            <span class="profile-name">${ownerProfile?.name || 'Your Voice'}</span>
          </div>
          
          <div class="profile-fields">
            <div class="field">
              <label for="owner-voice-name">Your Name</label>
              <input type="text" id="owner-voice-name" 
                     value="${esc(ownerProfile?.name || '')}"
                     placeholder="Enter your name">
            </div>
            
            <div class="field">
              <label for="owner-voice-desc">Voice Description</label>
              <input type="text" id="owner-voice-desc" 
                     value="${esc(ownerProfile?.description || '')}"
                     placeholder="e.g., Deep male voice, Fast speaker">
            </div>
            
            <div class="field">
              <label for="owner-voice-context">Context for AI</label>
              <textarea id="owner-voice-context" 
                        placeholder="e.g., I am a computer science professor. I often explain technical concepts.">${esc(ownerProfile?.context || '')}</textarea>
              <small>This helps the AI understand your speech patterns better</small>
            </div>
          </div>
          
          <div class="profile-actions">
            <button type="button" class="btn-primary" id="save-owner-voice">Save Profile</button>
            <button type="button" class="btn-secondary" id="record-owner-voice">Record Sample</button>
          </div>
        </div>
      </div>
      
      <div class="settings-section">
        <h4>Speaker Profiles</h4>
        <p>Add profiles for frequent speakers to improve transcription accuracy.</p>
        
        <div class="profiles-list" id="profiles-list">
          ${profiles.length === 0 ? '<p class="empty-state">No speaker profiles yet. Add one below.</p>' : ''}
          ${profiles.map(profile => renderProfileCard(profile)).join('')}
        </div>
        
        <button type="button" class="btn-secondary" id="add-new-profile">
          <span>+</span> Add New Speaker Profile
        </button>
      </div>
      
      <div class="settings-section">
        <h4>Transcription Settings</h4>
        
        <div class="field">
          <label for="transcription-mode">Default Mode</label>
          <select id="transcription-mode">
            <option value="class" ${context.mode !== 'meeting' ? 'selected' : ''}>Class</option>
            <option value="meeting" ${context.mode === 'meeting' ? 'selected' : ''}>Meeting</option>
          </select>
        </div>
        
        <div class="field">
          <label for="segment-duration">Segment Duration (ms)</label>
          <input type="number" id="segment-duration" 
                 value="${context.segmentMs || RECORD_CONFIG.segmentMs}"
                 min="5000" max="60000" step="5000">
          <small>Shorter segments = lower latency, more API calls</small>
        </div>
        
        <div class="field checkbox">
          <label>
            <input type="checkbox" id="auto-identify-owner" 
                   ${context.autoIdentifyOwner ? 'checked' : ''}>
            Auto-identify my voice
          </label>
          <small>Automatically label your voice as [Owner] in transcripts</small>
        </div>
      </div>
      
      <div class="settings-section">
        <h4>Language Settings</h4>
        <p>Select the language for transcription. The app will keep the original language and not translate.</p>
        
        <div class="field">
          <label for="recording-language">Transcription Language</label>
          <select id="recording-language">
            <option value="auto" ${SPEAKER_STATE.language === 'auto' ? 'selected' : ''}>${RECORDING_LANGUAGES.auto.label}</option>
            <option value="en" ${SPEAKER_STATE.language === 'en' ? 'selected' : ''}>${RECORDING_LANGUAGES.en.label}</option>
            <option value="ur" ${SPEAKER_STATE.language === 'ur' ? 'selected' : ''}>${RECORDING_LANGUAGES.ur.label}</option>
            <option value="ur_roman" ${SPEAKER_STATE.language === 'ur_roman' ? 'selected' : ''}>${RECORDING_LANGUAGES.ur_roman.label}</option>
          </select>
          <small>Select the primary language. Auto-detect will attempt to identify the language automatically.</small>
        </div>
      </div>
    </div>
  `;
  
  return html;
}

// Render individual profile card
function renderProfileCard(profile) {
  return `
    <div class="profile-card" data-profile-id="${esc(profile.id)}">
      <div class="profile-header">
        <span class="profile-icon">👤</span>
        <span class="profile-name">${esc(profile.name)}</span>
        <button type="button" class="delete-profile" data-profile-id="${esc(profile.id)}" title="Delete">×</button>
      </div>
      
      <div class="profile-info">
        <div class="info-row">
          <span class="label">Description:</span>
          <span class="value">${esc(profile.description || 'None')}</span>
        </div>
        <div class="info-row">
          <span class="label">Sample Text:</span>
          <span class="value">${esc((profile.sampleText || '').slice(0, 50))}...</span>
        </div>
      </div>
      
      <div class="profile-actions">
        <button type="button" class="btn-small" data-profile-id="${esc(profile.id)}" data-action="edit">Edit</button>
      </div>
    </div>
  `;
}

// Show voice settings
function showVoiceSettings() {
  const dialog = showModal('voice-settings-modal', 'Voice Settings', renderVoiceProfileSettings(), modal => {
    modal.firstElementChild.style.width = 'min(800px, 100%)';
    
    // Save owner voice
    modal.querySelector('#save-owner-voice')?.addEventListener('click', () => {
      const name = modal.querySelector('#owner-voice-name')?.value || '';
      const description = modal.querySelector('#owner-voice-desc')?.value || '';
      const context = modal.querySelector('#owner-voice-context')?.value || '';
      
      const profile = {
        id: 'owner',
        name,
        description,
        context,
        type: 'owner',
        createdAt: Date.now()
      };
      
      saveOwnerVoiceProfile(profile);
      SPEAKER_STATE.ownerVoiceId = profile.id;
      toast('Owner voice profile saved!');
    });
    
    // Record owner voice sample
    modal.querySelector('#record-owner-voice')?.addEventListener('click', () => {
      toast('Recording 10 seconds of your voice for calibration...', 'info', 5000);
      recordVoiceSample('owner');
    });
    
    // Add new profile
    modal.querySelector('#add-new-profile')?.addEventListener('click', () => {
      showAddProfileModal();
    });
    
    // Save transcription settings
    modal.querySelectorAll('.settings-section input, .settings-section select').forEach(input => {
      input.addEventListener('change', () => {
        const context = getVoiceContext();
        if (input.id === 'transcription-mode') {
          context.mode = input.value;
        } else if (input.id === 'segment-duration') {
          context.segmentMs = parseInt(input.value) || RECORD_CONFIG.segmentMs;
        } else if (input.id === 'auto-identify-owner') {
          context.autoIdentifyOwner = input.checked;
        }
        saveVoiceContext(context);
      });
    });
    
    // Delete profile handlers
    modal.querySelectorAll('.delete-profile').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const profileId = btn.dataset.profileId;
        if (profileId) {
          const profiles = getVoiceProfiles().filter(p => p.id !== profileId);
          saveVoiceProfiles(profiles);
          showVoiceSettings(); // Refresh
          toast('Profile deleted');
        }
      });
    });
    
    // Edit profile handlers
    modal.querySelectorAll('[data-action="edit"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const profileId = btn.dataset.profileId;
        const profile = getVoiceProfiles().find(p => p.id === profileId);
        if (profile) {
          showEditProfileModal(profile);
        }
      });
    });
  });
}

// Show add profile modal
function showAddProfileModal() {
  const html = `
    <div class="add-profile-modal">
      <h3>Add Speaker Profile</h3>
      
      <div class="field">
        <label for="profile-name">Name</label>
        <input type="text" id="profile-name" placeholder="e.g., Professor Smith">
      </div>
      
      <div class="field">
        <label for="profile-desc">Description</label>
        <input type="text" id="profile-desc" placeholder="e.g., Fast speaker, British accent">
      </div>
      
      <div class="field">
        <label for="profile-sample">Sample Text (optional)</label>
        <textarea id="profile-sample" placeholder="Paste a sample of their speech..."></textarea>
        <small>This helps the AI recognize their voice pattern</small>
      </div>
      
      <div class="modal-actions">
        <button type="button" class="btn-secondary" id="cancel-add-profile">Cancel</button>
        <button type="button" class="btn-primary" id="confirm-add-profile">Save Profile</button>
      </div>
    </div>
  `;
  
  const dialog = showModal('add-profile-modal', 'Add Speaker', html, modal => {
    modal.querySelector('#cancel-add-profile')?.addEventListener('click', () => dialog.hidden = true);
    modal.querySelector('#confirm-add-profile')?.addEventListener('click', () => {
      const name = modal.querySelector('#profile-name')?.value || '';
      const description = modal.querySelector('#profile-desc')?.value || '';
      const sampleText = modal.querySelector('#profile-sample')?.value || '';
      
      if (!name) {
        toast('Please enter a name');
        return;
      }
      
      const profile = {
        id: uid(),
        name,
        description,
        sampleText,
        type: 'speaker',
        createdAt: Date.now()
      };
      
      const profiles = [...getVoiceProfiles(), profile];
      saveVoiceProfiles(profiles);
      dialog.hidden = true;
      showVoiceSettings(); // Refresh
      toast('Speaker profile added!');
    });
  });
}

// Show edit profile modal
function showEditProfileModal(profile) {
  const html = `
    <div class="edit-profile-modal">
      <h3>Edit Speaker Profile</h3>
      
      <div class="field">
        <label for="edit-profile-name">Name</label>
        <input type="text" id="edit-profile-name" value="${esc(profile.name)}" placeholder="e.g., Professor Smith">
      </div>
      
      <div class="field">
        <label for="edit-profile-desc">Description</label>
        <input type="text" id="edit-profile-desc" value="${esc(profile.description || '')}" placeholder="e.g., Fast speaker, British accent">
      </div>
      
      <div class="field">
        <label for="edit-profile-sample">Sample Text</label>
        <textarea id="edit-profile-sample" placeholder="Paste a sample of their speech...">${esc(profile.sampleText || '')}</textarea>
      </div>
      
      <div class="modal-actions">
        <button type="button" class="btn-secondary" id="cancel-edit-profile">Cancel</button>
        <button type="button" class="btn-primary" id="confirm-edit-profile">Save Changes</button>
      </div>
    </div>
  `;
  
  const dialog = showModal('edit-profile-modal', 'Edit Speaker', html, modal => {
    modal.querySelector('#cancel-edit-profile')?.addEventListener('click', () => dialog.hidden = true);
    modal.querySelector('#confirm-edit-profile')?.addEventListener('click', () => {
      const name = modal.querySelector('#edit-profile-name')?.value || '';
      const description = modal.querySelector('#edit-profile-desc')?.value || '';
      const sampleText = modal.querySelector('#edit-profile-sample')?.value || '';
      
      if (!name) {
        toast('Please enter a name');
        return;
      }
      
      const updatedProfile = { ...profile, name, description, sampleText };
      const profiles = getVoiceProfiles().map(p => p.id === profile.id ? updatedProfile : p);
      saveVoiceProfiles(profiles);
      dialog.hidden = true;
      showVoiceSettings(); // Refresh
      toast('Profile updated!');
    });
  });
}

// Record voice sample for calibration
async function recordVoiceSample(profileId) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: 48000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true
      }
    });
    
    const mediaRecorder = new MediaRecorder(stream, {
      mimeType: 'audio/webm;codecs=opus',
      audioBitsPerSecond: 48000
    });
    
    const chunks = [];
    mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
    
    // Record for 10 seconds
    mediaRecorder.start();
    
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    mediaRecorder.stop();
    stream.getTracks().forEach(track => track.stop());
    
    // Process the sample
    const blob = new Blob(chunks, { type: 'audio/webm' });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const base64Audio = bytesToB64Safe(bytes);
    
    // Transcribe the sample
    const key = aiKey('gemini');
    if (!key) {
      toast('Gemini API key required for voice calibration');
      return;
    }
    
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [
              { text: 'Transcribe this short voice sample exactly as spoken. Return only the text, no labels or formatting.' },
              { inlineData: { mimeType: 'audio/webm', data: base64Audio } }
            ]
          }],
          generationConfig: { temperature: 0.1 }
        })
      }
    );
    
    if (!response.ok) throw new Error('API error');
    const data = await response.json();
    const sampleText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    // Save sample to profile
    if (profileId === 'owner') {
      const ownerProfile = getOwnerVoiceProfile() || {};
      saveOwnerVoiceProfile({ ...ownerProfile, sampleText });
    } else {
      const profiles = getVoiceProfiles().map(p => 
        p.id === profileId ? { ...p, sampleText } : p
      );
      saveVoiceProfiles(profiles);
    }
    
    toast('Voice sample recorded and saved!');
    
  } catch (error) {
    console.error('Voice sample recording error:', error);
    toast('Could not record voice sample', 'error');
  }
}

// =============================================================================
// ENHANCED TRANSCRIPTION WITH CONTEXT
// =============================================================================

// Enhanced transcription with subject context
function getContextEnhancedPrompt(segmentIndex, mode, subject, context) {
  const voiceDescriptions = getVoiceProfiles().map(v => 
    `Voice ${v.id}: ${v.name || 'Unknown'} (${v.description || 'No description'})`
  ).join(', ');
  
  return `Transcribe this audio segment (${segmentIndex + 1}) with enhanced context:

CONTEXT:
- Mode: ${mode || 'class'}
- Subject: ${subject || 'general'}
- ${context || 'No additional context'}

SPEAKER GUIDELINES:
- Label each speaking turn as "Voice 1:", "Voice 2:", etc.
- Use the same number for the same person throughout.
- Known voices: ${voiceDescriptions || 'None identified yet'}
- The app owner's voice should be labeled as "[Owner]" or their configured name

TRANSCRIPTION RULES:
1. Include [MM:SS] timestamps at the start of each turn when possible
2. Transcribe EXACTLY as spoken, in the original language
3. Use [inaudible] for unclear audio
4. Maintain academic/professional tone
5. One turn per line

Output ONLY the transcript, no additional text.`;
}

// Start context-aware recording
async function startContextRecording(note, mode = 'class') {
  if (!note) {
    toast('Please open a note first');
    return;
  }
  
  const subject = note.subject || 'General';
  const context = getVoiceContext();
  
  SPEAKER_STATE.noteId = note.id;
  SPEAKER_STATE.mode = mode || context.mode || 'class';
  SPEAKER_STATE.subject = subject;
  
  // Store context for this recording
  saveVoiceContext({ ...context, lastNoteId: note.id, lastSubject: subject });
  
  await startEnhancedRecording(mode);
  
  // Update note in real-time
  const interval = setInterval(() => {
    if (SPEAKER_STATE.liveTranscript) {
      const updatedNote = notes.find(n => n.id === note.id);
      if (updatedNote) {
        const transcriptSection = `## Live Transcript (${formatDuration(Date.now() - SPEAKER_STATE.startTime)})

${SPEAKER_STATE.liveTranscript}`;
        
        const notesSection = SPEAKER_STATE.liveNotes ? `

## AI Notes

${SPEAKER_STATE.liveNotes}` : '';
        
        updatedNote.body = `${updatedNote.body || ''}\n\n${transcriptSection}${notesSection}`;
        updatedNote.updatedAt = Date.now();
        persistNote(updatedNote).catch(() => {});
      }
    }
  }, 2000);
  
  // Store interval for cleanup
  SPEAKER_STATE.updateInterval = interval;
}

// =============================================================================
// OWNER VOICE MENTIONING IN NOTES
// =============================================================================

// Add owner mention to note
function addOwnerMentionToNote(noteId, text) {
  const note = notes.find(n => n.id === noteId);
  if (!note) return;
  
  const ownerProfile = getOwnerVoiceProfile();
  if (!ownerProfile || !ownerProfile.name) return;
  
  const ownerName = ownerProfile.name;
  const enhancedText = `[${ownerName}]: ${text}`;
  
  // Add to note body
  note.body = `${note.body || ''}\n\n${enhancedText}`;
  note.updatedAt = Date.now();
  
  persistNote(note);
  renderEverything();
}

// Quick action to add owner comment
function addOwnerComment() {
  const activeNote = notes.find(n => n.id === activeId);
  if (!activeNote) {
    toast('Please open a note first');
    return;
  }
  
  const comment = prompt('Enter your comment:');
  if (comment) {
    addOwnerMentionToNote(activeNote.id, comment);
    toast('Owner comment added!');
  }
}

// =============================================================================
// INITIALIZATION
// =============================================================================

// Initialize voice profile system
initVoiceProfiles();

// Add event listeners
function initVoiceProfileListeners() {
  // Add voice settings to settings hub
  const settingsHub = document.getElementById('settings-hub-menu');
  if (settingsHub) {
    const originalClick = settingsHub.onclick;
    settingsHub.onclick = function(e) {
      if (originalClick) originalClick(e);
      // Add voice settings option if not exists
      const voiceSettingsBtn = document.querySelector('[data-hub="voice-settings"]');
      if (!voiceSettingsBtn) {
        const hubRow = document.createElement('div');
        hubRow.className = 'hub-row';
        hubRow.innerHTML = `<div><b>Voice settings</b><small>Configure voice profiles and transcription.</small></div><button type="button" class="nzai-primary hub-btn" data-hub="voice-settings">Open</button>`;
        hubRow.querySelector('button').addEventListener('click', () => {
          closeAccountMenu();
          // One voice system: the learned-voice library is the one the
          // transcriber actually reads, so this entry opens that.
          if (typeof nzVoiceLibrary === 'function') nzVoiceLibrary();
          else showVoiceSettings();
        });
        const generalSection = document.querySelector('.hub-body');
        if (generalSection) {
          generalSection.appendChild(hubRow);
        }
      }
    };
  }
  
  // Add recording button to toolbar if not exists
  const recordBtn = document.getElementById('record-menu');
  if (!recordBtn) {
    const toolbar = document.querySelector('.top-actions') || document.querySelector('.workspace-header');
    if (toolbar) {
      const btn = document.createElement('button');
      btn.id = 'record-menu';
      btn.type = 'button';
      btn.className = 'top-action-btn';
      btn.title = 'Record with AI transcription';
      btn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M19 10v2a7 7 0 0 1-14 0v-2" fill="none" stroke="currentColor" stroke-width="2"/><line x1="12" y1="19" x2="12" y2="23" stroke="currentColor" stroke-width="2"/><line x1="8" y1="23" x2="16" y2="23" stroke="currentColor" stroke-width="2"/></svg>';
      btn.addEventListener('click', () => {
        closeAccountMenu();
        openRecorder();
      });
      toolbar.appendChild(btn);
    }
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initVoiceProfileListeners);
} else {
  initVoiceProfileListeners();
}

// Export functions for global access
window.startEnhancedRecording = startEnhancedRecording;
window.stopRecording = stopRecording;
window.pauseRecording = pauseRecording;
window.resumeRecording = resumeRecording;
window.showVoiceSettings = showVoiceSettings;
window.startContextRecording = startContextRecording;
window.addOwnerComment = addOwnerComment;
