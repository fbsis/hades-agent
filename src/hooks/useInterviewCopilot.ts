import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_INTERVIEW_CONFIG,
  ConversationSuggestion,
  ConversationSuggestionExpansion,
  InterviewAnswer,
  InterviewAnswerVariant,
  InterviewConfig,
  InterviewFlowStatus,
  InterviewSession,
  InterviewTranscriptionStatus,
  TranscriptTurn
} from '../types/interview';
import {
  applyInterviewTranscriptDelta,
  canUseInterviewActionShortcut,
  isLikelyInterviewQuestion,
  normalizeInterviewConfig,
  selectConversationTurns,
  selectLatestQuickAnswerTurn,
  selectQuickAnswerFragments,
  selectScreenAnswerVariant
} from '../utils/interview';
import { arrayBufferToBase64, floatTo16BitPCM } from '../utils/audio';
import { electronService } from '../services/electron';
import { useAudioRecorder } from './useAudioRecorder';
import { useWindowControl } from './useWindowControl';

type AudioSource = 'interviewer' | 'candidate';

const makeId = (prefix: string) => {
  const suffix = globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  return `${prefix}_${suffix}`;
};

const buildTranscriptionVocabulary = (config: InterviewConfig): string[] => [
  config.company,
  config.role,
  config.resume.split(/\r?\n/).find(line => (
    line.trim().length >= 3 && line.trim().length <= 80
  )) || '',
  ...config.topics.split(/[,;\n]/).slice(0, 8)
].map(value => value.trim()).filter(Boolean);

