import { describe, expect, it } from 'vitest';
import opacityModule from './windowOpacity.js';

const {
  DEFAULT_WINDOW_OPACITY,
  MIN_WINDOW_OPACITY,
  normalizeWindowOpacity
} = opacityModule;

describe('window opacity', () => {
  it('uses a slightly transparent default for missing or invalid values', () => {
    expect(normalizeWindowOpacity(undefined)).toBe(DEFAULT_WINDOW_OPACITY);
    expect(normalizeWindowOpacity('invalid')).toBe(DEFAULT_WINDOW_OPACITY);
  });

  it('keeps opacity inside the readable range', () => {
    expect(normalizeWindowOpacity(0)).toBe(MIN_WINDOW_OPACITY);
    expect(normalizeWindowOpacity(0.75)).toBe(0.75);
    expect(normalizeWindowOpacity(2)).toBe(1);
  });
});
