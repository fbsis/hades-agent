import { afterEach, describe, it, expect, vi } from 'vitest';
import handoff from './shortcutHandoff.js';
describe('WritingTools shortcut handoff', () => {
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
  it('registers immediately when the accelerator is free', () => {
    vi.useFakeTimers();
    const globalShortcut = { register: vi.fn(() => true) };
    expect(handoff.registerWithHandoff({ globalShortcut, key: 'Alt+Space', handler: vi.fn() }).registered).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('acquires after WritingTools releases it without unregistering other shortcuts', () => {
    vi.useFakeTimers();
    const globalShortcut = { register: vi.fn().mockReturnValueOnce(false).mockReturnValue(true), unregisterAll: vi.fn() };
    const onStatus = vi.fn();
    const registration = handoff.registerWithHandoff({ globalShortcut, key: 'Alt+Space', handler: vi.fn(), onStatus });
    expect(registration.registered).toBe(false);
    vi.advanceTimersByTime(5000);
    expect(onStatus.mock.calls).toEqual([[false], [true]]);
    expect(globalShortcut.unregisterAll).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('cancels an old retry when shortcut settings change', () => {
    vi.useFakeTimers();
    const globalShortcut = { register: vi.fn(() => false) };
    const registration = handoff.registerWithHandoff({ globalShortcut, key: 'Alt+Space', handler: vi.fn() });
    registration.cancel();
    vi.advanceTimersByTime(15000);
    expect(globalShortcut.register).toHaveBeenCalledOnce();
  });
});
