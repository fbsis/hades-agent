import { describe, expect, it } from 'vitest';
import { InterviewTranscriptDelta, TranscriptTurn } from '../types/interview';
import {
  applyInterviewTranscriptDelta,
  buildCompactInterviewTranscript,
  isLikelyInterviewQuestion,
  selectInterviewContextTurns
} from './interview';

const turn = (id: string, text: string, overrides: Partial<TranscriptTurn> = {}): TranscriptTurn => ({
  id,
  sessionId: 'session-1',
  source: 'interviewer',
  text,
  pendingText: '',
  startedAt: '2026-07-21T10:00:00.000Z',
  endedAt: '2026-07-21T10:00:01.000Z',
  isFinal: true,
  isQuestion: false,
  ...overrides
});

const delta = (sequence: number, text: string, isFinal = false): InterviewTranscriptDelta => ({
  sessionId: 'session-1',
  source: 'interviewer',
  turnId: 'turn-live',
  sequence,
  text,
  isFinal,
  timestamp: `2026-07-21T10:00:0${sequence}.000Z`
});

describe('isLikelyInterviewQuestion', () => {
  it.each([
    'Como voce lidou com um conflito no time',
    'Conte sobre uma vez em que voce falhou',
    'Qual e a complexidade desse algoritmo?',
    'Walk me through your most recent project',
    'Tell me about your biggest challenge'
  ])('detecta perguntas de entrevista sem depender de ponto de interrogacao: %s', text => {
    expect(isLikelyInterviewQuestion(text)).toBe(true);
  });

  it.each([
    'Obrigado pela resposta.',
    'A entrevista comecara agora.',
    'We will send the next steps tomorrow.'
  ])('nao marca afirmacoes comuns: %s', text => {
    expect(isLikelyInterviewQuestion(text)).toBe(false);
  });
});

describe('applyInterviewTranscriptDelta', () => {
  it('constroi um unico turno incremental e o finaliza sem duplicar texto', () => {
    let turns: TranscriptTurn[] = [];
    turns = applyInterviewTranscriptDelta(turns, delta(1, 'Como '));
    turns = applyInterviewTranscriptDelta(turns, delta(2, 'voce trabalha'));
    turns = applyInterviewTranscriptDelta(turns, delta(3, ' sob pressao?', true));

    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({
      text: 'Como voce trabalha sob pressao?',
      pendingText: '',
      isFinal: true,
      isQuestion: true,
      lastSequence: 3
    });
  });

  it('ignora deltas repetidos ou fora de ordem', () => {
    let turns = applyInterviewTranscriptDelta([], delta(2, 'primeiro'));
    turns = applyInterviewTranscriptDelta(turns, delta(1, 'duplicado'));
    turns = applyInterviewTranscriptDelta(turns, delta(2, 'duplicado'));
    expect(turns[0].pendingText).toBe('primeiro');
  });
});

describe('compact interview context', () => {
  it('envia no maximo seis turnos e remove a pergunta selecionada', () => {
    const turns = Array.from({ length: 9 }, (_, index) => turn(`turn-${index}`, `fala ${index}`));
    const selected = turns[8];
    const context = selectInterviewContextTurns(turns, selected.id);

    expect(context).toHaveLength(6);
    expect(context.map(item => item.id)).toEqual([
      'turn-2', 'turn-3', 'turn-4', 'turn-5', 'turn-6', 'turn-7'
    ]);
    expect(buildCompactInterviewTranscript(turns, selected.id)).not.toContain('fala 8');
  });

  it('ignora turnos pendentes', () => {
    const turns = [
      turn('final', 'contexto anterior'),
      turn('pending', '', { isFinal: false, pendingText: 'ainda falando' })
    ];
    expect(selectInterviewContextTurns(turns)).toEqual([turns[0]]);
  });
});
