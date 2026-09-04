import { describe, expect, it } from 'vitest';
import prompt from './conversationSuggestionPrompt.js';

const suggestions = [
  { probability: 0.55, type: 'question', title: 'Ask about timing', intent: 'Clarify timing', mood: '', motivation: '' },
  { probability: 0.9, type: 'say', title: 'Confirm the goal', intent: 'Align expectations', mood: '', motivation: '' },
  { probability: 0.3, type: 'social', title: 'Lighten the mood', intent: 'Build rapport', mood: 'Light', motivation: 'Reduce tension' },
  { probability: 0.7, type: 'question', title: 'Ask about users', intent: 'Understand the audience', mood: '', motivation: '' },
  { probability: 0.4, type: 'say', title: 'Summarize', intent: 'Check shared understanding', mood: '', motivation: '' }
];

describe('conversationSuggestionPrompt', () => {
  it('keeps bounded context and labels both sides of the conversation', () => {
    const input = prompt.buildConversationInput({
      session: { config: { mode: 'meeting', language: 'pt-BR' } },
      turns: [
        { source: 'interviewer', text: 'Qual e o prazo?', pendingText: '' },
        { source: 'candidate', text: '', pendingText: 'Posso entregar sexta.' }
      ]
    });
    expect(input).toContain('Other person: Qual e o prazo?');
    expect(input).toContain('User: Posso entregar sexta.');
    expect(input.length).toBeLessThan(9000);
  });

  it('includes a short hint and options that should not be repeated', () => {
    const input = prompt.buildConversationInput({
      session: { config: { mode: 'interview', language: 'pt-BR' } },
      turns: [{ source: 'interviewer', text: 'Como foi o projeto?', pendingText: '' }],
      hint: 'falar de liderança',
      excludedSuggestions: ['Explicar o contexto', 'Perguntar sobre o time']
    });
    expect(input).toContain('<user_hint>\nfalar de liderança');
    expect(input).toContain('<excluded_options>\nExplicar o contexto\nPerguntar sobre o time');
  });

  it('requires five suggestions and ranks them by probability', () => {
    const result = prompt.validateConversationSuggestions({ suggestions });
    expect(result).toHaveLength(5);
    expect(result.map(item => item.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(result.map(item => item.probability)).toEqual([0.9, 0.7, 0.55, 0.4, 0.3]);
    expect(() => prompt.validateConversationSuggestions({ suggestions: suggestions.slice(0, 4) })).toThrow(/cinco/);
  });

  it('validates speakable expansion fields', () => {
    expect(prompt.validateConversationExpansion({
      quickResponses: [
        'Como esse prazo foi definido?',
        'Quais dependencias determinaram esse prazo?',
        'Existe margem para revisar esse prazo?'
      ],
      deepDive: [
        'Dependencias tecnicas e externas que afetam a entrega.',
        'Riscos considerados na estimativa atual.',
        'Marcos intermediarios para validar o progresso.'
      ]
    })).toMatchObject({ quickResponses: ['Como esse prazo foi definido?', 'Quais dependencias determinaram esse prazo?', 'Existe margem para revisar esse prazo?'] });
  });
});
