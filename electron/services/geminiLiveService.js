const crypto = require('node:crypto');
const { GoogleGenAI } = require('@google/genai');
const store = require('../store/jsonStore');
const logger = require('./logger');

const MODEL = 'gemini-3.1-flash-live-preview';
const TURN_IDLE_MS = 900;
const MAX_PENDING_CHUNKS = 50;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAYS = [500, 1000, 2000, 5000, 8000];

class GeminiLiveService {
  constructor() {
    this.sources = new Map();
  }

  key(sessionId, source) {
    return `${sessionId}:${source}`;
  }

  sendToRenderer(record, channel, payload) {
    if (!record.event?.sender || record.event.sender.isDestroyed()) return;
    record.event.sender.send(channel, payload);
  }

  emitStatus(record, status, extra = {}) {
    record.statusSequence += 1;
    const payload = {
      sessionId: record.sessionId,
      source: record.source,
      turnId: record.currentTurnId || undefined,
      sequence: record.statusSequence,
      status,
      ...extra
    };
    this.sendToRenderer(record, 'interview-transcription-status', payload);
    if (record.legacy) this.sendToRenderer(record, 'susurro-live-status', status);
  }

  createRecord(event, options) {
    return {
      event,
      sessionId: options.sessionId,
      source: options.source,
      language: options.language || 'auto',
      personaPrompt: options.personaPrompt || '',
      legacy: !!options.legacy,
      client: null,
      session: null,
      desired: true,
      ready: false,
      reconnectAttempt: 0,
      reconnectTimer: null,
      connectVersion: 0,
      resumeHandle: '',
      pendingChunks: [],
      lastRendererSeq: 0,
      chunkCount: 0,
      lastAudioLogAt: 0,
      lastChunkTime: 0,
      audioStreamOpen: false,
      currentTurnId: null,
      deltaSequence: 0,
      statusSequence: 0,
      turnStartTime: 0,
      finalizeTimer: null
    };
  }

  async startSource(event, options = {}) {
    const sessionId = String(options.sessionId || '').trim();
    const source = options.source === 'candidate' ? 'candidate' : 'interviewer';
    if (!sessionId) throw new Error('sessionId obrigatorio para transcricao.');

    const apiKey = store.getSettings()?.general?.apiKey || process.env.VITE_GEMINI_API_KEY;
    if (!apiKey) throw new Error('Gemini API key nao configurada.');

    const key = this.key(sessionId, source);
    await this.stopSource(sessionId, source);
    const record = this.createRecord(event, { ...options, sessionId, source });
    record.client = new GoogleGenAI({ apiKey });
    this.sources.set(key, record);

    await this.connectSource(record, false);
    return record.desired;
  }

  transcriptionInstruction(record) {
    const language = record.language === 'auto'
      ? 'Preserve the language being spoken.'
      : `The expected language is ${record.language}.`;
    return record.personaPrompt || [
      'You are a high precision audio transcription engine.',
      'Transcribe exactly what is spoken through input_audio_transcription.',
      'Do not answer, comment, summarize or emit model text/audio.',
      language
    ].join(' ');
  }

