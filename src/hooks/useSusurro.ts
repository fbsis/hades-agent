import { useState, useEffect, useRef, useCallback } from 'react';
import { SusurroMessage, MenuView } from '../types';
import { useWindowControl } from './useWindowControl';
import { useClipboard } from './useClipboard';
import { usePersonas } from './usePersonas';
import { useTranscription } from './useTranscription';
import { useTranslation } from './useTranslation';
import { electronService } from '../services/electron';

/**
 * Orchestrator hook for Susurro logic.
 * Manages state for messages, personas, translation, and UI controls.
 */
export const useSusurro = (options: { embedded?: boolean; autoStart?: boolean; onClosePanel?: () => void } = {}) => {
  // --- Core State ---
  const [messages, setMessages] = useState<SusurroMessage[]>([]);
  const [timer, setTimer] = useState(0);
  const [tokens, setTokens] = useState(0);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [menuView, setMenuView] = useState<MenuView>('main');
  const [isSuggestionsEnabled, setIsSuggestionsEnabled] = useState(false);
  const [targetLanguage, setTargetLanguage] = useState('pt');
  const [targetLanguageLabel, setTargetLanguageLabel] = useState('Português');
  const [inputVolume, setInputVolume] = useState(1);
  const [isCreatingPersona, setIsCreatingPersona] = useState(false);
  const [newPersonaName, setNewPersonaName] = useState('');
  const [newPersonaPrompt, setNewPersonaPrompt] = useState('');
  const [isGlobalTranslationEnabled, setIsGlobalTranslationEnabled] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [fontSize, setFontSize] = useState(14); // Default 14px
  const [transcriptQuestion, setTranscriptQuestion] = useState('');
  const [transcriptAnswers, setTranscriptAnswers] = useState<Array<{
    id: string;
    question: string;
    answer: string;
    provider?: string;
    timestamp: Date;
  }>>([]);
  const [isAskingTranscript, setIsAskingTranscript] = useState(false);

  // --- Refs ---
  const chatEndRef = useRef<HTMLDivElement>(null);

  // --- Sub-Hooks ---
  const { isPinned, isResizing, togglePin, handleMinimize, startResizing } = useWindowControl();
  const { copiedId, copyToClipboard } = useClipboard();
  const {
    personas,
    selectedPersona,
    setSelectedPersona,
    savePersona,
    deletePersona
  } = usePersonas();

  const { isTranscribing, isConnecting, startTranscriptionMetis, stopTranscriptionMetis } = useTranscription(
    selectedPersona,
    isSuggestionsEnabled,
    isGlobalTranslationEnabled,
    setMessages,
    setTokens,
    inputVolume
  );

  useTranslation(messages, setMessages, targetLanguage, isTranscribing);

  // --- Effects ---
  useEffect(() => {
    const loadTokens = async () => {
      const t = await electronService.getTotalTokens();
      if (typeof t === 'number') setTokens(t);
    };
    loadTokens();

    electronService.getSettings().then(settings => {
      if (settings?.audio?.micVolume !== undefined) {
        setInputVolume(settings.audio.micVolume / 100);
      }
    });

    const timerInterval = setInterval(() => setTimer(prev => prev + 1), 1000);
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTyping = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable;
      if (e.key === 'Escape') {
        if (options.embedded && options.onClosePanel) {
          options.onClosePanel();
          return;
        }
        electronService.closeWindow();
      }
      if (e.key === ' ' && !isTyping) {
        e.preventDefault();
        e.stopPropagation();
        (document.activeElement as HTMLElement)?.blur();
        startTranscriptionMetis();
      }
    };
    globalThis.addEventListener('keydown', handleKeyDown);

    return () => {
      globalThis.removeEventListener('keydown', handleKeyDown);
      clearInterval(timerInterval);
    };
  }, [options.embedded, options.onClosePanel, startTranscriptionMetis]);

  useEffect(() => {
    if (!options.autoStart) return;
    startTranscriptionMetis();
  }, [options.autoStart, startTranscriptionMetis]);

  useEffect(() => {
    return () => {
      if (options.embedded) {
        electronService.stopSusurroLive();
      }
    };
  }, [options.embedded]);

  // Listen for live settings updates from the main process
  useEffect(() => {
    const unsubscribe = electronService.onSettingsUpdated((settings) => {
      if (settings?.audio?.micVolume !== undefined) {
        setInputVolume(settings.audio.micVolume / 100);
      }
    });
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (autoScroll) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, autoScroll]);

  useEffect(() => {
    document.documentElement.style.setProperty('--susurro-base-font-size', `${fontSize}px`);
  }, [fontSize]);

  // --- Handlers ---
  const handleToggleGlobalTranslation = useCallback(() => {
    const nextState = !isGlobalTranslationEnabled;
    setIsGlobalTranslationEnabled(nextState);
    setMessages(curr => curr.map(m => ({ ...m, isTranslated: nextState, isTranslating: false })));
  }, [isGlobalTranslationEnabled]);

  const handleToggleMessageTranslation = useCallback((msgId: string) => {
    setMessages(curr => curr.map(m =>
      m.id === msgId ? { ...m, isTranslated: !m.isTranslated, isTranslating: false } : m
    ));
  }, []);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 50);
  }, []);

  const onSavePersona = useCallback(async () => {
    if (!newPersonaName || !newPersonaPrompt) return;
    const persona = await savePersona(newPersonaName, newPersonaPrompt);
    if (persona) {
      setIsCreatingPersona(false);
      setNewPersonaName('');
      setNewPersonaPrompt('');
    }
  }, [newPersonaName, newPersonaPrompt, savePersona]);

  const handleCloseSession = useCallback(async () => {
    try {
      const finalizedMessages = messages
        .map(message => ({
          ...message,
          text: ((message.text || '') + (message.pendingText || '')).trim(),
          pendingText: '',
          timestamp: message.timestamp instanceof Date ? message.timestamp.toISOString() : message.timestamp
        }))
        .filter(message => message.text);

      await Promise.all(finalizedMessages.map(message => electronService.saveSusurroMessage(message)));
      await electronService.endSession('susurro');
    } catch {
      // Archiving failed, still clear local state
    } finally {
      setMessages([]);
      setTranscriptAnswers([]);
      setTranscriptQuestion('');
      setTimer(0);
    }
  }, [messages]);

  const buildTranscriptContext = useCallback(() => {
    const transcript = messages
      .map((message, index) => {
        const text = `${message.text || ''}${message.pendingText || ''}`.trim();
        if (!text) return '';
        return `${index + 1}. ${text}`;
      })
      .filter(Boolean)
      .join('\n');

    return transcript.length > 14000 ? transcript.slice(-14000) : transcript;
  }, [messages]);

  const askTranscriptQuestion = useCallback(async () => {
    const question = transcriptQuestion.trim();
    if (!question || isAskingTranscript) return;

    const transcript = buildTranscriptContext();
    if (!transcript) {
      setTranscriptAnswers(prev => [...prev, {
        id: `qa_${Date.now()}`,
        question,
        answer: 'Ainda nao existe transcricao para consultar.',
        provider: 'local',
        timestamp: new Date()
      }]);
      return;
    }

    setIsAskingTranscript(true);
    setTranscriptQuestion('');

    try {
      const result = await electronService.askSusurroTranscript({
        question,
        transcript,
        personaPrompt: selectedPersona?.systemPrompt
      });

      setTranscriptAnswers(prev => [...prev.slice(-4), {
        id: `qa_${Date.now()}`,
        question,
        answer: result?.text || 'Nao consegui responder usando a transcricao.',
        provider: result?.provider,
        timestamp: new Date()
      }]);
    } catch (error: any) {
      setTranscriptAnswers(prev => [...prev.slice(-4), {
        id: `qa_${Date.now()}`,
        question,
        answer: `Erro ao consultar a transcricao: ${error?.message || 'erro desconhecido'}`,
        provider: 'error',
        timestamp: new Date()
      }]);
    } finally {
      setIsAskingTranscript(false);
    }
  }, [buildTranscriptContext, isAskingTranscript, selectedPersona?.systemPrompt, transcriptQuestion]);

  return {
    // State
    messages,
    timer,
    tokens,
    isSettingsOpen, setIsSettingsOpen,
    menuView, setMenuView,
    isSuggestionsEnabled, setIsSuggestionsEnabled,
    personas,
    selectedPersona, setSelectedPersona,
    targetLanguage, setTargetLanguage,
    targetLanguageLabel, setTargetLanguageLabel,
    inputVolume, setInputVolume,
    isCreatingPersona, setIsCreatingPersona,
    newPersonaName, setNewPersonaName,
    newPersonaPrompt, setNewPersonaPrompt,
    isGlobalTranslationEnabled,
    autoScroll, setAutoScroll,
    transcriptQuestion, setTranscriptQuestion,
    transcriptAnswers,
    isAskingTranscript,

    // Window/UI
    isPinned, isResizing, togglePin, handleMinimize, startResizing,
    copiedId, copyToClipboard,
    chatEndRef,
    handleScroll,

    // Transcription
    isTranscribing, isConnecting, startTranscriptionMetis, stopTranscriptionMetis,

    // Handlers
    handleToggleGlobalTranslation,
    handleToggleMessageTranslation,
    handleSavePersona: onSavePersona,
    handleDeletePersona: deletePersona,
    askTranscriptQuestion,

    // Font Size
    fontSize,
    increaseFontSize: () => setFontSize(prev => Math.min(prev + 1, 24)),
    decreaseFontSize: () => setFontSize(prev => Math.max(prev - 1, 10)),
    onCloseSession: handleCloseSession
  };
};
