const logger = require('./logger');
const jsonStore = require('../store/jsonStore');
const hermesService = require('./hermesService');
const openaiResponsesService = require('./openaiResponsesService');

function getOpenAIKey() {
  return jsonStore.getSettings()?.general?.openaiApiKey || process.env.OPENAI_API_KEY;
}

function buildChatInput({ history = [], prompt = '', image = '' }) {
  const input = history.slice(-12).map(message => ({
    role: message.sender === 'ia' || message.role === 'assistant' ? 'assistant' : 'user',
    content: String(message.text || message.content || '').trim()
  })).filter(message => message.content);

  const cleanPrompt = String(prompt || '').trim();
  const last = input.at(-1);
  if (image) {
    if (last?.role === 'user' && last.content === cleanPrompt) input.pop();
    input.push({
      role: 'user',
      content: [
        { type: 'input_text', text: cleanPrompt || 'Analise a imagem e responda diretamente.' },
        { type: 'input_image', image_url: image, detail: 'high' }
      ]
    });
  } else if (cleanPrompt && !(last?.role === 'user' && last.content === cleanPrompt)) {
    input.push({ role: 'user', content: cleanPrompt });
  }

  return input;
}

class AIService {
  async generateSuggestion({ transcription, personaPrompt }) {
    const settings = jsonStore.getSettings();
    if (settings?.hermes?.enabled && settings?.hermes?.useAsPrimaryAgent !== false) {
      const hermesResult = await hermesService.ask({
        prompt: `Persona: ${personaPrompt}\n\nTrecho da transcricao: ${transcription}`,
        instruction: 'Gere uma sugestao curta e util para a pessoa acompanhando esta reuniao. Retorne apenas a sugestao.',
        includeLocalContext: true,
        maxOutputTokens: 220,
        timeoutMs: 10000,
        logType: 'suggestion',
        primaryAgent: true
      });
      if (hermesResult.success && hermesResult.text) return hermesResult.text;
    }

    const apiKey = getOpenAIKey();
    if (!apiKey) return null;
    const result = await openaiResponsesService.generateText({
      apiKey,
      model: 'gpt-5.6-luna',
      instructions: 'Gere uma sugestao curta e util em pt-BR. Retorne somente a sugestao.',
      input: `Persona: ${personaPrompt}\n\nTrecho da transcricao: ${transcription}`,
      maxOutputTokens: 300
    });
    return result.text;
  }

  async answerTranscriptQuestion({ question, transcript, personaPrompt }) {
    const cleanQuestion = String(question || '').trim();
    const cleanTranscript = String(transcript || '').trim();
    if (!cleanQuestion) throw new Error('Pergunta vazia.');
    if (!cleanTranscript) throw new Error('Ainda nao existe transcricao para consultar.');

    const settings = jsonStore.getSettings();
    const context = [
      personaPrompt ? `Persona ativa:\n${personaPrompt}` : '',
      `Transcricao atual:\n${cleanTranscript}`
    ].filter(Boolean).join('\n\n');

    if (settings?.hermes?.enabled) {
      const hermesResult = await hermesService.ask({
        prompt: cleanQuestion,
        context,
        instruction: 'Responda em pt-BR usando a transcricao como fonte principal. Nao invente informacoes ausentes.',
        includeLocalContext: true,
        maxOutputTokens: 900,
        timeoutMs: settings?.hermes?.timeoutMs || 30000,
        logType: 'transcript_question',
        primaryAgent: true
      });
      if (hermesResult.success && hermesResult.text) {
        return { text: hermesResult.text, provider: 'hermes' };
      }
    }

    const apiKey = getOpenAIKey();
    if (!apiKey) throw new Error('Hermes indisponivel e OpenAI API key nao configurada.');
    const result = await openaiResponsesService.generateText({
      apiKey,
      model: 'gpt-5.6-sol',
      instructions: 'Responda em pt-BR usando somente a transcricao fornecida. Se a resposta nao estiver nela, diga isso objetivamente.',
      input: `${context}\n\nPergunta:\n${cleanQuestion}`,
      maxOutputTokens: 1200
    });
    return { text: result.text, provider: 'openai' };
  }

  async generateSessionTitle(firstMessage) {
    const apiKey = getOpenAIKey();
    if (!apiKey) return this._fallbackTitle(firstMessage);

    try {
      const result = await openaiResponsesService.generateText({
        apiKey,
        model: 'gpt-5.6-luna',
        instructions: [
          'Gere um titulo de sessao em portugues com 2 a 5 palavras.',
          'Use Title Case, sem pontuacao final, aspas, emojis ou Markdown.',
          'Retorne somente o titulo.'
        ].join(' '),
        input: String(firstMessage || '').slice(0, 500),
        maxOutputTokens: 40
      });
      return result.text.replace(/['"]/g, '').replace(/\n.*/g, '').trim()
        || this._fallbackTitle(firstMessage);
    } catch (error) {
      logger.error('AI', 'OpenAI session title error', error);
      return this._fallbackTitle(firstMessage);
    }
  }

  _fallbackTitle(text) {
    if (!text) return 'Nova Sessao';
    return String(text).substring(0, 40).trim() + (String(text).length > 40 ? '...' : '');
  }

  async transcribeAudio(base64Audio) {
    return openaiResponsesService.transcribeAudio({
      apiKey: getOpenAIKey(),
      base64Audio
    });
  }

  async streamChat(args = {}, onDelta = () => {}) {
    const apiKey = getOpenAIKey();
    if (!apiKey) throw new Error('OpenAI API key nao configurada. Abra Configuracoes.');
    const hasImage = Boolean(args.image);
    const coding = Boolean(args.codingQuestion);
    const instructions = [
      'Voce e o assistente desktop Metis. Responda diretamente em pt-BR, salvo quando o usuario pedir outro idioma.',
      'Use Markdown compacto e nao mencione provedores internos.',
      hasImage ? 'Leia todo o conteudo visivel da imagem antes de responder: texto, codigo, erros, alternativas, graficos e enunciados.' : '',
      hasImage ? 'Nao diga que a imagem esta truncada se o conteudo necessario estiver legivel. Responda o pedido atual diretamente.' : '',
      coding ? 'Para programacao, forneca a resposta correta e use blocos de codigo Markdown com a linguagem apropriada.' : '',
      `Modo: ${args.mode || 'auto'}. Estilo: ${args.preferredAnswerStyle || 'auto'}.`
    ].filter(Boolean).join(' ');

    return openaiResponsesService.generateTextStream({
      apiKey,
      model: 'gpt-5.6-sol',
      instructions,
      input: buildChatInput(args),
      maxOutputTokens: coding || hasImage ? 4096 : 1800,
      reasoningEffort: coding || hasImage ? 'low' : 'none',
      verbosity: coding ? 'medium' : 'low',
      onDelta
    });
  }
}

module.exports = new AIService();
module.exports.buildChatInput = buildChatInput;
