import { describe, expect, it } from 'vitest';
import whisperLocalModule from './whisperLocalService.js';

const {
  WhisperLocalService,
  MODEL_FILE,
  VAD_MODEL_FILE,
  createWav,
  hasSpeechActivity,
  languageCode,
  mergeTranscript,
  vocabularyForLanguage
} = whisperLocalModule;

describe('WhisperLocalService utilities', () => {
  it('creates a 16 kHz mono PCM WAV', () => {
    const wav = createWav(Buffer.alloc(640));
    expect(wav.subarray(0, 4).toString()).toBe('RIFF');
    expect(wav.subarray(8, 12).toString()).toBe('WAVE');
    expect(wav.readUInt32LE(24)).toBe(16000);
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.readUInt32LE(40)).toBe(640);
  });

  it('maps interview languages to Whisper language codes', () => {
    expect(languageCode('pt-BR')).toBe('pt');
    expect(languageCode('en-US')).toBe('en');
    expect(languageCode('auto')).toBe('auto');
  });

  it('removes Portuguese prompt phrases from an English transcription', () => {
    expect(vocabularyForLanguage([
      'GX2',
      'Fullstack Developer Mobile Node Senior',
      'desenvolvedor node e react com ampla experiencia',
      'React Native',
      'Experiência com dispositivos inteligentes'
    ], 'en-US')).toEqual([
      'GX2',
      'Fullstack Developer Mobile Node Senior',
      'React Native'
    ]);
  });

  it('overwrites Whisper request language, translation and prompt parameters', async () => {
    const service = new WhisperLocalService();
    service.port = 12345;
    service.fetch = async (_url, options) => {
      expect(options.body.get('language')).toBe('en');
      expect(options.body.get('translate')).toBe('false');
      expect(options.body.get('detect_language')).toBe('false');
      expect(options.body.get('prompt')).toBe('GX2');
      return { ok: true, json: async () => ({ text: '' }) };
    };
    const record = service.createRecord(null, {
      sessionId: 'english-session',
      source: 'interviewer',
      language: 'en-US',
      customVocabulary: ['GX2', 'experiência em aplicações e dispositivos']
    });

    await service.transcribe(record, Buffer.alloc(16000));
  });

  it('merges overlapping transcription windows without duplicate words', () => {
    expect(mergeTranscript(
      'como voce resolveu esse problema',
      'esse problema no seu ultimo projeto'
    )).toBe('como voce resolveu esse problema no seu ultimo projeto');
  });

  it('uses the quantized large-v3 Turbo model', () => {
    expect(MODEL_FILE).toBe('ggml-large-v3-turbo-q5_0.bin');
    expect(VAD_MODEL_FILE).toBe('ggml-silero-v6.2.0.bin');
  });

  it('rejects low-amplitude background noise', () => {
    const pcm = Buffer.alloc(16000 * 2);
    for (let offset = 0; offset < pcm.length; offset += 2) {
      pcm.writeInt16LE(offset % 4 === 0 ? 120 : -120, offset);
    }
    expect(hasSpeechActivity(pcm)).toBe(false);
  });

  it('rejects digital silence before invoking Whisper', () => {
    expect(hasSpeechActivity(Buffer.alloc(16000 * 2))).toBe(false);
  });

  it('accepts a short voiced PCM segment', () => {
    const samples = 16000;
    const pcm = Buffer.alloc(samples * 2);
    for (let index = 0; index < samples; index += 1) {
      const voiced = index < 3200
        ? Math.sin(2 * Math.PI * 220 * index / 16000) * 0.08
        : 0;
      pcm.writeInt16LE(Math.round(voiced * 32767), index * 2);
    }
    expect(hasSpeechActivity(pcm)).toBe(true);
  });

  it('unloads the model process after the final transcription source stops', async () => {
    let killed = false;
    const service = new WhisperLocalService();
    service.process = { kill: () => { killed = true; } };
    service.port = 12345;
    const record = service.createRecord(null, {
      sessionId: 'session-1',
      source: 'interviewer'
    });
    service.sources.set(service.key(record.sessionId, record.source), record);

    await service.stopSource(record.sessionId, record.source);

    expect(killed).toBe(true);
    expect(service.process).toBeNull();
    expect(service.port).toBe(0);
  });
});
