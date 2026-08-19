import { describe, expect, it } from 'vitest';
import textActionModule from './textActionPrompts.js';

const { buildTextActionPrompt } = textActionModule;

describe('selected text actions', () => {
  it('provides a focused prompt for every built-in action', () => {
    for (const action of ['translate', 'simplify', 'explain', 'summarize', 'proofread', 'rewrite', 'professional', 'friendly', 'shorten', 'expand']) {
      expect(buildTextActionPrompt(action)).toBeTruthy();
    }
  });

  it('uses the custom instruction', () => {
    expect(buildTextActionPrompt('custom', 'Transforme em uma lista')).toBe('Transforme em uma lista');
  });

  it('rejects an empty custom instruction', () => {
    expect(() => buildTextActionPrompt('custom', '  ')).toThrow('Descreva');
  });

  it('rejects unknown actions', () => {
    expect(() => buildTextActionPrompt('unknown')).toThrow('inválida');
  });
});
