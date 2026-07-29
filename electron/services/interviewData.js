const { DEFAULT_CONFIG } = require('./interviewPrompt');
const path = require('node:path');

function legacyHistoryToInterviewSession(legacy, fallbackTimestamp = new Date().toISOString()) {
  if (!Array.isArray(legacy) || legacy.length === 0) return null;

  const transcript = legacy.map((message, index) => {
    const timestamp = message.timestamp || fallbackTimestamp;
    return {
      id: message.id || `legacy_turn_${index}`,
      sessionId: 'legacy-susurro',
      source: 'interviewer',
      text: `${message.text || ''}${message.pendingText || ''}`.trim(),
      pendingText: '',
      startedAt: timestamp,
      endedAt: timestamp,
      isFinal: true,
      isQuestion: false,
      lastSequence: index + 1
    };
  }).filter(turn => turn.text);
  if (transcript.length === 0) return null;

  const startedAt = transcript[0].startedAt;
  const endedAt = transcript.at(-1).endedAt;
  return {
    id: 'legacy-susurro',
    status: 'completed',
    title: 'Historico Susurro',
    startedAt,
    updatedAt: endedAt,
    endedAt,
    config: { ...DEFAULT_CONFIG },
    transcript,
    answers: []
  };
}

function sessionHasContent(session = {}) {
  const hasTranscript = (session.transcript || []).some(turn => (
    `${turn?.text || ''}${turn?.pendingText || ''}`.trim()
  ));
  const hasAnswer = (session.answers || []).some(answer => String(answer?.text || '').trim());
  const hasAudio = (session.audioArtifacts || []).some(artifact => Number(artifact?.bytes || 0) > 0);
  return Boolean(session.hasRecording || hasTranscript || hasAnswer || hasAudio);
}

function buildFinishedSessionPatch(session = {}, now = new Date().toISOString()) {
  if (sessionHasContent(session)) {
    return {
      status: 'completed',
      endedAt: now
    };
  }

  return {
    status: 'pending',
    startedAt: undefined,
    endedAt: undefined,
    hasRecording: false
  };
}

function isPathInsideDirectory(directory, targetPath) {
  const root = path.resolve(String(directory || ''));
  const target = path.resolve(String(targetPath || ''));
  const relative = path.relative(root, target);
  return Boolean(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

module.exports = {
  buildFinishedSessionPatch,
  isPathInsideDirectory,
  legacyHistoryToInterviewSession,
  sessionHasContent
};
