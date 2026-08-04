const SOURCE_LABELS = {
  interviewer: 'Outra pessoa',
  candidate: 'Usuario',
  screen: 'Tela',
  manual: 'Nota manual'
};

function hasSavedRecording(session = {}) {
  const hasAudioArtifact = (session.audioArtifacts || [])
    .some(artifact => Number(artifact?.bytes || 0) > 0);
  return hasAudioArtifact || Boolean(session.config?.retainAudio && session.hasRecording);
}

function buildRecordedTranscript(session = {}) {
  return (session.transcript || [])
    .map(turn => {
      const text = `${turn?.text || ''}${turn?.pendingText || ''}`.replace(/\s+/g, ' ').trim();
      if (!text) return '';
      return `${SOURCE_LABELS[turn.source] || turn.source || 'Fala'}: ${text}`;
    })
    .filter(Boolean)
    .join('\n');
}

function clipMeetingText(value, maxChars) {
  const text = String(value || '').trim();
  if (text.length <= maxChars) return text;
  const headLength = Math.floor(maxChars * 0.6);
  const tailLength = maxChars - headLength;
  return `${text.slice(0, headLength)}\n\n[trecho intermediario omitido]\n\n${text.slice(-tailLength)}`;
}

function shouldSyncRecordedMeeting(session = {}) {
  if (session.status !== 'completed' || !hasSavedRecording(session)) return false;
  if (session.hermesMemory?.status === 'synced') return false;
  return Boolean(String(session.summary || '').trim() || buildRecordedTranscript(session));
}

function buildRecordedMeetingMemoryPrompt(session = {}, maxTranscriptChars = 12000) {
  const config = session.config || {};
  const transcript = clipMeetingText(buildRecordedTranscript(session), maxTranscriptChars);
  const memoryId = `metis-recorded-session:${session.id || 'unknown'}`;

  return {
    memoryId,
    transcript,
    prompt: [
      'O Metis concluiu uma reuniao ou entrevista gravada que deve fazer parte da inteligencia persistente do Hermes.',
      `ID de memoria: ${memoryId}`,
      `Tipo: ${config.mode === 'interview' ? 'entrevista' : 'reuniao'}`,
      `Titulo: ${session.title || config.title || 'Sem titulo'}`,
      config.company ? `Empresa ou pessoa: ${config.company}` : '',
      config.role ? `Cargo: ${config.role}` : '',
      config.description ? `Descricao: ${config.description}` : '',
      config.topics ? `Assuntos previstos: ${config.topics}` : '',
      `Inicio: ${session.startedAt || session.createdAt || 'nao informado'}`,
      `Fim: ${session.endedAt || session.updatedAt || 'nao informado'}`,
      session.summary ? `<resumo_existente>\n${session.summary}\n</resumo_existente>` : '',
      transcript ? `<transcricao>\n${transcript}\n</transcricao>` : ''
    ].filter(Boolean).join('\n')
  };
}

module.exports = {
  buildRecordedMeetingMemoryPrompt,
  buildRecordedTranscript,
  clipMeetingText,
  hasSavedRecording,
  shouldSyncRecordedMeeting
};
