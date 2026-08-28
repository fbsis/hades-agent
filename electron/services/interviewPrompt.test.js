import { describe, expect, it } from 'vitest';
import promptModule from './interviewPrompt.js';

const {
  DEFAULT_CONFIG,
  buildOpenAIInterviewPrompt,
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
  it('keeps audio recording enabled by default', () => {
    expect(DEFAULT_CONFIG.retainAudio).toBe(true);
    expect(DEFAULT_CONFIG.interviewFormat).toBe('standard');
  });

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
        description: 'Choose the queue strategy.',
        company: 'Acme'
      },
      sessionSummary: '- The team prefers at-least-once delivery.'
    });

    expect(context).toContain('Mode: meeting');
    expect(context).toContain('Meeting title: Architecture review');
    expect(context).toContain('Choose the queue strategy.');
    expect(context).toContain('Organization or participant: Acme');
    expect(context).toContain('Saved meeting summary');
    expect(context).toContain('at-least-once delivery');
  });

  it('includes the optional meeting company or participant in the OpenAI prompt', () => {
    const prompt = buildOpenAIInterviewPrompt({
      config: { mode: 'meeting', company: 'Maria Silva' }
    });

    expect(prompt).toContain('Organization or participant: Maria Silva');
  });

  it('includes planned interview topics in OpenAI and compact context', () => {
    const args = {
      config: {
        mode: 'interview',
        topics: 'Node.js event loop, React hooks and system design.'
      }
    };

    expect(buildOpenAIInterviewPrompt(args)).toContain('<planned_topics>');
    expect(buildOpenAIInterviewPrompt(args)).toContain('React hooks');
    expect(buildInterviewContext(args)).toContain('Planned topics');
    expect(buildInterviewContext(args)).toContain('system design');
  });

  it('locks natural spoken and coding response behavior', () => {
    const natural = buildInterviewInstruction({ config: { answerStyle: 'natural' }, variant: 'answer' });
    const openai = buildInterviewInstruction({ config: { answerStyle: 'natural' }, variant: 'answer', provider: 'openai' });
    const coding = buildInterviewInstruction({ config: { answerStyle: 'technical' }, variant: 'code' });
    expect(natural).toContain('first person');
    expect(natural).toContain('45 to 90 seconds');
    expect(natural).toContain('every answer');
    expect(natural).toContain('**Resumo**');
    expect(natural).toContain('2 to 4 short bullet points');
    expect(natural).toContain('**Aprofundamento**');
    expect(natural).toContain('2 to 4 advanced bullet points');
    expect(natural).toContain('Do not write prose paragraphs');
    expect(openai).toContain('supplied resume');
    expect(openai).not.toContain('Hermes persistent memory');
    expect(openai).toContain('plausible illustrative example');
    expect(openai).toContain('opinion');
    expect(openai).toContain('hypothetical');
    expect(coding).toContain('expert coding interviewee');
    expect(coding).toContain('**1. Problem Statement**');
    expect(coding).toContain('**2. My Thoughts**');
    expect(coding).toContain('**3. The Code**');
    expect(coding).toContain('**4. Time Complexity**');
    expect(coding).toContain('**5. Correct Answer**');
    expect(coding).toContain('enforce TypeScript types');
    expect(coding).toContain('React TypeScript problem');
  });

  it('keeps substantially more visual context for coding screenshots', () => {
    const visualContext = `START-${'x'.repeat(3000)}-CENTRAL-CONSTRAINTS-${'x'.repeat(2500)}-END`;
    const codingPrompt = buildOpenAIInterviewPrompt({
      question: 'Solve the visible problem',
      visualContext,
      variant: 'code',
      config: {}
    });
    const regularPrompt = buildOpenAIInterviewPrompt({
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

  it('builds the OpenAI question prompt with resume, job and only five recent texts', () => {
    const turns = Array.from({ length: 8 }, (_, index) => makeTurn(index));
    const recent = selectRecentInterviewTexts(turns);
    const prompt = buildOpenAIInterviewPrompt({
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
    const prompt = buildOpenAIInterviewPrompt({
      question: 'fragment 2 fragment 3 fragment 4 fragment 5 fragment 6',
      quickFragments: Array.from({ length: 7 }, (_, index) => `fragment ${index}`),
      quickComment: 'Corrija: destaque que usei filas, não chamadas síncronas.',
      turns: Array.from({ length: 7 }, (_, index) => makeTurn(index, {
        text: `Earlier conversation context ${index}`
      })),
      variant: 'quick',
      config: {
        resume: 'Backend engineer resume.',
        jobDescription: 'Senior platform role.'
      }
    });
    const instruction = buildInterviewInstruction({
      config: { answerStyle: 'concise' },
      variant: 'quick',
      provider: 'openai'
    });

    expect(prompt).toContain('<latest_live_fragments>');
    expect(prompt).not.toContain('fragment 0');
    expect(prompt).not.toContain('fragment 1');
    expect(prompt).toContain('fragment 6');
    expect(prompt).toContain('incomplete final fragment');
    expect(prompt).toContain('<conversation_history>');
    expect(prompt).toContain('Earlier conversation context 0');
    expect(prompt).toContain('Earlier conversation context 6');
    expect(prompt).not.toContain('<last_five_conversation_texts>');
    expect(prompt).toContain('<candidate_live_comment>');
    expect(prompt).toContain('destaque que usei filas');
    expect(instruction).toContain('using STAR');
    expect(instruction).toContain('Use 5 to 7 independently readable Markdown bullets');
    expect(instruction).toContain('Technical question');
    expect(instruction).toContain('exactly 7 concise');
    expect(instruction).toContain('demonstrates understanding instead of merely stating facts');
    expect(instruction).toContain('Any other conversational statement');
    expect(instruction).toContain('Make the response persuasive');
    expect(instruction).toContain('explain the reasoning behind it');
    expect(instruction).toContain('speaker labels');
    expect(instruction).toContain('Candidate fragments');
    expect(instruction).toContain('complete supplied conversation_history');
    expect(instruction).toContain('real-time correction or addition');
    expect(instruction).toContain('do not answer the comment in isolation');
    expect(instruction).toContain('Choose only one format');
    expect(instruction).not.toContain('all 14 bullets useful');
    expect(instruction).not.toContain('mandatory two-level bullet format');
    expect(instruction).not.toContain('120 words');
    expect(instruction).not.toContain('Avoid headings and bullets');
  });

  it('uses the interviewer language in interviews even when candidate input has another language', () => {
    const prompt = buildOpenAIInterviewPrompt({
      question: 'Tell me about the Node.js event loop.',
      quickFragments: [
        'Interviewer: Tell me about the Node.js event loop',
        'Candidate: Eu gostaria de destacar os detalhes técnicos'
      ],
      quickComment: 'Responda com um exemplo curto.',
      variant: 'quick',
      config: { mode: 'interview', language: 'en-US' }
    });
    const instruction = buildInterviewInstruction({
      config: { mode: 'interview', language: 'en-US' },
      variant: 'quick',
      provider: 'openai'
    });

    expect(prompt).toContain('Interview response language policy');
    expect(prompt).toContain('language used by the interviewer');
    expect(prompt).toContain('Candidate: Eu gostaria');
    expect(prompt).toContain('Responda com um exemplo curto');
    expect(instruction).toContain('Only interviewer utterances determine the response language');
    expect(instruction).toContain('candidate_live_comment');
    expect(instruction).toContain('If the interviewer speaks English, respond in English');
    expect(instruction).toContain('Situation, Task, Action and Result');
    expect(instruction).toContain('exactly 7 concise');
  });
});
