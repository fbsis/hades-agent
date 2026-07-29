import { describe, expect, it, vi } from 'vitest';
import contentProtection from './contentProtection.js';

const { protectWindow } = contentProtection;

describe('protectWindow', () => {
  it('always enables content protection', () => {
    const win = {
      isDestroyed: () => false,
      setContentProtection: vi.fn()
    };

    expect(protectWindow(win)).toBe(true);
    expect(win.setContentProtection).toHaveBeenCalledWith(true);
  });

  it('does not touch a destroyed window', () => {
    const win = {
      isDestroyed: () => true,
      setContentProtection: vi.fn()
    };

    expect(protectWindow(win)).toBe(false);
    expect(win.setContentProtection).not.toHaveBeenCalled();
  });

  it('reports a failed Electron call without crashing', () => {
    const win = {
      isDestroyed: () => false,
      setContentProtection: () => {
        throw new Error('unsupported');
      }
    };

    expect(protectWindow(win)).toBe(false);
  });
});
