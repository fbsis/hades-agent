import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_INTERVIEW_CONFIG,
  InterviewAnswer,
  InterviewAnswerVariant,
  InterviewConfig,
  InterviewFlowStatus,
  InterviewSession,
  InterviewTranscriptionStatus,
  TranscriptTurn
} from '../types/interview';
import { applyInterviewTranscriptDelta, isLikelyInterviewQuestion } from '../utils/interview';
import { arrayBufferToBase64, floatTo16BitPCM } from '../utils/audio';
import { electronService } from '../services/electron';
import { useAudioRecorder } from './useAudioRecorder';
import { useWindowControl } from './useWindowControl';

type AudioSource = 'interviewer' | 'candidate';

const makeId = (prefix: string) => {
  const suffix = globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  return `${prefix}_${suffix}`;
};

const isEditableTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
};

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

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    activeAnswerIdRef.current = activeAnswerId;
  }, [activeAnswerId]);

  const refreshSessions = useCallback(async () => {
    const sessions = await electronService.listInterviewSessions();
    setRecentSessions(sessions.filter(item => item.status !== 'archived').slice(0, 8));
  }, []);

  useEffect(() => {
    electronService.getSettings().then(settings => {
      if (settings?.interview) setConfig({ ...DEFAULT_INTERVIEW_CONFIG, ...settings.interview });
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

      updateSessionState(current => {
        const transcript = applyInterviewTranscriptDelta(current.transcript, delta);
        const turn = transcript.find(item => item.id === delta.turnId);
        const previousSequence = persistedTurnSequencesRef.current.get(delta.turnId) || 0;
        if (turn?.isFinal && (turn.lastSequence || 0) > previousSequence) {
          persistedTurnSequencesRef.current.set(delta.turnId, turn.lastSequence || 0);
          queueMicrotask(() => electronService.saveInterviewTurn(current.id, turn));
          if (turn.source === 'interviewer' && turn.isQuestion) {
            queueMicrotask(() => {
              setSelectedTurnId(turn.id);
              setQuestionDraft(turn.text);
              setActiveAnswerId(turn.answerId || null);
            });
          }
        }
        return { ...current, transcript, updatedAt: new Date().toISOString() };
      });
    });

    const removeStatus = electronService.onInterviewTranscriptionStatus(status => {
      if (status.sessionId !== sessionRef.current?.id) return;
      setSourceStatuses(current => ({ ...current, [status.source]: status }));
      if (status.source === 'interviewer' && status.status === 'ready') {
        setFlowStatus(current => current === 'answering' ? current : 'listening');
      }
      if (status.source === 'interviewer' && status.status === 'error') {
        setError(status.error || 'Falha na transcricao do audio do sistema.');
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
  }, [sourceStatuses.interviewer?.status, updateSessionState]);

  const recordingChunk = useCallback((sessionId: string, source: AudioSource, samples: Float32Array) => {
    if (!sessionRef.current?.config.retainAudio) return;
    const base64 = arrayBufferToBase64(floatTo16BitPCM(samples));
    electronService.sendInterviewRecordingChunk(sessionId, source, base64);
  }, []);

  const startRecorder = useCallback(async (activeSession: InterviewSession, source: AudioSource) => {
    const startRecording = source === 'interviewer' ? startSystemRecording : startMicrophoneRecording;
    if (activeSession.config.retainAudio) {
      await electronService.startInterviewRecording(activeSession.id, source);
    }
    return startRecording({
      isSystemAudio: source === 'interviewer',
      onChunk: (base64, sequence) => electronService.sendInterviewAudioChunk({
        sessionId: activeSession.id,
        source,
        base64,
        sequence
      }),
      onRawChunk: samples => recordingChunk(activeSession.id, source, samples),
      onAudioStreamEnd: () => electronService.endInterviewAudioStream(activeSession.id, source)
    });
  }, [recordingChunk, startMicrophoneRecording, startSystemRecording]);

  const startListening = useCallback(async () => {
    if (flowStatus === 'starting' || flowStatus === 'listening' || flowStatus === 'answering') return;
    setError('');
    setFlowStatus('starting');

    try {
      let activeSession = sessionRef.current;
      if (!activeSession) {
        activeSession = await electronService.createInterviewSession(config);
        if (!activeSession) throw new Error('Nao foi possivel criar a sessao.');
        setSession(activeSession);
        sessionRef.current = activeSession;
      } else if (activeSession.status !== 'active') {
        const resumed = await electronService.updateInterviewSession(activeSession.id, { status: 'active' });
        if (resumed) {
          activeSession = resumed;
          setSession(resumed);
          sessionRef.current = resumed;
        }
      }

      const systemStarted = await electronService.startInterviewSource({
        sessionId: activeSession.id,
        source: 'interviewer',
        language: activeSession.config.language
      });
      if (!systemStarted) throw new Error('Gemini Live nao iniciou para o audio do sistema.');

      const recorderStarted = await startRecorder(activeSession, 'interviewer');
      if (!recorderStarted) throw new Error('Nao foi possivel capturar o audio do sistema.');

      if (activeSession.config.transcribeMicrophone) {
        const microphoneSourceStarted = await electronService.startInterviewSource({
          sessionId: activeSession.id,
          source: 'candidate',
          language: activeSession.config.language
        });
        if (microphoneSourceStarted) {
          const microphoneStarted = await startRecorder(activeSession, 'candidate');
          if (!microphoneStarted) {
            await electronService.stopInterviewSource(activeSession.id, 'candidate');
            setError('Microfone indisponivel. A entrevista continua com o audio do sistema.');
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

  const finishSession = useCallback(async () => {
    const activeSession = sessionRef.current;
    if (!activeSession) return;
    if (activeAnswerIdRef.current) await electronService.cancelInterviewAnswer(activeAnswerIdRef.current);
    await stopListening();
    const finished = await electronService.finishInterviewSession(activeSession.id);
    if (finished) setSession(finished);
    refreshSessions();
  }, [refreshSessions, stopListening]);

  const newSession = useCallback(async () => {
    if (sessionRef.current?.status === 'active') await finishSession();
    setSession(null);
    sessionRef.current = null;
    setSelectedTurnId(null);
    setQuestionDraft('');
    setActiveAnswerId(null);
    setSourceStatuses({});
    setFlowStatus('idle');
    setError('');
  }, [finishSession]);

  const selectTurn = useCallback((turn: TranscriptTurn) => {
    setSelectedTurnId(turn.id);
    setQuestionDraft(`${turn.text}${turn.pendingText}`.trim());
    setActiveAnswerId(turn.answerId || null);
  }, []);

  const requestAnswer = useCallback(async (
    variant: InterviewAnswerVariant = 'answer',
    answer?: Pick<InterviewAnswer, 'question' | 'turnId'>
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
      await electronService.saveInterviewTurn(activeSession.id, manualTurn);
      updateSessionState(current => ({ ...current, transcript: [...current.transcript, manualTurn] }));
      setSelectedTurnId(turnId);
    }

    const answerId = makeId('answer');
    const nextAnswer: InterviewAnswer = {
      id: answerId,
      sessionId: activeSession.id,
      turnId,
      question,
      text: '',
      status: 'streaming',
      provider: 'hermes',
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
      visualContext: sessionRef.current?.transcript.find(turn => turn.id === turnId)?.visualContext,
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

  const captureScreen = useCallback(async () => {
    const activeSession = sessionRef.current;
    if (!activeSession || screenStatus === 'reading') return;
    setScreenStatus('reading');
    setError('');
    const analysis = await electronService.analyzeInterviewScreen(questionDraft);
    if (!analysis) {
      setScreenStatus('error');
      setError('Gemini nao conseguiu ler a tela.');
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
    await electronService.saveInterviewTurn(activeSession.id, screenTurn);
    await electronService.updateInterviewSession(activeSession.id, { visualContext: analysis.context });
    updateSessionState(current => ({
      ...current,
      visualContext: analysis.context,
      transcript: [...current.transcript, screenTurn]
    }));
    setSelectedTurnId(screenTurn.id);
    setQuestionDraft(screenTurn.text);
    setActiveAnswerId(null);
    setScreenStatus('idle');
  }, [questionDraft, screenStatus, updateSessionState]);

  const loadSession = useCallback((loaded: InterviewSession) => {
    setSession(loaded);
    sessionRef.current = loaded;
    setConfig({ ...DEFAULT_INTERVIEW_CONFIG, ...loaded.config });
    const latestQuestion = [...loaded.transcript].reverse().find(turn => turn.isQuestion)
      || [...loaded.transcript].reverse().find(turn => turn.source === 'interviewer');
    setSelectedTurnId(latestQuestion?.id || null);
    setQuestionDraft(latestQuestion?.text || '');
    setActiveAnswerId(latestQuestion?.answerId || loaded.answers.at(-1)?.id || null);
    setFlowStatus('idle');
    setError('');
  }, []);

  const archiveSession = useCallback(async (sessionId: string) => {
    await electronService.archiveInterviewSession(sessionId);
    if (sessionRef.current?.id === sessionId) await newSession();
    refreshSessions();
  }, [newSession, refreshSessions]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && options.onClosePanel) {
        options.onClosePanel();
        return;
      }
      if (event.code === 'Space' && !isEditableTarget(event.target) && sessionRef.current) {
        event.preventDefault();
        requestAnswer('answer');
      }
    };
    globalThis.addEventListener('keydown', handleKeyDown);
    return () => globalThis.removeEventListener('keydown', handleKeyDown);
  }, [options.onClosePanel, requestAnswer]);

  useEffect(() => () => {
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
    setQuestionDraft,
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
    newSession,
    selectTurn,
    requestAnswer,
    stopAnswer,
    captureScreen,
    loadSession,
    archiveSession
  };
};
