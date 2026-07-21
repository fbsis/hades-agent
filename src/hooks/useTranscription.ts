import { useState, useEffect, useRef, useCallback } from 'react';
import { SusurroMessage, Persona } from '../types';
import { useAudioRecorder } from './useAudioRecorder';
import { updateMessageWithDeltas, calculateDeltaLength } from '../utils/transcription';
import { electronService } from '../services/electron';

const DELTA_RENDER_DEBOUNCE_MS = 40;
const LOCAL_TURN_IDLE_MS = 900;

/**
 * Hook to manage high-level transcription logic, delta processing, and message state.
 * Orchestrates the audio recording lifecycle and coordinates with Electron IPC for STT.
 */
export const useTranscription = (
  selectedPersona: Persona | null,
  isSuggestionsEnabled: boolean,
  isGlobalTranslationEnabled: boolean,
  setMessages: React.Dispatch<React.SetStateAction<SusurroMessage[]>>,
  setTokens: React.Dispatch<React.SetStateAction<number>>,
  inputVolume: number
) => {
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const currentTurnIdRef = useRef<string | null>(null);
  const persistedTurnIdsRef = useRef<Set<string>>(new Set());
  const pendingDeltaRef = useRef<{ text: string, isFinal: boolean }[]>([]);
  const deltaTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localFinalizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { startRecording, stopRecording, gainNode } = useAudioRecorder();

  const clearLocalFinalizeTimeout = useCallback(() => {
    if (localFinalizeTimeoutRef.current) {
      clearTimeout(localFinalizeTimeoutRef.current);
      localFinalizeTimeoutRef.current = null;
    }
  }, []);

  const persistFinalMessage = useCallback((message: SusurroMessage) => {
    if (!message?.id || persistedTurnIdsRef.current.has(message.id)) return;
    const text = (message.text || message.pendingText || '').trim();
    if (!text) return;

    persistedTurnIdsRef.current.add(message.id);
    electronService.saveSusurroMessage({
      ...message,
      text,
      pendingText: '',
      timestamp: message.timestamp instanceof Date ? message.timestamp.toISOString() : message.timestamp
    });
  }, []);

  const finalizeCurrentTurn = useCallback(() => {
    const turnId = currentTurnIdRef.current;
    if (!turnId) return;

    setMessages(prev => {
      const idx = prev.findIndex(m => m.id === turnId);
      if (idx === -1) return prev;

      const next = [...prev];
      const target = next[idx];
      const finalized = {
        ...target,
        text: (target.text || "") + (target.pendingText || ""),
        pendingText: ""
      };
      next[idx] = finalized;
      queueMicrotask(() => persistFinalMessage(finalized));
      return next;
    });

    currentTurnIdRef.current = null;
  }, [persistFinalMessage, setMessages]);

  const scheduleLocalFinalize = useCallback(() => {
    clearLocalFinalizeTimeout();
    localFinalizeTimeoutRef.current = setTimeout(() => {
      localFinalizeTimeoutRef.current = null;
      finalizeCurrentTurn();
    }, LOCAL_TURN_IDLE_MS);
  }, [clearLocalFinalizeTimeout, finalizeCurrentTurn]);

  // Keep refs in sync for use in callbacks to avoid stale closures
  const settingsRef = useRef({ isSuggestionsEnabled, selectedPersona, isGlobalTranslationEnabled });
  useEffect(() => {
    settingsRef.current = { isSuggestionsEnabled, selectedPersona, isGlobalTranslationEnabled };
  }, [isSuggestionsEnabled, selectedPersona, isGlobalTranslationEnabled]);

  /**
   * Updates token counts and generates suggestions based on new deltas.
   */
  const updateExternalState = useCallback((deltas: { text: string, isFinal: boolean }[]) => {
    const totalChars = calculateDeltaLength(deltas);

    electronService.updateTokens(Math.ceil(totalChars / 4)).then((total: number) => {
      if (typeof total === 'number') setTokens(total);
    });

    const finalDelta = deltas.find(d => d.isFinal);
    if (settingsRef.current.isSuggestionsEnabled && settingsRef.current.selectedPersona && finalDelta) {
      electronService.generateSuggestion({
        transcription: finalDelta.text,
        personaPrompt: settingsRef.current.selectedPersona.systemPrompt
      });
    }
  }, [setTokens]);

  /**
   * Processes incoming transcription deltas and updates message state.
   */
  const processDeltas = useCallback((deltas: { text: string, isFinal: boolean }[]) => {
    if (deltas.length === 0) return;
    clearLocalFinalizeTimeout();

    setMessages(prev => {
      let newMessages = [...prev];
      let msgIndex = currentTurnIdRef.current ? newMessages.findIndex(m => m.id === currentTurnIdRef.current) : -1;

      // Initialize a new message if this is a new turn
      if (msgIndex === -1) {
        const id = Date.now().toString();
        currentTurnIdRef.current = id;

        // Finalize any pending text in previous messages
        newMessages = newMessages.map(m => m.pendingText ? {
          ...m,
          text: (m.text || "") + (m.pendingText || ""),
          pendingText: ""
        } : m);

        newMessages.push({
          id, text: "", pendingText: "", timestamp: new Date(), updateCount: 0,
          isTranslated: settingsRef.current.isGlobalTranslationEnabled, isTranslating: false
        });

        msgIndex = newMessages.length - 1;
      }

      return updateMessageWithDeltas(newMessages, msgIndex, deltas);
    });

    updateExternalState(deltas);

    if (deltas.some(d => d.isFinal)) {
      finalizeCurrentTurn();
      return;
    }

    if (deltas.some(d => d.text)) {
      scheduleLocalFinalize();
    }
  }, [clearLocalFinalizeTimeout, finalizeCurrentTurn, scheduleLocalFinalize, setMessages, updateExternalState]);

  /**
   * Handles status updates from the backend transcription service.
   */
  const handleStatusUpdate = useCallback((status: string) => {
    console.log(`[TRANSCRIPTION] Status update received: ${status}`);

    if (status === 'connecting') {
      setIsConnecting(true);
      return;
    }

    if (status === 'ready') {
      setIsConnecting(false);
      setIsTranscribing(true);
      return;
    }

    if (status === 'error' || status === 'closed') {
      setIsConnecting(false);
      setIsTranscribing(false);
      stopRecording(); // Ensure audio pipeline is torn down when backend closes
      clearLocalFinalizeTimeout();
      finalizeCurrentTurn();
      return;
    }

    if (status !== 'turn_complete') return;
    clearLocalFinalizeTimeout();
    finalizeCurrentTurn();
  }, [clearLocalFinalizeTimeout, finalizeCurrentTurn, stopRecording]);

  const isTranscribingRef = useRef(isTranscribing);
  useEffect(() => {
    isTranscribingRef.current = isTranscribing;
  }, [isTranscribing]);

  const isConnectingRef = useRef(isConnecting);
  useEffect(() => {
    isConnectingRef.current = isConnecting;
  }, [isConnecting]);

  /**
   * Toggles the live transcription session.
   */
  const toggleTranscription = useCallback(async () => {
    console.log(`[TRANSCRIPTION] Toggle requested. State: isTranscribing=${isTranscribingRef.current}, isConnecting=${isConnectingRef.current}`);

    if (isTranscribingRef.current || isConnectingRef.current) {
      stopRecording();
      await electronService.stopSusurroLive();

      // Flush any pending deltas immediately on manual stop
      if (pendingDeltaRef.current.length > 0) {
        processDeltas(pendingDeltaRef.current);
        pendingDeltaRef.current = [];
      }
      if (deltaTimeoutRef.current) {
        clearTimeout(deltaTimeoutRef.current);
        deltaTimeoutRef.current = null;
      }
      clearLocalFinalizeTimeout();

      // handleStatusUpdate will catch the 'closed' signal and cleanup
      return;
    }

    setIsConnecting(true);
    const success = await electronService.startSusurroLive(settingsRef.current.selectedPersona?.systemPrompt);

    if (!success) {
      setIsConnecting(false);
      return;
    }

    // Once the backend says it started successfully, we can start capturing audio.
    // The 'ready' status from backend will set isTranscribing=true via handleStatusUpdate.
    const started = await startRecording({
      isSystemAudio: true,
      onChunk: (base64, seq) => {
        electronService.sendSusurroChunk(base64, seq);
      },
      onAudioStreamEnd: () => {
        electronService.endSusurroAudioStream();
      }
    });

    if (!started) {
      console.error('[TRANSCRIPTION] Failed to start audio recording');
      electronService.stopSusurroLive();
      setIsConnecting(false);
    }
  }, [clearLocalFinalizeTimeout, processDeltas, startRecording, stopRecording]);

  // Sync gain node with volume state
  useEffect(() => {
    if (gainNode) gainNode.gain.value = inputVolume;
  }, [inputVolume, gainNode]);

  // Set up Electron IPC listeners
  useEffect(() => {
    const removeDelta = electronService.onSusurroLiveDelta((delta: any) => {
      if (delta.isFinal) {
        if (deltaTimeoutRef.current) clearTimeout(deltaTimeoutRef.current);
        processDeltas([...pendingDeltaRef.current, delta]);
        pendingDeltaRef.current = [];
      } else {
        pendingDeltaRef.current.push(delta);
        if (!deltaTimeoutRef.current) {
          deltaTimeoutRef.current = setTimeout(() => {
            deltaTimeoutRef.current = null;
            processDeltas(pendingDeltaRef.current);
            pendingDeltaRef.current = [];
          }, DELTA_RENDER_DEBOUNCE_MS);
        }
      }
    });

    const removeStatus = electronService.onSusurroLiveStatus(handleStatusUpdate);
    const removeToggleSignal = electronService.onToggleSusurroTranscriptionSignal(() => {
      toggleTranscription();
    });
    const removeStartSusurro = electronService.onStartSusurro(() => {
      if (!isTranscribingRef.current && !isConnectingRef.current) {
        toggleTranscription();
      }
    });
    const removeStopSusurro = electronService.onStopSusurro(() => {
      if (isTranscribingRef.current || isConnectingRef.current) {
        toggleTranscription();
      }
    });

    return () => {
      if (removeDelta) removeDelta();
      if (removeStatus) removeStatus();
      if (removeToggleSignal) removeToggleSignal();
      if (removeStartSusurro) removeStartSusurro();
      if (removeStopSusurro) removeStopSusurro();
      if (deltaTimeoutRef.current) clearTimeout(deltaTimeoutRef.current);
      clearLocalFinalizeTimeout();
    };
  }, [clearLocalFinalizeTimeout, processDeltas, handleStatusUpdate, toggleTranscription]);

  useEffect(() => {
    return () => {
      electronService.stopSusurroLive();
      stopRecording();
      if (deltaTimeoutRef.current) clearTimeout(deltaTimeoutRef.current);
      clearLocalFinalizeTimeout();
    };
  }, [clearLocalFinalizeTimeout, stopRecording]);

  return {
    isTranscribing,
    isConnecting,
    startTranscriptionHades: toggleTranscription,
    stopTranscriptionHades: toggleTranscription
  };
};