export const useInterviewCopilot = (options: { embedded?: boolean; onClosePanel?: () => void } = {}) => {
  const [config, setConfig] = useState<InterviewConfig>(DEFAULT_INTERVIEW_CONFIG);
  const [session, setSession] = useState<InterviewSession | null>(null);
  const [recentSessions, setRecentSessions] = useState<InterviewSession[]>([]);
  const [flowStatus, setFlowStatus] = useState<InterviewFlowStatus>('idle');
  const [sourceStatuses, setSourceStatuses] = useState<Partial<Record<AudioSource, InterviewTranscriptionStatus>>>({});
  const [selectedTurnId, setSelectedTurnId] = useState<string | null>(null);
  const [questionDraft, setQuestionDraft] = useState('');
  const [activeAnswerId, setActiveAnswerId] = useState<string | null>(null);
  const [toolStatus, setToolStatus] = useState('');
  const [screenStatus, setScreenStatus] = useState<'idle' | 'reading' | 'error'>('idle');
  const [error, setError] = useState('');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isPreparingQuickAnswer, setIsPreparingQuickAnswer] = useState(false);
  const [conversationCopilotActive, setConversationCopilotActive] = useState(false);
  const [conversationSuggestions, setConversationSuggestions] = useState<ConversationSuggestion[]>([]);
  const [selectedConversationSuggestionId, setSelectedConversationSuggestionId] = useState<string | null>(null);
  const [conversationExpansion, setConversationExpansion] = useState<ConversationSuggestionExpansion | null>(null);
  const [isLoadingConversationSuggestions, setIsLoadingConversationSuggestions] = useState(false);
  const [isExpandingConversationSuggestion, setIsExpandingConversationSuggestion] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [lastSpeechAt, setLastSpeechAt] = useState(() => Date.now());

  const {
    startRecording: startSystemRecording,
    stopRecording: stopSystemRecording
  } = useAudioRecorder();
  const {
    startRecording: startMicrophoneRecording,
    stopRecording: stopMicrophoneRecording
  } = useAudioRecorder();
  const { isPinned, togglePin, handleMinimize } = useWindowControl();

  const sessionRef = useRef<InterviewSession | null>(null);
  const activeAnswerIdRef = useRef<string | null>(null);
  const persistedTurnSequencesRef = useRef(new Map<string, number>());
  const answerEventSequencesRef = useRef(new Map<string, number>());
  const captureScreenShortcutRef = useRef<() => void>(() => {});
  const quickAnswerShortcutRef = useRef<() => void>(() => {});
  const shortcutTimestampsRef = useRef({ capture: 0, quick: 0 });
  const questionDraftEditedRef = useRef(false);
  const conversationCopilotActiveRef = useRef(false);
  const conversationOptionsHoveredRef = useRef(false);
  const isLoadingConversationSuggestionsRef = useRef(false);
  const conversationRequestSequenceRef = useRef(0);
  const conversationRefreshTimerRef = useRef<number | null>(null);
  const requestConversationSuggestionsRef = useRef<() => void>(() => {});
  const audioCaptureErrorRef = useRef('');

  const setProgrammaticQuestionDraft = useCallback((value: string) => {
    questionDraftEditedRef.current = false;
    setQuestionDraft(value);
  }, []);

  const updateQuestionDraft = useCallback((value: string) => {
    questionDraftEditedRef.current = true;
    setQuestionDraft(value);
  }, []);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    activeAnswerIdRef.current = activeAnswerId;
  }, [activeAnswerId]);

  const refreshSessions = useCallback(async () => {
    const sessions = await electronService.listInterviewSessions();
    const statusOrder: Record<InterviewSession['status'], number> = {
      pending: 0,
      active: 1,
      completed: 2,
      archived: 3
    };
    setRecentSessions(
      sessions
        .filter(session => !session.isTestMode)
        .sort((a, b) => (
          statusOrder[a.status] - statusOrder[b.status]
          || String(b.updatedAt).localeCompare(String(a.updatedAt))
        ))
    );
  }, []);

  useEffect(() => {
    electronService.getSettings().then(settings => {
      if (settings?.interview) setConfig(normalizeInterviewConfig(settings.interview));
    });
    refreshSessions();
  }, [refreshSessions]);

  useEffect(() => {
    if (!session?.startedAt) {
      setElapsedSeconds(0);
      return;
    }
    const update = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - new Date(session.startedAt).getTime()) / 1000)));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [session?.startedAt]);

  const updateSessionState = useCallback((updater: (current: InterviewSession) => InterviewSession) => {
    setSession(current => {
      if (!current) return current;
      const next = updater(current);
      sessionRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    const removeDelta = electronService.onInterviewTranscriptDelta(delta => {
      if (delta.sessionId !== sessionRef.current?.id) return;
      if (String(delta.text || '').trim()) setLastSpeechAt(Date.now());
      const previousTurn = sessionRef.current.transcript.find(item => item.id === delta.turnId);

      updateSessionState(current => {
        const transcript = applyInterviewTranscriptDelta(current.transcript, delta);
        const turn = transcript.find(item => item.id === delta.turnId);
        const previousSequence = persistedTurnSequencesRef.current.get(delta.turnId) || 0;
        if (turn?.isFinal && (turn.lastSequence || 0) > previousSequence) {
          persistedTurnSequencesRef.current.set(delta.turnId, turn.lastSequence || 0);
          if (current.config.saveTranscript) {
            queueMicrotask(() => electronService.saveInterviewTurn(current.id, turn));
          }
          if (turn.source === 'interviewer' && turn.isQuestion) {
            queueMicrotask(() => {
              setSelectedTurnId(turn.id);
              if (!questionDraftEditedRef.current) {
                setProgrammaticQuestionDraft(turn.text);
              }
              setActiveAnswerId(turn.answerId || null);
            });
          }
        }
        return { ...current, transcript, updatedAt: new Date().toISOString() };
      });
      if (delta.isFinal && delta.source === 'interviewer' && conversationCopilotActiveRef.current) {
        const startedAt = new Date(previousTurn?.startedAt || delta.timestamp).getTime();
        const endedAt = new Date(delta.timestamp).getTime();
        const spokeForAtLeastTwentySeconds = endedAt - startedAt >= 20_000;
        if (spokeForAtLeastTwentySeconds || !conversationOptionsHoveredRef.current) {
          if (conversationRefreshTimerRef.current) globalThis.clearTimeout(conversationRefreshTimerRef.current);
          conversationRefreshTimerRef.current = globalThis.setTimeout(() => {
            requestConversationSuggestionsRef.current();
          }, 250);
        }
      }
    });

    const removeStatus = electronService.onInterviewTranscriptionStatus(status => {
      if (status.sessionId !== sessionRef.current?.id) return;
      setSourceStatuses(current => ({ ...current, [status.source]: status }));
      if (status.source === 'interviewer' && status.status === 'ready') {
        setFlowStatus(current => current === 'answering' ? current : 'listening');
      }
      if (status.source === 'interviewer' && status.status === 'error') {
        setError(status.error || 'Falha na transcricao em tempo real do audio do sistema.');
      }
    });

    const removeAnswer = electronService.onInterviewAnswerEvent(event => {
      if (event.sessionId !== sessionRef.current?.id) return;
      const previousSequence = answerEventSequencesRef.current.get(event.answerId) || 0;
      if (event.sequence <= previousSequence) return;
      answerEventSequencesRef.current.set(event.answerId, event.sequence);
      updateSessionState(current => {
        const answers = [...current.answers];
        const index = answers.findIndex(answer => answer.id === event.answerId);
        if (index < 0) return current;
        const answer = answers[index];
        if (event.type === 'delta' && event.text) {
          answers[index] = { ...answer, text: `${answer.text}${event.text}`, provider: event.provider || answer.provider };
        } else if (event.type === 'end') {
          answers[index] = {
            ...answer,
            text: event.text || answer.text,
            status: 'complete',
            provider: event.provider || answer.provider,
            completedAt: new Date().toISOString()
          };
        } else if (event.type === 'error') {
          answers[index] = { ...answer, status: 'failed', error: event.error || 'Falha ao responder.' };
        } else if (event.type === 'cancelled') {
          answers[index] = { ...answer, text: event.text || answer.text, status: 'cancelled' };
        }
        return { ...current, answers };
      });

      if (event.type === 'tool') setToolStatus(event.text || 'Hermes usando ferramenta');
      if (['end', 'error', 'cancelled'].includes(event.type) && activeAnswerIdRef.current === event.answerId) {
        setToolStatus('');
        setFlowStatus(sourceStatuses.interviewer?.status === 'ready' ? 'listening' : 'idle');
      }
    });

    return () => {
      removeDelta();
      removeStatus();
      removeAnswer();
    };
  }, [setProgrammaticQuestionDraft, sourceStatuses.interviewer?.status, updateSessionState]);

  const recordingChunk = useCallback((sessionId: string, source: AudioSource, samples: Float32Array) => {
    if (!sessionRef.current?.config.retainAudio) return;
    const base64 = arrayBufferToBase64(floatTo16BitPCM(samples));
    electronService.sendInterviewRecordingChunk(sessionId, source, base64);
  }, []);

  const startRecorder = useCallback(async (
    activeSession: InterviewSession,
    source: AudioSource,
    captureFrom: 'system' | 'microphone' = source === 'interviewer' ? 'system' : 'microphone'
  ) => {
    audioCaptureErrorRef.current = '';
    const startRecording = captureFrom === 'system' ? startSystemRecording : startMicrophoneRecording;
    if (activeSession.config.retainAudio) {
      await electronService.startInterviewRecording(activeSession.id, source);
    }
    return startRecording({
      isSystemAudio: captureFrom === 'system',
      onChunk: (base64, sequence) => electronService.sendInterviewAudioChunk({
        sessionId: activeSession.id,
        source,
        base64,
        sequence
      }),
      onRawChunk: samples => recordingChunk(activeSession.id, source, samples),
      onAudioStreamEnd: () => electronService.endInterviewAudioStream(activeSession.id, source),
      onError: message => {
        audioCaptureErrorRef.current = message;
      }
    });
  }, [recordingChunk, startMicrophoneRecording, startSystemRecording]);

  const startListening = useCallback(async () => {
    if (flowStatus === 'starting' || flowStatus === 'listening' || flowStatus === 'answering') return;
    setError('');
    setLastSpeechAt(Date.now());
    if (!config.title.trim()) {
      setError('Informe um título antes de iniciar.');
      return;
    }
    setFlowStatus('starting');

    try {
      let activeSession = sessionRef.current;
      if (!activeSession) {
        activeSession = await electronService.createInterviewSession(config);
        if (!activeSession) throw new Error('Nao foi possivel criar a sessao.');
        setSession(activeSession);
        sessionRef.current = activeSession;
      } else if (activeSession.status !== 'active') {
        const sessionConfig = activeSession.status === 'pending' ? config : activeSession.config;
        const resumed = await electronService.updateInterviewSession(activeSession.id, {
          status: 'active',
          startedAt: new Date().toISOString(),
          endedAt: undefined,
          hasRecording: false,
          config: sessionConfig,
          title: sessionConfig.title || activeSession.title
        });
        if (resumed) {
          activeSession = resumed;
          setSession(resumed);
          sessionRef.current = resumed;
        }
      } else {
        const refreshed = await electronService.updateInterviewSession(activeSession.id, {
          config,
          title: config.title || activeSession.title
        });
        if (refreshed) {
          activeSession = refreshed;
          setSession(refreshed);
          sessionRef.current = refreshed;
        }
      }

      const systemStarted = await electronService.startInterviewSource({
        sessionId: activeSession.id,
        source: 'interviewer',
        language: activeSession.config.language,
        provider: activeSession.config.transcriptionProvider || 'whisper-local',
        customVocabulary: buildTranscriptionVocabulary(activeSession.config)
      });
      if (!systemStarted) throw new Error('A transcricao em tempo real nao iniciou para o audio do sistema.');

      const recorderStarted = await startRecorder(activeSession, 'interviewer');
      if (!recorderStarted) throw new Error('Nao foi possivel capturar o audio do sistema.');
      const recordingSession = await electronService.updateInterviewSession(activeSession.id, {
        hasRecording: true
      });
      if (recordingSession) {
        activeSession = recordingSession;
        setSession(recordingSession);
        sessionRef.current = recordingSession;
      }

      if (activeSession.config.transcribeMicrophone) {
        const microphoneSourceStarted = await electronService.startInterviewSource({
          sessionId: activeSession.id,
          source: 'candidate',
          language: activeSession.config.language,
          provider: activeSession.config.transcriptionProvider || 'whisper-local',
          customVocabulary: buildTranscriptionVocabulary(activeSession.config)
        });
        if (microphoneSourceStarted) {
          const microphoneStarted = await startRecorder(activeSession, 'candidate');
          if (!microphoneStarted) {
            await electronService.stopInterviewSource(activeSession.id, 'candidate');
            setError(audioCaptureErrorRef.current || 'Microfone indisponível. A entrevista continua com o áudio do sistema.');
          }
        } else {
          setError('A segunda transcricao nao iniciou. A entrevista continua com o audio do sistema.');
        }
      }

      setFlowStatus('listening');
      refreshSessions();
    } catch (startError: any) {
      stopSystemRecording();
      stopMicrophoneRecording();
      if (sessionRef.current) await electronService.stopInterviewTranscription(sessionRef.current.id);
      setError(startError?.message || 'Falha ao iniciar a entrevista.');
      setFlowStatus('error');
    }
  }, [config, flowStatus, refreshSessions, startRecorder, stopMicrophoneRecording, stopSystemRecording]);

  const stopListening = useCallback(async () => {
    const activeSession = sessionRef.current;
    if (!activeSession) return;
    setFlowStatus('stopping');
    stopSystemRecording();
    stopMicrophoneRecording();
    await electronService.stopInterviewTranscription(activeSession.id);
    if (activeSession.config.retainAudio) {
      await Promise.all([
        electronService.stopInterviewRecording(activeSession.id, 'interviewer'),
        activeSession.config.transcribeMicrophone
          ? electronService.stopInterviewRecording(activeSession.id, 'candidate')
          : Promise.resolve(null)
      ]);
    }
    setSourceStatuses({});
    setFlowStatus('idle');
    refreshSessions();
  }, [refreshSessions, stopMicrophoneRecording, stopSystemRecording]);

  useEffect(() => {
    const removeStart = electronService.onStartSusurro(() => startListening());
    const removeStop = electronService.onStopSusurro(() => stopListening());
    const removeToggle = electronService.onToggleSusurroTranscriptionSignal(() => {
      if (sessionRef.current && ['listening', 'answering'].includes(flowStatus)) stopListening();
      else startListening();
    });
    return () => {
      removeStart();
      removeStop();
      removeToggle();
    };
  }, [flowStatus, startListening, stopListening]);

  const finishSession = useCallback(async (options: { forceCompleted?: boolean } = {}) => {
    const activeSession = sessionRef.current;
    if (!activeSession) return;
    if (activeAnswerIdRef.current) await electronService.cancelInterviewAnswer(activeAnswerIdRef.current);
    await stopListening();
    if (activeSession.config.saveTranscript || activeSession.config.retainAudio) {
      await Promise.all((sessionRef.current?.transcript || []).map(turn => (
        electronService.saveInterviewTurn(activeSession.id, {
          ...turn,
          text: `${turn.text}${turn.pendingText}`.trim(),
          pendingText: ''
        })
      )));
    }
    const finished = await electronService.finishInterviewSession(activeSession.id, options);
    if (finished) {
      setSession(finished);
      sessionRef.current = finished;
      setConfig(normalizeInterviewConfig(finished.config));
      setSelectedTurnId(null);
      setProgrammaticQuestionDraft('');
      setActiveAnswerId(null);
      activeAnswerIdRef.current = null;
      setSourceStatuses({});
      setFlowStatus('idle');
      setError('');
    }
    await refreshSessions();
  }, [refreshSessions, setProgrammaticQuestionDraft, stopListening]);

  const savePendingSession = useCallback(async () => {
    setError('');
    if (!config.title.trim()) {
      setError('Informe um título antes de salvar.');
      return null;
    }

    const current = sessionRef.current;
    const saved = current?.status === 'pending'
      ? await electronService.updateInterviewSession(current.id, {
          status: 'pending',
          title: config.title || current.title,
          config
        })
      : await electronService.createInterviewSession(config, { status: 'pending' });

    if (!saved) {
      setError('Não foi possível salvar a sessão pendente.');
      return null;
    }

    setSession(saved);
    sessionRef.current = saved;
    setConfig(normalizeInterviewConfig(saved.config));
    setFlowStatus('idle');
    await refreshSessions();
    return saved;
  }, [config, refreshSessions]);

  const startTestSession = useCallback(async (savedSession?: InterviewSession) => {
    if (flowStatus === 'starting' || flowStatus === 'listening' || flowStatus === 'answering') return null;
    setError('');
    setLastSpeechAt(Date.now());
    setFlowStatus('starting');

    let sourceSession = savedSession || null;
    let testSession: InterviewSession | null = null;
    try {
      if (!sourceSession) sourceSession = await savePendingSession();
      if (!sourceSession) throw new Error('Nao foi possivel salvar a entrevista pendente para teste.');
      if (sourceSession.status !== 'pending' || sourceSession.config.mode !== 'interview' || sourceSession.isTestMode) {
        throw new Error('O teste esta disponivel apenas para entrevistas pendentes.');
      }

      testSession = await electronService.createInterviewTestSession(sourceSession.id);
      if (!testSession) throw new Error('Nao foi possivel criar a sessao temporaria de teste.');
      setSession(testSession);
      sessionRef.current = testSession;
      setConfig(normalizeInterviewConfig(testSession.config));
      setProgrammaticQuestionDraft('');
      setSelectedTurnId(null);
      setActiveAnswerId(null);

      const sourceStarted = await electronService.startInterviewSource({
        sessionId: testSession.id,
        source: 'interviewer',
        language: testSession.config.language,
        provider: testSession.config.transcriptionProvider || 'whisper-local',
        customVocabulary: buildTranscriptionVocabulary(testSession.config)
      });
      if (!sourceStarted) throw new Error('A transcricao do microfone nao iniciou para o teste.');

      const microphoneStarted = await startRecorder(testSession, 'interviewer', 'microphone');
      if (!microphoneStarted) throw new Error(audioCaptureErrorRef.current || 'Não foi possível capturar o microfone para o teste.');
      const recordingSession = await electronService.updateInterviewSession(testSession.id, { hasRecording: true });
      if (recordingSession) {
        testSession = recordingSession;
        setSession(recordingSession);
        sessionRef.current = recordingSession;
      }
      setFlowStatus('listening');
      await refreshSessions();
      return testSession;
    } catch (testError) {
      stopMicrophoneRecording();
      if (testSession) {
        await electronService.stopInterviewTranscription(testSession.id);
        if (testSession.config.retainAudio) {
          await electronService.stopInterviewRecording(testSession.id, 'interviewer');
        }
        await electronService.deleteInterviewSession(testSession.id);
      }
      if (sourceSession) {
        setSession(sourceSession);
        sessionRef.current = sourceSession;
        setConfig(normalizeInterviewConfig(sourceSession.config));
      }
      setError(testError instanceof Error ? testError.message : 'Falha ao iniciar o teste da entrevista.');
      setFlowStatus('error');
      return null;
    }
  }, [flowStatus, refreshSessions, savePendingSession, setProgrammaticQuestionDraft, startRecorder, stopMicrophoneRecording]);

  const exitTestSession = useCallback(async () => {
    const testSession = sessionRef.current;
    if (!testSession?.isTestMode) return null;
    const sourceSessionId = testSession.sourceSessionId;
    await stopListening();
    await electronService.deleteInterviewSession(testSession.id);
    const pendingSession = sourceSessionId
      ? await electronService.loadInterviewSession(sourceSessionId)
      : null;
    setSession(pendingSession);
    sessionRef.current = pendingSession;
    if (pendingSession) setConfig(normalizeInterviewConfig(pendingSession.config));
    setSelectedTurnId(null);
    setProgrammaticQuestionDraft('');
    setActiveAnswerId(null);
    activeAnswerIdRef.current = null;
    setSourceStatuses({});
    setFlowStatus('idle');
    setError('');
    await refreshSessions();
    return pendingSession;
  }, [refreshSessions, setProgrammaticQuestionDraft, stopListening]);

  const newSession = useCallback(async () => {
    if (sessionRef.current?.status === 'active') await finishSession();
    setSession(null);
    sessionRef.current = null;
    setSelectedTurnId(null);
    setProgrammaticQuestionDraft('');
    setActiveAnswerId(null);
    setSourceStatuses({});
    setFlowStatus('idle');
    setError('');
    conversationCopilotActiveRef.current = false;
    setConversationCopilotActive(false);
    setConversationSuggestions([]);
    setSelectedConversationSuggestionId(null);
    setConversationExpansion(null);
  }, [finishSession, setProgrammaticQuestionDraft]);

  const selectTurn = useCallback((turn: TranscriptTurn) => {
    setSelectedTurnId(turn.id);
    setProgrammaticQuestionDraft(`${turn.text}${turn.pendingText}`.trim());
    setActiveAnswerId(turn.answerId || null);
  }, [setProgrammaticQuestionDraft]);

  const addTestConversationTurn = useCallback(async (
    source: 'interviewer' | 'candidate',
    text: string
  ) => {
    const activeSession = sessionRef.current;
    const normalizedText = String(text || '').replace(/\s+/g, ' ').trim();
    if (!activeSession?.isTestMode || !normalizedText) return;
    const now = new Date().toISOString();
    const turn: TranscriptTurn = {
      id: makeId(`test_${source}`),
      sessionId: activeSession.id,
      source,
      text: normalizedText,
      pendingText: '',
      startedAt: now,
      endedAt: now,
      isFinal: true,
      isQuestion: source === 'interviewer' && isLikelyInterviewQuestion(normalizedText)
    };
    await electronService.saveInterviewTurn(activeSession.id, turn);
    updateSessionState(current => ({
      ...current,
      transcript: [...current.transcript, turn],
      updatedAt: now
    }));
    setLastSpeechAt(Date.now());
    if (turn.isQuestion) {
      setSelectedTurnId(turn.id);
      setProgrammaticQuestionDraft(turn.text);
      setActiveAnswerId(null);
    }
  }, [setProgrammaticQuestionDraft, updateSessionState]);

  const requestAnswer = useCallback(async (
    variant: InterviewAnswerVariant = 'answer',
    answer?: Pick<InterviewAnswer, 'question' | 'turnId'>
      & { quickFragments?: string[]; quickComment?: string; visualContext?: string }
  ) => {
    const activeSession = sessionRef.current;
    if (!activeSession) return;
    const selectedTurn = activeSession.transcript.find(turn => turn.id === selectedTurnId);
    const question = String(answer?.question || questionDraft || selectedTurn?.text || '').trim();
    if (!question) return;

    if (activeAnswerIdRef.current) {
      await electronService.cancelInterviewAnswer(activeAnswerIdRef.current);
      updateSessionState(current => ({
        ...current,
        answers: current.answers.map(item => item.id === activeAnswerIdRef.current
          ? { ...item, status: item.status === 'streaming' ? 'cancelled' : item.status }
          : item)
      }));
    }

    let turnId = answer?.turnId || selectedTurn?.id;
    if (!turnId) {
      const now = new Date().toISOString();
      const manualTurn: TranscriptTurn = {
        id: makeId('manual'),
        sessionId: activeSession.id,
        source: 'manual',
        text: question,
        pendingText: '',
        startedAt: now,
        endedAt: now,
        isFinal: true,
        isQuestion: true
      };
      turnId = manualTurn.id;
      if (activeSession.config.saveTranscript) {
        await electronService.saveInterviewTurn(activeSession.id, manualTurn);
      }
      updateSessionState(current => ({ ...current, transcript: [...current.transcript, manualTurn] }));
      setSelectedTurnId(turnId);
    }

    const answerId = makeId('answer');
    const provider = 'openai';
    const nextAnswer: InterviewAnswer = {
      id: answerId,
      sessionId: activeSession.id,
      turnId,
      question,
      text: '',
      status: 'streaming',
      provider,
      variant,
      createdAt: new Date().toISOString()
    };
    updateSessionState(current => ({
      ...current,
      answers: [...current.answers, nextAnswer],
      transcript: current.transcript.map(turn => turn.id === turnId ? { ...turn, answerId } : turn)
    }));
    setActiveAnswerId(answerId);
    activeAnswerIdRef.current = answerId;
    setFlowStatus('answering');
    setToolStatus('');
    setError('');

    const result = await electronService.requestInterviewAnswer({
      sessionId: activeSession.id,
      answerId,
      turnId,
      question,
      turns: sessionRef.current?.transcript || activeSession.transcript,
      config: activeSession.config,
      visualContext: answer?.visualContext
        || sessionRef.current?.transcript.find(turn => turn.id === turnId)?.visualContext,
      sessionSummary: activeSession.summary,
      quickFragments: answer?.quickFragments,
      quickComment: answer?.quickComment,
      variant
    });

    if (!result) {
      updateSessionState(current => ({
        ...current,
        answers: current.answers.map(item => item.id === answerId
          ? { ...item, status: 'failed', error: 'O processo principal nao retornou uma resposta.' }
          : item)
      }));
      setFlowStatus('idle');
    }
  }, [questionDraft, selectedTurnId, updateSessionState]);

  const stopAnswer = useCallback(async () => {
    if (!activeAnswerIdRef.current) return;
    await electronService.cancelInterviewAnswer(activeAnswerIdRef.current);
  }, []);

  const answerLatestQuestion = useCallback(() => {
    const activeSession = sessionRef.current;
    if (!activeSession) return;

    const recentTurns = [...activeSession.transcript].reverse();
    const latestTurn = recentTurns.find(turn => (
      turn.source === 'interviewer'
      && `${turn.text}${turn.pendingText}`.trim()
    )) || recentTurns.find(turn => (
      ['screen', 'manual'].includes(turn.source)
      && `${turn.text}${turn.pendingText}`.trim()
    ));

    if (!latestTurn) {
      setError('Ainda nao ha uma pergunta transcrita para responder.');
      return;
    }

    const question = `${latestTurn.text}${latestTurn.pendingText}`.trim();
    setSelectedTurnId(latestTurn.id);
    setProgrammaticQuestionDraft(question);
    setActiveAnswerId(latestTurn.answerId || null);
    requestAnswer('answer', {
      question,
      turnId: latestTurn.id
    });
  }, [requestAnswer, setProgrammaticQuestionDraft]);

  const requestConversationSuggestions = useCallback(async (options: {
    hint?: string;
    excludeCurrent?: boolean;
  } = {}) => {
    const currentSession = sessionRef.current;
    if (!currentSession || !conversationCopilotActiveRef.current || isLoadingConversationSuggestionsRef.current) return;
    isLoadingConversationSuggestionsRef.current = true;
    setIsLoadingConversationSuggestions(true);
    setError('');
    const requestSequence = ++conversationRequestSequenceRef.current;
    try {
      await Promise.all([
        electronService.flushInterviewTranscription(currentSession.id, 'interviewer'),
        currentSession.config.transcribeMicrophone
          ? electronService.flushInterviewTranscription(currentSession.id, 'candidate')
          : Promise.resolve(false)
      ]);
      const activeSession = sessionRef.current;
      if (!activeSession) return;
      const turns = selectConversationTurns(activeSession.transcript);
      if (!turns.length) {
        setError('Ainda nao ha conversa transcrita para gerar sugestoes.');
        return;
      }
      const result = await electronService.requestConversationSuggestions({
        sessionId: activeSession.id,
        turns,
        hint: String(options.hint || '').trim(),
        excludedSuggestions: options.excludeCurrent
          ? conversationSuggestions.map(suggestion => suggestion.title)
          : undefined
      });
      if (requestSequence !== conversationRequestSequenceRef.current || !conversationCopilotActiveRef.current) return;
      setConversationSuggestions(result.suggestions);
      setSelectedConversationSuggestionId(null);
      setConversationExpansion(null);
    } catch (requestError) {
      setError(requestError instanceof Error
        ? requestError.message
        : 'Nao foi possivel gerar sugestoes para a conversa.');
    } finally {
      isLoadingConversationSuggestionsRef.current = false;
      setIsLoadingConversationSuggestions(false);
    }
  }, [conversationSuggestions]);

  requestConversationSuggestionsRef.current = () => { void requestConversationSuggestions(); };

  const setConversationOptionsHovered = useCallback((hovered: boolean) => {
    conversationOptionsHoveredRef.current = hovered;
  }, []);

  const toggleConversationCopilot = useCallback(async () => {
    const activeSession = sessionRef.current;
    if (!activeSession || activeSession.status !== 'active') return;
    if (conversationCopilotActiveRef.current) {
      conversationCopilotActiveRef.current = false;
      conversationRequestSequenceRef.current += 1;
      setConversationCopilotActive(false);
      conversationOptionsHoveredRef.current = false;
      return;
    }

    conversationCopilotActiveRef.current = true;
    setConversationCopilotActive(true);
    setError('');
    if (!activeSession.isTestMode && !activeSession.config.transcribeMicrophone) {
      const nextConfig = { ...activeSession.config, transcribeMicrophone: true };
      let sourceStarted = false;
      let recorderStarted = false;
      try {
        sourceStarted = await electronService.startInterviewSource({
          sessionId: activeSession.id,
          source: 'candidate',
          language: nextConfig.language,
          provider: nextConfig.transcriptionProvider,
          customVocabulary: buildTranscriptionVocabulary(nextConfig)
        });
        recorderStarted = sourceStarted
          ? await startRecorder({ ...activeSession, config: nextConfig }, 'candidate')
          : false;
      } catch {
        recorderStarted = false;
      }
      if (sourceStarted && recorderStarted) {
        const updated = await electronService.updateInterviewSession(activeSession.id, { config: nextConfig });
        setConfig(nextConfig);
        updateSessionState(current => ({ ...current, config: nextConfig, updatedAt: updated?.updatedAt || current.updatedAt }));
      } else {
        if (sourceStarted) await electronService.stopInterviewSource(activeSession.id, 'candidate');
        stopMicrophoneRecording();
        setError(audioCaptureErrorRef.current || 'O copiloto foi ativado, mas seu microfone nao ficou disponivel. As sugestoes usarao apenas as outras pessoas.');
      }
    }
    await requestConversationSuggestions();
  }, [requestConversationSuggestions, startRecorder, stopMicrophoneRecording, updateSessionState]);

  const expandConversationSuggestion = useCallback(async (suggestion: ConversationSuggestion) => {
    const activeSession = sessionRef.current;
    if (!activeSession || isExpandingConversationSuggestion) return;
    setSelectedConversationSuggestionId(suggestion.id);
    setConversationExpansion(null);
    setIsExpandingConversationSuggestion(true);
    setError('');
    try {
      const expansion = await electronService.expandConversationSuggestion({
        sessionId: activeSession.id,
        turns: selectConversationTurns(activeSession.transcript),
        suggestion
      });
      if (sessionRef.current?.id === activeSession.id) setConversationExpansion(expansion);
    } catch (expandError) {
      setError(expandError instanceof Error ? expandError.message : 'Nao foi possivel detalhar esta sugestao.');
    } finally {
      setIsExpandingConversationSuggestion(false);
    }
  }, [isExpandingConversationSuggestion]);

  const clearConversationSuggestion = useCallback(() => {
    setSelectedConversationSuggestionId(null);
    setConversationExpansion(null);
  }, []);

  const quickAnswer = useCallback(async () => {
    const currentSession = sessionRef.current;
    if (!currentSession || isPreparingQuickAnswer) return;
    setIsPreparingQuickAnswer(true);
    setError('');
    const quickComment = questionDraftEditedRef.current ? questionDraft.trim() : '';
    try {
      await Promise.all([
        electronService.flushInterviewTranscription(currentSession.id, 'interviewer'),
        currentSession.config.transcribeMicrophone
          ? electronService.flushInterviewTranscription(currentSession.id, 'candidate')
          : Promise.resolve(false)
      ]);
      const activeSession = sessionRef.current;
      if (!activeSession) return;

      const quickFragments = selectQuickAnswerFragments(activeSession.transcript, 5);
      const latestTurn = selectLatestQuickAnswerTurn(activeSession.transcript);

      if (!latestTurn || quickFragments.length === 0) {
        setError('Ainda nao ha conversa transcrita para gerar a resposta rapida.');
        return;
      }

      const question = quickFragments.join(' ');
      setSelectedTurnId(latestTurn.id);
      setActiveAnswerId(latestTurn.answerId || null);
      setIsPreparingQuickAnswer(false);
      await requestAnswer('quick', {
        question,
        turnId: latestTurn.id,
        quickFragments,
        quickComment
      });
    } finally {
      setIsPreparingQuickAnswer(false);
    }
  }, [isPreparingQuickAnswer, questionDraft, requestAnswer]);

  const captureScreen = useCallback(async () => {
    const activeSession = sessionRef.current;
    if (!activeSession || screenStatus === 'reading') return;
    setScreenStatus('reading');
    setError('');
    const analysis = await electronService.analyzeInterviewScreen(questionDraft);
    if (!analysis) {
      setScreenStatus('error');
      setError('OpenAI nao conseguiu ler a tela.');
      return;
    }

    const now = new Date().toISOString();
    const text = analysis.detectedQuestion || analysis.summary;
    const screenTurn: TranscriptTurn = {
      id: makeId('screen'),
      sessionId: activeSession.id,
      source: 'screen',
      text,
      pendingText: '',
      startedAt: now,
      endedAt: now,
      isFinal: true,
      isQuestion: Boolean(analysis.detectedQuestion) || isLikelyInterviewQuestion(text),
      visualContext: analysis.context
    };
    if (activeSession.config.saveTranscript) {
      await electronService.saveInterviewTurn(activeSession.id, screenTurn);
    }
    await electronService.updateInterviewSession(activeSession.id, { visualContext: analysis.context });
    updateSessionState(current => ({
      ...current,
      visualContext: analysis.context,
      transcript: [...current.transcript, screenTurn]
    }));
    setSelectedTurnId(screenTurn.id);
    setProgrammaticQuestionDraft(screenTurn.text);
    setActiveAnswerId(null);
    setScreenStatus('idle');
    await requestAnswer(
      selectScreenAnswerVariant(activeSession.config.mode, analysis.programmingQuestionVisible),
      {
        question: screenTurn.text,
        turnId: screenTurn.id,
        visualContext: analysis.context
      }
    );
  }, [questionDraft, requestAnswer, screenStatus, setProgrammaticQuestionDraft, updateSessionState]);

  captureScreenShortcutRef.current = () => { void captureScreen(); };
  quickAnswerShortcutRef.current = () => { void quickAnswer(); };

  const invokeInterviewShortcut = useCallback((action: 'capture' | 'quick') => {
    const activeSession = sessionRef.current;
    if (!canUseInterviewActionShortcut(activeSession?.status, activeSession?.config.mode)) return false;

    const now = Date.now();
    if (now - shortcutTimestampsRef.current[action] < 300) return true;
    shortcutTimestampsRef.current[action] = now;

    if (action === 'capture') captureScreenShortcutRef.current();
    else quickAnswerShortcutRef.current();
    return true;
  }, []);

  const summarizeSession = useCallback(async () => {
    const activeSession = sessionRef.current;
    if (!activeSession || isSummarizing) return;
    if (!activeSession.config.saveTranscript) {
      setError('Ative "Salvar transcrição" para gerar um resumo reutilizável.');
      return;
    }
    setIsSummarizing(true);
    setError('');
    await Promise.all(activeSession.transcript.map(turn => (
      electronService.saveInterviewTurn(activeSession.id, {
        ...turn,
        text: `${turn.text}${turn.pendingText}`.trim(),
        pendingText: ''
      })
    )));
    const summarized = await electronService.summarizeInterviewSession(activeSession.id);
    if (summarized) {
      setSession(summarized);
      sessionRef.current = summarized;
    } else {
      setError('Nao foi possivel resumir a transcrição.');
    }
    setIsSummarizing(false);
  }, [isSummarizing]);

  const loadSession = useCallback((loaded: InterviewSession) => {
    const normalized = {
      ...loaded,
      config: normalizeInterviewConfig(loaded.config)
    };
    setSession(normalized);
    sessionRef.current = normalized;
    setConfig(normalized.config);
    const latestQuestion = [...normalized.transcript].reverse().find(turn => turn.isQuestion)
      || [...normalized.transcript].reverse().find(turn => turn.source === 'interviewer');
    setSelectedTurnId(latestQuestion?.id || null);
    setProgrammaticQuestionDraft(latestQuestion?.text || '');
    setActiveAnswerId(latestQuestion?.answerId || normalized.answers.at(-1)?.id || null);
    setFlowStatus('idle');
    setError('');
    setLastSpeechAt(Date.now());
    conversationCopilotActiveRef.current = false;
    setConversationCopilotActive(false);
    setConversationSuggestions([]);
    setSelectedConversationSuggestionId(null);
    setConversationExpansion(null);
  }, [setProgrammaticQuestionDraft]);

  const archiveSession = useCallback(async (sessionId: string) => {
    await electronService.archiveInterviewSession(sessionId);
    if (sessionRef.current?.id === sessionId) await newSession();
    refreshSessions();
  }, [newSession, refreshSessions]);

  const deleteSession = useCallback(async (target: InterviewSession) => {
    const action = target.status === 'pending' ? 'cancelada e excluida' : 'excluida';
    const confirmed = globalThis.confirm(
      `"${target.title}" sera ${action} permanentemente.\n\n`
      + 'Transcricao, respostas, resumo e gravacoes salvas serao apagados. Esta acao nao pode ser desfeita.'
    );
    if (!confirmed) return false;

    const isCurrent = sessionRef.current?.id === target.id;
    if (isCurrent) {
      stopSystemRecording();
      stopMicrophoneRecording();
      if (activeAnswerIdRef.current) {
        await electronService.cancelInterviewAnswer(activeAnswerIdRef.current);
      }
    }

    const deleted = await electronService.deleteInterviewSession(target.id);
    if (!deleted) {
      setError('Nao foi possivel excluir a entrevista.');
      return false;
    }

    if (isCurrent) {
      setSession(null);
      sessionRef.current = null;
      setSelectedTurnId(null);
      setProgrammaticQuestionDraft('');
      setActiveAnswerId(null);
      activeAnswerIdRef.current = null;
      setSourceStatuses({});
      setFlowStatus('idle');
      setError('');
    }
    await refreshSessions();
    return true;
  }, [refreshSessions, setProgrammaticQuestionDraft, stopMicrophoneRecording, stopSystemRecording]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && options.onClosePanel) {
        options.onClosePanel();
        return;
      }
      if (event.repeat) return;

      const key = event.key.toUpperCase();
      const action = key === 'F4' ? 'quick' : key === 'F5' ? 'capture' : null;
      if (action && invokeInterviewShortcut(action)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    globalThis.addEventListener('keydown', handleKeyDown, true);
    return () => globalThis.removeEventListener('keydown', handleKeyDown, true);
  }, [invokeInterviewShortcut, options.onClosePanel]);

  useEffect(() => electronService.onInterviewCaptureShortcut(() => {
    invokeInterviewShortcut('capture');
  }), [invokeInterviewShortcut]);

  useEffect(() => electronService.onInterviewQuickAnswerShortcut(() => {
    invokeInterviewShortcut('quick');
  }), [invokeInterviewShortcut]);

  useEffect(() => () => {
    if (conversationRefreshTimerRef.current) globalThis.clearTimeout(conversationRefreshTimerRef.current);
    stopSystemRecording();
    stopMicrophoneRecording();
    if (sessionRef.current?.status === 'active') {
      electronService.stopInterviewTranscription(sessionRef.current.id);
      if (sessionRef.current.config.retainAudio) {
        electronService.stopInterviewRecording(sessionRef.current.id, 'interviewer');
        if (sessionRef.current.config.transcribeMicrophone) {
          electronService.stopInterviewRecording(sessionRef.current.id, 'candidate');
        }
      }
    }
  }, [stopMicrophoneRecording, stopSystemRecording]);

  const selectedTurn = useMemo(
    () => session?.transcript.find(turn => turn.id === selectedTurnId) || null,
    [selectedTurnId, session?.transcript]
  );
  const activeAnswer = useMemo(
    () => session?.answers.find(answer => answer.id === activeAnswerId) || null,
    [activeAnswerId, session?.answers]
  );
  const canAnswerLatestQuestion = useMemo(
    () => Boolean(session?.transcript.some(turn => (
      ['interviewer', 'screen', 'manual'].includes(turn.source)
      && `${turn.text}${turn.pendingText}`.trim()
    ))),
    [session?.transcript]
  );

  return {
    config,
    setConfig,
    session,
    recentSessions,
    flowStatus,
    sourceStatuses,
    selectedTurn,
    selectedTurnId,
    questionDraft,
    setQuestionDraft: updateQuestionDraft,
    activeAnswer,
    toolStatus,
    screenStatus,
    error,
    elapsedSeconds,
    isPinned,
    togglePin,
    handleMinimize,
    startListening,
    stopListening,
    finishSession,
    savePendingSession,
    startTestSession,
    exitTestSession,
    newSession,
    selectTurn,
    addTestConversationTurn,
    requestAnswer,
    answerLatestQuestion,
    quickAnswer,
    isPreparingQuickAnswer,
    conversationCopilotActive,
    conversationSuggestions,
    selectedConversationSuggestionId,
    conversationExpansion,
    isLoadingConversationSuggestions,
    isExpandingConversationSuggestion,
    toggleConversationCopilot,
    requestConversationSuggestions,
    expandConversationSuggestion,
    clearConversationSuggestion,
    setConversationOptionsHovered,
    isSummarizing,
    lastSpeechAt,
    markMeetingActive: () => setLastSpeechAt(Date.now()),
    canAnswerLatestQuestion,
    stopAnswer,
    captureScreen,
    summarizeSession,
    loadSession,
    archiveSession,
    deleteSession
  };
};
