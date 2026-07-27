const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { app } = require('electron');
const interviewService = require('./interviewService');
const logger = require('./logger');

const SAMPLE_RATE = 16000;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;

function safePart(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_');
}

function wavHeader(dataBytes) {
  const header = Buffer.alloc(44);
  const byteRate = SAMPLE_RATE * CHANNELS * (BITS_PER_SAMPLE / 8);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(CHANNELS, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(CHANNELS * (BITS_PER_SAMPLE / 8), 32);
  header.writeUInt16LE(BITS_PER_SAMPLE, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataBytes, 40);
  return header;
}

class InterviewRecordingService {
  constructor() {
    this.active = new Map();
  }

  key(sessionId, source) {
    return `${sessionId}:${source}`;
  }

  async start(sessionId, source) {
    await this.stop(sessionId, source);
    const directory = path.join(app.getPath('userData'), 'interview-audio');
    fs.mkdirSync(directory, { recursive: true });
    const basename = `${safePart(sessionId)}-${safePart(source)}-${Date.now()}`;
    const rawPath = path.join(directory, `${basename}.pcm`);
    const wavPath = path.join(directory, `${basename}.wav`);
    const stream = fs.createWriteStream(rawPath, { flags: 'w' });
    stream.on('error', error => logger.error('INTERVIEW_AUDIO', 'recording stream failed', error));
    this.active.set(this.key(sessionId, source), {
      sessionId,
      source,
      rawPath,
      wavPath,
      stream,
      bytes: 0,
      startedAt: Date.now()
    });
    return true;
  }

  append(sessionId, source, base64) {
    const recording = this.active.get(this.key(sessionId, source));
    if (!recording || !base64) return false;
    const chunk = Buffer.from(base64, 'base64');
    recording.bytes += chunk.length;
    recording.stream.write(chunk);
    return true;
  }

  async stop(sessionId, source) {
    const key = this.key(sessionId, source);
    const recording = this.active.get(key);
    if (!recording) return null;
    this.active.delete(key);

    await new Promise(resolve => recording.stream.end(resolve));
    if (recording.bytes === 0) {
      fs.rmSync(recording.rawPath, { force: true });
      return null;
    }

    fs.writeFileSync(recording.wavPath, wavHeader(recording.bytes));
    await pipeline(
      fs.createReadStream(recording.rawPath),
      fs.createWriteStream(recording.wavPath, { flags: 'r+', start: 44 })
    );
    fs.rmSync(recording.rawPath, { force: true });

    const artifact = {
      source,
      path: recording.wavPath,
      durationMs: Math.round((recording.bytes / (SAMPLE_RATE * 2)) * 1000),
      bytes: recording.bytes
    };
    interviewService.addAudioArtifact(sessionId, artifact);
    return artifact;
  }

  async stopSession(sessionId) {
    const keys = [...this.active.keys()].filter(key => key.startsWith(`${sessionId}:`));
    return Promise.all(keys.map(key => {
      const source = key.slice(key.lastIndexOf(':') + 1);
      return this.stop(sessionId, source);
    }));
  }
}

module.exports = new InterviewRecordingService();
