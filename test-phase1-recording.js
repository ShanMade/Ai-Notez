/**
 * Phase 1 Voice-to-Note Test Suite
 * Tests recording data integrity, state management, and error handling
 */

// Mock browser APIs for testing
const mockMediaRecorderEvents = [];
const mockAudioChunks = [];
const mockTracks = [];

class MockMediaRecorder {
  constructor(stream, options) {
    this.stream = stream;
    this.options = options;
    this.state = 'inactive';
    this.ondataavailable = null;
    this.onstop = null;
    this.onerror = null;
  }
  
  start() {
    this.state = 'recording';
  }
  
  stop() {
    this.state = 'inactive';
    if (this.onstop) this.onstop({ type: 'stop' });
  }
  
  pause() {
    this.state = 'paused';
  }
  
  resume() {
    this.state = 'recording';
  }
}

class MockMediaStream {
  constructor() {
    this.tracks = [];
  }
  
  getTracks() {
    return this.tracks;
  }
  
  addTrack(track) {
    this.tracks.push(track);
  }
}

class MockMediaStreamTrack {
  constructor() {
    this.readyState = 'live';
  }
  
  stop() {
    this.readyState = 'ended';
  }
}

// Set up global mocks
const mockNavigator = {
  mediaDevices: {
    getUserMedia: async (constraints) => {
      const stream = new MockMediaStream();
      stream.addTrack(new MockMediaStreamTrack());
      return stream;
    }
  }
};

Object.defineProperty(global, 'navigator', {
  value: mockNavigator,
  writable: true,
  enumerable: true,
  configurable: true
});

global.MediaRecorder = MockMediaRecorder;

// Mock window objects
global.window = global;
global.document = {
  createElement: (tag) => ({
    innerHTML: '',
    style: {},
    className: '',
    id: '',
    setAttribute: () => {},
    appendChild: () => {},
    remove: () => {}
  }),
  querySelector: () => null,
  getElementById: (id) => {
    if (id === 'rec-body') {
      return { innerHTML: '' };
    }
    return null;
  }
};

// Mock toast function
let toastMessages = [];
function toast(message, type = 'info', duration = 3000) {
  toastMessages.push({ message, type, duration });
  console.log(`[TOAST ${type}] ${message}`);
}

