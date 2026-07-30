import type {
  InterviewAnswer,
  InterviewAnswerEvent,
  InterviewAnswerVariant,
  InterviewConfig,
  GoogleCloudAuthStatus,
  InterviewScreenAnalysis,
  InterviewSession,
  InterviewTranscriptDelta,
  InterviewTranscriptionStatus,
  TranscriptTurn
} from './interview';

/**
 * Standardized response from the Electron backend.
 */
export interface IPCResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface ElectronAPI {
  // Window Control
  closeWindow: () => Promise<IPCResponse<void>>;
  minimizeWindow: () => Promise<IPCResponse<void>>;
  minimizeToHead: () => Promise<IPCResponse<void>>;
  quitApp: () => Promise<IPCResponse<void>>;
  resizeWindow: (width: number, height: number) => Promise<IPCResponse<void>>;
  togglePin: () => void;
  isPinned: () => Promise<boolean>;
  isMinimized: () => Promise<boolean>;
  isMaximized: () => Promise<boolean>;
  startResizing: () => void;
  showSettings: () => void;
  showSusurro: () => void;
  floatingHeadClick: () => void;
  moveFloatingHead: (delta: { x: number; y: number }) => void;
  toggleMic: (enabled: boolean) => void;
  toggleAudio: (enabled: boolean) => void;
  
  // Messaging & Notifications
  sendMessage: (text: string, image?: string | null) => void;
  showNotification: (text: string) => void;
  onNewChatMessage: (callback: (msg: string, img?: string) => void) => () => void;
  onFocusInput: (callback: () => void) => () => void;
  onOpenCommandPanel: (callback: (panel: 'command' | 'chat' | 'history' | 'settings' | 'transcription' | 'voice') => void) => () => void;
  setActiveCommandPanel: (panel: 'command' | 'chat' | 'history' | 'settings' | 'transcription' | 'voice') => void;
  onNotify: (callback: (message: string) => void) => () => void;
  notifHidden: () => void;
  
  // Screen Capture
  getSources: () => Promise<any[]>;
  captureSource: (sourceId: string) => Promise<string>;
  captureAllScreens: () => Promise<string | string[]>;
  onCaptureEvent: (callback: () => void) => () => void;
  
  // Chat History & Tokens
  getChat: () => Promise<IPCResponse<any[]>>;
  saveChat: (history: any[]) => void;
  updateChatStatus: (hasMessages: boolean) => void;
  endSession: (type?: string, history?: any[]) => Promise<IPCResponse<any>>;
  getTotalTokens: () => Promise<IPCResponse<number>>;
  updateTokens: (count: number) => Promise<IPCResponse<number>>;
  commandWindowReady: () => void;
  chatWindowReady: () => void;
  
  // Susurro (Live Transcription)
  startSusurroLive: (personaPrompt?: string) => Promise<IPCResponse<boolean>>;
  stopSusurroLive: () => Promise<IPCResponse<void>>;
  sendSusurroChunk: (base64: string, seq: number) => void;
  endSusurroAudioStream: () => void;
  onSusurroLiveDelta: (callback: (delta: any) => void) => () => void;
  onSusurroLiveStatus: (callback: (status: string) => void) => () => void;
  onToggleSusurroTranscriptionSignal: (callback: () => void) => () => void;
  onStartSusurro: (callback: () => void) => () => void;
  onStopSusurro: (callback: () => void) => () => void;
  onInterviewCaptureShortcut: (callback: () => void) => () => void;
  onInterviewQuickAnswerShortcut: (callback: () => void) => () => void;
  generateSuggestion: (data: { transcription: string, personaPrompt: string }) => Promise<IPCResponse<string>>;
  askSusurroTranscript: (data: { question: string; transcript: string; personaPrompt?: string }) => Promise<IPCResponse<{ text: string; provider: string }>>;
  saveSusurroMessage: (msg: any) => Promise<IPCResponse<void>>;