  async connectSource(record, reconnecting) {
    if (!record.desired) return false;
    const version = ++record.connectVersion;
    this.emitStatus(record, reconnecting ? 'reconnecting' : 'connecting', {
      attempt: record.reconnectAttempt
    });

    try {
      const session = await record.client.live.connect({
        model: MODEL,
        config: {
          responseModalities: ['AUDIO'],
          systemInstruction: {
            parts: [{ text: this.transcriptionInstruction(record) }]
          },
          inputAudioTranscription: {},
          thinkingConfig: { thinkingLevel: 'MINIMAL' },
          sessionResumption: {
            transparent: true,
            ...(record.resumeHandle ? { handle: record.resumeHandle } : {})
          },
          contextWindowCompression: {
            triggerTokens: '24000',
            slidingWindow: { targetTokens: '12000' }
          },
          realtimeInputConfig: {
            automaticActivityDetection: {
              startOfSpeechSensitivity: 'START_SENSITIVITY_HIGH',
              endOfSpeechSensitivity: 'END_SENSITIVITY_HIGH',
              prefixPaddingMs: 100,
              silenceDurationMs: 500
            }
          }
        },
        callbacks: {
          onopen: () => {
            if (!record.desired || version !== record.connectVersion) return;
            record.ready = true;
            record.reconnectAttempt = 0;
            logger.info('GEMINI LIVE', `[${record.source}] session ready`);
            this.emitStatus(record, 'ready');
            this.flushPendingChunks(record);
          },
          onmessage: message => this.handleServerMessage(record, message),
          onerror: error => {
            if (!record.desired || version !== record.connectVersion) return;
            logger.error('GEMINI LIVE', `[${record.source}] session error`, error);
            record.ready = false;
            this.emitStatus(record, 'error', { error: error?.message || String(error) });
            this.scheduleReconnect(record);
          },
          onclose: closeEvent => {
            if (version !== record.connectVersion) return;
            record.ready = false;
            record.session = null;
            this.finalizeTurn(record, 'connection_closed');
            logger.info(
              'GEMINI LIVE',
              `[${record.source}] closed (${closeEvent?.code || 'n/a'}: ${closeEvent?.reason || 'no reason'})`
            );
            if (record.desired) this.scheduleReconnect(record);
            else this.emitStatus(record, 'closed');
          }
        }
      });

      if (!record.desired || version !== record.connectVersion) {
        session.close?.();
        return false;
      }
      record.session = session;
      if (record.ready) this.flushPendingChunks(record);
      return true;
    } catch (error) {
      if (!record.desired || version !== record.connectVersion) return false;
      record.ready = false;
      logger.error('GEMINI LIVE', `[${record.source}] connection failed`, error);
      this.emitStatus(record, 'error', { error: error?.message || String(error) });
      this.scheduleReconnect(record);
      return false;
    }
  }

  scheduleReconnect(record) {
    if (!record.desired || record.reconnectTimer) return;
    if (record.reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
      this.emitStatus(record, 'error', { error: 'Nao foi possivel reconectar a transcricao.' });
      return;
    }

    const attempt = record.reconnectAttempt + 1;
    const delay = RECONNECT_DELAYS[Math.min(record.reconnectAttempt, RECONNECT_DELAYS.length - 1)];
    record.reconnectAttempt = attempt;
    this.emitStatus(record, 'reconnecting', { attempt });
    record.reconnectTimer = setTimeout(() => {
      record.reconnectTimer = null;
      const previousSession = record.session;
      record.session = null;
      record.connectVersion += 1;
      try {
        previousSession?.close?.();
      } catch (error) {
        logger.warn('GEMINI LIVE', `[${record.source}] old session close failed: ${error.message}`);
      }
      this.connectSource(record, true);
    }, delay);
  }

  handleServerMessage(record, message) {
    if (!message || !record.desired) return;
    if (message.sessionResumptionUpdate?.resumable && message.sessionResumptionUpdate.newHandle) {
      record.resumeHandle = message.sessionResumptionUpdate.newHandle;
    }
    if (message.goAway) {
      logger.info('GEMINI LIVE', `[${record.source}] server requested reconnect`);
    }

    const serverContent = message.serverContent;
    if (!serverContent) return;
    if (serverContent.inputTranscription) {
      this.processInputTranscription(record, serverContent.inputTranscription);
    }
    if (serverContent.turnComplete) this.finalizeTurn(record, 'server_turn_complete');
  }

  ensureTurn(record) {
    if (!record.currentTurnId) {
      record.currentTurnId = `turn_${crypto.randomUUID()}`;
      record.turnStartTime = Date.now();
    }
    return record.currentTurnId;
  }

  emitDelta(record, text, isFinal) {
    const turnId = this.ensureTurn(record);
    record.deltaSequence += 1;
    const payload = {
      sessionId: record.sessionId,
      source: record.source,
      turnId,
      sequence: record.deltaSequence,
      text: text || '',
      isFinal: !!isFinal,
      timestamp: new Date().toISOString()
    };
    this.sendToRenderer(record, 'interview-transcript-delta', payload);
    if (record.legacy) {
      this.sendToRenderer(record, 'susurro-live-delta', { text: payload.text, isFinal: payload.isFinal });
    }
    if (isFinal) {
      record.currentTurnId = null;
      record.turnStartTime = 0;
    }
  }

  processInputTranscription(record, transcription) {
    const text = String(transcription.text || '');
    if (!text && !transcription.finished) return;
    const latency = record.lastChunkTime ? Date.now() - record.lastChunkTime : 0;
    if (text) logger.info('GEMINI LIVE', `[${record.source}] "${text}" (${latency}ms)`);
    this.clearFinalizeTimer(record);
    this.emitDelta(record, text, !!transcription.finished);
    if (!transcription.finished) this.scheduleTurnFinalize(record);
  }

