import React, { useState } from 'react';
import {
  Camera,
  Check,
  ChevronLeft,
  CircleStop,
  Headphones,
  Mic,
  Minus,
  Pin,
  PinOff,
  Plus,
  Radio,
  SlidersHorizontal
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
  const isListening = copilot.flowStatus === 'listening' || copilot.flowStatus === 'answering';
  const isStarting = copilot.flowStatus === 'starting';

  return (
    <div className={`app-container interview-copilot ${embedded ? 'embedded-susurro' : ''}`}>
      <header className="interview-header">
        <div className="interview-header-title">
          <Radio size={16} />
          <span>{copilot.session?.title || 'Interview Copilot'}</span>
          {copilot.session && <time>{formatTime(copilot.elapsedSeconds)}</time>}
        </div>

        {copilot.session && (
          <div className="interview-source-statuses">
            <span className={`source-status status-${copilot.sourceStatuses.interviewer?.status || 'idle'}`}>
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
          {copilot.session && (
            <>
              <button
                type="button"
                className="interview-icon-button"
                onClick={copilot.captureScreen}
                disabled={copilot.screenStatus === 'reading'}
                title={copilot.screenStatus === 'reading' ? 'Lendo tela' : 'Ler tela com Gemini'}
              >
                <Camera size={15} />
              </button>
              <button
                type="button"
                className={`interview-icon-button ${isContextOpen ? 'active' : ''}`}
                onClick={() => setIsContextOpen(open => !open)}
                title="Contexto da entrevista"
              >
                <SlidersHorizontal size={15} />
              </button>
              <button
                type="button"
                className={`interview-listen-button ${isListening ? 'active' : ''}`}
                onClick={isListening ? copilot.stopListening : copilot.startListening}
                disabled={isStarting || copilot.flowStatus === 'stopping'}
              >
                {isListening ? <CircleStop size={14} /> : <Radio size={14} />}
                {isStarting ? 'Conectando' : isListening ? 'Pausar' : 'Ouvir'}
              </button>
              <button type="button" className="interview-icon-button" onClick={copilot.newSession} title="Nova entrevista">
                <Plus size={15} />
              </button>
              <button type="button" className="interview-icon-button" onClick={copilot.finishSession} title="Finalizar entrevista">
                <Check size={15} />
              </button>
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
            onClick={embedded && onClosePanel ? onClosePanel : copilot.handleMinimize}
            title={embedded ? 'Voltar' : 'Minimizar'}
          >
            {embedded ? <ChevronLeft size={16} /> : <Minus size={16} />}
          </button>
        </div>
      </header>

      {!copilot.session ? (
        <InterviewSetup
          config={copilot.config}
          recentSessions={copilot.recentSessions}
          error={copilot.error}
          onConfigChange={copilot.setConfig}
          onStart={copilot.startListening}
          onLoadSession={copilot.loadSession}
          onArchiveSession={copilot.archiveSession}
        />
      ) : (
        <>
          {isContextOpen && (
            <div className="interview-context-strip">
              <span><strong>Cargo</strong>{copilot.session.config.role || 'Nao informado'}</span>
              <span><strong>Empresa</strong>{copilot.session.config.company || 'Nao informada'}</span>
              <span><strong>Idioma</strong>{copilot.session.config.language}</span>
              <span><strong>Estilo</strong>{copilot.session.config.answerStyle}</span>
            </div>
          )}

          {copilot.error && <div className="interview-error-banner">{copilot.error}</div>}
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
                <small>Space para gerar</small>
              </div>
              <InterviewAnswerPane
                question={copilot.questionDraft}
                answer={copilot.activeAnswer}
                toolStatus={copilot.toolStatus}
                onQuestionChange={copilot.setQuestionDraft}
                onAnswer={copilot.requestAnswer}
                onStop={copilot.stopAnswer}
                onCopy={text => electronService.copyToClipboard(text)}
              />
            </section>
          </main>
        </>
      )}
    </div>
  );
};

export default InterviewCopilot;
