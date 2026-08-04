import { beforeEach, describe, expect, it, vi } from 'vitest';

const electronMocks = vi.hoisted(() => ({
  askHermesStream: vi.fn(),
  askOpenAIChatStream: vi.fn(),
  getSettings: vi.fn(),
  logSession: vi.fn(),
  updateTokens: vi.fn()
}));

vi.mock('react', () => ({
  useCallback: (callback: unknown) => callback,
  useState: (initial: unknown) => [initial, vi.fn()]
}));

vi.mock('../services/electron', () => ({ electronService: electronMocks }));

import { useAssistant } from './useAssistant';

describe('useAssistant provider routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    electronMocks.logSession.mockResolvedValue(null);
    electronMocks.updateTokens.mockResolvedValue(1);
  });

  it('renders a successful Hermes stream only once', async () => {
    electronMocks.getSettings.mockResolvedValue({
      hermes: { enabled: true, useAsPrimaryAgent: true, maxContextChars: 3200 },
      assistant: { mode: 'auto', compactContext: true }
    });
    electronMocks.askHermesStream.mockImplementation(async (_args, onEvent) => {
      onEvent({ type: 'delta', text: 'Resposta do Hermes.' });
      return { success: true, text: 'Resposta do Hermes.' };
    });
    const addMessage = vi.fn(() => []);
    const updateMessage = vi.fn(() => []);
    const appendMessageText = vi.fn(() => []);
    const removeMessage = vi.fn(() => []);
    const hook = useAssistant(addMessage, updateMessage, appendMessageText, removeMessage);

    await hook.handleAIResponse('Explique event loop.', [{
      id: 'user-1', text: 'Explique event loop.', sender: 'user', timestamp: new Date()
    }]);

    expect(electronMocks.askHermesStream).toHaveBeenCalledOnce();
    expect(electronMocks.askOpenAIChatStream).not.toHaveBeenCalled();
    expect(addMessage).toHaveBeenCalledOnce();
    expect(appendMessageText).toHaveBeenCalledOnce();
  });

  it('uses OpenAI directly for images and never sends them to Google', async () => {
    electronMocks.getSettings.mockResolvedValue({
      hermes: { enabled: true, useAsPrimaryAgent: true },
      assistant: { mode: 'auto' }
    });
    electronMocks.askOpenAIChatStream.mockImplementation(async (args, onEvent) => {
      onEvent({ type: 'delta', text: 'Resposta visual.' });
      return { text: 'Resposta visual.', usage: { total_tokens: 20 }, args };
    });
    const hook = useAssistant(vi.fn(() => []), vi.fn(() => []), vi.fn(() => []), vi.fn(() => []));

    await hook.handleAIResponse('O que aparece?', [{
      id: 'user-2',
      text: 'O que aparece?',
      sender: 'user',
      timestamp: new Date(),
      image: 'data:image/png;base64,AAAA'
    }]);

    expect(electronMocks.askHermesStream).not.toHaveBeenCalled();
    expect(electronMocks.askOpenAIChatStream).toHaveBeenCalledWith(
      expect.objectContaining({ image: 'data:image/png;base64,AAAA' }),
      expect.any(Function)
    );
  });
});
