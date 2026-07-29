const { contextBridge, ipcRenderer } = require('electron');

/**
 * Electron Preload Script
 * Exposes a safe subset of Electron's IPC functionality to the renderer process.
 * Grouped by feature area for better maintainability.
 */
contextBridge.exposeInMainWorld('electron', {
  // --- Core Messaging & UI ---
  sendMessage: (message, image) => ipcRenderer.send('send-message', message, image),
  onNewChatMessage: (callback) => {
    const sub = (_event, msg, img) => callback(msg, img);
    ipcRenderer.on('new-message', sub);
    return () => ipcRenderer.removeListener('new-message', sub);
  },
  onFocusInput: (callback) => {
    const sub = (_event) => callback();
    ipcRenderer.on('focus-input', sub);
    return () => ipcRenderer.removeListener('focus-input', sub);
  },
  onOpenCommandPanel: (callback) => {
    const sub = (_event, panel) => callback(panel);
    ipcRenderer.on('open-command-panel', sub);
    return () => ipcRenderer.removeListener('open-command-panel', sub);
  },
  setActiveCommandPanel: (panel) => ipcRenderer.send('command-panel-changed', panel),
  onNotify: (callback) => {
    const sub = (_event, message) => callback(message);
    ipcRenderer.on('notify', sub);
    return () => ipcRenderer.removeListener('notify', sub);
  },
  showNotification: (text) => ipcRenderer.send('show-notification', text),
  notifHidden: () => ipcRenderer.send('notif-hidden'),

  // --- Window Management ---
  closeWindow: () => ipcRenderer.invoke('close-window'),
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  minimizeToHead: () => ipcRenderer.invoke('minimize-to-head'),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  resizeWindow: (w, h) => ipcRenderer.invoke('resize-window', { width: w, height: h }),
  showChat: () => ipcRenderer.send('show-chat'),
  showSettings: () => ipcRenderer.send('show-settings'),
  showSusurro: () => ipcRenderer.send('show-susurro'),
  togglePin: () => ipcRenderer.send('toggle-pin'),
  isPinned: () => ipcRenderer.invoke('is-pinned'),
  isMinimized: () => ipcRenderer.invoke('is-minimized'),
  isMaximized: () => ipcRenderer.invoke('is-maximized'),
  startResizing: () => ipcRenderer.send('start-resizing'),
  updateChatPin: (pinned) => ipcRenderer.send('update-chat-pin', pinned),
  floatingHeadClick: () => ipcRenderer.send('floating-head-click'),
  moveFloatingHead: (delta) => ipcRenderer.send('move-floating-head', delta),
  toggleMic: (enabled) => ipcRenderer.send('toggle-mic', enabled),
  toggleAudio: (enabled) => ipcRenderer.send('toggle-audio', enabled),

  // --- Chat & Persistence ---
  getChat: () => ipcRenderer.invoke('get-chat-history'),
  saveChat: (history) => ipcRenderer.send('save-chat-history', history),
  updateChatStatus: (hasMessages) => ipcRenderer.send('chat-status-update', { hasMessages }),
  updateTokens: (count) => ipcRenderer.invoke('update-tokens', count),
  getTotalTokens: () => ipcRenderer.invoke('get-total-tokens'),
  endSession: (type) => ipcRenderer.invoke('end-session', type),
  commandWindowReady: () => ipcRenderer.send('command-window-ready'),
  chatWindowReady: () => ipcRenderer.send('chat-window-ready'),

  // --- Tasks ---
  scheduleTask: (data) => ipcRenderer.invoke('schedule-task', data),
  getTasks: () => ipcRenderer.invoke('get-tasks'),
  deleteTask: (id) => ipcRenderer.invoke('delete-task', id),
  onExecuteTask: (callback) => {
    const sub = (_event, task) => callback(task);
    ipcRenderer.on('execute-scheduled-task', sub);
    return () => ipcRenderer.removeListener('execute-scheduled-task', sub);
  },

  // --- Voice & Susurro (Transcription) ---
  onStartVoice: (callback) => {
    const sub = (_event) => callback();
    ipcRenderer.on('start-voice', sub);
    return () => ipcRenderer.removeListener('start-voice', sub);
  },
  onVoiceSend: (callback) => {
    const sub = (_event) => callback();
    ipcRenderer.on('voice-send', sub);
    return () => ipcRenderer.removeListener('voice-send', sub);
  },
  startSusurroLive: (persona) => ipcRenderer.invoke('susurro-start-live', persona),
  stopSusurroLive: () => ipcRenderer.invoke('susurro-stop-live'),
  sendSusurroChunk: (base64, seq) => ipcRenderer.send('susurro-send-chunk', base64, seq),
  endSusurroAudioStream: () => ipcRenderer.send('susurro-audio-stream-end'),
  onSusurroLiveDelta: (callback) => {
    const sub = (_event, delta) => callback(delta);
    ipcRenderer.on('susurro-live-delta', sub);
    return () => ipcRenderer.removeListener('susurro-live-delta', sub);
  },
  onSusurroLiveStatus: (callback) => {
    const sub = (_event, status) => callback(status);
    ipcRenderer.on('susurro-live-status', sub);
    return () => ipcRenderer.removeListener('susurro-live-status', sub);
  },
  onToggleSusurroTranscriptionSignal: (callback) => {
    const sub = (_event) => callback();
    ipcRenderer.on('toggle-susurro-transcription-signal', sub);
    return () => ipcRenderer.removeListener('toggle-susurro-transcription-signal', sub);
  },
  onStartSusurro: (callback) => {
    const sub = (_event) => callback();
    ipcRenderer.on('start-susurro', sub);
    return () => ipcRenderer.removeListener('start-susurro', sub);
  },
  onStopSusurro: (callback) => {
    const sub = (_event) => callback();
    ipcRenderer.on('stop-susurro', sub);
    return () => ipcRenderer.removeListener('stop-susurro', sub);
  },
  askSusurroTranscript: (data) => ipcRenderer.invoke('ask-susurro-transcript', data),

  // --- Interview Copilot ---
  getGoogleCloudAuthStatus: () => ipcRenderer.invoke('google-cloud-auth-status'),
  loginGoogleCloud: (projectId) => ipcRenderer.invoke('google-cloud-auth-login', projectId),
  createInterviewSession: (config, options) => ipcRenderer.invoke('interview-create-session', config, options),
  listInterviewSessions: () => ipcRenderer.invoke('interview-list-sessions'),
  loadInterviewSession: (sessionId) => ipcRenderer.invoke('interview-load-session', sessionId),
  updateInterviewSession: (sessionId, patch) => ipcRenderer.invoke('interview-update-session', sessionId, patch),
  finishInterviewSession: (sessionId) => ipcRenderer.invoke('interview-finish-session', sessionId),
  archiveInterviewSession: (sessionId) => ipcRenderer.invoke('interview-archive-session', sessionId),
  deleteInterviewSession: (sessionId) => ipcRenderer.invoke('interview-delete-session', sessionId),
  summarizeInterviewSession: (sessionId) => ipcRenderer.invoke('interview-summarize-session', sessionId),
  saveInterviewTurn: (sessionId, turn) => ipcRenderer.invoke('interview-save-turn', sessionId, turn),
  startInterviewSource: (options) => ipcRenderer.invoke('interview-start-source', options),
  stopInterviewSource: (sessionId, source) => ipcRenderer.invoke('interview-stop-source', sessionId, source),
  stopInterviewTranscription: (sessionId) => ipcRenderer.invoke('interview-stop-transcription', sessionId),
  sendInterviewAudioChunk: (payload) => ipcRenderer.send('interview-send-audio-chunk', payload),
  endInterviewAudioStream: (sessionId, source) => ipcRenderer.send('interview-audio-stream-end', sessionId, source),
  flushInterviewTranscription: (sessionId, source) => ipcRenderer.invoke('interview-flush-transcription', sessionId, source),
  onInterviewTranscriptDelta: (callback) => {
    const sub = (_event, payload) => callback(payload);
    ipcRenderer.on('interview-transcript-delta', sub);
    return () => ipcRenderer.removeListener('interview-transcript-delta', sub);
  },
  onInterviewTranscriptionStatus: (callback) => {
    const sub = (_event, payload) => callback(payload);
    ipcRenderer.on('interview-transcription-status', sub);
    return () => ipcRenderer.removeListener('interview-transcription-status', sub);
  },
  requestInterviewAnswer: (args) => ipcRenderer.invoke('interview-request-answer', args),
  cancelInterviewAnswer: (answerId) => ipcRenderer.invoke('interview-cancel-answer', answerId),
  onInterviewAnswerEvent: (callback) => {
    const sub = (_event, payload) => callback(payload);
    ipcRenderer.on('interview-answer-event', sub);
    return () => ipcRenderer.removeListener('interview-answer-event', sub);
  },
  analyzeInterviewScreen: (question) => ipcRenderer.invoke('interview-analyze-screen', question),
  startInterviewRecording: (sessionId, source) => ipcRenderer.invoke('interview-recording-start', sessionId, source),
  sendInterviewRecordingChunk: (sessionId, source, base64) => ipcRenderer.send('interview-recording-chunk', sessionId, source, base64),
  stopInterviewRecording: (sessionId, source) => ipcRenderer.invoke('interview-recording-stop', sessionId, source),

  // --- Screen Capture ---
  getSources: () => ipcRenderer.invoke('get-sources'),
  captureSource: (sourceId) => ipcRenderer.invoke('capture-source', sourceId),
  captureAllScreens: () => ipcRenderer.invoke('capture-all-screens'),
  onCaptureEvent: (callback) => {
    const sub = (_event) => callback();
    ipcRenderer.on('capture-event', sub);
    return () => ipcRenderer.removeListener('capture-event', sub);
  },

  // --- Personas & Suggestions ---
  getPersonas: () => ipcRenderer.invoke('get-personas'),
  savePersona: (persona) => ipcRenderer.invoke('save-persona', persona),
  deletePersona: (id) => ipcRenderer.invoke('delete-persona', id),
  toggleSuggestions: (show) => ipcRenderer.send('toggle-suggestions-window', show),
  generateSuggestion: (data) => ipcRenderer.invoke('generate-suggestion', data),
  onNewSuggestion: (callback) => {
    const sub = (_event, sug) => callback(sug);
    ipcRenderer.on('new-suggestion', sub);
    return () => ipcRenderer.removeListener('new-suggestion', sub);
  },
  saveSusurroMessage: (msg) => ipcRenderer.invoke('save-susurro-message', msg),

  // --- Translation Service ---
  translateText: (text, target) => ipcRenderer.invoke('susurro-translate', text, target),
  translateIncremental: (text, previousText, target) => ipcRenderer.invoke('susurro-translate-incremental', text, previousText, target),
  sendSusurroSetupComplete: () => ipcRenderer.send('susurro-setup-complete'),

  // --- Utility Tools ---
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  searchWeb: (query) => ipcRenderer.invoke('search-web', query),
  getLolPlayerStats: (args) => ipcRenderer.invoke('get-lol-player-stats', args),
  openExternal: (url) => ipcRenderer.send('open-external', url),
  copyToClipboard: (text) => ipcRenderer.send('copy-to-clipboard', text),
  getSystemAudioSourceId: () => ipcRenderer.invoke('get-system-audio-source-id'),
  transcribeAudio: (base64) => ipcRenderer.invoke('transcribe-audio', base64),

  // --- Skills System ---
  saveSkill: (args) => ipcRenderer.invoke('save-skill', args),
  listSkills: () => ipcRenderer.invoke('list-skills'),
  loadSkill: (name) => ipcRenderer.invoke('load-skill', name),

  // --- Session Logger ---
  logSession: (data) => ipcRenderer.invoke('log-session', data),
  getLearnings: () => ipcRenderer.invoke('get-learnings'),
  getHermesDashboard: () => ipcRenderer.invoke('hermes-dashboard'),
  testHermesConnection: () => ipcRenderer.invoke('hermes-test-connection'),
  askHermes: (args) => ipcRenderer.invoke('hermes-ask', args),
  askHermesStream: (args) => ipcRenderer.invoke('hermes-ask-stream', args),
  onHermesStreamEvent: (callback) => {
    const sub = (_event, payload) => callback(payload);
    ipcRenderer.on('hermes-stream-event', sub);
    return () => ipcRenderer.removeListener('hermes-stream-event', sub);
  },
  rememberWithHermes: (args) => ipcRenderer.invoke('hermes-remember', args),
  ingestHermesDocument: (document) => ipcRenderer.invoke('hermes-ingest-document', document),
  syncHermesContext: () => ipcRenderer.invoke('hermes-sync-context'),

  // --- Settings ---
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  applyStealthMode: (enabled) => ipcRenderer.invoke('apply-stealth-mode', enabled),
  getHistoryData: () => ipcRenderer.invoke('get-history-data'),
  onSettingsUpdated: (callback) => {
    const sub = (_event, settings) => callback(settings);
    ipcRenderer.on('settings-updated', sub);
    return () => ipcRenderer.removeListener('settings-updated', sub);
  },
  disableShortcuts: () => ipcRenderer.invoke('disable-shortcuts'),
  enableShortcuts: () => ipcRenderer.invoke('enable-shortcuts'),
});
