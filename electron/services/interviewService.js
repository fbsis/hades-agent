const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const store = require('../store/jsonStore');
const openaiResponsesService = require('./openaiResponsesService');
const {
  RECORDED_MEETING_SUMMARY_INSTRUCTIONS,
  buildRecordedMeetingSummaryInput
} = require('./recordedMeetingMemory');
const {
  DEFAULT_CONFIG,
  buildOpenAIInterviewPrompt,
  buildInterviewContext,
  buildInterviewInstruction,
  clip
} = require('./interviewPrompt');
const {
  buildFinishedSessionPatch,
  isPathInsideDirectory,
  legacyHistoryToInterviewSession
} = require('./interviewData');
const {
  CONVERSATION_EXPANSION_INSTRUCTIONS,
  CONVERSATION_EXPANSION_SCHEMA,
  CONVERSATION_SUGGESTIONS_INSTRUCTIONS,
  CONVERSATION_SUGGESTIONS_SCHEMA,
  buildConversationInput,
  validateConversationExpansion,
  validateConversationSuggestions
} = require('./conversationSuggestionPrompt');

function id(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function parseJsonResponse(rawText) {
  const cleaned = String(rawText || '').replace(/```json|```/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

function normalizeConfig(config = {}) {
  return { ...DEFAULT_CONFIG, ...(config || {}), interviewFormat: 'standard' };
}

function normalizeSession(session) {
  if (!session) return session;
  const { whiteboardState, ...rest } = session;
  return { ...rest, config: normalizeConfig(session.config) };
}

class InterviewService {
  constructor() {
    this.activeAnswers = new Map();
    this.activeConversationSuggestions = new Set();
  }

  migrateLegacyHistory() {
    const sessions = store.getInterviewSessions();
    if (sessions.some(session => session.id === 'legacy-susurro')) return sessions;

    const migrated = legacyHistoryToInterviewSession(store.getSusurroHistory());
    if (!migrated) return sessions;

    const next = [...sessions, migrated];
    store.saveInterviewSessions(next);
    return next;
  }

  listSessions() {
    return [...this.migrateLegacyHistory()]
      .map(normalizeSession)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  getSession(sessionId) {
    return normalizeSession(this.migrateLegacyHistory().find(session => session.id === sessionId) || null);
  }

  listDocuments() {
    return [...store.getInterviewDocuments()].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  saveDocument(input = {}) {
    const title = String(input.title || '').trim();
    const content = String(input.content || '').trim();
    if (!title) throw new Error('Informe o título do documento.');
    if (!content) throw new Error('Informe o conteúdo do documento.');
    const documents = this.listDocuments();
    const now = new Date().toISOString();
    const index = documents.findIndex(document => document.id === input.id);
    const document = {
      id: index >= 0 ? documents[index].id : id('document'),
      title,
      content,
      createdAt: index >= 0 ? documents[index].createdAt : now,
      updatedAt: now
    };
    if (index >= 0) documents[index] = document;
    else documents.unshift(document);
    store.saveInterviewDocuments(documents);
    return document;
  }

  deleteDocument(documentId) {
    const documents = this.listDocuments();
    if (!documents.some(document => document.id === documentId)) throw new Error('Documento não encontrado.');
    store.saveInterviewDocuments(documents.filter(document => document.id !== documentId));
    return true;
  }

  resolveContextDocuments(config = {}) {
    const selectedIds = new Set(Array.isArray(config.contextDocumentIds) ? config.contextDocumentIds : []);
    return this.listDocuments().filter(document => selectedIds.has(document.id));
  }

  createSession(config = {}, options = {}) {
    const now = new Date().toISOString();
    const normalizedConfig = normalizeConfig(config);
    const isPending = options.status === 'pending';
    const titleParts = normalizedConfig.mode === 'interview'
      ? [normalizedConfig.company, normalizedConfig.role].filter(Boolean)
      : [normalizedConfig.company].filter(Boolean);
    const fallbackLabel = normalizedConfig.mode === 'interview' ? 'Entrevista' : 'Reuniao';
    const session = {
      id: id('interview'),
      status: isPending ? 'pending' : 'active',
      title: normalizedConfig.title || titleParts.join(' - ')
        || `${fallbackLabel} ${new Date().toLocaleDateString('pt-BR')}`,
      createdAt: now,
      ...(isPending ? {} : { startedAt: now }),
      updatedAt: now,
      config: normalizedConfig,
      transcript: [],
      answers: [],
      audioArtifacts: []
    };
    store.saveInterviewSessions([session, ...this.listSessions()]);
    store.saveSettings({ ...store.getSettings(), interview: normalizedConfig });
    return session;
  }

  createTestSession(sourceSessionId) {
    const sourceSession = this.getSession(sourceSessionId);
    if (!sourceSession || sourceSession.status !== 'pending' || sourceSession.isTestMode || sourceSession.config.mode !== 'interview') {
      throw new Error('Selecione uma entrevista pendente para testa-la.');
    }
    const now = new Date().toISOString();
    const testSession = {
      id: id('interview_test'),
      isTestMode: true,
      sourceSessionId: sourceSession.id,
      status: 'active',
      title: `${sourceSession.title} · Teste`,
      createdAt: now,
      startedAt: now,
      updatedAt: now,
      config: normalizeConfig(sourceSession.config),
      transcript: [],
      answers: [],
      audioArtifacts: []
    };
    store.saveInterviewSessions([testSession, ...this.listSessions()]);
    return testSession;
  }

  cleanupTestSessions() {
    const sessions = this.migrateLegacyHistory();
    const tests = sessions.filter(session => session.isTestMode);
    if (!tests.length) return 0;
    const audioRoot = path.resolve(store.userDataPath, 'interview-audio');
    for (const session of tests) {
      for (const artifact of session.audioArtifacts || []) {
        const target = path.resolve(String(artifact?.path || ''));
        if (isPathInsideDirectory(audioRoot, target)) fs.rmSync(target, { force: true });
      }
    }
    store.saveInterviewSessions(sessions.filter(session => !session.isTestMode));
    return tests.length;
  }

  updateSession(sessionId, patch = {}) {
    const sessions = this.listSessions();
    const index = sessions.findIndex(session => session.id === sessionId);
    if (index < 0) throw new Error('Sessao de entrevista nao encontrada.');

    const current = sessions[index];
    const nextSession = {
      ...current,
      ...patch,
      config: patch.config ? { ...current.config, ...patch.config } : current.config,
      transcript: current.transcript,
      answers: current.answers,
      audioArtifacts: patch.audioArtifacts || current.audioArtifacts || [],
      updatedAt: new Date().toISOString()
    };
    sessions[index] = nextSession;
    store.saveInterviewSessions(sessions);
    return nextSession;
  }

  finishSession(sessionId, options = {}) {
    const session = this.getSession(sessionId);
    if (!session) throw new Error('Sessao de entrevista nao encontrada.');
    if (options.forceCompleted) {
      return this.updateSession(sessionId, {
        status: 'completed',
        endedAt: new Date().toISOString()
      });
    }
    return this.updateSession(sessionId, buildFinishedSessionPatch(session));
  }

  archiveSession(sessionId) {
    return this.updateSession(sessionId, { status: 'archived' });
  }

  deleteSession(sessionId) {
    const sessions = this.migrateLegacyHistory();
    const session = sessions.find(item => item.id === sessionId);
    if (!session) throw new Error('Sessao de entrevista nao encontrada.');

    for (const [answerId, state] of this.activeAnswers.entries()) {
      if (state.sessionId === sessionId) this.cancelAnswer(answerId);
    }

    const audioRoot = path.resolve(store.userDataPath, 'interview-audio');
    for (const artifact of session.audioArtifacts || []) {
      const target = path.resolve(String(artifact?.path || ''));
      if (isPathInsideDirectory(audioRoot, target)) {
        fs.rmSync(target, { force: true });
      }
    }

    if (sessionId === 'legacy-susurro') {
      store.saveSusurroHistory([]);
    }
    store.saveInterviewSessions(sessions.filter(item => item.id !== sessionId));
    return true;
  }

  upsertTurn(sessionId, turn) {
    const sessions = this.listSessions();
    const sessionIndex = sessions.findIndex(session => session.id === sessionId);
    if (sessionIndex < 0) throw new Error('Sessao de entrevista nao encontrada.');

    const session = sessions[sessionIndex];
    const transcript = [...(session.transcript || [])];
    const turnIndex = transcript.findIndex(item => item.id === turn.id);
    const normalized = { ...turn, sessionId };
    if (turnIndex < 0) transcript.push(normalized);
    else transcript[turnIndex] = { ...transcript[turnIndex], ...normalized };

    sessions[sessionIndex] = { ...session, transcript, updatedAt: new Date().toISOString() };
    store.saveInterviewSessions(sessions);
    return normalized;
  }

  upsertAnswer(sessionId, answer) {
    const sessions = this.listSessions();
    const sessionIndex = sessions.findIndex(session => session.id === sessionId);
    if (sessionIndex < 0) throw new Error('Sessao de entrevista nao encontrada.');

    const session = sessions[sessionIndex];
    const answers = [...(session.answers || [])];
    const answerIndex = answers.findIndex(item => item.id === answer.id);
    if (answerIndex < 0) answers.push(answer);
    else answers[answerIndex] = { ...answers[answerIndex], ...answer };

    const transcript = (session.transcript || []).map(turn => (
      answer.turnId && turn.id === answer.turnId ? { ...turn, answerId: answer.id } : turn
    ));
    sessions[sessionIndex] = {
      ...session,
      answers,
      transcript,
      updatedAt: new Date().toISOString()
    };
    store.saveInterviewSessions(sessions);
    return answer;
  }

  addAudioArtifact(sessionId, artifact) {
    const session = this.getSession(sessionId);
    if (!session) return null;
    const artifacts = (session.audioArtifacts || []).filter(item => item.path !== artifact.path);
    return this.updateSession(sessionId, { audioArtifacts: [...artifacts, artifact] });
  }

  buildContext(args) {
    return buildInterviewContext(args);
  }

  buildInstruction(args) {
    return buildInterviewInstruction(args);
  }

  async summarizeSession(sessionId) {
    const session = this.getSession(sessionId);
    if (!session) throw new Error('Sessao nao encontrada.');
    const settings = store.getSettings();
    const summaryInput = buildRecordedMeetingSummaryInput(
      session,
      settings?.hermes?.meetingSummaryMaxChars || 12000
    );
    if (!summaryInput.transcript) throw new Error('Nao ha transcricao salva para resumir.');

    const apiKey = settings?.general?.openaiApiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OpenAI API key nao configurada para resumir.');
    const result = await openaiResponsesService.generateText({
      apiKey,
      model: settings?.general?.dreamingModel || 'gpt-5.6-luna',
      instructions: RECORDED_MEETING_SUMMARY_INSTRUCTIONS,
      input: summaryInput.input,
      maxOutputTokens: 1000,
      reasoningEffort: 'none',
      verbosity: 'low'
    });
    const text = result.text.trim();

    if (!text) throw new Error('A IA nao retornou um resumo.');
    return this.updateSession(sessionId, {
      summary: text,
      summaryAt: new Date().toISOString(),
      summaryProvider: 'openai'
    });
  }

  async streamOpenAIAnswer(args, instruction, state, emit) {
    const settings = store.getSettings();
    const apiKey = settings?.general?.openaiApiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OpenAI API key nao configurada. Abra Configuracoes > Configuracao.');
    }

    const controller = new AbortController();
    state.abortController = controller;
    const result = await openaiResponsesService.generateTextStream({
      apiKey,
      model: 'gpt-5.6-sol',
      instructions: instruction,
      input: buildOpenAIInterviewPrompt(args),
      maxOutputTokens: null,
      reasoningEffort: 'low',
      verbosity: 'low',
      signal: controller.signal,
      onDelta: delta => {
        if (state.cancelled || !delta) return;
        state.text += delta;
        emit({ type: 'delta', text: delta, provider: 'openai' });
      }
    });
    if (!state.text.trim() && result.text) {
      state.text = result.text;
      emit({ type: 'delta', text: result.text, provider: 'openai' });
    }
    return { success: !state.cancelled, cancelled: state.cancelled, text: state.text };
  }

  async streamAnswer(args = {}, onEvent = () => {}) {
    const question = String(args.question || '').trim();
    if (!question) throw new Error('Pergunta vazia.');

    const answerId = args.answerId || id('answer');
    const sessionId = args.sessionId;
    const enrichedArgs = { ...args, contextDocuments: this.resolveContextDocuments(args.config) };
    const instruction = this.buildInstruction(enrichedArgs);
    const requestedProvider = 'openai';
    const state = {
      answerId,
      sessionId,
      turnId: args.turnId,
      question,
      text: '',
      cancelled: false,
      provider: requestedProvider,
      eventSequence: 0,
      abortController: null
    };
    const emit = payload => {
      state.eventSequence += 1;
      onEvent({
        sessionId,
        answerId,
        source: 'answer',
        turnId: state.turnId,
        sequence: state.eventSequence,
        ...payload
      });
    };
    this.activeAnswers.set(answerId, state);

    const answer = {
      id: answerId,
      sessionId,
      turnId: args.turnId,
      question,
      text: '',
      status: 'streaming',
      provider: requestedProvider,
      variant: args.variant || 'answer',
      createdAt: new Date().toISOString()
    };
    this.upsertAnswer(sessionId, answer);
    emit({ type: 'start', provider: requestedProvider });

    try {
      const result = await this.streamOpenAIAnswer(enrichedArgs, instruction, state, emit);

      if (state.cancelled || result?.cancelled) {
        const cancelled = {
          ...answer,
          text: state.text.trim(),
          status: 'cancelled',
          provider: state.provider,
          completedAt: new Date().toISOString()
        };
        this.upsertAnswer(sessionId, cancelled);
        emit({ type: 'cancelled', text: cancelled.text, provider: state.provider });
        return cancelled;
      }

      if (!state.text.trim()) throw new Error(result?.error || 'Nenhuma resposta foi gerada.');

      const completed = {
        ...answer,
        text: state.text.trim(),
        status: 'complete',
        provider: state.provider,
        completedAt: new Date().toISOString()
      };
      this.upsertAnswer(sessionId, completed);
      emit({ type: 'end', text: completed.text, provider: completed.provider });
      return completed;
    } catch (error) {
      const failed = {
        ...answer,
        text: state.text.trim(),
        status: state.cancelled ? 'cancelled' : 'failed',
        provider: state.provider,
        completedAt: new Date().toISOString(),
        error: state.cancelled ? undefined : error.message
      };
      this.upsertAnswer(sessionId, failed);
      emit({
        type: state.cancelled ? 'cancelled' : 'error',
        text: failed.text,
        error: failed.error,
        provider: failed.provider
      });
      return failed;
    } finally {
      this.activeAnswers.delete(answerId);
    }
  }

  cancelAnswer(answerId) {
    const state = this.activeAnswers.get(answerId);
    if (!state) return false;
    state.cancelled = true;
    state.abortController?.abort();
    return true;
  }

  async analyzeScreen(images, question = '') {
    const settings = store.getSettings();
    const apiKey = settings?.general?.openaiApiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OpenAI API key nao configurada. Abra Configuracoes > Configuracao.');
    }
    if (!Array.isArray(images) || images.length === 0) throw new Error('Nenhuma tela disponivel.');

    const prompt = [
      'Read all visible content in these screenshots, including code, terminal output, question text and alternatives.',
      'For a technical test, extract the complete problem statement, examples, constraints, starter code, requested language and all answer choices.',
      'Extract the exact interview or programming question when one is visible. Preserve identifiers, numbers and code syntax exactly.',
      'Create complete but compact context for the answering model. Do not claim the screenshot is truncated merely because there are other windows.',
      question ? `Candidate note: ${question}` : '',
      'Return only valid JSON: {"summary":"","detectedQuestion":"","extractedText":"","programmingQuestionVisible":false,"directAnswer":"","confidence":0}'
    ].filter(Boolean).join('\n');
    const result = await openaiResponsesService.generateText({
      apiKey,
      model: 'gpt-5.6-sol',
      instructions: 'Analyze the interview screenshot accurately. Return only the requested valid JSON.',
      input: [{
        role: 'user',
        content: [
          { type: 'input_text', text: prompt },
          ...images.slice(0, 4).map(imageUrl => ({
            type: 'input_image',
            image_url: imageUrl,
            detail: 'high'
          }))
        ]
      }],
      maxOutputTokens: 4096,
      reasoningEffort: 'low',
      verbosity: 'low'
    });
    const raw = result.text;
    const parsed = parseJsonResponse(raw) || {};
    const analysis = {
      summary: String(parsed.summary || raw || '').trim(),
      detectedQuestion: String(parsed.detectedQuestion || '').trim(),
      extractedText: clip(parsed.extractedText || '', 6000),
      programmingQuestionVisible: Boolean(parsed.programmingQuestionVisible),
      directAnswer: String(parsed.directAnswer || '').trim(),
      confidence: Number(parsed.confidence || 0)
    };
    analysis.context = [
      analysis.summary ? `Screen summary: ${analysis.summary}` : '',
      analysis.detectedQuestion ? `Detected question: ${analysis.detectedQuestion}` : '',
      analysis.extractedText ? `Visible text/code:\n${analysis.extractedText}` : ''
    ].filter(Boolean).join('\n\n');
    return analysis;
  }

  async requestConversationSuggestions(args = {}) {
    const sessionId = String(args.sessionId || '');
    if (this.activeConversationSuggestions.has(sessionId)) {
      throw new Error('Uma analise da conversa ja esta em andamento.');
    }
    this.activeConversationSuggestions.add(sessionId);
    try {
      const session = this.getSession(sessionId);
      if (!session) throw new Error('Sessao de entrevista nao encontrada.');
      const settings = store.getSettings();
      const apiKey = settings?.general?.openaiApiKey || process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error('OpenAI API key nao configurada. Abra Configuracoes > Configuracao.');

      const turns = Array.isArray(args.turns) ? args.turns : session.transcript || [];
      const input = buildConversationInput({
        session,
        turns,
        contextDocuments: this.resolveContextDocuments(session.config),
        hint: args.hint,
        excludedSuggestions: args.excludedSuggestions
      });
      const result = await openaiResponsesService.generateText({
        apiKey,
        model: 'gpt-5.6-luna',
        instructions: CONVERSATION_SUGGESTIONS_INSTRUCTIONS,
        input,
        maxOutputTokens: 1800,
        reasoningEffort: 'none',
        verbosity: 'low',
        textFormat: CONVERSATION_SUGGESTIONS_SCHEMA
      });
      const suggestions = validateConversationSuggestions(parseJsonResponse(result.text))
        .map(suggestion => ({ ...suggestion, id: id('suggestion') }));
      return { generatedAt: new Date().toISOString(), suggestions };
    } finally {
      this.activeConversationSuggestions.delete(sessionId);
    }
  }

  async expandConversationSuggestion(args = {}) {
    const session = this.getSession(args.sessionId);
    if (!session) throw new Error('Sessao de entrevista nao encontrada.');
    const settings = store.getSettings();
    const apiKey = settings?.general?.openaiApiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OpenAI API key nao configurada. Abra Configuracoes > Configuracao.');
    if (!args.suggestion) throw new Error('Selecione uma sugestao para continuar.');
    const turns = Array.isArray(args.turns) ? args.turns : session.transcript || [];
    const input = buildConversationInput({
      session,
      turns,
      contextDocuments: this.resolveContextDocuments(session.config),
      suggestion: args.suggestion
    });
    const result = await openaiResponsesService.generateText({
      apiKey,
      model: 'gpt-5.6-sol',
      instructions: CONVERSATION_EXPANSION_INSTRUCTIONS,
      input,
      maxOutputTokens: 700,
      reasoningEffort: 'low',
      verbosity: 'low',
      textFormat: CONVERSATION_EXPANSION_SCHEMA
    });
    return validateConversationExpansion(parseJsonResponse(result.text));
  }
}

module.exports = new InterviewService();
