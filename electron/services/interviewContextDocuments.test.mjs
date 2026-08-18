import { describe, expect, it } from 'vitest';
import promptModule from './interviewPrompt.js';

const { buildInterviewContext, buildOpenAIInterviewPrompt } = promptModule;

describe('meeting context documents', () => {
  const contextDocuments = [
    { id: 'resume', title: 'Meu currículo', content: 'Especialista em IA generativa e aplicações com RAG.' },
    { id: 'design', title: 'Design System', content: 'Experiência criando tokens, componentes e governança.' }
  ];

  it('adds every selected text document to the OpenAI prompt', () => {
    const prompt = buildOpenAIInterviewPrompt({
      config: { mode: 'meeting', language: 'pt-BR' },
      question: 'Qual é a sua experiência?',
      contextDocuments
    });
    expect(prompt).toContain('<context_documents>');
    expect(prompt).toContain('<document title="Meu currículo">');
    expect(prompt).toContain('Especialista em IA generativa');
    expect(prompt).toContain('<document title="Design System">');
  });

  it('includes documents in the compact meeting context', () => {
    const context = buildInterviewContext({ config: {}, contextDocuments });
    expect(context).toContain('Selected context documents:');
    expect(context).toContain('Experiência criando tokens');
  });
});
