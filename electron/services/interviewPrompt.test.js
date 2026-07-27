import { describe, expect, it } from 'vitest';
import promptModule from './interviewPrompt.js';

const { buildInterviewContext, buildInterviewInstruction } = promptModule;

const makeTurn = (index, overrides = {}) => ({
  id: `turn-${index}`,
  source: index % 2 ? 'candidate' : 'interviewer',
  text: `turn text ${index}`,
  isFinal: true,
  ...overrides
});

describe('interview prompt contract', () => {
  it('excludes the selected question and keeps only six finalized context turns', () => {
    const turns = Array.from({ length: 9 }, (_, index) => makeTurn(index));
    const context = buildInterviewContext({
      turnId: 'turn-8',
      turns,
      config: { role: 'Engineer', company: 'Acme', language: 'auto' }
    });

    expect(context).toContain('turn text 2');
    expect(context).toContain('turn text 7');
    expect(context).not.toContain('turn text 0');
    expect(context).not.toContain('turn text 1');
    expect(context).not.toContain('turn text 8');
    expect(context.match(/turn text/g)).toHaveLength(6);
  });

  it('does not include pending turns', () => {
    const context = buildInterviewContext({
      turns: [makeTurn(1), makeTurn(2, { isFinal: false })],
      config: {}
    });
    expect(context).toContain('turn text 1');
    expect(context).not.toContain('turn text 2');
  });

  it('locks natural spoken and coding response behavior', () => {
    const natural = buildInterviewInstruction({ config: { answerStyle: 'natural' }, variant: 'answer' });
    const coding = buildInterviewInstruction({ config: { answerStyle: 'technical' }, variant: 'code' });
    expect(natural).toContain('first person');
    expect(natural).toContain('45 to 90 seconds');
    expect(coding).toContain('Markdown code');
  });
});
