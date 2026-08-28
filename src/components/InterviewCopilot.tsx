import React, { useEffect, useState } from 'react';
import {
  Check,
  Headphones,
  Mic,
  Minus,
  Pin,
  PinOff,
  Radio,
  SlidersHorizontal,
  Zap
} from 'lucide-react';
import { useInterviewCopilot } from '../hooks/useInterviewCopilot';
import { formatTime } from '../utils/formatters';
import { electronService } from '../services/electron';
import { InterviewSetup } from './interview/InterviewSetup';
import { InterviewTranscript } from './interview/InterviewTranscript';
import { InterviewAnswerPane } from './interview/InterviewAnswerPane';
import { InterviewList } from './interview/InterviewList';
import { InterviewDetails } from './interview/InterviewDetails';
import { DEFAULT_INTERVIEW_CONFIG, InterviewContextDocument, InterviewSession } from '../types/interview';
import { InterviewDocuments } from './interview/InterviewDocuments';
import { WhiteboardGuidancePane } from './interview/WhiteboardGuidancePane';
import { getMeetingInactivityState } from '../utils/interview';

interface InterviewCopilotProps {
  embedded?: boolean;
  onClosePanel?: () => void;
}

const InterviewCopilot: React.FC<InterviewCopilotProps> = ({ embedded = false, onClosePanel }) => {
  const copilot = useInterviewCopilot({ embedded, onClosePanel });
  const [view, setView] = useState<'list' | 'form' | 'live' | 'details' | 'documents'>('list');
  const [isContextOpen, setIsContextOpen] = useState(false);
  const [startSessionId, setStartSessionId] = useState<string | null>(null);
  const [documents, setDocuments] = useState<InterviewContextDocument[]>([]);
  const [inactivityWarningAt, setInactivityWarningAt] = useState<number | null>(null);
  const [isAutoFinishing, setIsAutoFinishing] = useState(false);

  const refreshDocuments = async () => setDocuments(await electronService.listInterviewDocuments());

  useEffect(() => { void refreshDocuments(); }, []);

  useEffect(() => {
    if (embedded) return;
    let cancelled = false;
    const applyOpacity = (configuredOpacity: number) => {
      if (cancelled) return;
      void electronService.setCurrentWindowOpacity(view === 'live' ? configuredOpacity : 1);
    };
    void electronService.getSettings().then(settings => {
      applyOpacity(settings?.general?.windowOpacity ?? 0.9);
    });
    const unsubscribe = electronService.onSettingsUpdated(settings => {
      applyOpacity(settings.general.windowOpacity ?? 0.9);
    });
    return () => { cancelled = true; unsubscribe(); };
  }, [embedded, view]);

  useEffect(() => {
    if (copilot.session?.status === 'active') setView('live');
    if (copilot.session?.status === 'completed') setView('details');
  }, [copilot.session?.id, copilot.session?.status]);

  useEffect(() => {
    if (!startSessionId || copilot.session?.id !== startSessionId) return;
    setStartSessionId(null);
    void copilot.startListening();
  }, [copilot.session?.id, copilot.startListening, startSessionId]);

  const openSession = (session: InterviewSession) => {
    copilot.loadSession(session);
    setView(session.status === 'completed' ? 'details' : session.status === 'active' ? 'live' : 'form');
  };

  const createSession = async () => {
    await copilot.newSession();
    copilot.setConfig({ ...DEFAULT_INTERVIEW_CONFIG });
    setView('form');
  };

  const returnToList = async () => {
    if (copilot.session?.status !== 'active') await copilot.newSession();
    setView('list');
  };

  const finishAndReturnToList = async (forceCompleted = false) => {
    await copilot.finishSession({ forceCompleted });
    setIsContextOpen(false);
    setInactivityWarningAt(null);
    setView('list');
  };

  useEffect(() => {
    if (view !== 'live' || copilot.session?.status !== 'active') {
      setInactivityWarningAt(null);
      return;
    }
    const check = () => {
      const state = getMeetingInactivityState(copilot.lastSpeechAt, inactivityWarningAt);
      if (state === 'active' && inactivityWarningAt !== null) setInactivityWarningAt(null);
      if (state === 'warning' && inactivityWarningAt === null) setInactivityWarningAt(Date.now());
      if (state === 'finish' && !isAutoFinishing) {
        setIsAutoFinishing(true);
        void finishAndReturnToList(true).finally(() => setIsAutoFinishing(false));
      }
    };
    check();
    const timer = globalThis.setInterval(check, 1000);
    return () => globalThis.clearInterval(timer);
  }, [copilot.lastSpeechAt, copilot.session?.status, inactivityWarningAt, isAutoFinishing, view]);

  return (
    <div className={`app-container interview-copilot ${embedded ? 'embedded-susurro' : ''}`}>
      <header className="interview-header">
        <div className="interview-header-title">
          <Radio size={16} />
          <span>{view === 'live' ? copilot.session?.title : 'Metis · Reuniões'}</span>
          {view === 'live' && copilot.session?.status === 'active' && (
            <time>{formatTime(copilot.elapsedSeconds)}</time>
          )}
        </div>

        {view === 'live' && copilot.session?.status === 'active' && (
          <div className="interview-source-statuses">
            <span
              className={`source-status status-${copilot.sourceStatuses.interviewer?.status || 'idle'}`}
              title="Whisper local, privado e sem custo de API"
            >
              <Headphones size={12} /> Sistema
            </span>
            {copilot.session.config.transcribeMicrophone && (
              <span className={`source-status status-${copilot.sourceStatuses.candidate?.status || 'idle'}`}>
                <Mic size={12} /> Voce
              </span>
            )}
          </div>
        )}

        <div className="interview-header-actions">
          {view === 'live' && copilot.session?.status === 'active' && (
            <>
              <button
                type="button"
                className={`interview-icon-button ${isContextOpen ? 'active' : ''}`}
                onClick={() => setIsContextOpen(open => !open)}
                title="Contexto da reunião"
              >
                <SlidersHorizontal size={15} />
              </button>
              <button
                type="button"
                className="interview-quick-answer-button"
                onClick={copilot.quickAnswer}
                disabled={copilot.isPreparingQuickAnswer}
                title={copilot.session.config.interviewFormat === 'whiteboard' ? 'Capturar o quadro e avançar a orientação' : 'Atualizar a transcrição e gerar uma resposta rápida'}
              >
                <Zap size={14} />
                {copilot.isPreparingQuickAnswer
                  ? (copilot.session.config.interviewFormat === 'whiteboard' ? 'Analisando' : 'Preparando')
                  : (copilot.session.config.interviewFormat === 'whiteboard' ? 'Avançar orientação' : 'Resposta rapida')}
              </button>
              <button type="button" className="interview-finish-button" onClick={() => finishAndReturnToList()} title="Finalizar reunião"><Check size={15} /> Finalizar</button>
            </>
          )}
          {!embedded && (
            <button type="button" className="interview-icon-button" onClick={copilot.togglePin} title="Sempre no topo">
              {copilot.isPinned ? <PinOff size={15} /> : <Pin size={15} />}
            </button>
          )}
          <button
            type="button"
            className="interview-icon-button"
            onClick={copilot.handleMinimize}
            title="Minimizar e continuar"
          >
            <Minus size={16} />
          </button>
        </div>
      </header>

      {view === 'list' && (
        <InterviewList
          sessions={copilot.recentSessions}
          onCreate={createSession}
          onOpen={openSession}
          onEdit={openSession}
          onStart={session => {
            copilot.loadSession(session);
            if (session.status === 'active') setView('live');
            else setStartSessionId(session.id);
          }}
          onArchive={copilot.archiveSession}
          onDelete={copilot.deleteSession}
          onDocuments={() => setView('documents')}
        />
      )}
      {view === 'documents' && <InterviewDocuments
        documents={documents}
        onBack={() => setView('list')}
        onSave={async document => {
          await electronService.saveInterviewDocument(document);
          await refreshDocuments();
        }}
        onDelete={async document => {
          if (!globalThis.confirm(`Excluir o documento "${document.title}"? As reuniões deixarão de usar este contexto.`)) return;
          if (await electronService.deleteInterviewDocument(document.id)) await refreshDocuments();
        }}
      />}
      {view === 'form' && (
        <InterviewSetup
          config={copilot.config}
          error={copilot.error}
          isEditing={copilot.session?.status === 'pending'}
          onConfigChange={copilot.setConfig}
          onStart={copilot.startListening}
          onSavePending={async () => { const saved = await copilot.savePendingSession(); if (saved) setView('list'); }}
          onCancel={returnToList}
          documents={documents}
        />
      )}
      {view === 'details' && copilot.session?.status === 'completed' && (
        <InterviewDetails
          session={copilot.session}
          isSummarizing={copilot.isSummarizing}
          onBack={returnToList}
          onSummarize={copilot.summarizeSession}
          onArchive={async () => { await copilot.archiveSession(copilot.session!.id); setView('list'); }}
          onDelete={async () => { const deleted = await copilot.deleteSession(copilot.session!); if (deleted) setView('list'); }}
        />
      )}
      {view === 'live' && copilot.session?.status === 'active' && (
        <>
          {inactivityWarningAt !== null && <div className="interview-inactivity-backdrop" role="dialog" aria-modal="true" aria-labelledby="inactivity-title">
            <div className="interview-inactivity-dialog">
              <span className="interview-inactivity-icon"><Radio size={19} /></span>
              <h2 id="inactivity-title">Esta reunião ainda está ativa?</h2>
              <p>Não detectamos nenhuma fala nos últimos 5 minutos. Se não houver fala ou ação nos próximos 5 minutos, a reunião será finalizada automaticamente.</p>
              <div><button type="button" className="interview-cancel-button" onClick={() => finishAndReturnToList(true)}>Finalizar agora</button><button type="button" className="interview-primary-button" onClick={() => { copilot.markMeetingActive(); setInactivityWarningAt(null); }}>Continuar reunião</button></div>
            </div>
          </div>}
          {isContextOpen && (
            <div className="interview-context-strip">
              <span><strong>Tipo</strong>{copilot.session.config.mode === 'interview' ? 'Entrevista' : 'Reunião'}</span>
              {copilot.session.config.mode === 'interview' && <span><strong>Formato</strong>{copilot.session.config.interviewFormat === 'whiteboard' ? 'Whiteboard' : 'Tradicional'}</span>}
              <span><strong>Título</strong>{copilot.session.config.title || copilot.session.title}</span>
              {copilot.session.config.mode === 'interview' && (
                <span><strong>Cargo / Empresa</strong>{[copilot.session.config.role, copilot.session.config.company].filter(Boolean).join(' / ') || 'Nao informado'}</span>
              )}
              {copilot.session.config.mode === 'meeting' && copilot.session.config.company && (
                <span><strong>Empresa / pessoa</strong>{copilot.session.config.company}</span>
              )}
              <span><strong>Idioma</strong>{copilot.session.config.language}</span>
              <span><strong>Estilo</strong>{copilot.session.config.answerStyle}</span>
            </div>
          )}

          {copilot.error && <div className="interview-error-banner">{copilot.error}</div>}
          {copilot.session.summary && (
            <div className="interview-summary">
              <strong>Resumo da reunião</strong>
              <div>{copilot.session.summary}</div>
            </div>
          )}
          <main className="interview-workspace">
            <section className="interview-transcript-pane">
              <div className="interview-pane-heading">
                <span>Transcricao</span>
                <small>{copilot.session.transcript.length} turnos</small>
              </div>
              <InterviewTranscript
                turns={copilot.session.transcript}
                selectedTurnId={copilot.selectedTurnId}
                onSelect={copilot.selectTurn}
                onAnswer={turn => {
                  copilot.selectTurn(turn);
                  copilot.requestAnswer('answer', {
                    question: `${turn.text}${turn.pendingText}`.trim(),
                    turnId: turn.id
                  });
                }}
              />
            </section>

            <section className="interview-response-pane">
              <div className="interview-pane-heading">
                <span>{copilot.session.config.interviewFormat === 'whiteboard' ? 'Orientação Whiteboard' : 'Resposta'}</span>
                {copilot.session.config.mode === 'interview' && <div className="interview-live-format-switch" role="group" aria-label="Formato atual da entrevista">
                  <button
                    type="button"
                    className={copilot.session.config.interviewFormat === 'standard' ? 'active' : ''}
                    onClick={() => copilot.switchInterviewFormat('standard')}
                    disabled={copilot.isSwitchingInterviewFormat || copilot.isAdvancingWhiteboard}
                  >Tradicional</button>
                  <button
                    type="button"
                    className={copilot.session.config.interviewFormat === 'whiteboard' ? 'active' : ''}
                    onClick={() => copilot.switchInterviewFormat('whiteboard')}
                    disabled={copilot.isSwitchingInterviewFormat || copilot.isAdvancingWhiteboard}
                  >Whiteboard</button>
                </div>}
              </div>
              {copilot.session.config.interviewFormat === 'whiteboard' ? <WhiteboardGuidancePane
                state={copilot.session.whiteboardState}
                comment={copilot.questionDraft}
                isAnalyzing={copilot.isAdvancingWhiteboard}
                onCommentChange={copilot.setQuestionDraft}
                onAdvance={copilot.advanceWhiteboard}
              /> : <InterviewAnswerPane
                question={copilot.questionDraft}
                answer={copilot.activeAnswer}
                toolStatus={copilot.toolStatus}
                onQuestionChange={copilot.setQuestionDraft}
                onAnswer={copilot.requestAnswer}
                onStop={copilot.stopAnswer}
                onCopy={text => electronService.copyToClipboard(text)}
                screenStatus={copilot.screenStatus}
                onCaptureScreen={copilot.captureScreen}
              />}
            </section>
          </main>
        </>
      )}
    </div>
  );
};

export default InterviewCopilot;
