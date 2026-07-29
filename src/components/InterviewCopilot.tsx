import React, { useState } from 'react';
import {
  Check,
  FileText,
  Headphones,
  Mic,
  Minus,
  Pin,
  PinOff,
  Plus,
  Radio,
  SlidersHorizontal,
  Trash2,
  Zap
} from 'lucide-react';
import { useInterviewCopilot } from '../hooks/useInterviewCopilot';
import { formatTime } from '../utils/formatters';
import { electronService } from '../services/electron';
import { InterviewSetup } from './interview/InterviewSetup';
import { InterviewTranscript } from './interview/InterviewTranscript';
import { InterviewAnswerPane } from './interview/InterviewAnswerPane';

interface InterviewCopilotProps {
  embedded?: boolean;
  onClosePanel?: () => void;
}

const InterviewCopilot: React.FC<InterviewCopilotProps> = ({ embedded = false, onClosePanel }) => {
  const copilot = useInterviewCopilot({ embedded, onClosePanel });
  const [isContextOpen, setIsContextOpen] = useState(false);
  return (
    <div className={`app-container interview-copilot ${embedded ? 'embedded-susurro' : ''}`}>
      <header className="interview-header">
        <div className="interview-header-title">
          <Radio size={16} />
          <span>{copilot.session?.title || 'Reunião'}</span>
          {copilot.session?.status === 'pending' && (
            <span className="interview-header-status">Pendente</span>
          )}
          {copilot.session?.status === 'active' && (
            <time>{formatTime(copilot.elapsedSeconds)}</time>
          )}
        </div>

        {copilot.session?.status === 'active' && (
          <div className="interview-source-statuses">
            <span
              className={`source-status status-${copilot.sourceStatuses.interviewer?.status || 'idle'}`}
              title={copilot.sourceStatuses.interviewer?.provider === 'google-cloud'
                ? 'Google Cloud Speech-to-Text com resultados intermediarios'
                : copilot.sourceStatuses.interviewer?.provider === 'whisper-local'
                  ? 'Whisper local, privado e sem custo de API'
                  : 'Gemini Live'}
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
          {copilot.session?.status === 'pending' && (
            <>
              <button type="button" className="interview-icon-button" onClick={copilot.newSession} title="Nova reunião">
                <Plus size={15} />
              </button>
              <button
                type="button"
                className="interview-icon-button danger"
                onClick={() => copilot.deleteSession(copilot.session!)}
                title="Cancelar e excluir permanentemente"
              >
                <Trash2 size={15} />
              </button>
            </>
          )}
          {copilot.session && copilot.session.status !== 'pending' && (
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
                title="Atualizar a transcricao e gerar um resumo com ate cinco topicos"
              >
                <Zap size={14} />
                {copilot.isPreparingQuickAnswer ? 'Preparando' : 'Resposta rapida'}
              </button>
              <button
                type="button"
                className="interview-icon-button"
                onClick={copilot.summarizeSession}
                disabled={copilot.isSummarizing || !copilot.session.transcript.length}
                title={copilot.isSummarizing ? 'Resumindo transcrição' : 'Resumir transcrição'}
              >
                <FileText className={copilot.isSummarizing ? 'spin' : ''} size={15} />
              </button>
              <button type="button" className="interview-icon-button" onClick={copilot.newSession} title="Nova reunião">
                <Plus size={15} />
              </button>
              <button
                type="button"
                className="interview-icon-button danger"
                onClick={() => copilot.deleteSession(copilot.session!)}
                title="Excluir permanentemente"
              >
                <Trash2 size={15} />
              </button>
              {copilot.session.status === 'active' && (
                <button type="button" className="interview-icon-button" onClick={copilot.finishSession} title="Finalizar reunião">
                  <Check size={15} />
                </button>
              )}
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

      {!copilot.session || copilot.session.status === 'pending' ? (
        <InterviewSetup
          config={copilot.config}
          recentSessions={copilot.recentSessions}
          error={copilot.error}
          cloudAuthStatus={copilot.cloudAuthStatus}
          isAuthenticatingCloud={copilot.isAuthenticatingCloud}
          pendingSession={copilot.session?.status === 'pending' ? copilot.session : null}
          onConfigChange={copilot.setConfig}
          onAuthenticateCloud={copilot.authenticateGoogleCloud}
          onOpenCloudDataLogging={copilot.openCloudDataLogging}
          onStart={copilot.startListening}
          onSavePending={copilot.savePendingSession}
          onLoadSession={copilot.loadSession}
          onArchiveSession={copilot.archiveSession}
          onDeleteSession={copilot.deleteSession}
        />
      ) : (
        <>
          {isContextOpen && (
            <div className="interview-context-strip">
              <span><strong>Tipo</strong>{copilot.session.config.mode === 'interview' ? 'Entrevista' : 'Reunião'}</span>
              <span><strong>Título</strong>{copilot.session.config.title || copilot.session.title}</span>
              {copilot.session.config.mode === 'interview' && (
                <span><strong>Cargo / Empresa</strong>{[copilot.session.config.role, copilot.session.config.company].filter(Boolean).join(' / ') || 'Nao informado'}</span>
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
                <span>Resposta</span>
              </div>
              <InterviewAnswerPane
                question={copilot.questionDraft}
                answer={copilot.activeAnswer}
                toolStatus={copilot.toolStatus}
                onQuestionChange={copilot.setQuestionDraft}
                onAnswer={copilot.requestAnswer}
                onStop={copilot.stopAnswer}
                onCopy={text => electronService.copyToClipboard(text)}
                screenStatus={copilot.screenStatus}
                onCaptureScreen={copilot.captureScreen}
              />
            </section>
          </main>
        </>
      )}
    </div>
  );
};

export default InterviewCopilot;
