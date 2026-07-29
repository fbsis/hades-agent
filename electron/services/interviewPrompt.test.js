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

  it('includes meeting details and the saved summary in future answers', () => {
    const context = buildInterviewContext({
      config: {
        mode: 'meeting',
        title: 'Architecture review',
        description: 'Choose the queue strategy.'
      },
      sessionSummary: '- The team prefers at-least-once delivery.'
    });

    expect(context).toContain('Mode: meeting');
    expect(context).toContain('Meeting title: Architecture review');
    expect(context).toContain('Choose the queue strategy.');
    expect(context).toContain('Saved meeting summary');
    expect(context).toContain('at-least-once delivery');
  });

  it('includes planned interview topics in Gemini and Hermes context', () => {
    const args = {
      config: {
        mode: 'interview',
        topics: 'Node.js event loop, React hooks and system design.'
      }
    };

    expect(buildGeminiInterviewPrompt(args)).toContain('<planned_topics>');
    expect(buildGeminiInterviewPrompt(args)).toContain('React hooks');
    expect(buildInterviewContext(args)).toContain('Planned topics');
    expect(buildInterviewContext(args)).toContain('system design');
  });

  it('locks natural spoken and coding response behavior', () => {
    const natural = buildInterviewInstruction({ config: { answerStyle: 'natural' }, variant: 'answer' });
    const gemini = buildInterviewInstruction({ config: { answerStyle: 'natural' }, variant: 'answer', provider: 'gemini' });
    const coding = buildInterviewInstruction({ config: { answerStyle: 'technical' }, variant: 'code' });
    expect(natural).toContain('first person');
    expect(natural).toContain('45 to 90 seconds');
    expect(natural).toContain('every answer');
    expect(natural).toContain('**Resumo**');
    expect(natural).toContain('2 to 4 short bullet points');
    expect(natural).toContain('**Aprofundamento**');
    expect(natural).toContain('2 to 4 advanced bullet points');
    expect(natural).toContain('Do not write prose paragraphs');
    expect(gemini).toContain('supplied resume');
    expect(gemini).not.toContain('Hermes persistent memory');
    expect(gemini).toContain('plausible illustrative example');
    expect(gemini).toContain('opinion');
    expect(gemini).toContain('hypothetical');
    expect(coding).toContain('expert technical interview candidate');
    expect(coding).toContain('**1. Problem Statement**');
    expect(coding).toContain('**2. My Thoughts**');
    expect(coding).toContain('**3. The Code**');
    expect(coding).toContain('**4. Complexity**');
    expect(coding).toContain('**5. Correct Answer**');
    expect(coding).toContain('enforce TypeScript types');
    expect(coding).toContain('React TypeScript problem');
  });

  it('keeps substantially more visual context for coding screenshots', () => {
    const visualContext = `START-${'x'.repeat(3000)}-CENTRAL-CONSTRAINTS-${'x'.repeat(2500)}-END`;
    const codingPrompt = buildGeminiInterviewPrompt({
      question: 'Solve the visible problem',
      visualContext,
      variant: 'code',
      config: {}
    });
    const regularPrompt = buildGeminiInterviewPrompt({
      question: 'Answer the visible question',
      visualContext,
      variant: 'answer',
      config: {}
    });

    expect(codingPrompt).toContain('START-');
    expect(codingPrompt).toContain('-CENTRAL-CONSTRAINTS-');
    expect(codingPrompt).toContain('-END');
    expect(regularPrompt).not.toContain('-CENTRAL-CONSTRAINTS-');
    expect(regularPrompt).toContain('-END');
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
    expect(instruction).toContain('**Resumo**');
    expect(instruction).toContain('**Aprofundamento**');
    expect(instruction).toContain('2 to 4 short bullet points');
    expect(instruction).toContain('2 to 4 advanced bullet points');
    expect(instruction).toContain('mandatory two-level bullet format');
    expect(instruction).not.toContain('120 words');
    expect(instruction).not.toContain('Avoid headings and bullets');
  });
});
