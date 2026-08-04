const whisperLocalService = require('./whisperLocalService');
const logger = require('./logger');

class InterviewTranscriptionService {
  constructor(options = {}) {
    this.sources = new Map();
    this.whisperLocalService = options.whisperLocalService || whisperLocalService;
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
      options: { ...options, sessionId, source, provider: 'whisper-local' }
    };
    this.sources.set(key, state);

    try {
      return await this.whisperLocalService.startSource(event, {
        ...state.options,
        onUnavailable: error => {
          logger.error(
            'INTERVIEW STT',
            `Local Whisper unavailable for ${source}; remote fallback is disabled: ${error.message}`
          );
        }
      });
    } catch (error) {
      this.sources.delete(key);
      logger.error('INTERVIEW STT', `Local Whisper failed to start for ${source}`, error);
      throw error;
    }
  }

  sendChunk(payload = {}) {
    if (!this.sources.has(this.key(payload.sessionId, payload.source))) return false;
    return this.whisperLocalService.sendChunk(payload);
  }

  sendAudioStreamEnd(sessionId, source, reason) {
    if (!this.sources.has(this.key(sessionId, source))) return;
    this.whisperLocalService.sendAudioStreamEnd(sessionId, source, reason);
  }

  async flushForAnswer(sessionId, source) {
    if (!this.sources.has(this.key(sessionId, source))) return false;
    return this.whisperLocalService.flushForAnswer(sessionId, source);
  }

  async stopSource(sessionId, source) {
    const key = this.key(sessionId, source);
    if (!this.sources.has(key)) return false;
    this.sources.delete(key);
    return this.whisperLocalService.stopSource(sessionId, source);
  }

  async stopSession(sessionId) {
    const states = [...this.sources.values()]
      .filter(state => state.options.sessionId === sessionId);
    await Promise.all(states.map(state => (
      this.stopSource(state.options.sessionId, state.options.source)
    )));
    return true;
  }

  shutdown() {
    this.whisperLocalService.shutdown();
  }
}

module.exports = new InterviewTranscriptionService();
module.exports.InterviewTranscriptionService = InterviewTranscriptionService;
