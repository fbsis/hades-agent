const jsonStore = require('../store/jsonStore');
const openaiResponsesService = require('./openaiResponsesService');
const { buildTextActionPrompt } = require('./textActionPrompts');

async function runTextAction({ action, text, customInstruction }) {
  const selectedText = String(text || '').trim();
  if (!selectedText) throw new Error('Nenhum texto selecionado.');
  const apiKey = jsonStore.getSettings()?.general?.openaiApiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('Configure sua chave da OpenAI antes de usar as ações de texto.');

  const result = await openaiResponsesService.generateText({
    apiKey,
    model: 'gpt-5.6-luna',
    instructions: [
      'Você transforma somente o texto fornecido conforme a instrução.',
      'Não inclua introduções, comentários sobre o processo ou cercas de Markdown.',
      buildTextActionPrompt(action, customInstruction)
    ].join(' '),
    input: selectedText.slice(0, 30000),
    maxOutputTokens: 1800,
    verbosity: 'low'
  });
  return result.text;
}

module.exports = { runTextAction };
