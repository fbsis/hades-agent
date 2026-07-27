const { DEFAULT_CONFIG } = require('./interviewPrompt');

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

module.exports = { legacyHistoryToInterviewSession };
