import React from 'react';
import {
  AlignLeft,
  Camera,
  Clipboard,
  Code2,
  ListCollapse,
  LoaderCircle,
  RotateCcw,
  Square,
  UserRound
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { InterviewAnswer, InterviewAnswerVariant } from '../../types/interview';

interface InterviewAnswerPaneProps {
  question: string;
  answer: InterviewAnswer | null;
  toolStatus: string;
  onQuestionChange: (question: string) => void;
  onAnswer: (variant: InterviewAnswerVariant, answer?: InterviewAnswer) => void;
  onStop: () => void;
  onCopy: (text: string) => void;
  screenStatus: 'idle' | 'reading' | 'error';
  onCaptureScreen: () => void;
}

export const InterviewAnswerPane: React.FC<InterviewAnswerPaneProps> = ({
  question,
  answer,
  toolStatus,
  onQuestionChange,
  onAnswer,
  onStop,
  onCopy,
  screenStatus,
  onCaptureScreen
}) => (
  <div className="interview-answer-pane">
    <div className="interview-question-editor">
      <input
        type="text"
        value={question}
        onChange={event => onQuestionChange(event.target.value)}
        onKeyDown={event => {
          if (
            event.key !== 'Enter'
            || event.nativeEvent.isComposing
            || !question.trim()
            || answer?.status === 'streaming'
          ) return;
          event.preventDefault();
          onAnswer('answer');
        }}
        placeholder="Selecione, escreva ou corrija uma pergunta..."
        aria-label="Pergunta da reunião"
      />
      <button
        type="button"
        className="interview-question-capture"
        onClick={onCaptureScreen}
        disabled={screenStatus === 'reading'}
        title={screenStatus === 'reading' ? 'Lendo tela' : 'Capturar tela'}
        aria-label="Capturar tela"
      >
        {screenStatus === 'reading'
          ? <LoaderCircle className="spin" size={15} />
          : <Camera size={15} />}
      </button>
    </div>

    <div className="interview-answer-output">
      {!answer && <div className="interview-empty-answer">A resposta aparecera aqui.</div>}
      {answer && (
        <>
          <div className="interview-answer-status">
            <span className={`interview-provider provider-${answer.provider}`}>{answer.provider}</span>
            <span>{toolStatus || (answer.status === 'streaming' ? 'Escrevendo...' : answer.status)}</span>
          </div>
          <div className="interview-markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{answer.text || '...'}</ReactMarkdown>
          </div>
          {answer.error && <div className="interview-error">{answer.error}</div>}
        </>
      )}
    </div>

    <div className="interview-answer-actions">
      {answer?.status === 'streaming' ? (
        <button type="button" onClick={onStop} title="Parar resposta"><Square size={14} /></button>
      ) : (
        <button type="button" onClick={() => answer && onAnswer('retry', answer)} disabled={!answer} title="Tentar novamente"><RotateCcw size={14} /></button>
      )}
      <button type="button" onClick={() => answer && onCopy(answer.text)} disabled={!answer?.text} title="Copiar"><Clipboard size={14} /></button>
      <span className="interview-action-separator" />
      <button type="button" onClick={() => answer && onAnswer('shorter', answer)} disabled={!answer} title="Encurtar"><ListCollapse size={14} /></button>
      <button type="button" onClick={() => answer && onAnswer('detail', answer)} disabled={!answer} title="Detalhar"><AlignLeft size={14} /></button>
      <button type="button" onClick={() => answer && onAnswer('star', answer)} disabled={!answer} title="Resposta STAR"><UserRound size={14} /></button>
      <button type="button" onClick={() => answer && onAnswer('code', answer)} disabled={!answer} title="Responder com codigo"><Code2 size={14} /></button>
    </div>
  </div>
);
