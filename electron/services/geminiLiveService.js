const { GoogleGenAI } = require('@google/genai');
const logger = require('./logger');

/**
 * GeminiLiveService manages the real-time session to Gemini's Multimodal Live API
 * using the official @google/genai SDK.
 */
class GeminiLiveService {
  /** @type {any} */
  session = null;
  /** @type {any} */
  client = null;
  
  isReady = false;
  chunkCount = 0;
  _notifiedWaiting = false;

  // Latency tracking
  lastChunkTime = 0;
  lastAudioLogAt = 0;
  lastTranscriptionAt = 0;
  audioStreamOpen = false;
  turnStartTime = 0;

  /**
   * Starts the Gemini Live session.
   * @param {Object} event - The Electron IPC event.
   * @param {string} personaPrompt - The persona instruction for the model.
   * @returns {Promise<boolean>}
   */
  async start(event, personaPrompt) {
    if (this.session) {
      this.stop();
    }

    const jsonStore = require('../store/jsonStore');
    const apiKey = jsonStore.getSettings().general.apiKey || process.env.VITE_GEMINI_API_KEY;
    if (!apiKey) {
      logger.error('GEMINI LIVE', 'API Key missing.');
      throw new Error("API Key missing");
    }

    this.isReady = false;
    this.chunkCount = 0;
    this._notifiedWaiting = false;
    this.turnStartTime = 0;
    this.lastAudioLogAt = 0;
    this.lastTranscriptionAt = 0;
    this.audioStreamOpen = false;

    return new Promise((resolve) => {
      (async () => {
        try {
          this.client = new GoogleGenAI({ apiKey });
          
          const model = "gemini-3.1-flash-live-preview";

          logger.info('GEMINI LIVE', `Connecting to session for model: ${model}`);
          
          event.sender.send('susurro-live-status', 'connecting');

          this.session = await this.client.live.connect({
            model: model,
            config: {
              responseModalities: ["AUDIO"],
              systemInstruction: {
                parts: [{ 
                  text: personaPrompt || "VOCÊ É UM TRANSRITOR DE ÁUDIO DE ALTA PRECISÃO. REGRA ABSOLUTA: Transcreva EXATAMENTE o que é dito no áudio. NÃO responda, NÃO comente, NÃO gere 'Model Text'. Sua ÚNICA função é fornecer a transcrição via canal de input_audio_transcription. MANTENHA SILÊNCIO TOTAL NO CANAL DE RESPOSTA (AUDIO E TEXTO)."
                }]
              },
              inputAudioTranscription: {},
              thinkingConfig: { thinkingLevel: "MINIMAL" },
              realtimeInputConfig: {
                automaticActivityDetection: {
                  startOfSpeechSensitivity: "START_SENSITIVITY_HIGH",
                  endOfSpeechSensitivity: "END_SENSITIVITY_HIGH",
                  prefixPaddingMs: 100,
                  silenceDurationMs: 500
                }
              }
            },
            callbacks: {
              onopen: () => {
                logger.info('GEMINI LIVE', 'Session handshake complete. Ready for audio.');
                this.isReady = true;
                event.sender.send('susurro-live-status', 'ready');
              },
              onmessage: (msg) => {
                this.handleServerMessage(msg, event);
              },
              onerror: (err) => {
                logger.error('GEMINI LIVE', 'Session error encountered:', err);
                event.sender.send('susurro-live-status', 'error');
                resolve(false);
              },
              onclose: (e) => {
                logger.info('GEMINI LIVE', `Session closed by server. Code: ${e.code}, Reason: ${e.reason || 'None'}`);
                event.sender.send('susurro-live-status', 'closed');
                this.session = null;
                this.isReady = false;
                resolve(false);
              }
            }
          });

          resolve(true);

        } catch (err) {
          logger.error('GEMINI LIVE', 'Critical failure during session initialization:', err);
          event.sender.send('susurro-live-status', 'error');
          this.session = null;
          this.isReady = false;
          resolve(false);
        }
      })();
    });
  }
  