  // Interview Copilot
  getGoogleCloudAuthStatus: () => Promise<IPCResponse<GoogleCloudAuthStatus>>;
  loginGoogleCloud: (projectId: string) => Promise<IPCResponse<GoogleCloudAuthStatus>>;
  createInterviewSession: (
    config: InterviewConfig,
    options?: { status?: 'active' | 'pending' }
  ) => Promise<IPCResponse<InterviewSession>>;
  listInterviewSessions: () => Promise<IPCResponse<InterviewSession[]>>;
  loadInterviewSession: (sessionId: string) => Promise<IPCResponse<InterviewSession | null>>;
  updateInterviewSession: (sessionId: string, patch: Partial<InterviewSession>) => Promise<IPCResponse<InterviewSession>>;
  finishInterviewSession: (sessionId: string) => Promise<IPCResponse<InterviewSession>>;
  archiveInterviewSession: (sessionId: string) => Promise<IPCResponse<InterviewSession>>;
  deleteInterviewSession: (sessionId: string) => Promise<IPCResponse<boolean>>;
  summarizeInterviewSession: (sessionId: string) => Promise<IPCResponse<InterviewSession>>;
  saveInterviewTurn: (sessionId: string, turn: TranscriptTurn) => Promise<IPCResponse<TranscriptTurn>>;
  startInterviewSource: (options: {
    sessionId: string;
    source: 'interviewer' | 'candidate';
    language: string;
    provider: 'whisper-local' | 'gemini-live' | 'google-cloud';
    customVocabulary?: string[];
  }) => Promise<IPCResponse<boolean>>;
  stopInterviewSource: (sessionId: string, source: 'interviewer' | 'candidate') => Promise<IPCResponse<boolean>>;
  stopInterviewTranscription: (sessionId: string) => Promise<IPCResponse<boolean>>;
  sendInterviewAudioChunk: (payload: { sessionId: string; source: 'interviewer' | 'candidate'; base64: string; sequence: number }) => void;
  endInterviewAudioStream: (sessionId: string, source: 'interviewer' | 'candidate') => void;
  flushInterviewTranscription: (sessionId: string, source: 'interviewer' | 'candidate') => Promise<IPCResponse<boolean>>;
  onInterviewTranscriptDelta: (callback: (delta: InterviewTranscriptDelta) => void) => () => void;
  onInterviewTranscriptionStatus: (callback: (status: InterviewTranscriptionStatus) => void) => () => void;
  requestInterviewAnswer: (args: {
    sessionId: string;
    answerId: string;
    turnId?: string;
    question: string;
    turns: TranscriptTurn[];
    config: InterviewConfig;
    visualContext?: string;
    sessionSummary?: string;
    quickFragments?: string[];
    variant: InterviewAnswerVariant;
    provider?: 'openai' | 'hermes' | 'gemini';
  }) => Promise<IPCResponse<InterviewAnswer>>;
  cancelInterviewAnswer: (answerId: string) => Promise<IPCResponse<boolean>>;
  onInterviewAnswerEvent: (callback: (event: InterviewAnswerEvent) => void) => () => void;
  analyzeInterviewScreen: (question?: string) => Promise<IPCResponse<InterviewScreenAnalysis>>;
  startInterviewRecording: (sessionId: string, source: 'interviewer' | 'candidate') => Promise<IPCResponse<boolean>>;
  sendInterviewRecordingChunk: (sessionId: string, source: 'interviewer' | 'candidate', base64: string) => void;
  stopInterviewRecording: (sessionId: string, source: 'interviewer' | 'candidate') => Promise<IPCResponse<any>>;
  
  // Tools & IPC
  openFileDialog: () => Promise<string | null>;
  searchWeb: (query: string) => Promise<any>;

  
  // Skills System
  saveSkill: (args: { name: string, description: string, procedure: string }) => Promise<IPCResponse<any>>;
  listSkills: () => Promise<IPCResponse<any[]>>;
  loadSkill: (name: string) => Promise<IPCResponse<string>>;

  // Session Logging
  logSession: (data: any) => Promise<IPCResponse<any>>;
  getLearnings: () => Promise<IPCResponse<string>>;
  getHermesDashboard: () => Promise<IPCResponse<HermesDashboard>>;
  testHermesConnection: () => Promise<IPCResponse<any>>;
  askHermes: (args: HermesAskInput) => Promise<IPCResponse<HermesAskResult>>;
  askHermesStream: (args: HermesAskInput & { streamId: string }) => Promise<IPCResponse<HermesAskResult>>;
  onHermesStreamEvent: (callback: (event: HermesStreamEvent) => void) => () => void;
  rememberWithHermes: (args: HermesMemoryInput) => Promise<IPCResponse<HermesAskResult>>;
  ingestHermesDocument: (document: HermesDocumentInput) => Promise<IPCResponse<HermesAskResult>>;
  syncHermesContext: () => Promise<IPCResponse<HermesAskResult>>;

  scheduleTask: (args: any) => Promise<IPCResponse<any>>;

  getTasks: () => Promise<IPCResponse<any[]>>;
  deleteTask: (id: string) => Promise<IPCResponse<void>>;
  onExecuteTask: (callback: (task: any) => void) => () => void;
  showChat: () => void;
  translateText: (text: string, targetLanguage: string) => Promise<IPCResponse<string>>;
  translateIncremental: (text: string, previousText: string, targetLanguage: string) => Promise<IPCResponse<string>>;
  transcribeAudio: (base64: string) => Promise<IPCResponse<string>>;
  getSystemAudioSourceId: () => Promise<IPCResponse<string>>;
  updateChatPin: (pinned: boolean) => void;
  getPersonas: () => Promise<IPCResponse<any[]>>;
  savePersona: (persona: any) => Promise<IPCResponse<void>>;
  deletePersona: (id: string) => Promise<IPCResponse<void>>;

  // Voice Recording
  onStartVoice: (callback: () => void) => () => void;
  onVoiceSend: (callback: () => void) => () => void;

