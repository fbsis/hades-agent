import { describe, expect, it } from 'vitest';
import promptModule from './interviewPrompt.js';

const {
  buildGeminiInterviewPrompt,
  buildInterviewContext,
  buildInterviewInstruction,
  selectRecentInterviewTexts
} = promptModule;

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
    const gemini = buildInterviewInstruction({ config: { answerStyle: 'natural' }, variant: 'answer', provider: 'gemini' });
    const coding = buildInterviewInstruction({ config: { answerStyle: 'technical' }, variant: 'code' });
    expect(natural).toContain('first person');
    expect(natural).toContain('45 to 90 seconds');
    expect(gemini).toContain('supplied resume');
    expect(gemini).not.toContain('Hermes persistent memory');
    expect(coding).toContain('Markdown code');
  });

  it('builds the Gemini question prompt with resume, job and only five recent texts', () => {
    const turns = Array.from({ length: 8 }, (_, index) => makeTurn(index));
    const recent = selectRecentInterviewTexts(turns);
    const prompt = buildGeminiInterviewPrompt({
      question: 'turn text 7',
      turns,
      config: {
        role: 'Engineer',
        company: 'Acme',
        resume: 'Built distributed systems at Example Corp.',
        jobDescription: 'Design resilient backend services.'
      }
    });

    expect(recent.map(turn => turn.text)).toEqual([
      'turn text 3',
      'turn text 4',
      'turn text 5',
      'turn text 6',
      'turn text 7'
    ]);
    expect(prompt).toContain('<resume>');
    expect(prompt).toContain('Built distributed systems');
    expect(prompt).toContain('<job_description>');
    expect(prompt).toContain('Design resilient backend services');
    expect(prompt.match(/turn text/g)).toHaveLength(5);
    expect(prompt).not.toContain('<question>');
  });

  it('uses only the latest five live fragments for a compact quick answer', () => {
    const prompt = buildGeminiInterviewPrompt({
      question: 'fragment 2 fragment 3 fragment 4 fragment 5 fragment 6',
      quickFragments: Array.from({ length: 7 }, (_, index) => `fragment ${index}`),
      variant: 'quick',
      config: {
        resume: 'Backend engineer resume.',
        jobDescription: 'Senior platform role.'
      }
    });
    const instruction = buildInterviewInstruction({
      config: { answerStyle: 'concise' },
      variant: 'quick',
      provider: 'gemini'
    });

    expect(prompt).toContain('<latest_live_fragments>');
    expect(prompt).not.toContain('fragment 0');
    expect(prompt).not.toContain('fragment 1');
    expect(prompt).toContain('fragment 6');
    expect(prompt).toContain('incomplete final fragment');
    expect(prompt).not.toContain('<last_five_conversation_texts>');
    expect(instruction).toContain('Resumo:');
    expect(instruction).toContain('3 to 5 bullet points');
    expect(instruction).toContain('Never exceed five bullets');
    expect(instruction).not.toContain('Avoid headings and bullets');
  });
});