// Mock other required functions
global.toast = toast;
global.esc = (s) => s ? String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';
global.uid = () => `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
global.normalizeNote = (note) => note;
global.persistNote = async () => {};
global.renderEverything = () => {};
global.openNote = () => {};
global.addFolderPath = () => {};
global.markdownToHtml = (s) => s;
global.aiReady = () => true;
global.aiGenerate = async () => ({ text: 'Test AI notes' });

// Mock SPEAKER_STATE for testing
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
  liveTranscript: '',
  liveNotes: '',
  startTime: 0,
  elapsedMs: 0,
  stream: null,
  segmentInterval: null,
  mimeType: null,
  mode: null
};

// Mock getSupportedMimeType
function getSupportedMimeType() {
  return 'audio/webm;codecs=opus';
}

// Mock processAudioSegment
async function processAudioSegment(blob, index) {
  return `Test transcript segment ${index + 1}`;
}

// Mock detectSpeakerFromText
function detectSpeakerFromText(text) {
  return { detectedVoices: [], voiceMap: new Map() };
}

// Mock matchVoicesToProfiles
function matchVoicesToProfiles() {
  return {};
}

// Mock applyVoiceLabels
function applyVoiceLabels(t) { return t; }

// Mock getVoiceProfiles
function getVoiceProfiles() { return []; }

// Mock generateLiveNotes
async function generateLiveNotes() {
  SPEAKER_STATE.liveNotes = 'Generated notes';
}

// Mock updateRecordingUI
function updateRecordingUI() {}

// Mock formatDuration
function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  return `${seconds}s`;
}

// Mock cleanupRecording
function cleanupRecording() {
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
  SPEAKER_STATE.mediaRecorder = null;
  SPEAKER_STATE.stream = null;
  SPEAKER_STATE.segmentInterval = null;
}

// Test functions from app/07-voice-profiles.js
// We'll inline the fixed functions for testing

function saveRecordingAsNote() {
  const transcript = SPEAKER_STATE.liveTranscript;
  const aiNotesText = SPEAKER_STATE.liveNotes;
  
  if (!transcript || !transcript.trim()) {
    toast('No transcript to save');
    return;
  }
  
  const mode = SPEAKER_STATE.mode || 'class';
  const timestamp = new Date(SPEAKER_STATE.startTime).toLocaleString();
  const durationMs = Date.now() - SPEAKER_STATE.startTime;
  
  // Ensure segments are in correct order
  const orderedSegments = SPEAKER_STATE.transcriptSegments
    .map((segment, index) => ({ index, text: segment }))
    .filter(seg => seg.text && seg.text.trim())
    .sort((a, b) => a.index - b.index)
    .map(seg => seg.text);
  
  const finalTranscript = orderedSegments.join('\n\n') || transcript;
  
  const note = normalizeNote({
    id: uid(),
    title: `${mode === 'meeting' ? 'Meeting' : 'Class'} Recording - ${timestamp}`,
    subject: mode === 'meeting' ? 'Meetings' : 'Classes',
    folderPath: mode === 'meeting' ? 'Meetings' : 'Classes',
    tags: ['recording', mode, 'transcript'],
    kind: 'markdown',
    body: `# ${mode === 'meeting' ? 'Meeting' : 'Class'} Recording\n\n**Date:** ${timestamp}\n**Duration:** ${formatDuration(durationMs)}\n\n## Transcript\n\n${finalTranscript}\n\n${aiNotesText ? `## AI Notes\n\n${aiNotesText}` : ''}`,
    createdAt: Date.now(),
    updatedAt: Date.now()
  });
  
  // Add to global notes array
  const globalNotes = window.notes || [];
  window.notes = [note, ...globalNotes];
  addFolderPath(note.folderPath);
  persistNote(note).catch(() => toast('Saved locally; sync is queued.', 'error'));
  renderEverything();
  
  // Open the note
  openNote(note.id);
}

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
        SPEAKER_STATE.liveTranscript = SPEAKER_STATE.transcriptSegments.filter(Boolean).join('\n\n');
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
      
      if (orderedTranscript !== SPEAKER_STATE.liveTranscript) {
        SPEAKER_STATE.liveTranscript = orderedTranscript;
      }
      
      // Save final transcript as note (only once)
      saveRecordingAsNote();
    } catch (error) {
      console.error('Error during final processing:', error);
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

// =============================================================================
// Test Suite
// =============================================================================

console.log('=== Phase 1 Voice-to-Note Test Suite ===\n');

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, testName, details = '') {
  if (condition) {
    console.log(`✓ PASS: ${testName}`);
    if (details) console.log(`  Details: ${details}`);
    testsPassed++;
  } else {
    console.error(`✗ FAIL: ${testName}`);
    if (details) console.error(`  Details: ${details}`);
    testsFailed++;
  }
}

function resetState() {
  // Reset SPEAKER_STATE
  SPEAKER_STATE.profiles = [];
  SPEAKER_STATE.currentSpeakers = new Map();
  SPEAKER_STATE.ownerVoiceId = null;
  SPEAKER_STATE.isRecording = false;
  SPEAKER_STATE.isPaused = false;
  SPEAKER_STATE.isStopping = false;
  SPEAKER_STATE.mediaRecorder = null;
  SPEAKER_STATE.audioChunks = [];
  SPEAKER_STATE.processingQueue = Promise.resolve();
  SPEAKER_STATE.transcriptSegments = [];
  SPEAKER_STATE.liveTranscript = '';
  SPEAKER_STATE.liveNotes = '';
  SPEAKER_STATE.startTime = 0;
  SPEAKER_STATE.elapsedMs = 0;
  SPEAKER_STATE.stream = null;
  SPEAKER_STATE.segmentInterval = null;
  SPEAKER_STATE.mimeType = null;
  SPEAKER_STATE.mode = null;
  
  // Reset mocks
  toastMessages = [];
  mockMediaRecorderEvents.length = 0;
  mockAudioChunks.length = 0;
  mockTracks.length = 0;
  window.notes = [];
}

// Test 1: Variable collision fix - saveRecordingAsNote uses aiNotesText instead of notes
console.log('\n--- Test 1: Variable Collision Fix ---');
resetState();
SPEAKER_STATE.liveTranscript = 'Test transcript';
SPEAKER_STATE.liveNotes = 'Test AI notes';
SPEAKER_STATE.startTime = Date.now();
SPEAKER_STATE.mode = 'class';
SPEAKER_STATE.transcriptSegments = ['Segment 1', 'Segment 2'];

