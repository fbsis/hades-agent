const cloudSpeechService = require('./cloudSpeechService');
const geminiLiveService = require('./geminiLiveService');
const { resolveInterviewTranscriptionProvider } = require('./interviewTranscriptionProvider');
const logger = require('./logger');

const FALLBACK_REPLAY_CHUNKS = 50;

class InterviewTranscriptionService {
  constructor(options = {}) {
    this.sources = new Map();
    this.cloudSpeechService = options.cloudSpeechService || cloudSpeechService;
    this.geminiLiveService = options.geminiLiveService || geminiLiveService;
  }

  key(sessionId, source) {
    return `${sessionId}:${source}`;
  }

  async startSource(event, options = {}) {
    const sessionId = String(options.sessionId || '').trim();
    const source = options.source === 'candidate' ? 'candidate' : 'interviewer';
    const key = this.key(sessionId, source);
    await this.stopSource(sessionId, source);

    const state = {
      event,
      options: { ...options, sessionId, source },
      provider: '',
      switching: false,
      recentChunks: []
    };
    this.sources.set(key, state);

    if (resolveInterviewTranscriptionProvider(state.options.provider) === 'gemini-live') {
      return this.startGeminiFallback(state);
    }

    try {
      const started = await this.cloudSpeechService.startSource(event, {
        ...state.options,
        onUnavailable: error => this.switchToGemini(state, error)
      });
      state.provider = 'google-cloud';
      return started;
    } catch (error) {
      logger.warn(
        'INTERVIEW STT',
        `Cloud Speech unavailable during startup; using Gemini Live: ${error.message}`
      );
      return this.startGeminiFallback(state);
    }
  }

  async startGeminiFallback(state) {
    const started = await this.geminiLiveService.startSource(state.event, state.options);
    state.provider = 'gemini-live';
    return started;
  }

  async switchToGemini(state, error) {
    const key = this.key(state.options.sessionId, state.options.source);
    if (this.sources.get(key) !== state || state.switching || state.provider === 'gemini-live') return;
    state.switching = true;
    logger.warn(
      'INTERVIEW STT',
      `Switching ${state.options.source} to Gemini Live: ${error?.message || error}`
    );

    try {
      await this.cloudSpeechService.stopSource(state.options.sessionId, state.options.source);
      await this.startGeminiFallback(state);
      const replay = state.recentChunks.splice(0);
      replay.forEach(chunk => this.geminiLiveService.sendChunk(chunk));
    } catch (fallbackError) {
      logger.error('INTERVIEW STT', 'Gemini Live fallback failed', fallbackError);
    } finally {
      state.switching = false;
    }
  }

  sendChunk(payload = {}) {
    const state = this.sources.get(this.key(payload.sessionId, payload.source));
    if (!state) return false;
    state.recentChunks.push(payload);
    if (state.recentChunks.length > FALLBACK_REPLAY_CHUNKS) state.recentChunks.shift();
    if (state.switching) return false;

    if (state.provider === 'gemini-live') {
      return this.geminiLiveService.sendChunk(payload);
    }
    return this.cloudSpeechService.sendChunk(payload);
  }

  sendAudioStreamEnd(sessionId, source, reason) {
    const state = this.sources.get(this.key(sessionId, source));
    if (!state || state.switching) return;
    if (state.provider === 'gemini-live') {
      this.geminiLiveService.sendAudioStreamEnd(sessionId, source, reason);
      return;
    }
    this.cloudSpeechService.sendAudioStreamEnd(sessionId, source, reason);
  }

  async flushForAnswer(sessionId, source) {
    const state = this.sources.get(this.key(sessionId, source));
    if (!state || state.switching) return false;
    if (state.provider === 'gemini-live') {
      return this.geminiLiveService.flushForAnswer(sessionId, source);
    }
    return true;
  }

  async stopSource(sessionId, source) {
    const key = this.key(sessionId, source);
    const state = this.sources.get(key);
    if (!state) return false;
    this.sources.delete(key);
    if (state.provider === 'gemini-live') {
      return this.geminiLiveService.stopSource(sessionId, source);
    }
    return this.cloudSpeechService.stopSource(sessionId, source);
  }

  async stopSession(sessionId) {
    const states = [...this.sources.entries()]
      .filter(([, state]) => state.options.sessionId === sessionId);
    await Promise.all(states.map(([, state]) => (
      this.stopSource(state.options.sessionId, state.options.source)
    )));
    return true;
  }
}

module.exports = new InterviewTranscriptionService();
module.exports.InterviewTranscriptionService = InterviewTranscriptionService;