  /**
   * Handles incoming messages from the SDK session.
   * @private
   */
  handleServerMessage(msg, event) {
    try {
      if (!msg) return;

      if (msg.setupComplete) {
        logger.info('GEMINI LIVE', 'Setup Complete (Server Acknowledged Config)');
      }

      if (msg.serverContent) {
        this.processServerContent(msg.serverContent, event);
      }
    } catch (e) {
      logger.error('GEMINI LIVE', 'Error processing message', e);
    }
  }

  processServerContent(serverContent, event) {
    const now = Date.now();

    // 1. Check for input audio transcription (user talking)
    const inputTranscription = serverContent.inputTranscription;
    if (inputTranscription) {
      this.processInputTranscription(inputTranscription, event, now);
    }

    // 2. Output transcription (model talking) is intentionally ignored to prevent polluting the history.

    // 4. Check for explicit turn completion
    if (serverContent.turnComplete) {
      const turnDuration = this.turnStartTime ? now - this.turnStartTime : 'N/A';
      logger.info('GEMINI LIVE', `[TURN COMPLETE] End-to-end time: ${turnDuration}ms`);
      this.turnStartTime = 0;
      event.sender.send('susurro-live-delta', { 
        text: '', 
        isFinal: true 
      });
    }
  }

  processInputTranscription(inputTranscription, event, now) {
    if (!this.turnStartTime) this.turnStartTime = now;
    
    const latency = now - this.lastChunkTime;
    this.lastTranscriptionAt = now;
    logger.info('GEMINI LIVE', `[INPUT] "${inputTranscription.text}" (Latency: ${latency}ms, Finished: ${inputTranscription.finished})`);
    
    if (inputTranscription.text) {
      event.sender.send('susurro-live-delta', { 
        text: inputTranscription.text, 
        isFinal: inputTranscription.finished || false 
      });
    }

    if (inputTranscription.finished) {
      const turnDuration = now - this.turnStartTime;
      logger.info('GEMINI LIVE', `[INPUT COMPLETE] Total turn time: ${turnDuration}ms`);
      this.turnStartTime = 0;
    }
  }

  /**
   * Sends a base64 encoded audio chunk to the model.
   * @param {string} base64Audio 
   * @param {number} rendererSeq
   */
  sendChunk(base64Audio, rendererSeq) {
    if (this.session && this.isReady) {
      this.chunkCount++;
      const now = Date.now();
      this.lastChunkTime = now;

      if (this.chunkCount === 1 || now - this.lastAudioLogAt >= 10000) {
        const suffix = rendererSeq ? ` (renderer seq ${rendererSeq})` : '';
        logger.info('GEMINI LIVE', `Sending audio chunk #${this.chunkCount}${suffix}`);
        this.lastAudioLogAt = now;
      }

      try {
        this.session.sendRealtimeInput({
          audio: {
            data: base64Audio,
            mimeType: "audio/pcm;rate=16000"
          }
        });
        this.audioStreamOpen = true;
      } catch (err) {
        logger.error('GEMINI LIVE', 'Failed to send audio chunk:', err);
      }
    } else if (!this.isReady && !this._notifiedWaiting) {
      logger.warn('GEMINI LIVE', 'Audio chunk received but session not ready. Waiting for handshake...');
      this._notifiedWaiting = true;
    }
  }

  /**
   * Signals that the current realtime audio stream paused while keeping the Live session open.
   * @param {string} reason
   */
  sendAudioStreamEnd(reason = 'pause') {
    if (!this.session || !this.isReady || !this.audioStreamOpen) return;

    try {
      this.session.sendRealtimeInput({ audioStreamEnd: true });
      this.audioStreamOpen = false;
      logger.info('GEMINI LIVE', `Audio stream end sent (${reason}).`);
    } catch (e) {
      logger.error('GEMINI LIVE', 'Error sending audio stream end', e);
    }
  }

  /**
   * Closes the active session.
   */
  stop() {
    this.sendAudioStreamEnd('stop');

    this.isReady = false;
    this._notifiedWaiting = false;
    this.audioStreamOpen = false;
    this.turnStartTime = 0;
    if (this.session) {
      try {
        if (typeof this.session.close === 'function') {
          this.session.close();
        }
      } catch (e) {
        logger.error('GEMINI LIVE', 'Error closing session', e);
      }
      this.session = null;
    }
  }
}

module.exports = new GeminiLiveService();