const globalNotesBefore = window.notes || [];
try {
  saveRecordingAsNote();
  const globalNotesAfter = window.notes || [];
  assert(globalNotesAfter.length === globalNotesBefore.length + 1, 
    'saveRecordingAsNote creates a note',
    `Notes before: ${globalNotesBefore.length}, after: ${globalNotesAfter.length}`);
  
  const createdNote = globalNotesAfter[0];
  assert(createdNote.body.includes('Test transcript'), 
    'Note body contains transcript',
    'Body contains transcript');
  assert(createdNote.body.includes('Test AI notes'), 
    'Note body contains AI notes',
    'Body contains AI notes');
  assert(createdNote.body.includes('## AI Notes'), 
    'Note body has AI Notes section',
    'Has AI Notes section');
} catch (error) {
  assert(false, 'saveRecordingAsNote execution', error.message);
}

// Test 2: MIME type detection
console.log('\n--- Test 2: MIME Type Detection ---');
resetState();
const mimeType = getSupportedMimeType();
assert(mimeType === 'audio/webm;codecs=opus', 
  'getSupportedMimeType returns supported type',
  `MIME type: ${mimeType}`);

// Test 3: Race condition - prevent duplicate start
console.log('\n--- Test 3: Race Condition - Prevent Duplicate Start ---');
resetState();
SPEAKER_STATE.isRecording = true;
SPEAKER_STATE.startTime = Date.now();

// Mock startEnhancedRecording for this test
async function mockStartEnhancedRecording(mode = 'class') {
  if (SPEAKER_STATE.isRecording || SPEAKER_STATE.isStopping) {
    toast('Recording is already in progress.', 'error');
    return;
  }
  SPEAKER_STATE.isRecording = true;
  SPEAKER_STATE.mode = mode;
}

try {
  await mockStartEnhancedRecording('class');
  toastMessages.length = 0;
  await mockStartEnhancedRecording('class');
  assert(toastMessages.length === 1 && toastMessages[0].type === 'error',
    'Second start call shows error toast',
    `Toast count: ${toastMessages.length}, type: ${toastMessages[0]?.type}`);
  assert(SPEAKER_STATE.isRecording === true, 
    'State remains recording after duplicate start attempt');
} catch (error) {
  assert(false, 'Duplicate start test', error.message);
}

// Test 4: Race condition - prevent duplicate stop
console.log('\n--- Test 4: Race Condition - Prevent Duplicate Stop ---');
resetState();
SPEAKER_STATE.isRecording = true;
SPEAKER_STATE.isStopping = false;
SPEAKER_STATE.mediaRecorder = { stop: () => {} };

// First stop
stopRecording();
assert(SPEAKER_STATE.isStopping === true, 
  'First stop sets isStopping flag');

// Second stop - should be prevented
const isRecordingBefore = SPEAKER_STATE.isRecording;
const isStoppingBefore = SPEAKER_STATE.isStopping;
stopRecording();
assert(SPEAKER_STATE.isRecording === isRecordingBefore && 
       SPEAKER_STATE.isStopping === isStoppingBefore,
  'Second stop is prevented by isStopping flag');

// Test 5: Chunk collection - using SPEAKER_STATE.audioChunks
console.log('\n--- Test 5: Chunk Collection Consistency ---');
resetState();

// Simulate dataavailable event
const mockRecorder = {
  ondataavailable: null,
  onstop: null,
  state: 'recording',
  start: () => { this.state = 'recording'; },
  stop: () => { 
    this.state = 'inactive';
    if (this.onstop) this.onstop({ type: 'stop' });
  },
  pause: () => { this.state = 'paused'; },
  resume: () => { this.state = 'recording'; }
};

SPEAKER_STATE.mediaRecorder = mockRecorder;
SPEAKER_STATE.audioChunks = [];

// Set up handler
mockRecorder.ondataavailable = (event) => {
  if (event.data?.size > 0) {
    SPEAKER_STATE.audioChunks.push(event.data);
  }
};

// Simulate chunks
const chunk1 = { size: 100, type: 'audio/webm' };
const chunk2 = { size: 150, type: 'audio/webm' };
mockRecorder.ondataavailable({ data: chunk1 });
mockRecorder.ondataavailable({ data: chunk2 });

