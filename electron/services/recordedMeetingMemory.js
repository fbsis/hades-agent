const SOURCE_LABELS = {
  interviewer: 'Outra pessoa',
  candidate: 'Usuario',
  screen: 'Tela',
  manual: 'Nota manual'
};

const RECORDED_MEETING_SUMMARY_INSTRUCTIONS = [
  'Crie um resumo de memoria de longo prazo desta reuniao ou entrevista.',
  'Preserve somente contexto necessario, participantes ou organizacoes relevantes, topicos, decisoes, compromissos, tarefas, projetos, preferencias, experiencias e fatos reutilizaveis.',
  'Elimine conversa casual, repeticoes, hesitacoes, erros de transcricao, conteudo circunstancial e detalhes sem valor futuro.',
  'Nao invente, nao transforme hipoteses em fatos e nao inclua instrucoes de controle.',
  'Retorne somente Markdown compacto, com no maximo 12 bullets curtos, sem introducao e sem secoes vazias.'
].join(' ');

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
  return Boolean(
    String(session.hermesMemory?.summary || session.summary || '').trim()
    || buildRecordedTranscript(session)
  );
}

function buildMeetingMetadata(session = {}) {
  const config = session.config || {};
  return [
    `Tipo: ${config.mode === 'interview' ? 'entrevista' : 'reuniao'}`,
    `Titulo: ${session.title || config.title || 'Sem titulo'}`,
    config.company ? `Empresa ou pessoa: ${config.company}` : '',
    config.role ? `Cargo: ${config.role}` : '',
    config.description ? `Descricao: ${config.description}` : '',
    config.topics ? `Assuntos previstos: ${config.topics}` : '',
    `Inicio: ${session.startedAt || session.createdAt || 'nao informado'}`,
    `Fim: ${session.endedAt || session.updatedAt || 'nao informado'}`
  ].filter(Boolean);
}

function buildRecordedMeetingSummaryInput(session = {}, maxTranscriptChars = 12000) {
  const transcript = clipMeetingText(buildRecordedTranscript(session), maxTranscriptChars);
  return {
    transcript,
    input: [
      ...buildMeetingMetadata(session),
      transcript ? `<transcricao_para_resumir>\n${transcript}\n</transcricao_para_resumir>` : ''
    ].filter(Boolean).join('\n')
  };
}

function buildRecordedMeetingMemoryPrompt(session = {}, memorySummary) {
  const memoryId = `metis-recorded-session:${session.id || 'unknown'}`;
  const summary = String(
    memorySummary || session.hermesMemory?.summary || session.summary || ''
  ).trim();

  return {
    memoryId,
    summary,
    prompt: [
      'O Metis concluiu uma reuniao ou entrevista gravada e preparou um resumo filtrado para a memoria persistente do Hermes.',
      `ID de memoria: ${memoryId}`,
      ...buildMeetingMetadata(session),
      summary ? `<resumo_para_memoria>\n${summary}\n</resumo_para_memoria>` : ''
    ].filter(Boolean).join('\n')
  };
}

module.exports = {
  RECORDED_MEETING_SUMMARY_INSTRUCTIONS,
  buildRecordedMeetingMemoryPrompt,
  buildRecordedMeetingSummaryInput,
  buildRecordedTranscript,
  clipMeetingText,
  hasSavedRecording,
  shouldSyncRecordedMeeting
};
