import React from 'react';
import { Camera, LoaderCircle, MoveRight, Sparkles } from 'lucide-react';
import { WhiteboardState } from '../../types/interview';

interface WhiteboardGuidancePaneProps {
  state?: WhiteboardState;
  comment?: string;
  isAnalyzing?: boolean;
  onCommentChange?: (value: string) => void;
  onAdvance?: () => void;
  readOnly?: boolean;
}

const problemLabels: Record<WhiteboardState['problemType'], string> = {
  unknown: 'Ainda não detectado',
  algorithm: 'Algoritmo',
  system_design: 'System design'
};

const phaseLabels: Record<WhiteboardState['phase'], string> = {
  understand: 'Entendimento',
  clarify: 'Clarificação',
  explore: 'Exploração',
  construct: 'Construção',
  validate: 'Validação',
  finalize: 'Fechamento'
};

const GuidanceList = ({ title, items }: { title: string; items?: string[] }) => (
  <section className="whiteboard-guidance-section">
    <h3>{title}</h3>
    {items?.length
      ? <ul>{items.map((item, index) => <li key={`${title}-${index}`}>{item}</li>)}</ul>
      : <p className="whiteboard-guidance-empty">Nada registrado nesta etapa.</p>}
  </section>
);

export const WhiteboardGuidancePane: React.FC<WhiteboardGuidancePaneProps> = ({
  state,
  comment = '',
  isAnalyzing = false,
  onCommentChange,
  onAdvance,
  readOnly = false
}) => (
  <div className={`whiteboard-guidance-pane ${readOnly ? 'read-only' : ''}`}>
    {!readOnly && <div className="whiteboard-guidance-editor">
      <label htmlFor="whiteboard-comment">Dúvida, correção ou direcionamento</label>
      <div>
        <input
          id="whiteboard-comment"
          type="text"
          value={comment}
          onChange={event => onCommentChange?.(event.target.value)}
          onKeyDown={event => {
            if (event.key !== 'Enter' || event.nativeEvent.isComposing || isAnalyzing) return;
            event.preventDefault();
            onAdvance?.();
          }}
          placeholder="Ex.: isto é system design; quero explorar filas"
          disabled={isAnalyzing}
        />
        <button type="button" className="interview-question-capture" onClick={onAdvance} disabled={isAnalyzing} title="Capturar e reanalisar o Whiteboard" aria-label="Capturar e reanalisar o Whiteboard">
          {isAnalyzing ? <LoaderCircle className="spin" size={15} /> : <Camera size={15} />}
        </button>
      </div>
      <button type="button" className="whiteboard-advance-button" onClick={onAdvance} disabled={isAnalyzing}>
        {isAnalyzing ? <LoaderCircle className="spin" size={15} /> : <MoveRight size={15} />}
        {isAnalyzing ? 'Analisando quadro e conversa…' : 'Avançar orientação'}
      </button>
    </div>}

    <div className="whiteboard-guidance-scroll">
      {!state ? <div className="whiteboard-guidance-welcome">
        <Sparkles size={20} />
        <strong>Pronto para acompanhar o Whiteboard</strong>
        <p>Avance a orientação para capturar a tela, interpretar o problema e receber o próximo passo.</p>
      </div> : <>
        <header className="whiteboard-guidance-meta">
          <span>{problemLabels[state.problemType]}</span>
          <span>{phaseLabels[state.phase]}</span>
          <small>revisão {state.revision} · {Math.round(state.confidence * 100)}% confiança</small>
        </header>
        <section className="whiteboard-understanding">
          <h3>Entendimento atual</h3>
          <p>{state.problemSummary || 'O problema ainda não foi identificado.'}</p>
          {state.screenSummary && <small>Tela: {state.screenSummary}</small>}
        </section>
        <GuidanceList title="Perguntas para o entrevistador" items={state.suggestedQuestions} />
        <GuidanceList title="Próximo passo no quadro" items={state.nextActions} />
        <GuidanceList title="Como explicar em voz alta" items={state.suggestedSpeech} />
        <GuidanceList title="Requisitos" items={state.requirements} />
        <GuidanceList title="Restrições" items={state.constraints} />
        <GuidanceList title="Dúvidas abertas" items={state.openQuestions} />
        <GuidanceList title="Trade-offs" items={state.tradeoffs} />
        <GuidanceList title="Hipóteses e decisões" items={[...state.assumptions, ...state.decisions]} />
        <GuidanceList title="Feedback do entrevistador" items={state.interviewerFeedback} />
      </>}
    </div>
  </div>
);