  // Translation & Setup
  sendSusurroSetupComplete: () => void;
  downloadTranslationModel: () => void;
  onTranslationDownloadProgress: (callback: (progress: number) => void) => () => void;
  onTranslationDownloadStatus: (callback: (status: string) => void) => () => void;
  onTranslationDownloadComplete: (callback: () => void) => () => void;
  onTranslationDownloadError: (callback: (error: string) => void) => () => void;

  // Suggestions
  toggleSuggestions: (enabled: boolean) => void;
  onNewSuggestion: (callback: (text: string) => void) => () => void;

  // --- Settings ---
  getSettings: () => Promise<SettingsData>;
  saveSettings: (settings: SettingsData) => Promise<IPCResponse<void>>;
  applyStealthMode: (enabled: boolean) => Promise<IPCResponse<void>>;
  getHistoryData: () => Promise<IPCResponse<{ susurroHistory: any[], chatHistory: any[] }>>;
  onSettingsUpdated: (callback: (settings: SettingsData) => void) => () => void;
  disableShortcuts: () => Promise<IPCResponse<void>>;
  enableShortcuts: () => Promise<IPCResponse<void>>;

  // Misc
  openExternal: (url: string) => void;
  copyToClipboard: (text: string) => void;
}

export interface AudioSettings {
  inputDeviceId: string;
  outputDeviceId: string;
  micEnabled: boolean;
  micVolume: number;
  systemAudioEnabled: boolean;
  systemAudioVolume: number;
}

export interface GeneralSettings {
  apiKey: string;
  openaiApiKey: string;
  tavilyApiKey: string;
  minichatModel: string;
  sttModel: string;
  fullTranscriptionModel: string;
  stealthMode: boolean;
  dreamingEnabled: boolean;
  dreamingModel: string;
  openAiDreamingMigrated?: boolean;
}

export interface HermesSettings {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  sessionKey: string;
  model: string;
  timeoutMs: number;
  maxContextChars: number;
  meetingSummaryMaxChars: number;
  useAsPrimaryAgent: boolean;
  useForExternalActions: boolean;
  useForMemory: boolean;
  autoForwardConversations: boolean;
  autoForwardTasksPersonas: boolean;
  autoSummarizeMeetings: boolean;
}

export type AssistantMode = 'auto' | 'interview' | 'help' | 'idea' | 'coding';
export type AssistantAnswerStyle = 'auto' | 'short' | 'structured' | 'code' | 'code_explained';

export interface AssistantSettings {
  mode: AssistantMode;
  delegationEnabled: boolean;
  compactContext: boolean;
  preferredAnswerStyle: AssistantAnswerStyle;
}

export interface ShortcutsSettings {
  toggleCommand: string;
  toggleSettings: string;
  toggleSusurro: string;
  toggleVoice: string;
  interviewQuickAnswer: string;
  interviewCaptureScreen: string;
}

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutSettings {
  commandBounds?: WindowBounds | null;
  floatingHeadBounds?: WindowBounds | null;
}

export interface SettingsData {
  audio: AudioSettings;
  general: GeneralSettings;
  hermes: HermesSettings;
  assistant: AssistantSettings;
  interview?: InterviewConfig;
  layout?: LayoutSettings;
  shortcuts?: ShortcutsSettings;
}

export interface HermesAskInput {
  prompt: string;
  context?: string;
  instruction?: string;
  mode?: AssistantMode | string;
  preferredAnswerStyle?: AssistantAnswerStyle | string;
  includeLocalContext?: boolean;
  maxOutputTokens?: number;
  timeoutMs?: number;
  logType?: string;
  primaryAgent?: boolean;
  streamId?: string;
}

export interface HermesAskResult {
  success: boolean;
  text?: string;
  model?: string;
  usage?: Record<string, any> | null;
  sessionKey?: string;
  durationMs?: number;
  error?: string;
}

export interface HermesStreamEvent {
  streamId: string;
  type: 'start' | 'delta' | 'tool' | 'end' | 'error' | 'cancelled';
  text?: string;
  error?: string;
  data?: Record<string, any>;
  result?: HermesAskResult;
}

export interface HermesDocumentInput {
  title: string;
  text: string;
  type?: string;
  source?: string;
  metadata?: Record<string, any>;
}

export interface HermesMemoryInput {
  kind?: string;
  title?: string;
  source?: string;
  text: string;
}

export interface HermesUsageEntry {
  id: string;
  timestamp: string;
  type: string;
  success: boolean;
  durationMs?: number;
  promptChars?: number;
  responseChars?: number;
  model?: string;
  error?: string;
}

export interface HermesDashboard {
  connected: boolean;
  enabled: boolean;
  reason?: string;
  error?: string;
  config?: Record<string, any>;
  counts?: {
    requests: number;
    failures: number;
    promptChars: number;
    responseChars: number;
    estimatedTokens: number;
  };
  recentRequests?: HermesUsageEntry[];
}

declare global {
  interface Window {
    electron?: ElectronAPI;
  }
}
