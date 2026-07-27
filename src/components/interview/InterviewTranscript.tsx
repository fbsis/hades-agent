import React, { useEffect, useRef } from 'react';
import { CircleHelp, MessageSquareReply } from 'lucide-react';
import { TranscriptTurn } from '../../types/interview';
import { sourceLabel } from '../../utils/interview';

interface InterviewTranscriptProps {
  turns: TranscriptTurn[];
  selectedTurnId: string | null;
  onSelect: (turn: TranscriptTurn) => void;
  onAnswer: (turn: TranscriptTurn) => void;
}

export const InterviewTranscript: React.FC<InterviewTranscriptProps> = ({
  turns,
  selectedTurnId,
  onSelect,
  onAnswer
}) => {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [turns]);

  return (
    <div className="interview-transcript-scroll">
      {turns.length === 0 && (
        <div className="interview-empty-state">
          <span className="interview-live-dot" />
          A transcricao aparecera aqui.
        </div>
      )}
      {turns.map(turn => {
        const fullText = `${turn.text}${turn.pendingText}`.trim();
        const canAnswer = turn.source === 'interviewer' || turn.source === 'screen' || turn.source === 'manual';
        return (
          <div
            key={turn.id}
            className={`interview-turn source-${turn.source} ${selectedTurnId === turn.id ? 'selected' : ''}`}
            onClick={() => onSelect(turn)}
          >
            <div className="interview-turn-meta">
              <span>{sourceLabel(turn.source)}</span>
              {turn.isQuestion && <CircleHelp size={12} aria-label="Pergunta detectada" />}
              <time>{new Date(turn.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
            </div>
            <div className="interview-turn-text">
              {fullText || <span className="interview-listening-text">Ouvindo...</span>}
            </div>
            {canAnswer && turn.isFinal && fullText && (
              <button
                type="button"
                className="interview-inline-answer"
                onClick={event => {
                  event.stopPropagation();
                  onAnswer(turn);
                }}
              >
                <MessageSquareReply size={13} />
                Responder
              </button>
            )}
          </div>
        );
      })}
      <div ref={endRef} />
    </div>
  );
};
