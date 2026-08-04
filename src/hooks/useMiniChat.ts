import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { useChatState } from './useChatState';
import { useAssistant } from './useAssistant';
import { useWindowControl } from './useWindowControl';
import { useClipboard } from './useClipboard';
import { electronService } from '../services/electron';
import { CHAT_SESSION_IDLE_LIMIT_MS, getChatSessionIdleMs } from '../utils/chatSession';

/**
 * Hook to manage the state and logic for the MiniChat component.
 * Orchestrates chat messages, AI responses, window controls, and IPC events.
 */
export const useMiniChat = (options: { embedded?: boolean; isActive?: boolean; onClosePanel?: () => void } = {}) => {
  const {
    messages,
    pendingMessages,
    setPendingMessages,
    pendingMessagesRef,
    isBusy,
    setIsBusy,
    isLoaded,
    addMessage,
    updateMessage,
    appendMessageText,
    removeMessage,
    clearHistory,
    rotateStaleSession
  } = useChatState();

  const { isThinking, activeTool, handleAIResponse } = useAssistant(
    addMessage,
    updateMessage,
    appendMessageText,
    removeMessage
  );
  const { isPinned, isResizing, togglePin, handleMinimize, startResizing } = useWindowControl();
  const { copiedId, copyToClipboard } = useClipboard();

  const [timer, setTimer] = useState(() => {
    const saved = localStorage.getItem('minichat_timer');
    return saved ? parseInt(saved, 10) : 0;
  });
  const [tokens, setTokens] = useState<number>(() => {
    const saved = localStorage.getItem('minichat_session_tokens');
    return saved ? parseInt(saved, 10) : 0;
  });
  const chatEndRef = useRef<HTMLDivElement>(null);

  const resetSessionCounters = useCallback(() => {
    setTimer(0);
    setTokens(0);
    localStorage.removeItem('minichat_session_tokens');
  }, []);

  const rotateSessionIfStale = useCallback(() => {
    if (!isLoaded) return false;
    const rotated = rotateStaleSession();
    if (rotated) resetSessionCounters();
    return rotated;
  }, [isLoaded, resetSessionCounters, rotateStaleSession]);

  const startNewSession = useCallback(() => {
    setPendingMessages([]);
    pendingMessagesRef.current = [];
    resetSessionCounters();
    clearHistory();
  }, [clearHistory, pendingMessagesRef, resetSessionCounters, setPendingMessages]);

  useEffect(() => {
    if (!isLoaded || messages.length === 0) return;

    const remaining = CHAT_SESSION_IDLE_LIMIT_MS - getChatSessionIdleMs(messages);
    if (remaining <= 0) {
      rotateSessionIfStale();
      return;
    }

    const timeout = setTimeout(rotateSessionIfStale, remaining);
    return () => clearTimeout(timeout);
  }, [isLoaded, messages, rotateSessionIfStale]);

  // Timer effect: ticks only when active session exists (messages.length > 0)
  useEffect(() => {
    if (options.embedded || messages.length === 0) {
      setTimer(0);
      localStorage.removeItem('minichat_timer');
      return;
    }

    const timerInterval = setInterval(() => {
      setTimer(prev => {
        const next = prev + 1;
        localStorage.setItem('minichat_timer', next.toString());
        return next;
      });
    }, 1000);

    return () => clearInterval(timerInterval);
  }, [messages.length, options.embedded]);

  // Keep Conversation anchored to the latest message, including live streaming deltas.
  useLayoutEffect(() => {
    if (options.embedded && !options.isActive) return;

    const scrollToLatest = () => {
      chatEndRef.current?.scrollIntoView({
        block: 'end',
        behavior: 'auto'
      });
    };

    scrollToLatest();
    const frame = requestAnimationFrame(scrollToLatest);
    const timeout = setTimeout(scrollToLatest, 50);

    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timeout);
    };
  }, [messages, pendingMessages, isThinking, activeTool, options.embedded, options.isActive]);

  // Process queued messages when not busy
  const processNextPending = async () => {
    if (pendingMessagesRef.current.length > 0) {
      const nextMsg = pendingMessagesRef.current[0];
      setPendingMessages(prev => prev.slice(1));
      const updatedHistory = addMessage(nextMsg.text, 'user', nextMsg.image);
      const loopTokens = await handleAIResponse(nextMsg.text, updatedHistory);
      
      // Update tokens after response
      setTokens(prev => {
        const next = prev + (loopTokens || 0);
        localStorage.setItem('minichat_session_tokens', next.toString());
        return next;
      });

      processNextPending();
    } else {
      setIsBusy(false);
    }
  };

  // Use refs for values needed inside the IPC listener to avoid recreating it
  const isBusyRef = useRef(isBusy);
  useEffect(() => { isBusyRef.current = isBusy; }, [isBusy]);

  // Handle incoming messages and task executions from Electron IPC
  useEffect(() => {
    // New message from Command Bar
    const unsubscribeMsg = electronService.onNewChatMessage((msg: string, image?: string) => {
      rotateSessionIfStale();
      if (isBusyRef.current) {
        setPendingMessages(prev => [...prev, {
          id: `user_${Date.now()}`,
          text: msg,
          sender: 'user',
          timestamp: new Date(),
          status: 'sent',
          image
        }]);
      } else {
        setIsBusy(true);
        // addMessage uses a ref internally so it's safe to call without depending on messages state
        const updatedHistory = addMessage(msg, 'user', image);
        handleAIResponse(msg, updatedHistory).then(async (loopTokens) => {
          setTokens(prev => {
            const next = prev + (loopTokens || 0);
            localStorage.setItem('minichat_session_tokens', next.toString());
            return next;
          });
          processNextPending();
        });
      }
    });

    // Scheduled task execution from taskService
    const unsubscribeTask = electronService.onExecuteTask((task: any) => {
      const prompt = `[TAREFA AGENDADA] A tarefa a seguir foi disparada automaticamente, execute-a agora: "${task.description}"`;
      setIsBusy(true);
      // We must get the latest messages for the prompt
      electronService.getChat().then(currentHistory => {
        handleAIResponse(prompt, currentHistory || []).then(async (loopTokens) => {
          setTokens(prev => {
            const next = prev + (loopTokens || 0);
            localStorage.setItem('minichat_session_tokens', next.toString());
            return next;
          });
          processNextPending();
        });
      });
    });

    // Keyboard shortcut to close/minimize
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (options.embedded) {
        if (options.isActive && options.onClosePanel) {
          options.onClosePanel();
        }
        return;
      }
      handleMinimize();
    };
    globalThis.addEventListener('keydown', handleKeyDown);

    return () => {
      if (unsubscribeMsg) unsubscribeMsg();
      if (unsubscribeTask) unsubscribeTask();
      globalThis.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    addMessage,
    handleAIResponse,
    handleMinimize,
    options.embedded,
    options.isActive,
    options.onClosePanel,
    rotateSessionIfStale
  ]); // Removed isBusy, currentModel, messages from dependencies

  return {
    messages,
    pendingMessages,
    isBusy,
    isThinking,
    activeTool,
    isPinned,
    isResizing,
    timer,
    tokens,
    copiedId,
    chatEndRef,
    addMessage,
    togglePin,
    handleMinimize,
    startResizing,
    startNewSession,
    copyToClipboard
  };
};
