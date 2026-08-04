const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { app } = require('electron');
const logger = require('./logger');

const SAMPLE_RATE = 16000;
const BYTES_PER_SAMPLE = 2;
const WINDOW_MS = 2000;
const OVERLAP_MS = 320;
const WINDOW_BYTES = SAMPLE_RATE * BYTES_PER_SAMPLE * WINDOW_MS / 1000;
const OVERLAP_BYTES = SAMPLE_RATE * BYTES_PER_SAMPLE * OVERLAP_MS / 1000;
const START_TIMEOUT_MS = 30000;
const MODEL_FILE = 'ggml-large-v3-turbo-q5_0.bin';
const VAD_MODEL_FILE = 'ggml-silero-v6.2.0.bin';
const ACTIVITY_FRAME_SAMPLES = 320;
const MIN_SPEECH_RMS = 0.008;
const MIN_SPEECH_PEAK = 0.018;

function languageCode(language) {
  if (language === 'pt-BR') return 'pt';
  if (language === 'en-US') return 'en';
  return 'auto';
}

const PORTUGUESE_VOCABULARY_PATTERN = /(?:[áàâãéêíóôõúç]|\b(?:a|ao|aos|as|com|da|das|de|do|dos|e|em|esta|para|por|que|uma|um)\b)/i;

