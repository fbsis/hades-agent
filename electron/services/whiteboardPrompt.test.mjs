import { describe, expect, it } from 'vitest';
import whiteboardPrompt from './whiteboardPrompt.js';

const {
  WHITEBOARD_INSTRUCTIONS,
  WHITEBOARD_STATE_SCHEMA,
  buildWhiteboardInput,
  validateWhiteboardState
} = whiteboardPrompt;

const completeState = {
  revision: 1,
  updatedAt: '2026-08-28T12:00:00.000Z',
  problemType: 'algorithm',
  phase: 'clarify',
  problemSummary: 'Encontrar dois valores que somem o alvo.',
  requirements: ['Retornar os índices.'],
  constraints: ['Uma solução existe.'],
  assumptions: [],
  decisions: [],
  interviewerFeedback: [],
  openQuestions: ['Há números repetidos?'],
  tradeoffs: ['Tempo versus memória.'],
  suggestedQuestions: ['Posso usar memória extra?', 'Há números negativos?'],
  nextActions: ['Escrever um exemplo no quadro.'],
  suggestedSpeech: ['Vou confirmar as restrições antes de escolher a estrutura.'],
  screenSummary: 'Enunciado e exemplo legíveis.',
  confidence: 0.9
};

describe('whiteboardPrompt', () => {
  it('requires every state field and constrains live guidance quantities', () => {
    const schema = WHITEBOARD_STATE_SCHEMA.schema;
    expect(WHITEBOARD_STATE_SCHEMA).toMatchObject({ type: 'json_schema', strict: true });
    expect(schema.required).toEqual(expect.arrayContaining(Object.keys(completeState)));
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.suggestedQuestions).toMatchObject({ minItems: 2, maxItems: 4 });
  });

  it('includes complete cross-speaker history, prior state and an authoritative live correction', () => {
    const input = buildWhiteboardInput({
      session: {
        config: { language: 'pt-BR', title: 'Backend', resume: 'Currículo completo' },
        whiteboardState: completeState
      },
      turns: [
        { source: 'interviewer', text: 'Desenhe o serviço', pendingText: '' },
        { source: 'candidate', text: 'Vou começar pelos requisitos', pendingText: ' funcionais' }
      ],
      contextDocuments: [{ title: 'Vaga', content: 'Descrição integral' }],
      comment: 'Isso é system design; quero explorar filas.'
    });

    expect(input).toContain('interviewer: Desenhe o serviço');
    expect(input).toContain('candidate: Vou começar pelos requisitos funcionais');
    expect(input).toContain('"problemType":"algorithm"');
    expect(input).toContain('Isso é system design; quero explorar filas.');
    expect(input).toContain('Descrição integral');
    expect(WHITEBOARD_INSTRUCTIONS).toContain('Do not advance phase merely because another analysis was requested');
    expect(WHITEBOARD_INSTRUCTIONS).toContain('screenshot is unreadable');
    expect(WHITEBOARD_INSTRUCTIONS).toContain('language used by the interviewer');
    expect(WHITEBOARD_INSTRUCTIONS).toContain('candidate comment is in Portuguese');
    expect(WHITEBOARD_INSTRUCTIONS).toContain('Only interviewer utterances determine the response language');
    expect(input).toContain('Fallback response language when no interviewer utterance exists');
  });

  it('validates complete snapshots and rejects invalid phases or question counts', () => {
    expect(validateWhiteboardState(completeState)).toBe(completeState);
    expect(() => validateWhiteboardState({ ...completeState, phase: 'solve' })).toThrow(/Fase/);
    expect(() => validateWhiteboardState({ ...completeState, suggestedQuestions: ['Só uma'] })).toThrow(/2 e 4/);
    expect(() => validateWhiteboardState({ ...completeState, updatedAt: undefined })).toThrow(/Metadados/);
  });

  it('keeps an English interviewer authoritative over a Portuguese candidate comment', () => {
    const input = buildWhiteboardInput({
      session: { config: { language: 'pt-BR' } },
      turns: [
        { source: 'interviewer', text: 'How would you scale this service?', pendingText: '' },
        { source: 'candidate', text: 'I would start with the requirements.', pendingText: '' }
      ],
      comment: 'Quero falar sobre filas primeiro.'
    });

    expect(input).toContain('interviewer: How would you scale this service?');
    expect(input).toContain('Quero falar sobre filas primeiro.');
    expect(WHITEBOARD_INSTRUCTIONS).toContain('If the interviewer speaks English, answer in English');
  });
});
