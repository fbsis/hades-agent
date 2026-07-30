import { describe, expect, it } from 'vitest';
import {
  CHAT_SESSION_IDLE_LIMIT_MS,
  getChatSessionIdleMs,
  shouldRotateChatSession
} from './chatSession';

describe('chat session rotation', () => {
  const now = new Date('2026-07-29T16:00:00.000Z').getTime();

  it('keeps a conversation active before four hours of inactivity', () => {
    const messages = [{ timestamp: new Date(now - CHAT_SESSION_IDLE_LIMIT_MS + 1) }];

    expect(shouldRotateChatSession(messages, now)).toBe(false);
  });

  it('rotates a conversation after four hours of inactivity', () => {
    const messages = [{ timestamp: new Date(now - CHAT_SESSION_IDLE_LIMIT_MS).toISOString() }];

    expect(shouldRotateChatSession(messages, now)).toBe(true);
  });

  it('uses the most recent message as the activity marker', () => {
    const messages = [
      { timestamp: new Date(now - CHAT_SESSION_IDLE_LIMIT_MS * 2) },
      { timestamp: new Date(now - 60_000) }
    ];

    expect(getChatSessionIdleMs(messages, now)).toBe(60_000);
    expect(shouldRotateChatSession(messages, now)).toBe(false);
  });

  it('does not rotate an empty conversation', () => {
    expect(shouldRotateChatSession([], now)).toBe(false);
  });
});
