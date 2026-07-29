import { describe, expect, it, vi } from 'vitest';
import macPrivacy from './macPrivacy.js';

const {
  configureMacWindowPrivacy,
  getMacOverlayOptions
} = macPrivacy;

describe('macOS window privacy', () => {
  it('uses a non-activating panel outside Mission Control and the Dock', () => {
    expect(getMacOverlayOptions('darwin')).toEqual({
      type: 'panel',
      hiddenInMissionControl: true,
      skipTaskbar: true
    });
  });

  it('does not change window types on other platforms', () => {
    expect(getMacOverlayOptions('win32')).toEqual({});
  });

  it('excludes a macOS window from native window lists', () => {
    const win = {
      isDestroyed: () => false,
      setHiddenInMissionControl: vi.fn(),
      excludedFromShownWindowsMenu: false
    };

    expect(configureMacWindowPrivacy(win, 'darwin')).toBe(true);
    expect(win.setHiddenInMissionControl).toHaveBeenCalledWith(true);
    expect(win.excludedFromShownWindowsMenu).toBe(true);
  });
});
