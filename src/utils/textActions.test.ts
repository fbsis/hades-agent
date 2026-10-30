import { describe, it, expect } from 'vitest';
import { shouldAutoReplace } from './textActions';

describe('direct text transformations', () => {
  const editable = { selectionId: 'current', canReplace: true };
  it.each(['translate', 'proofread', 'rewrite', 'professional', 'friendly', 'shorten', 'expand', 'simplify', 'custom'] as const)('applies %s without another confirmation', action => {
    expect(shouldAutoReplace(action, editable)).toBe(true);
  });
  it.each(['summarize', 'explain'] as const)('keeps %s in a result window', action => {
    expect(shouldAutoReplace(action, editable)).toBe(false);
  });
  it('never pastes manual, read-only or unknown selections', () => {
    expect(shouldAutoReplace('translate', {})).toBe(false);
    expect(shouldAutoReplace('translate', { ...editable, canReplace: false })).toBe(false);
    expect(shouldAutoReplace('translate', { canReplace: true })).toBe(false);
  });
});
