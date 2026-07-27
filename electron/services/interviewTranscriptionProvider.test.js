import { describe, expect, it } from 'vitest';
import providerModule from './interviewTranscriptionProvider.js';

const { resolveInterviewTranscriptionProvider } = providerModule;

describe('resolveInterviewTranscriptionProvider', () => {
  it('uses local Whisper by default', () => {
    expect(resolveInterviewTranscriptionProvider()).toBe('whisper-local');
    expect(resolveInterviewTranscriptionProvider('unknown')).toBe('whisper-local');
  });

  it('keeps explicitly selected remote providers', () => {
    expect(resolveInterviewTranscriptionProvider('google-cloud')).toBe('google-cloud');
    expect(resolveInterviewTranscriptionProvider('gemini-live')).toBe('gemini-live');
  });
});
