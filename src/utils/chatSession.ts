import type { ChatMessage } from '../types';

export const CHAT_SESSION_IDLE_LIMIT_MS = 4 * 60 * 60 * 1000;

export const getChatSessionIdleMs = (
  messages: Pick<ChatMessage, 'timestamp'>[],
  now = Date.now()
) => {
  const lastTimestamp = messages.at(-1)?.timestamp;
  if (!lastTimestamp) return 0;

  const lastActivity = new Date(lastTimestamp).getTime();
  if (!Number.isFinite(lastActivity)) return 0;

  return Math.max(0, now - lastActivity);
};

export const shouldRotateChatSession = (
  messages: Pick<ChatMessage, 'timestamp'>[],
  now = Date.now()
) => messages.length > 0 && getChatSessionIdleMs(messages, now) >= CHAT_SESSION_IDLE_LIMIT_MS;

