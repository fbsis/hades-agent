import {
  InterviewAnswerVariant,
  InterviewSession,
  InterviewSessionStatus,
  InterviewSource,
  MeetingMode,
  InterviewTranscriptDelta,
  TranscriptTurn
} from '../types/interview';

export interface InterviewSessionFilters {
  query?: string;
  mode?: 'all' | MeetingMode;
  status?: 'all' | InterviewSessionStatus;
}

export const MEETING_INACTIVITY_WARNING_MS = 5 * 60 * 1000;
export const MEETING_INACTIVITY_FINISH_MS = 5 * 60 * 1000;

export const getMeetingInactivityState = (
  lastSpeechAt: number,
  warningAt: number | null,
  now = Date.now()
): 'active' | 'warning' | 'finish' => {
  if (warningAt !== null && lastSpeechAt > warningAt) return 'active';
  if (warningAt === null) {
    return now - lastSpeechAt >= MEETING_INACTIVITY_WARNING_MS ? 'warning' : 'active';
  }
  return now - warningAt >= MEETING_INACTIVITY_FINISH_MS ? 'finish' : 'warning';
};

export const filterInterviewSessions = (
  sessions: InterviewSession[],
  filters: InterviewSessionFilters
): InterviewSession[] => {
  const query = (filters.query || '').trim().toLocaleLowerCase();
  return sessions.filter(session => {
    if (session.status === 'archived') return false;
    if (filters.mode && filters.mode !== 'all' && session.config.mode !== filters.mode) return false;
    if (filters.status && filters.status !== 'all' && session.status !== filters.status) return false;
    return !query || [session.title, session.config.company, session.config.role]
      .some(value => value?.toLocaleLowerCase().includes(query));
  });
};

const QUESTION_PREFIXES = [
  /^(como|qual|quais|quando|onde|por que|porque|quem|quanto|conte|explique|descreva|fale|imagine|diga|poderia|voce pode|você pode|o que|em que|ja teve|já teve|me dê|me de)\b/i,
  /^(how|what|when|where|why|who|which|tell me|describe|explain|walk me through|could you|can you|have you|give me)\b/i
];

const INTERVIEW_PATTERNS = [
  /\b(fale (sobre|de)|conte (sobre|uma vez)|experi[eê]ncia|maior desafio|ponto forte|ponto fraco|por que devemos|por que voc[eê]|pretens[aã]o salarial)\b/i,
  /\b(tell me about|walk me through|biggest challenge|strengths|weaknesses|why should we|why do you want|salary expectation)\b/i,
  /\b(implemente|escreva|resolva|qual (?:a )?complexidade|como voc[eê] projetaria|design (?:a|an)|implement|write|solve|time complexity)\b/i
];

export const isLikelyInterviewQuestion = (text: string): boolean => {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (normalized.length < 4) return false;
  if (normalized.endsWith('?')) return true;
  return QUESTION_PREFIXES.some(pattern => pattern.test(normalized))
    || INTERVIEW_PATTERNS.some(pattern => pattern.test(normalized));
};

export const selectScreenAnswerVariant = (
  mode: MeetingMode,
  programmingQuestionVisible: boolean
): InterviewAnswerVariant => (
  mode === 'interview' || programmingQuestionVisible ? 'code' : 'answer'
);

export const canUseInterviewActionShortcut = (
  status: InterviewSessionStatus | undefined,
  mode: MeetingMode | undefined
): boolean => status === 'active' && (mode === 'interview' || mode === 'meeting');

export const sourceLabel = (source: InterviewSource): string => ({
  interviewer: 'Entrevistador',
  candidate: 'Você',
  screen: 'Tela',
  manual: 'Manual'
})[source];

export const selectInterviewContextTurns = (
  turns: TranscriptTurn[],
  selectedTurnId?: string,
  limit = 6
): TranscriptTurn[] => turns
  .filter(turn => turn.isFinal && turn.id !== selectedTurnId && turn.text.trim())
  .slice(-limit);

export const buildCompactInterviewTranscript = (
  turns: TranscriptTurn[],
  selectedTurnId?: string,
  limit = 6
): string => selectInterviewContextTurns(turns, selectedTurnId, limit)
  .map(turn => `${sourceLabel(turn.source)}: ${turn.text.trim()}`)
  .join('\n');

export const applyInterviewTranscriptDelta = (
  turns: TranscriptTurn[],
  delta: InterviewTranscriptDelta
): TranscriptTurn[] => {
  const index = turns.findIndex(turn => turn.id === delta.turnId);
  const current = index >= 0 ? turns[index] : null;
  if (current && (current.lastSequence || 0) >= delta.sequence) return turns;

  const source: InterviewSource = delta.source;
  const incomingFragment = String(delta.text || '').trim();
  const fragments = incomingFragment
    ? [...(current?.fragments || []), incomingFragment].slice(-5)
    : current?.fragments || [];
  const pendingText = delta.replacePending
    ? delta.text || ''
    : `${current?.pendingText || ''}${delta.text || ''}`;
  const finalizedText = delta.isFinal
    ? `${current?.text || ''}${pendingText}`.replace(/\s+/g, ' ').trim()
    : current?.text || '';

  const nextTurn: TranscriptTurn = {
    id: delta.turnId,
    sessionId: delta.sessionId,
    source,
    text: finalizedText,
    pendingText: delta.isFinal ? '' : pendingText,
    startedAt: current?.startedAt || delta.timestamp,
    endedAt: delta.isFinal ? delta.timestamp : current?.endedAt,
    isFinal: delta.isFinal,
    isQuestion: delta.isFinal && source === 'interviewer'
      ? isLikelyInterviewQuestion(finalizedText)
      : current?.isQuestion || false,
    answerId: current?.answerId,
    lastSequence: delta.sequence,
    fragments
  };

  if (index < 0) return [...turns, nextTurn];
  const next = [...turns];
  next[index] = nextTurn;
  return next;
};