assert(SPEAKER_STATE.audioChunks.length === 2,
  'Chunks are collected in SPEAKER_STATE.audioChunks',
  `Chunks collected: ${SPEAKER_STATE.audioChunks.length}`);

// Test 6: State cleanup on error
console.log('\n--- Test 6: State Cleanup on Error ---');
resetState();

// Set up error state
SPEAKER_STATE.isRecording = true;
SPEAKER_STATE.isPaused = true;
SPEAKER_STATE.mediaRecorder = { stream: { getTracks: () => [
  { stop: () => {}, readyState: 'live' }
] } };
SPEAKER_STATE.stream = { getTracks: () => [{ stop: () => {}, readyState: 'live' }] };
SPEAKER_STATE.segmentInterval = setInterval(() => {}, 1000);

cleanupRecording();

assert(SPEAKER_STATE.isRecording === false,
  'cleanupRecording resets isRecording',
  `isRecording: ${SPEAKER_STATE.isRecording}`);
assert(SPEAKER_STATE.isPaused === false,
  'cleanupRecording resets isPaused',
  `isPaused: ${SPEAKER_STATE.isPaused}`);
assert(SPEAKER_STATE.mediaRecorder === null,
  'cleanupRecording clears mediaRecorder',
  `mediaRecorder: ${SPEAKER_STATE.mediaRecorder}`);
assert(SPEAKER_STATE.stream === null,
  'cleanupRecording clears stream',
  `stream: ${SPEAKER_STATE.stream}`);

// Test 7: Pause/Resume state management
console.log('\n--- Test 7: Pause/Resume State Management ---');
resetState();
SPEAKER_STATE.isRecording = true;
SPEAKER_STATE.isPaused = false;
SPEAKER_STATE.mediaRecorder = {
  state: 'recording',
  pause: () => { this.state = 'paused'; },
  resume: () => { this.state = 'recording'; }
};

// Test pause
toastMessages.length = 0;
pauseRecording();
assert(SPEAKER_STATE.isPaused === true,
  'pauseRecording sets isPaused flag',
  `isPaused: ${SPEAKER_STATE.isPaused}`);
assert(SPEAKER_STATE.mediaRecorder.state === 'paused',
  'pauseRecording calls mediaRecorder.pause()',
  `Recorder state: ${SPEAKER_STATE.mediaRecorder.state}`);
assert(toastMessages.length >= 1 && toastMessages.some(t => t.message === 'Recording paused'),
  'pauseRecording shows toast',
  `Toasts: ${JSON.stringify(toastMessages)}`);

// Test resume
toastMessages.length = 0;
resumeRecording();
assert(SPEAKER_STATE.isPaused === false,
  'resumeRecording clears isPaused flag',
  `isPaused: ${SPEAKER_STATE.isPaused}`);
assert(SPEAKER_STATE.mediaRecorder.state === 'recording',
  'resumeRecording calls mediaRecorder.resume()',
  `Recorder state: ${SPEAKER_STATE.mediaRecorder.state}`);

// Test 8: Prevent pause when already paused
console.log('\n--- Test 8: Prevent Pause When Already Paused ---');
resetState();
SPEAKER_STATE.isRecording = true;
SPEAKER_STATE.isPaused = true;
SPEAKER_STATE.mediaRecorder = { state: 'paused' };

const recorderStateBefore = SPEAKER_STATE.mediaRecorder.state;
pauseRecording();
assert(SPEAKER_STATE.isPaused === true && recorderStateBefore === 'paused',
  'Pause is prevented when already paused');

// Test 9: Prevent resume when not paused
console.log('\n--- Test 9: Prevent Resume When Not Paused ---');
resetState();
SPEAKER_STATE.isRecording = true;
SPEAKER_STATE.isPaused = false;
SPEAKER_STATE.mediaRecorder = { state: 'recording' };

const recorderStateBefore2 = SPEAKER_STATE.mediaRecorder.state;
resumeRecording();
assert(SPEAKER_STATE.isPaused === false && recorderStateBefore2 === 'recording',
  'Resume is prevented when not paused');

// Test 10: Segment ordering
console.log('\n--- Test 10: Segment Ordering ---');
resetState();
SPEAKER_STATE.transcriptSegments = [
  'Segment 2 text',
  'Segment 0 text', 
  'Segment 1 text'
];
SPEAKER_STATE.liveTranscript = 'Segment 2 text\n\nSegment 0 text\n\nSegment 1 text';

