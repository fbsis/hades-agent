import { describe, expect, it } from 'vitest';
import transcriptionModule from './geminiLiveTranscription.js';

const {
  buildAudioTranscriptionConfig,
  buildTranscriptionInstruction
} = transcriptionModule;

describe('Gemini Live transcription', () => {
  it('limits automatic language detection to Portuguese and English', () => {
    const record = {
      language: 'auto',
      customVocabulary: ['Felipe Braga', 'Example Corp']
    };
    expect(buildAudioTranscriptionConfig(record)).toEqual({
      languageHints: { languageCodes: ['pt-BR', 'en-US'] },
      customVocabulary: ['Felipe Braga', 'Example Corp']
    });
    expect(buildTranscriptionInstruction(record)).toContain(
      'Never interpret Portuguese as Spanish'
    );
  });

  it('pins Portuguese when it is explicitly selected', () => {
    const record = {
      language: 'pt-BR',
      customVocabulary: []
    };
    expect(buildAudioTranscriptionConfig(record)).toEqual({
      languageHints: { languageCodes: ['pt-BR'] }
    });
    expect(buildTranscriptionInstruction(record)).toContain(
      'The audio is Brazilian Portuguese'
    );
  });
});
