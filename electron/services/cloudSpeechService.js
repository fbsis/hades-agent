const crypto = require('node:crypto');
const speech = require('@google-cloud/speech');
const logger = require('./logger');

const MAX_PENDING_CHUNKS = 250;
const MAX_STREAM_MS = 280000;
const RECONNECT_DELAYS = [500, 1000, 2000, 5000, 8000];
const FATAL_STATUS_CODES = new Set([3, 7, 16]);

function languageConfig(language) {
  if (language === 'en-US') {
    return { languageCode: 'en-US', alternativeLanguageCodes: ['pt-BR'] };
  }
  if (language === 'pt-BR') {
    return { languageCode: 'pt-BR', alternativeLanguageCodes: ['en-US'] };
  }
  return { languageCode: 'pt-BR', alternativeLanguageCodes: ['en-US'] };
}

function isFatalError(error) {
  if (FATAL_STATUS_CODES.has(Number(error?.code))) return true;
  return /(credential|invalid_grant|unauthenticated|permission|billing|not enabled|api has not been used)/i
    .test(String(error?.message || ''));
}

class CloudSpeechService {
  constructor(options = {}) {
    this.sources = new Map();
    this.clientFactory = options.clientFactory || (() => new speech.SpeechClient());
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
    this.sendToRenderer(record, 'interview-transcription-status', {
      sessionId: record.sessionId,
      source: record.source,
      turnId: record.currentTurnId || undefined,
      sequence: record.statusSequence,
      status,
      provider: 'google-cloud',
      ...extra
    });
  }

  createRecord(event, options) {
    return {
      event,
      sessionId: options.sessionId,
      source: options.source,
      language: options.language || 'auto',
      onUnavailable: options.onUnavailable,
      client: null,
      stream: null,
      streamVersion: 0,
      streamStartedAt: 0,
      desired: true,
      ready: false,
      reconnectAttempt: 0,
      reconnectTimer: null,
      pendingChunks: [],
      lastRendererSeq: 0,
      chunkCount: 0,
      lastAudioLogAt: 0,
      currentTurnId: null,
      deltaSequence: 0,
      statusSequence: 0,
      pendingText: '',
      unavailableNotified: false
    };
  }

  async startSource(event, options = {}) {
    const sessionId = String(options.sessionId || '').trim();
    const source = options.source === 'candidate' ? 'candidate' : 'interviewer';
    if (!sessionId) throw new Error('sessionId obrigatorio para transcricao.');

    await this.stopSource(sessionId, source);
    const record = this.createRecord(event, { ...options, sessionId, source });
    record.client = this.clientFactory();
    this.sources.set(this.key(sessionId, source), record);

    try {
      await record.client.initialize();
      this.openStream(record, false);
      return true;
    } catch (error) {
      this.sources.delete(this.key(sessionId, source));
      record.desired = false;
      try {
        await record.client.close?.();
      } catch {
        // Ignore cleanup errors after an initialization failure.
      }
      throw error;
    }
  }

  recognitionRequest(record) {
    return {
      config: {
        encoding: 'LINEAR16',
        sampleRateHertz: 16000,
        ...languageConfig(record.language),
        enableAutomaticPunctuation: true,
        model: 'latest_long'
      },
      interimResults: true,
      singleUtterance: false
    };
  }

  openStream(record, reconnecting) {
    if (!record.desired) return false;
    const version = ++record.streamVersion;
    this.emitStatus(record, reconnecting ? 'reconnecting' : 'connecting', {
      attempt: record.reconnectAttempt
    });

    let stream;
    try {
      stream = record.client.streamingRecognize(this.recognitionRequest(record));
    } catch (error) {
      this.handleStreamError(record, error, version);
      return false;
    }

    record.stream = stream;
    record.streamStartedAt = Date.now();
    record.ready = true;

    stream.on('data', data => {
      if (record.desired && version === record.streamVersion) {
        this.handleRecognitionData(record, data);
      }
    });
    stream.on('error', error => this.handleStreamError(record, error, version));
    stream.on('end', () => this.handleStreamEnd(record, version));

    logger.info('CLOUD STT', `[${record.source}] stream ready with interim results`);
    this.emitStatus(record, 'ready');
    this.flushPendingChunks(record);
    return true;
  }

  handleRecognitionData(record, data) {
    const results = Array.isArray(data?.results) ? data.results : [];
    for (const result of results) {
      const text = String(result?.alternatives?.[0]?.transcript || '').trim();
      if (!text) continue;

      if (result.isFinal) {
        logger.info('CLOUD STT', `[${record.source}] final "${text}"`);
        this.emitTranscript(record, text, true);
      } else if (text !== record.pendingText) {
        logger.info(
          'CLOUD STT',
          `[${record.source}] interim "${text}" (stability ${Number(result.stability || 0).toFixed(2)})`
        );
        this.emitTranscript(record, text, false);
      }
    }
  }

  ensureTurn(record) {
    if (!record.currentTurnId) {
      record.currentTurnId = `turn_${crypto.randomUUID()}`;
    }
    return record.currentTurnId;
  }

  emitTranscript(record, text, isFinal) {
    const turnId = this.ensureTurn(record);
    record.deltaSequence += 1;
    record.pendingText = isFinal ? '' : text;
    this.sendToRenderer(record, 'interview-transcript-delta', {
      sessionId: record.sessionId,
      source: record.source,
      turnId,
      sequence: record.deltaSequence,
      text,
      isFinal: !!isFinal,
      replacePending: true,
      timestamp: new Date().toISOString()
    });
    if (isFinal) record.currentTurnId = null;
  }

