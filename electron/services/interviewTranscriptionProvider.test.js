import { describe, expect, it } from 'vitest';
import providerModule from './interviewTranscriptionProvider.js';

const { resolveInterviewTranscriptionProvider } = providerModule;

describe('resolveInterviewTranscriptionProvider', () => {
  it('uses Gemini Live by default', () => {
    expect(resolveInterviewTranscriptionProvider()).toBe('gemini-live');
    expect(resolveInterviewTranscriptionProvider('unknown')).toBe('gemini-live');
  });

  it('uses Google Cloud only when explicitly selected', () => {
    expect(resolveInterviewTranscriptionProvider('google-cloud')).toBe('google-cloud');
  });
});
