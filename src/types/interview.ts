export type InterviewSource = 'interviewer' | 'candidate' | 'screen' | 'manual';
export type InterviewFlowStatus = 'idle' | 'starting' | 'listening' | 'answering' | 'stopping' | 'error';
export type InterviewSessionStatus = 'pending' | 'active' | 'completed' | 'archived';
export type InterviewLanguage = 'auto' | 'pt-BR' | 'en-US';
export type InterviewAnswerStyle = 'natural' | 'concise' | 'star' | 'technical';
export type MeetingMode = 'meeting' | 'interview';
export type InterviewFormat = 'standard' | 'whiteboard';
export type InterviewTranscriptionProvider = 'whisper-local';
export type InterviewAnswerVariant = 'answer' | 'quick' | 'shorter' | 'detail' | 'star' | 'code' | 'retry';

export interface InterviewContextDocument {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface InterviewConfig {
  mode: MeetingMode;
  interviewFormat: InterviewFormat;
  title: string;
  description: string;
  role: string;
  company: string;
  topics: string;
  resume: string;
  jobDescription: string;
  language: InterviewLanguage;
  answerStyle: InterviewAnswerStyle;
  transcriptionProvider: InterviewTranscriptionProvider;
  extraInstructions: string;
  transcribeMicrophone: boolean;
  saveTranscript: boolean;
  retainAudio: boolean;
  contextDocumentIds: string[];
}

export type WhiteboardProblemType = 'unknown' | 'algorithm' | 'system_design';
export type WhiteboardPhase = 'understand' | 'clarify' | 'explore' | 'construct' | 'validate' | 'finalize';

export interface WhiteboardState {
  revision: number;
  updatedAt: string;
  problemType: WhiteboardProblemType;
  phase: WhiteboardPhase;
  problemSummary: string;
  requirements: string[];
  constraints: string[];
  assumptions: string[];
  decisions: string[];
  interviewerFeedback: string[];
  openQuestions: string[];
  tradeoffs: string[];
  suggestedQuestions: string[];
  nextActions: string[];
  suggestedSpeech: string[];
  screenSummary: string;
  confidence: number;
}

export interface TranscriptTurn {
  id: string;
  sessionId: string;
  source: InterviewSource;
  text: string;
  pendingText: string;
  startedAt: string;
  endedAt?: string;
  isFinal: boolean;
  isQuestion: boolean;
  answerId?: string;
  visualContext?: string;
  lastSequence?: number;
  fragments?: string[];
  fragmentTimestamps?: string[];
}

export interface InterviewAnswer {
  id: string;
  sessionId: string;
  turnId?: string;
  question: string;
  text: string;
  status: 'streaming' | 'complete' | 'failed' | 'cancelled';
  provider: 'openai';
  variant: InterviewAnswerVariant;
  createdAt: string;
  completedAt?: string;
  error?: string;
}

export interface InterviewAudioArtifact {
  source: 'interviewer' | 'candidate';
  path: string;
  durationMs?: number;
  bytes: number;
}

export interface InterviewSession {
  id: string;
  status: InterviewSessionStatus;
  title: string;
  createdAt?: string;
  startedAt?: string;
  updatedAt: string;
  endedAt?: string;
  config: InterviewConfig;
  transcript: TranscriptTurn[];
  answers: InterviewAnswer[];
  visualContext?: string;
  summary?: string;
  summaryAt?: string;
  summaryProvider?: 'openai' | 'hermes';
  audioArtifacts?: InterviewAudioArtifact[];
  whiteboardState?: WhiteboardState;
  hasRecording?: boolean;
  hermesMemory?: {
    status: 'pending' | 'synced';
    attempts: number;
    memoryId?: string;
    syncedAt?: string;
    lastAttemptAt?: string;
    response?: string;
    error?: string;
    summary?: string;
    summaryProvider?: 'openai' | 'existing';
    summaryModel?: string;
    summaryResponseId?: string | null;
    summaryUsage?: Record<string, unknown> | null;
  };
}

export interface InterviewTranscriptDelta {
  sessionId: string;
  source: 'interviewer' | 'candidate';
  turnId: string;
  sequence: number;
  text: string;
  isFinal: boolean;
  replacePending?: boolean;
  timestamp: string;
}

export interface InterviewTranscriptionStatus {
  sessionId: string;
  source: 'interviewer' | 'candidate';
  turnId?: string;
  sequence?: number;
  status: 'connecting' | 'ready' | 'reconnecting' | 'closed' | 'error';
  provider?: InterviewTranscriptionProvider;
  attempt?: number;
  error?: string;
}

export interface InterviewAnswerEvent {
  sessionId: string;
  answerId: string;
  source: 'answer';
  turnId?: string;
  sequence: number;
  type: 'start' | 'delta' | 'tool' | 'end' | 'error' | 'cancelled';
  text?: string;
  error?: string;
  provider?: 'openai';
}

export interface InterviewScreenAnalysis {
  summary: string;
  detectedQuestion: string;
  extractedText: string;
  programmingQuestionVisible: boolean;
  directAnswer: string;
  confidence: number;
  context: string;
}

export const DEFAULT_INTERVIEW_CONFIG: InterviewConfig = {
  mode: 'meeting',
  interviewFormat: 'standard',
  title: '',
  description: '',
  role: '',
  company: '',
  topics: '',
  resume: '',
  jobDescription: '',
  language: 'pt-BR',
  answerStyle: 'natural',
  transcriptionProvider: 'whisper-local',
  extraInstructions: '',
  transcribeMicrophone: false,
  saveTranscript: true,
  retainAudio: true,
  contextDocumentIds: []
};
