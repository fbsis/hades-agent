export type InterviewSource = 'interviewer' | 'candidate' | 'screen' | 'manual';
export type InterviewFlowStatus = 'idle' | 'starting' | 'listening' | 'answering' | 'stopping' | 'error';
export type InterviewSessionStatus = 'active' | 'completed' | 'archived';
export type InterviewLanguage = 'auto' | 'pt-BR' | 'en-US';
export type InterviewAnswerStyle = 'natural' | 'concise' | 'star' | 'technical';
export type InterviewTranscriptionProvider = 'gemini-live' | 'google-cloud';
export type InterviewAnswerVariant = 'answer' | 'quick' | 'shorter' | 'detail' | 'star' | 'code' | 'retry';

export interface GoogleCloudAuthStatus {
  authenticated: boolean;
  projectId?: string;
  error?: string;
}

export interface InterviewConfig {
  role: string;
  company: string;
  resume: string;
  jobDescription: string;
  language: InterviewLanguage;
  answerStyle: InterviewAnswerStyle;
  transcriptionProvider: InterviewTranscriptionProvider;
  googleCloudProjectId: string;
  extraInstructions: string;
  transcribeMicrophone: boolean;
  retainAudio: boolean;
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
}

export interface InterviewAnswer {
  id: string;
  sessionId: string;
  turnId?: string;
  question: string;
  text: string;
  status: 'streaming' | 'complete' | 'failed' | 'cancelled';
  provider: 'hermes' | 'gemini';
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
  startedAt: string;
  updatedAt: string;
  endedAt?: string;
  config: InterviewConfig;
  transcript: TranscriptTurn[];
  answers: InterviewAnswer[];
  visualContext?: string;
  audioArtifacts?: InterviewAudioArtifact[];
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
  provider?: 'google-cloud' | 'gemini-live';
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
  provider?: 'hermes' | 'gemini';
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
  role: '',
  company: '',
  resume: '',
  jobDescription: '',
  language: 'auto',
  answerStyle: 'natural',
  transcriptionProvider: 'gemini-live',
  googleCloudProjectId: '',
  extraInstructions: '',
  transcribeMicrophone: false,
  retainAudio: false
};
