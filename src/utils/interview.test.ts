import { describe, expect, it } from 'vitest';
import { InterviewTranscriptDelta, TranscriptTurn } from '../types/interview';
import {
  applyInterviewTranscriptDelta,
  buildCompactInterviewTranscript,
  canCaptureInterviewScreenShortcut,
  isPlainSpaceShortcut,
  isLikelyInterviewQuestion,
  selectScreenAnswerVariant,
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

describe('selectScreenAnswerVariant', () => {
  it('always applies the coding prompt to images captured during interviews', () => {
    expect(selectScreenAnswerVariant('interview', false)).toBe('code');
    expect(selectScreenAnswerVariant('interview', true)).toBe('code');
  });

  it('keeps automatic technical detection for regular meetings', () => {
    expect(selectScreenAnswerVariant('meeting', false)).toBe('answer');
    expect(selectScreenAnswerVariant('meeting', true)).toBe('code');
  });
});

describe('interview keyboard shortcuts', () => {
  const spaceEvent = {
    code: 'Space',
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    repeat: false
  };

  it('uses only an unmodified local Space for quick answers', () => {
    expect(isPlainSpaceShortcut(spaceEvent)).toBe(true);
    expect(isPlainSpaceShortcut({ ...spaceEvent, altKey: true })).toBe(false);
    expect(isPlainSpaceShortcut({ ...spaceEvent, repeat: true })).toBe(false);
    expect(isPlainSpaceShortcut({ ...spaceEvent, code: 'Enter' })).toBe(false);
  });

  it('allows the global screen capture only during an active interview', () => {
    expect(canCaptureInterviewScreenShortcut('active', 'interview')).toBe(true);
    expect(canCaptureInterviewScreenShortcut('active', 'meeting')).toBe(false);
    expect(canCaptureInterviewScreenShortcut('pending', 'interview')).toBe(false);
    expect(canCaptureInterviewScreenShortcut('completed', 'interview')).toBe(false);
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

  it('compoe blocos periodicos no mesmo turno ate a pausa real', () => {
    let turns: TranscriptTurn[] = [];
    turns = applyInterviewTranscriptDelta(turns, delta(1, 'Esta e uma '));
    turns = applyInterviewTranscriptDelta(turns, delta(2, 'pergunta longa que '));
    turns = applyInterviewTranscriptDelta(turns, delta(3, 'continua sendo falada'));

    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({
      text: '',
      pendingText: 'Esta e uma pergunta longa que continua sendo falada',
      isFinal: false,
      fragments: ['Esta e uma', 'pergunta longa que', 'continua sendo falada']
    });

    turns = applyInterviewTranscriptDelta(turns, delta(4, '', true));
    expect(turns[0]).toMatchObject({
      text: 'Esta e uma pergunta longa que continua sendo falada',
      pendingText: '',
      isFinal: true
    });
  });

  it('mantem somente os cinco fragmentos mais recentes para resposta rapida', () => {
    let turns: TranscriptTurn[] = [];
    for (let sequence = 1; sequence <= 7; sequence += 1) {
      turns = applyInterviewTranscriptDelta(turns, delta(sequence, `fragmento ${sequence} `));
    }

    expect(turns[0].fragments).toEqual([
      'fragmento 3',
      'fragmento 4',
      'fragmento 5',
      'fragmento 6',
      'fragmento 7'
    ]);

    turns = applyInterviewTranscriptDelta(turns, delta(8, '', true));
    expect(turns[0].fragments).toHaveLength(5);
  });

  it('substitui a hipotese intermediaria sem duplicar palavras', () => {
    let turns: TranscriptTurn[] = [];
    turns = applyInterviewTranscriptDelta(turns, {
      ...delta(1, 'como voce'),
      replacePending: true
    });
    turns = applyInterviewTranscriptDelta(turns, {
      ...delta(2, 'como voce resolveu esse problema'),
      replacePending: true
    });

    expect(turns[0].pendingText).toBe('como voce resolveu esse problema');
    expect(turns[0].fragments).toEqual([
      'como voce',
      'como voce resolveu esse problema'
    ]);

    turns = applyInterviewTranscriptDelta(turns, {
      ...delta(3, 'Como voce resolveu esse problema?'),
      replacePending: true,
      isFinal: true
    });
    expect(turns[0]).toMatchObject({
      text: 'Como voce resolveu esse problema?',
      pendingText: '',
      isFinal: true,
      isQuestion: true
    });
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
