import { describe, expect, it } from 'vitest';
import providerModule from './interviewTranscriptionProvider.js';

const { resolveInterviewTranscriptionProvider } = providerModule;

describe('resolveInterviewTranscriptionProvider', () => {
  it('uses local Whisper by default', () => {
    expect(resolveInterviewTranscriptionProvider()).toBe('whisper-local');
    expect(resolveInterviewTranscriptionProvider('unknown')).toBe('whisper-local');
  });

  it('migrates saved remote providers to local Whisper', () => {
    expect(resolveInterviewTranscriptionProvider('legacy-remote')).toBe('whisper-local');
    expect(resolveInterviewTranscriptionProvider('unknown-provider')).toBe('whisper-local');
  });
});
