import { describe, it, expect } from 'vitest';
import menu from './textContextMenu.js';
import openai from './openaiResponsesService.js';
describe('native text context menus', () => {
  it('offers only text actions for an explicit, non-password selection', () => {
    expect(menu.textItems({ selectionText: 'Texto de teste', isEditable: true }).map(item => item.label)).toEqual(['Traduzir com o Metis', 'Corrigir com o Metis', 'Reescrever com o Metis', 'Resumir com o Metis', 'Explicar com o Metis']);
  });
  it('does not truncate a large selection and then replace the whole original', () => {
    const items = menu.textItems({ selectionText: 'a'.repeat(30001), isEditable: true });
    expect(items).toHaveLength(1);
    expect(items[0].enabled).toBe(false);
  });
  it('does not offer actions for passwords or empty selections', () => {
    expect(menu.textItems({ selectionText: 'secret', inputFieldType: 'password' })).toEqual([]);
    expect(menu.textItems({ selectionText: ' ' })).toEqual([]);
  });
});
describe('automatic replacement completion guard', () => {
  it('never returns a truncated provider answer for direct replacement', async () => {
    await expect(openai.generateText({ apiKey: 'test-only', input: 'fixture', requireComplete: true, fetchImpl: async () => new Response(JSON.stringify({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output_text: 'Partial answer' }), { status: 200 }) })).rejects.toThrow('original foi mantido');
  });
  it('accepts a completed transformation', async () => {
    const result = await openai.generateText({ apiKey: 'test-only', input: 'fixture', requireComplete: true, fetchImpl: async () => new Response(JSON.stringify({ status: 'completed', output_text: 'Full answer' }), { status: 200 }) });
    expect(result.text).toBe('Full answer');
  });
});
