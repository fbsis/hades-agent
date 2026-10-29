import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import contentProtection from './contentProtection.js';

const { protectWindow, bindContentProtection } = contentProtection;

describe('window protection lifecycle', () => {
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
  const window = () => Object.assign(new EventEmitter(), {
    webContents: new EventEmitter(),
    isDestroyed: () => false,
    setContentProtection: vi.fn()
  });

  it.each(['show', 'restore', 'focus', 'did-finish-load'])('protects immediately and reapplies after %s', event => {
    vi.useFakeTimers();
    const win = window();
    expect(bindContentProtection(win)).toBe(true);
    expect(win.setContentProtection).toHaveBeenCalledWith(true);
    win.setContentProtection.mockClear();
    (event === 'did-finish-load' ? win.webContents : win).emit(event);
    expect(win.setContentProtection).toHaveBeenCalledWith(true);
    vi.advanceTimersByTime(1500);
    expect(win.setContentProtection.mock.calls.every(([enabled]) => enabled === true)).toBe(true);
    expect(win.setContentProtection.mock.calls.length).toBeGreaterThan(1);
  });

  it('bounds retries and cancels them when closed', () => {
    vi.useFakeTimers();
    const win = window();
    bindContentProtection(win);
    for (let index = 0; index < 10; index++) win.emit('focus');
    expect(vi.getTimerCount()).toBe(4);
    win.emit('closed');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores windows already destroyed', () => {
    const win = window();
    win.isDestroyed = () => true;
    expect(bindContentProtection(win)).toBe(false);
    expect(win.setContentProtection).not.toHaveBeenCalled();
  });
});

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