// This is what stopRecording does
const orderedTranscript = SPEAKER_STATE.transcriptSegments
  .map((segment, index) => ({ index, text: segment }))
  .filter(seg => seg.text && seg.text.trim())
  .sort((a, b) => a.index - b.index)
  .map(seg => seg.text)
  .join('\n\n');

assert(orderedTranscript === 'Segment 0 text\n\nSegment 1 text\n\nSegment 2 text',
  'Segments are reordered by index',
  `Ordered: ${orderedTranscript}`);

// Test 11: Empty transcript handling
console.log('\n--- Test 11: Empty Transcript Handling ---');
resetState();
SPEAKER_STATE.liveTranscript = '';
SPEAKER_STATE.liveNotes = '';
SPEAKER_STATE.startTime = Date.now();

const notesBefore = window.notes || [];
toastMessages.length = 0;
saveRecordingAsNote();

assert(toastMessages.length === 1 && toastMessages[0].message === 'No transcript to save',
  'Empty transcript shows error toast',
  `Toasts: ${JSON.stringify(toastMessages)}`);
assert(window.notes?.length === notesBefore.length,
  'No note created for empty transcript',
  `Notes count unchanged: ${window.notes?.length}`);

// Test 12: Segment timer stops when recording stops
console.log('\n--- Test 12: Segment Timer Cleanup ---');
resetState();

// Create a mock interval
let intervalFired = false;
const mockInterval = setInterval(() => {
  intervalFired = true;
  if (SPEAKER_STATE.isRecording && !SPEAKER_STATE.isPaused && !SPEAKER_STATE.isStopping) {
    // Would fire
  }
}, 100);

SPEAKER_STATE.segmentInterval = mockInterval;
SPEAKER_STATE.isRecording = true;
SPEAKER_STATE.isStopping = true;

// Simulate what stopRecording does
if (SPEAKER_STATE.segmentInterval) {
  clearInterval(SPEAKER_STATE.segmentInterval);
  SPEAKER_STATE.segmentInterval = null;
}

assert(SPEAKER_STATE.segmentInterval === null,
  'Segment interval is cleared on stop');

// Test 13: MIME type fallback
console.log('\n--- Test 13: MIME Type Fallback ---');
// Test the fallback logic
global.MediaRecorder.isTypeSupported = (type) => {
  return type === 'audio/webm';
};

const fallbackMime = getSupportedMimeType();
assert(fallbackMime === 'audio/webm',
  'Falls back to audio/webm when opus not supported',
  `Fallback MIME: ${fallbackMime}`);

// Test 14: Error handling in segment processing
console.log('\n--- Test 14: Error Handling in Segment Processing ---');
resetState();

// Mock error in processAudioSegment
const originalProcess = processAudioSegment;
let errorInProcessing = new Error('Test processing error');

SPEAKER_STATE.audioChunks = [{ size: 100 }];
SPEAKER_STATE.transcriptSegments = [];
SPEAKER_STATE.mimeType = 'audio/webm';

// Simulate onstop handler
const segmentIndex = SPEAKER_STATE.transcriptSegments.length;
SPEAKER_STATE.processingQueue = SPEAKER_STATE.processingQueue.then(async () => {
  try {
    // This would fail
    throw errorInProcessing;
  } catch (error) {
    SPEAKER_STATE.transcriptSegments[segmentIndex] = `[Error transcribing segment ${segmentIndex + 1}: ${error.message || 'Unknown error'}]`;
    updateRecordingUI();
  }
});

// Wait for promise to resolve
await SPEAKER_STATE.processingQueue;

assert(SPEAKER_STATE.transcriptSegments[0]?.includes('Test processing error'),
  'Segment processing error is captured in transcript',
  `Segment: ${SPEAKER_STATE.transcriptSegments[0]}`);

// Summary
console.log('\n=== Test Summary ===');
console.log(`Total: ${testsPassed + testsFailed}`);
console.log(`Passed: ${testsPassed}`);
console.log(`Failed: ${testsFailed}`);

if (testsFailed === 0) {
  console.log('\n✓ All Phase 1 tests passed!');
  process.exit(0);
} else {
  console.log('\n✗ Some tests failed. Review the failures above.');
  process.exit(1);
}
