const crypto = require('node:crypto');
const { GoogleGenAI } = require('@google/genai');
const store = require('../store/jsonStore');
const {
  buildAudioTranscriptionConfig,
  buildTranscriptionInstruction
} = require('./geminiLiveTranscription');
const logger = require('./logger');

const MODEL = 'gemini-3.1-flash-live-preview';
const FINAL_TRANSCRIPT_GRACE_MS = 900;
const QUICK_FLUSH_TIMEOUT_MS = 1400;
const QUICK_FLUSH_SETTLE_MS = 160;
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
      customVocabulary: (Array.isArray(options.customVocabulary) ? options.customVocabulary : [])
        .map(value => String(value || '').trim())
        .filter(Boolean)
        .slice(0, 8),
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
      streamHasAudio: false,
      currentTurnId: null,
      deltaSequence: 0,
      statusSequence: 0,
      turnStartTime: 0,
      finalizeTimer: null,
      finalizeRequested: false,
      interimText: '',
      finalInputText: '',
      flushWaiters: []
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
    return buildTranscriptionInstruction(record);
  }

  transcriptionConfig(record) {
    return buildAudioTranscriptionConfig(record);
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
          inputAudioTranscription: this.transcriptionConfig(record),
          thinkingConfig: { thinkingLevel: 'MINIMAL' },
          sessionResumption: {
            ...(record.resumeHandle ? { handle: record.resumeHandle } : {})
          },
          contextWindowCompression: {
            triggerTokens: '24000',
            slidingWindow: { targetTokens: '12000' }
          },
          realtimeInputConfig: {
            automaticActivityDetection: {
              disabled: false,
              startOfSpeechSensitivity: 'START_SENSITIVITY_HIGH',
              endOfSpeechSensitivity: 'END_SENSITIVITY_HIGH',
              prefixPaddingMs: 20,
              silenceDurationMs: 500
            },
            activityHandling: 'NO_INTERRUPTION',
            turnCoverage: 'TURN_INCLUDES_ONLY_ACTIVITY'
          }
        },
        callbacks: {
          onopen: () => {
            if (!record.desired || version !== record.connectVersion) return;
            record.ready = true;
            record.streamHasAudio = false;
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
            record.streamHasAudio = false;
            this.resolveFlushWaiters(record, false);
            this.emitStatus(record, 'error', { error: error?.message || String(error) });
            this.scheduleReconnect(record);
          },
          onclose: closeEvent => {
            if (version !== record.connectVersion) return;
            record.ready = false;
            record.session = null;
            record.streamHasAudio = false;
            this.resolveFlushWaiters(record, false);
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
      record.streamHasAudio = false;
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
    if (serverContent.interimInputTranscription) {
      this.processInterimInputTranscription(record, serverContent.interimInputTranscription);
    }
    if (serverContent.inputTranscription) {
      this.processInputTranscription(record, serverContent.inputTranscription);
    }
    if (serverContent.turnComplete && record.currentTurnId) {
      this.finalizeTurn(record, 'server_turn_complete');
    }
  }

  ensureTurn(record) {
    if (!record.currentTurnId) {
      record.currentTurnId = `turn_${crypto.randomUUID()}`;
      record.turnStartTime = Date.now();
    }
    return record.currentTurnId;
  }

  emitDelta(record, text, isFinal, replacePending = false) {
    const turnId = this.ensureTurn(record);
    record.deltaSequence += 1;
    const payload = {
      sessionId: record.sessionId,
      source: record.source,
      turnId,
      sequence: record.deltaSequence,
      text: text || '',
      isFinal: !!isFinal,
      replacePending,
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
    if (text) {
      if (record.interimText) {
        record.finalInputText += text;
        this.emitDelta(record, record.finalInputText, false, true);
      } else {
        this.emitDelta(record, text, false);
      }
      this.scheduleFlushWaiterResolution(record);
    }
    if (transcription.finished) this.scheduleFlushWaiterResolution(record, 0);
    if (transcription.finished && record.finalizeRequested) {
      this.finalizeTurn(record, 'input_transcription_finished');
    }
  }

  processInterimInputTranscription(record, transcription) {
    const text = String(transcription.text || '').replace(/\s+/g, ' ').trim();
    if (!text || text === record.interimText) return;
    record.interimText = text;
    record.finalInputText = '';
    const latency = record.lastChunkTime ? Date.now() - record.lastChunkTime : 0;
    logger.info('GEMINI LIVE', `[${record.source}] [INTERIM] "${text}" (${latency}ms)`);
    this.emitDelta(record, text, false, true);
    this.scheduleFlushWaiterResolution(record);
  }

  resolveFlushWaiter(record, waiter, result) {
    clearTimeout(waiter.timeout);
    clearTimeout(waiter.settleTimer);
    record.flushWaiters = record.flushWaiters.filter(item => item !== waiter);
    waiter.resolve(result);
  }

  resolveFlushWaiters(record, result) {
    [...record.flushWaiters].forEach(waiter => this.resolveFlushWaiter(record, waiter, result));
  }

  scheduleFlushWaiterResolution(record, delay = QUICK_FLUSH_SETTLE_MS) {
    record.flushWaiters.forEach(waiter => {
      clearTimeout(waiter.settleTimer);
      waiter.settleTimer = setTimeout(() => this.resolveFlushWaiter(record, waiter, true), delay);
    });
  }

  requestTurnFinalization(record, reason) {
    record.finalizeRequested = true;
    this.clearFinalizeTimer(record);
    record.finalizeTimer = setTimeout(() => {
      record.finalizeTimer = null;
      this.finalizeTurn(record, `${reason}_grace_timeout`);
    }, FINAL_TRANSCRIPT_GRACE_MS);
  }

  clearFinalizeTimer(record) {
    if (!record.finalizeTimer) return;
    clearTimeout(record.finalizeTimer);
    record.finalizeTimer = null;
  }

  finalizeTurn(record, reason) {
    this.clearFinalizeTimer(record);
    record.finalizeRequested = false;
    record.interimText = '';
    record.finalInputText = '';
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
      if (record.finalizeRequested) {
        this.finalizeTurn(record, 'new_audio_after_pause');
      }

      const now = Date.now();
      record.session.sendRealtimeInput({
        audio: {
          data: payload.base64,
          mimeType: 'audio/pcm;rate=16000'
        }
      });
      record.chunkCount += 1;
      record.streamHasAudio = true;
      record.lastChunkTime = now;
      if (record.chunkCount === 1 || record.lastChunkTime - record.lastAudioLogAt >= 10000) {
        logger.info('GEMINI LIVE', `[${record.source}] sending chunk #${record.chunkCount} (seq ${payload.sequence})`);
        record.lastAudioLogAt = record.lastChunkTime;
      }
      return true;
    } catch (error) {
      logger.error('GEMINI LIVE', `[${record.source}] failed to send audio`, error);
      record.ready = false;
      record.streamHasAudio = false;
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

  flushAudioWindow(record, reason = 'manual') {
    if (!record?.session || !record.ready || !record.streamHasAudio) return false;
    record.session.sendRealtimeInput({ audioStreamEnd: true });
    record.streamHasAudio = false;
    logger.info('GEMINI LIVE', `[${record.source}] audio stream flush (${reason})`);
    return true;
  }

  flushForAnswer(sessionId, source) {
    const record = this.sources.get(this.key(sessionId, source));
    if (!record?.ready || !record.session) return Promise.resolve(false);
    if (!record.streamHasAudio) return Promise.resolve(true);

    return new Promise(resolve => {
      const waiter = {
        resolve,
        settleTimer: null,
        timeout: null
      };
      waiter.timeout = setTimeout(
        () => this.resolveFlushWaiter(record, waiter, true),
        QUICK_FLUSH_TIMEOUT_MS
      );
      record.flushWaiters.push(waiter);

      try {
        if (!this.flushAudioWindow(record, 'quick_answer')) {
          this.resolveFlushWaiter(record, waiter, true);
        }
      } catch (error) {
        logger.warn('GEMINI LIVE', `[${source}] quick answer flush failed: ${error.message}`);
        this.resolveFlushWaiter(record, waiter, false);
      }
    });
  }

  sendAudioStreamEnd(sessionId, source, reason = 'pause') {
    const record = this.sources.get(this.key(sessionId, source));
    if (!record) return;
    try {
      this.flushAudioWindow(record, reason);
      this.requestTurnFinalization(record, reason);
    } catch (error) {
      logger.error('GEMINI LIVE', `[${source}] activity end failed`, error);
    }
  }

  async stopSource(sessionId, source) {
    const key = this.key(sessionId, source);
    const record = this.sources.get(key);
    if (!record) return false;
    record.desired = false;
    record.connectVersion += 1;
    if (record.reconnectTimer) clearTimeout(record.reconnectTimer);
    this.resolveFlushWaiters(record, false);
    try {
      this.flushAudioWindow(record);
    } catch (error) {
      logger.warn('GEMINI LIVE', `[${source}] final audio flush failed: ${error.message}`);
    }
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
