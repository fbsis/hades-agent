const crypto = require('node:crypto');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const store = require('../store/jsonStore');
const hermesService = require('./hermesService');
const logger = require('./logger');
const { geminiGenerationConfig } = require('./interviewGenerationConfig');
const {
  DEFAULT_CONFIG,
  buildGeminiInterviewPrompt,
  buildInterviewContext,
  buildInterviewInstruction,
  clip
} = require('./interviewPrompt');
const { legacyHistoryToInterviewSession } = require('./interviewData');

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

class InterviewService {
  constructor() {
    this.activeAnswers = new Map();
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
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  getSession(sessionId) {
    return this.migrateLegacyHistory().find(session => session.id === sessionId) || null;
  }

  createSession(config = {}) {
    const now = new Date().toISOString();
    const normalizedConfig = { ...DEFAULT_CONFIG, ...(config || {}) };
    const titleParts = normalizedConfig.mode === 'interview'
      ? [normalizedConfig.company, normalizedConfig.role].filter(Boolean)
      : [];
    const fallbackLabel = normalizedConfig.mode === 'interview' ? 'Entrevista' : 'Reuniao';
    const session = {
      id: id('interview'),
      status: 'active',
      title: normalizedConfig.title || titleParts.join(' - ')
        || `${fallbackLabel} ${new Date().toLocaleDateString('pt-BR')}`,
      startedAt: now,
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

  finishSession(sessionId) {
    return this.updateSession(sessionId, {
      status: 'completed',
      endedAt: new Date().toISOString()
    });
  }

  archiveSession(sessionId) {
    return this.updateSession(sessionId, { status: 'archived' });
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
    const transcript = (session.transcript || [])
      .map(turn => `${turn.source}: ${String(turn.text || '').trim()}`)
      .filter(line => !line.endsWith(':'))
      .join('\n');
    if (!transcript.trim()) throw new Error('Nao ha transcricao salva para resumir.');

    const instruction = [
      'Resuma esta reuniao ou entrevista em Markdown compacto.',
      'Use as secoes Resumo, Decisoes, Acoes, Perguntas abertas e Contexto.',
      'Use somente bullets, omita secoes sem conteudo e preserve nomes, numeros e compromissos.',
      'O resumo sera reutilizado como contexto para responder perguntas futuras.'
    ].join(' ');
    let provider = 'hermes';
    let text = '';
    const hermesResult = await hermesService.ask({
      prompt: `Titulo: ${session.title}\n\n${clip(transcript, 16000)}`,
      instruction,
      includeLocalContext: false,
      maxOutputTokens: 1200,
      logType: 'meeting_summary',
      primaryAgent: true
    });

    if (hermesResult.success && hermesResult.text) {
      text = hermesResult.text.trim();
    } else {
      provider = 'gemini';
      const settings = store.getSettings();
      const apiKey = settings?.general?.apiKey || process.env.VITE_GEMINI_API_KEY;
      if (!apiKey) throw new Error(hermesResult.error || 'Nenhuma IA configurada para resumir.');
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({
        model: settings.general.minichatModel || 'gemini-2.5-flash',
        systemInstruction: instruction
      });
      const result = await model.generateContent(`Titulo: ${session.title}\n\n${clip(transcript, 16000)}`);
      text = result.response.text().trim();
    }

    if (!text) throw new Error('A IA nao retornou um resumo.');
    return this.updateSession(sessionId, {
      summary: text,
      summaryAt: new Date().toISOString(),
      summaryProvider: provider
    });
  }

  async streamGeminiAnswer(args, instruction, state, emit) {
    const settings = store.getSettings();
    const apiKey = settings?.general?.apiKey || process.env.VITE_GEMINI_API_KEY;
    if (!apiKey) throw new Error('Gemini API key nao configurada.');

    const controller = new AbortController();
    state.abortController = controller;
    const genAI = new GoogleGenerativeAI(apiKey);
    const modelName = settings.general.minichatModel || 'gemini-2.5-flash';
    const model = genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: instruction,
      generationConfig: geminiGenerationConfig(modelName, args.variant)
    });
    const prompt = buildGeminiInterviewPrompt(args);
    const streamResult = await model.generateContentStream(prompt, {
      signal: controller.signal
    });

    for await (const chunk of streamResult.stream) {
      if (state.cancelled) break;
      const delta = chunk.text();
      if (!delta) continue;
      state.text += delta;
      emit({ type: 'delta', text: delta, provider: 'gemini' });
    }

    const response = await streamResult.response;
    if (!state.cancelled && !state.text.trim()) {
      const text = response.text().trim();
      if (text) {
        state.text = text;
        emit({ type: 'delta', text, provider: 'gemini' });
      }
    }

    const finishReason = response.candidates?.[0]?.finishReason;
    if (!state.cancelled && finishReason && finishReason !== 'STOP') {
      logger.warn(
        'INTERVIEW',
        `Gemini ${args.variant || 'answer'} finished with ${finishReason} after ${state.text.length} chars`
      );
      if (finishReason === 'MAX_TOKENS') {
        throw new Error('Gemini atingiu o limite antes de concluir a resposta. Tente novamente.');
      }
    }

    return { success: !state.cancelled, cancelled: state.cancelled, text: state.text };
  }

  async generateGeminiFallback(args, context, instruction) {
    const settings = store.getSettings();
    const apiKey = settings?.general?.apiKey || process.env.VITE_GEMINI_API_KEY;
    if (!apiKey) throw new Error('Hermes indisponivel e Gemini API key nao configurada.');

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: settings.general.minichatModel || 'gemini-2.5-flash',
      systemInstruction: instruction
    });
    const result = await model.generateContent([
      context ? `Context:\n${context}` : '',
      `Interview question:\n${String(args.question || '').trim()}`
    ].filter(Boolean).join('\n\n'));
    return result.response.text().trim();
  }

  async streamAnswer(args = {}, onEvent = () => {}) {
    const question = String(args.question || '').trim();
    if (!question) throw new Error('Pergunta vazia.');

    const answerId = args.answerId || id('answer');
    const sessionId = args.sessionId;
    const context = this.buildContext(args);
    const instruction = this.buildInstruction(args);
    const requestedProvider = args.provider === 'gemini' ? 'gemini' : 'hermes';
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
      let result = null;
      if (requestedProvider === 'gemini') {
        result = await this.streamGeminiAnswer(args, instruction, state, emit);
      } else {
        result = await hermesService.askStream({
          streamId: answerId,
          prompt: question,
          context,
          instruction,
          mode: 'interview',
          preferredAnswerStyle: args.variant === 'code' ? 'code_explained' : 'short',
          includeLocalContext: false,
          maxOutputTokens: args.variant === 'code' ? 1400 : 700,
          timeoutMs: store.getSettings()?.hermes?.timeoutMs || 30000,
          logType: 'interview_answer',
          primaryAgent: true
        }, event => {
          if (event.type === 'delta' && event.text) {
            state.text += event.text;
            emit({ type: 'delta', text: event.text, provider: 'hermes' });
          } else if (event.type === 'tool') {
            emit({ type: 'tool', text: event.text, provider: 'hermes' });
          }
        });
      }

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

      if (requestedProvider === 'hermes') {
        const nonStreamedHermesText = String(result?.text || '').trim();
        if (
          result?.success
          && !state.text.trim()
          && nonStreamedHermesText
          && nonStreamedHermesText !== 'Hermes nao retornou texto.'
        ) {
          state.text = nonStreamedHermesText;
          emit({ type: 'delta', text: state.text, provider: 'hermes' });
        }

        if (!result?.success && state.text.trim()) {
          throw new Error(result?.error || 'O stream do Hermes terminou antes de completar a resposta.');
        }

        if (!state.text.trim()) {
          state.provider = 'gemini';
          const fallbackText = await this.generateGeminiFallback(
            args,
            context,
            this.buildInstruction({ ...args, provider: 'gemini' })
          );
          state.text = fallbackText;
          emit({ type: 'delta', text: fallbackText, provider: 'gemini' });
        }
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
    hermesService.cancelStream(answerId);
    return true;
  }

  async analyzeScreen(images, question = '') {
    const settings = store.getSettings();
    const apiKey = settings?.general?.apiKey || process.env.VITE_GEMINI_API_KEY;
    if (!apiKey) throw new Error('Gemini API key nao configurada.');
    if (!Array.isArray(images) || images.length === 0) throw new Error('Nenhuma tela disponivel.');

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: settings.general.minichatModel || 'gemini-2.5-flash' });
    const prompt = [
      'Read all visible content in these screenshots, including code, terminal output, question text and alternatives.',
      'Extract the exact interview or programming question when one is visible.',
      'Create compact context for another agent. Do not answer with uncertainty about truncation.',
      question ? `Candidate note: ${question}` : '',
      'Return only valid JSON: {"summary":"","detectedQuestion":"","extractedText":"","programmingQuestionVisible":false,"directAnswer":"","confidence":0}'
    ].filter(Boolean).join('\n');
    const parts = [
      prompt,
      ...images.slice(0, 4).map(dataUrl => {
        const match = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl || '');
        return {
          inlineData: {
            mimeType: match?.[1] || 'image/png',
            data: match?.[2] || String(dataUrl).split(',')[1]
          }
        };
      })
    ];
    const result = await model.generateContent(parts);
    const raw = result.response.text();
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
}

module.exports = new InterviewService();