function vocabularyForLanguage(vocabulary, language) {
  const normalized = (Array.isArray(vocabulary) ? vocabulary : [])
    .map(value => String(value || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (language !== 'en-US') return normalized.slice(0, 8);
  return normalized
    .filter(value => !PORTUGUESE_VOCABULARY_PATTERN.test(value))
    .slice(0, 8);
}

function createWav(pcm) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * BYTES_PER_SAMPLE, 28);
  header.writeUInt16LE(BYTES_PER_SAMPLE, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function normalizeTranscript(text) {
  return String(text || '')
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function mergeTranscript(previous, incoming) {
  const left = normalizeTranscript(previous);
  const right = normalizeTranscript(incoming);
  if (!left) return right;
  if (!right) return left;
  if (left.toLocaleLowerCase().endsWith(right.toLocaleLowerCase())) return left;

  const leftWords = left.split(' ');
  const rightWords = right.split(' ');
  const maxOverlap = Math.min(12, leftWords.length, rightWords.length);
  let overlap = 0;
  for (let size = maxOverlap; size >= 1; size -= 1) {
    const suffix = leftWords.slice(-size).join(' ').toLocaleLowerCase();
    const prefix = rightWords.slice(0, size).join(' ').toLocaleLowerCase();
    if (suffix === prefix) {
      overlap = size;
      break;
    }
  }
  return `${left} ${rightWords.slice(overlap).join(' ')}`.trim();
}

function hasSpeechActivity(pcm) {
  const sampleCount = Math.floor(pcm.length / BYTES_PER_SAMPLE);
  const frameCount = Math.floor(sampleCount / ACTIVITY_FRAME_SAMPLES);
  if (frameCount === 0) return false;

  let activeFrames = 0;
  for (let frame = 0; frame < frameCount; frame += 1) {
    let sumSquares = 0;
    let peak = 0;
    const start = frame * ACTIVITY_FRAME_SAMPLES;
    for (let index = 0; index < ACTIVITY_FRAME_SAMPLES; index += 1) {
      const sample = pcm.readInt16LE((start + index) * BYTES_PER_SAMPLE) / 32768;
      sumSquares += sample * sample;
      peak = Math.max(peak, Math.abs(sample));
    }
    const rms = Math.sqrt(sumSquares / ACTIVITY_FRAME_SAMPLES);
    if (rms >= MIN_SPEECH_RMS && peak >= MIN_SPEECH_PEAK) activeFrames += 1;
  }

  const requiredFrames = Math.min(6, Math.max(3, Math.ceil(frameCount * 0.08)));
  return activeFrames >= requiredFrames;
}

function getResourcePaths() {
  const root = app.isPackaged
    ? path.join(process.resourcesPath, 'whisper')
    : path.join(__dirname, '..', '..', 'resources', 'whisper');
  const platformArch = `${process.platform}-${process.arch}`;
  return {
    executable: path.join(
      root,
      'bin',
      platformArch,
      process.platform === 'win32' ? 'whisper-server.exe' : 'whisper-server'
    ),
    model: path.join(root, 'models', MODEL_FILE),
    vadModel: path.join(root, 'models', VAD_MODEL_FILE)
  };
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

class WhisperLocalService {
  constructor(options = {}) {
    this.sources = new Map();
    this.process = null;
    this.port = 0;
    this.startPromise = null;
    this.fetch = options.fetch || globalThis.fetch;
    this.resourcePaths = options.resourcePaths || getResourcePaths;
    this.spawn = options.spawn || spawn;
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
      provider: 'whisper-local',
      ...extra
    });
  }

  async ensureServer() {
    if (this.process && this.port) return true;
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.startServer();
    try {
      return await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  stopServer() {
    const child = this.process;
    this.process = null;
    this.port = 0;
    if (!child) return false;
    logger.info('WHISPER LOCAL', 'Unloading model from memory');
    try {
      child.kill();
    } catch (error) {
      logger.warn('WHISPER LOCAL', `Could not stop server: ${error.message}`);
    }
    return true;
  }

  releaseServerIfIdle() {
    if (this.sources.size === 0) this.stopServer();
  }

  async startServer() {
    const resources = this.resourcePaths();
    if (
      !fs.existsSync(resources.executable)
      || !fs.existsSync(resources.model)
      || !fs.existsSync(resources.vadModel)
    ) {
      throw new Error('Whisper local nao preparado. Execute npm run whisper:prepare.');
    }

    this.port = await freePort();
    const args = [
      '--host', '127.0.0.1',
      '--port', String(this.port),
      '--model', resources.model,
      '--vad',
      '--vad-model', resources.vadModel,
      '--vad-threshold', '0.5',
      '--vad-min-speech-duration-ms', '120',
      '--vad-min-silence-duration-ms', '120',
      '--vad-speech-pad-ms', '120',
      '--vad-samples-overlap', '0.1',
      '--language', 'auto',
      '--no-timestamps',
      '--threads', String(Math.max(2, Math.min(8, require('node:os').cpus().length - 1)))
    ];
    logger.info('WHISPER LOCAL', `Starting server on 127.0.0.1:${this.port}`);
    const child = this.spawn(resources.executable, args, {
      cwd: path.dirname(resources.executable),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    this.process = child;
    child.stdout?.on('data', data => logger.debug?.('WHISPER LOCAL', String(data).trim()));
    child.stderr?.on('data', data => {
      const line = String(data).trim();
      if (line) logger.info('WHISPER LOCAL', line);
    });
    child.once('exit', (code, signal) => {
      logger.info('WHISPER LOCAL', `Server stopped (${code ?? signal ?? 'unknown'})`);
      if (this.process === child) {
        this.process = null;
        this.port = 0;
      }
    });
    child.once('error', error => logger.error('WHISPER LOCAL', 'Server process failed', error));

    const deadline = Date.now() + START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`Whisper local encerrou com codigo ${child.exitCode}.`);
      try {
        const response = await this.fetch(`http://127.0.0.1:${this.port}/`);
        if (response.ok) {
          logger.info('WHISPER LOCAL', 'Model ready');
          return true;
        }
      } catch {
        // The model is still loading.
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    child.kill();
    throw new Error('Whisper local demorou demais para carregar o modelo.');
  }

  createRecord(event, options) {
    return {
      event,
      sessionId: options.sessionId,
      source: options.source,
      language: options.language || 'auto',
      customVocabulary: Array.isArray(options.customVocabulary) ? options.customVocabulary : [],
      onUnavailable: options.onUnavailable,
      unavailableNotified: false,
      desired: true,
      buffers: [],
      bufferedBytes: 0,
      overlap: Buffer.alloc(0),
      currentTurnId: null,
      currentText: '',
      deltaSequence: 0,
      statusSequence: 0,
      lastRendererSeq: 0,
      inferenceChain: Promise.resolve()
    };
  }

  async startSource(event, options = {}) {
    const sessionId = String(options.sessionId || '').trim();
    const source = options.source === 'candidate' ? 'candidate' : 'interviewer';
    if (!sessionId) throw new Error('sessionId obrigatorio para transcricao.');
    await this.stopSource(sessionId, source);

    const record = this.createRecord(event, { ...options, sessionId, source });
    this.sources.set(this.key(sessionId, source), record);
    this.emitStatus(record, 'connecting');
    try {
      await this.ensureServer();
      if (!record.desired) return false;
      this.emitStatus(record, 'ready');
      return true;
    } catch (error) {
      this.sources.delete(this.key(sessionId, source));
      this.releaseServerIfIdle();
      this.emitStatus(record, 'error', { error: error.message });
      throw error;
    }
  }

  sendChunk(payload = {}) {
    const record = this.sources.get(this.key(payload.sessionId, payload.source));
    if (!record || !record.desired || !payload.base64) return false;
    if (Number(payload.sequence) <= record.lastRendererSeq) return false;
    record.lastRendererSeq = Number(payload.sequence);

    const chunk = Buffer.from(payload.base64, 'base64');
    record.buffers.push(chunk);
    record.bufferedBytes += chunk.length;
    while (record.bufferedBytes >= WINDOW_BYTES) this.queueWindow(record, WINDOW_BYTES);
    return true;
  }

  takeBytes(record, byteCount) {
    const result = Buffer.allocUnsafe(byteCount);
    let offset = 0;
    while (offset < byteCount && record.buffers.length) {
      const chunk = record.buffers[0];
      const length = Math.min(chunk.length, byteCount - offset);
      chunk.copy(result, offset, 0, length);
      offset += length;
      record.bufferedBytes -= length;
      if (length === chunk.length) record.buffers.shift();
      else record.buffers[0] = chunk.subarray(length);
    }
    return result.subarray(0, offset);
  }

  queueWindow(record, byteCount) {
    const pcm = this.takeBytes(record, Math.min(byteCount, record.bufferedBytes));
    if (!pcm.length) return record.inferenceChain;
    if (!hasSpeechActivity(pcm)) {
      record.overlap = Buffer.alloc(0);
      logger.info('WHISPER LOCAL', `[${record.source}] discarded non-speech audio window`);
      return record.inferenceChain;
    }
    const withOverlap = record.overlap.length ? Buffer.concat([record.overlap, pcm]) : pcm;
    record.overlap = pcm.subarray(Math.max(0, pcm.length - OVERLAP_BYTES));
    record.inferenceChain = record.inferenceChain
      .then(() => this.transcribe(record, withOverlap))
      .catch(error => {
        logger.error('WHISPER LOCAL', `[${record.source}] inference failed`, error);
        this.emitStatus(record, 'error', { error: error.message });
        if (!record.unavailableNotified && typeof record.onUnavailable === 'function') {
          record.unavailableNotified = true;
          queueMicrotask(() => record.onUnavailable(error));
        }
      });
    return record.inferenceChain;
  }

  async transcribe(record, pcm) {
    if (!record.desired || pcm.length < SAMPLE_RATE * BYTES_PER_SAMPLE / 4) return;
    const form = new FormData();
    form.append('file', new Blob([createWav(pcm)], { type: 'audio/wav' }), 'audio.wav');
    form.append('response_format', 'json');
    form.append('language', languageCode(record.language));
    form.append('translate', 'false');
    form.append('detect_language', 'false');
    form.append('temperature', '0.0');
    form.append('no_speech_thold', '0.6');
    // whisper-server reuses request parameters, so an empty prompt must overwrite stale context.
    form.append('prompt', vocabularyForLanguage(record.customVocabulary, record.language).join(', '));

    const response = await this.fetch(`http://127.0.0.1:${this.port}/inference`, {
      method: 'POST',
      body: form
    });
    if (!response.ok) throw new Error(`Whisper local respondeu HTTP ${response.status}.`);
    const payload = await response.json();
    const text = normalizeTranscript(payload.text);
    if (!text || !record.desired) return;

    record.currentText = mergeTranscript(record.currentText, text);
    if (!record.currentTurnId) record.currentTurnId = `turn_${crypto.randomUUID()}`;
    record.deltaSequence += 1;
    this.sendToRenderer(record, 'interview-transcript-delta', {
      sessionId: record.sessionId,
      source: record.source,
      turnId: record.currentTurnId,
      sequence: record.deltaSequence,
      text: record.currentText,
      isFinal: false,
      replacePending: true,
      timestamp: new Date().toISOString()
    });
    logger.info('WHISPER LOCAL', `[${record.source}] "${text}"`);
  }

  async flushRecord(record, finalize) {
    if (record.bufferedBytes > 0) this.queueWindow(record, record.bufferedBytes);
    await record.inferenceChain;
    if (finalize) this.finalizeTurn(record);
    return true;
  }

  finalizeTurn(record) {
    if (!record.currentTurnId) return;
    record.deltaSequence += 1;
    this.sendToRenderer(record, 'interview-transcript-delta', {
      sessionId: record.sessionId,
      source: record.source,
      turnId: record.currentTurnId,
      sequence: record.deltaSequence,
      text: record.currentText,
      isFinal: true,
      replacePending: true,
      timestamp: new Date().toISOString()
    });
    record.currentTurnId = null;
    record.currentText = '';
    record.overlap = Buffer.alloc(0);
  }

  sendAudioStreamEnd(sessionId, source) {
    const record = this.sources.get(this.key(sessionId, source));
    if (record) void this.flushRecord(record, true);
  }

  async flushForAnswer(sessionId, source) {
    const record = this.sources.get(this.key(sessionId, source));
    return record ? this.flushRecord(record, false) : false;
  }

  async stopSource(sessionId, source) {
    const key = this.key(sessionId, source);
    const record = this.sources.get(key);
    if (!record) return false;
    await this.flushRecord(record, true);
    record.desired = false;
    this.sources.delete(key);
    this.emitStatus(record, 'closed');
    this.releaseServerIfIdle();
    return true;
  }

  async stopSession(sessionId) {
    const records = [...this.sources.values()].filter(record => record.sessionId === sessionId);
    await Promise.all(records.map(record => this.stopSource(record.sessionId, record.source)));
    return true;
  }

  shutdown() {
    for (const record of this.sources.values()) record.desired = false;
    this.sources.clear();
    this.stopServer();
  }
}

module.exports = new WhisperLocalService();
module.exports.WhisperLocalService = WhisperLocalService;
module.exports.createWav = createWav;
module.exports.languageCode = languageCode;
module.exports.vocabularyForLanguage = vocabularyForLanguage;
module.exports.mergeTranscript = mergeTranscript;
module.exports.MODEL_FILE = MODEL_FILE;
module.exports.VAD_MODEL_FILE = VAD_MODEL_FILE;
module.exports.hasSpeechActivity = hasSpeechActivity;