  finalizePendingTurn(record, reason) {
    if (!record.currentTurnId) return;
    logger.info('CLOUD STT', `[${record.source}] turn finalized (${reason})`);
    record.deltaSequence += 1;
    this.sendToRenderer(record, 'interview-transcript-delta', {
      sessionId: record.sessionId,
      source: record.source,
      turnId: record.currentTurnId,
      sequence: record.deltaSequence,
      text: record.pendingText,
      isFinal: true,
      replacePending: true,
      timestamp: new Date().toISOString()
    });
    record.currentTurnId = null;
    record.pendingText = '';
  }

  handleStreamError(record, error, version) {
    if (!record.desired || version !== record.streamVersion) return;
    record.ready = false;
    record.stream = null;
    this.finalizePendingTurn(record, 'stream_error');
    logger.error('CLOUD STT', `[${record.source}] stream error`, error);

    if (isFatalError(error)) {
      this.emitStatus(record, 'error', { error: error?.message || String(error) });
      if (!record.unavailableNotified && typeof record.onUnavailable === 'function') {
        record.unavailableNotified = true;
        queueMicrotask(() => record.onUnavailable(error));
      }
      return;
    }

    this.scheduleReconnect(record, error);
  }

  handleStreamEnd(record, version) {
    if (!record.desired || version !== record.streamVersion || !record.stream) return;
    record.ready = false;
    record.stream = null;
    this.finalizePendingTurn(record, 'stream_ended');
    this.scheduleReconnect(record);
  }

  scheduleReconnect(record, error) {
    if (!record.desired || record.reconnectTimer) return;
    if (record.reconnectAttempt >= RECONNECT_DELAYS.length) {
      this.emitStatus(record, 'error', {
        error: error?.message || 'Nao foi possivel reconectar ao Google Cloud Speech-to-Text.'
      });
      return;
    }

    const delay = RECONNECT_DELAYS[record.reconnectAttempt];
    record.reconnectAttempt += 1;
    this.emitStatus(record, 'reconnecting', { attempt: record.reconnectAttempt });
    record.reconnectTimer = setTimeout(() => {
      record.reconnectTimer = null;
      this.openStream(record, true);
    }, delay);
  }

  rotateStream(record) {
    if (!record.stream) return;
    const oldStream = record.stream;
    record.stream = null;
    record.ready = false;
    record.streamVersion += 1;
    this.finalizePendingTurn(record, 'stream_rotation');
    try {
      oldStream.end();
    } catch (error) {
      logger.warn('CLOUD STT', `[${record.source}] stream rotation close failed: ${error.message}`);
    }
    record.reconnectAttempt = 0;
    this.openStream(record, true);
  }

  sendChunk(payload = {}) {
    const record = this.sources.get(this.key(payload.sessionId, payload.source));
    if (!record || !record.desired || !payload.base64) return false;
    if (Number(payload.sequence) <= record.lastRendererSeq) return false;
    record.lastRendererSeq = Number(payload.sequence);

    if (
      record.streamStartedAt
      && Date.now() - record.streamStartedAt >= MAX_STREAM_MS
    ) {
      this.rotateStream(record);
    }

    if (!record.ready || !record.stream) {
      record.pendingChunks.push(payload);
      if (record.pendingChunks.length > MAX_PENDING_CHUNKS) record.pendingChunks.shift();
      return false;
    }
    return this.writeChunk(record, payload);
  }

  writeChunk(record, payload) {
    try {
      const accepted = record.stream.write(Buffer.from(payload.base64, 'base64'));
      record.chunkCount += 1;
      const now = Date.now();
      if (record.chunkCount === 1 || now - record.lastAudioLogAt >= 10000) {
        logger.info('CLOUD STT', `[${record.source}] sending chunk #${record.chunkCount} (seq ${payload.sequence})`);
        record.lastAudioLogAt = now;
      }
      return accepted;
    } catch (error) {
      record.pendingChunks.push(payload);
      this.handleStreamError(record, error, record.streamVersion);
      return false;
    }
  }

  flushPendingChunks(record) {
    if (!record.ready || !record.stream || record.pendingChunks.length === 0) return;
    const pending = record.pendingChunks.splice(0);
    for (const chunk of pending) {
      if (!record.ready || !record.stream) {
        record.pendingChunks.unshift(chunk);
        break;
      }
      this.writeChunk(record, chunk);
    }
  }

  sendAudioStreamEnd(sessionId, source) {
    const record = this.sources.get(this.key(sessionId, source));
    if (!record) return;
    logger.info('CLOUD STT', `[${source}] renderer pause detected; stream remains open`);
  }

  async stopSource(sessionId, source) {
    const key = this.key(sessionId, source);
    const record = this.sources.get(key);
    if (!record) return false;

    record.desired = false;
    record.streamVersion += 1;
    if (record.reconnectTimer) clearTimeout(record.reconnectTimer);
    this.finalizePendingTurn(record, 'stop');
    record.ready = false;
    try {
      record.stream?.end();
    } catch (error) {
      logger.warn('CLOUD STT', `[${source}] stream close failed: ${error.message}`);
    }
    try {
      await record.client?.close?.();
    } catch (error) {
      logger.warn('CLOUD STT', `[${source}] client close failed: ${error.message}`);
    }
    record.stream = null;
    this.sources.delete(key);
    this.emitStatus(record, 'closed');
    return true;
  }

  async stopSession(sessionId) {
    const records = [...this.sources.values()].filter(record => record.sessionId === sessionId);
    await Promise.all(records.map(record => this.stopSource(record.sessionId, record.source)));
    return true;
  }
}

module.exports = new CloudSpeechService();
module.exports.CloudSpeechService = CloudSpeechService;
module.exports.languageConfig = languageConfig;