  scheduleTurnFinalize(record) {
    this.clearFinalizeTimer(record);
    record.finalizeTimer = setTimeout(() => {
      record.finalizeTimer = null;
      this.finalizeTurn(record, 'local_idle');
    }, TURN_IDLE_MS);
  }

  clearFinalizeTimer(record) {
    if (!record.finalizeTimer) return;
    clearTimeout(record.finalizeTimer);
    record.finalizeTimer = null;
  }

  finalizeTurn(record, reason) {
    this.clearFinalizeTimer(record);
    if (!record.currentTurnId) return;
    logger.info('GEMINI LIVE', `[${record.source}] turn finalized (${reason})`);
    this.emitDelta(record, '', true);
  }

  sendChunk(payload = {}) {
    const record = this.sources.get(this.key(payload.sessionId, payload.source));
    if (!record || !record.desired || !payload.base64) return false;
    if (Number(payload.sequence) <= record.lastRendererSeq) return false;
    record.lastRendererSeq = Number(payload.sequence);

    if (!record.ready || !record.session) {
      record.pendingChunks.push(payload);
      if (record.pendingChunks.length > MAX_PENDING_CHUNKS) record.pendingChunks.shift();
      return false;
    }
    return this.sendChunkNow(record, payload);
  }

  sendChunkNow(record, payload) {
    try {
      record.session.sendRealtimeInput({
        audio: {
          data: payload.base64,
          mimeType: 'audio/pcm;rate=16000'
        }
      });
      record.chunkCount += 1;
      record.lastChunkTime = Date.now();
      record.audioStreamOpen = true;
      if (record.chunkCount === 1 || record.lastChunkTime - record.lastAudioLogAt >= 10000) {
        logger.info('GEMINI LIVE', `[${record.source}] sending chunk #${record.chunkCount} (seq ${payload.sequence})`);
        record.lastAudioLogAt = record.lastChunkTime;
      }
      return true;
    } catch (error) {
      logger.error('GEMINI LIVE', `[${record.source}] failed to send audio`, error);
      record.ready = false;
      record.pendingChunks.push(payload);
      this.scheduleReconnect(record);
      return false;
    }
  }

  flushPendingChunks(record) {
    if (!record.ready || !record.session || record.pendingChunks.length === 0) return;
    const pending = record.pendingChunks.splice(0);
    pending.forEach(chunk => this.sendChunkNow(record, chunk));
  }

  sendAudioStreamEnd(sessionId, source, reason = 'pause') {
    const record = this.sources.get(this.key(sessionId, source));
    if (!record?.session || !record.ready || !record.audioStreamOpen) return;
    try {
      record.session.sendRealtimeInput({ audioStreamEnd: true });
      record.audioStreamOpen = false;
      this.finalizeTurn(record, reason);
    } catch (error) {
      logger.error('GEMINI LIVE', `[${source}] audio stream end failed`, error);
    }
  }

  async stopSource(sessionId, source) {
    const key = this.key(sessionId, source);
    const record = this.sources.get(key);
    if (!record) return false;
    record.desired = false;
    record.connectVersion += 1;
    if (record.reconnectTimer) clearTimeout(record.reconnectTimer);
    this.sendAudioStreamEnd(sessionId, source, 'stop');
    this.finalizeTurn(record, 'stop');
    record.ready = false;
    try {
      record.session?.close?.();
    } catch (error) {
      logger.error('GEMINI LIVE', `[${source}] close failed`, error);
    }
    record.session = null;
    this.sources.delete(key);
    this.emitStatus(record, 'closed');
    return true;
  }

  async stopSession(sessionId) {
    const records = [...this.sources.values()].filter(record => record.sessionId === sessionId);
    await Promise.all(records.map(record => this.stopSource(record.sessionId, record.source)));
    return true;
  }

  // Legacy Susurro bridge kept for old windows and shortcuts.
  async start(event, personaPrompt) {
    return this.startSource(event, {
      sessionId: 'legacy',
      source: 'interviewer',
      personaPrompt,
      legacy: true
    });
  }

  sendLegacyChunk(base64, sequence) {
    return this.sendChunk({
      sessionId: 'legacy',
      source: 'interviewer',
      base64,
      sequence
    });
  }

  sendLegacyAudioStreamEnd(reason) {
    return this.sendAudioStreamEnd('legacy', 'interviewer', reason);
  }

  stop() {
    return this.stopSession('legacy');
  }
}

module.exports = new GeminiLiveService();
