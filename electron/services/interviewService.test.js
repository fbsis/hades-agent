import { describe, expect, it } from 'vitest';
import generationConfigModule from './interviewGenerationConfig.js';

const { geminiGenerationConfig } = generationConfigModule;

describe('Gemini interview generation config', () => {
  it('reserves the quick-answer budget for visible Gemini 2.5 Flash output', () => {
    expect(geminiGenerationConfig('gemini-2.5-flash', 'quick')).toEqual({
      temperature: 0.15,
      thinkingConfig: { thinkingBudget: 0 }
    });
  });

  it('does not send the legacy thinking budget to other model families', () => {
    expect(geminiGenerationConfig('gemini-3-flash-preview', 'quick')).toEqual({
      temperature: 0.15
    });
  });
});
