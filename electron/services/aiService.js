const { GoogleGenerativeAI } = require("@google/generative-ai");
const logger = require('./logger');
const jsonStore = require('../store/jsonStore');
const hermesService = require('./hermesService');

/**
 * AIService provides an interface for interacting with Google's Gemini models.
 * It handles prompt generation and AI responses for application-level insights.
 */
class AIService {
  /**
   * Generates a suggestion based on a transcription chunk and a given persona.
   * @param {Object} params
   * @param {string} params.transcription - The text chunk from the transcription.
   * @param {string} params.personaPrompt - The system instruction or persona definition.
   * @returns {Promise<string|null>}
   */
  async generateSuggestion({ transcription, personaPrompt }) {
    const settings = jsonStore.getSettings();
    if (settings?.hermes?.enabled && settings?.hermes?.useAsPrimaryAgent !== false) {
      const hermesResult = await hermesService.ask({
        prompt: `Persona: ${personaPrompt}\n\nTrecho da transcricao: ${transcription}`,
        instruction: 'Gere uma sugestao curta e util para a pessoa acompanhando esta reuniao/transcricao. Retorne apenas a sugestao.',
        includeLocalContext: true,
        maxOutputTokens: 220,
        timeoutMs: 10000,
        logType: 'suggestion',
        primaryAgent: true
      });

      if (hermesResult.success && hermesResult.text) {
        return hermesResult.text;
      }
    }

    const apiKey = jsonStore.getSettings().general.apiKey || process.env.VITE_GEMINI_API_KEY;
    if (!apiKey) {
      logger.warn('AI', 'VITE_GEMINI_API_KEY is not defined.');
      return null;
    }

    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

      const prompt = `Persona: ${personaPrompt}\n\nTranscription Chunk: ${transcription}\n\nBased on the persona and the transcription, generate a brief suggestion or insight. Be concise. Use markdown if needed.`;

      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (err) {
      logger.error('AI', 'Error generating suggestion', err);
      return null;
    }
  }

  /**
   * Answers a user question using the current live transcription as context.
   * Hermes is preferred because it is the agent layer; Gemini is the local fallback.
   * @param {Object} params
   * @param {string} params.question
   * @param {string} params.transcript
   * @param {string} [params.personaPrompt]
   * @returns {Promise<{ text: string, provider: string }>}
   */
  async answerTranscriptQuestion({ question, transcript, personaPrompt }) {
    const cleanQuestion = String(question || '').trim();
    const cleanTranscript = String(transcript || '').trim();
    if (!cleanQuestion) {
      throw new Error('Pergunta vazia.');
    }
    if (!cleanTranscript) {
      throw new Error('Ainda nao existe transcricao para consultar.');
    }

    const settings = jsonStore.getSettings();
    const context = [
      personaPrompt ? `Persona ativa:\n${personaPrompt}` : '',
      `Transcricao atual:\n${cleanTranscript}`
    ].filter(Boolean).join('\n\n');

    if (settings?.hermes?.enabled) {
      const hermesResult = await hermesService.ask({
        prompt: cleanQuestion,
        context,
        instruction: [
          'Responda em pt-BR usando a transcricao como fonte principal.',
          'Se a resposta nao estiver na transcricao, diga isso objetivamente e, quando util, explique o que faltou.',
          'Se houver tarefas, decisoes ou pontos importantes, destaque de forma curta.',
          'Nao invente informacoes fora da transcricao.'
        ].join(' '),
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

    const apiKey = settings.general.apiKey || process.env.VITE_GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('Hermes indisponivel e Gemini API key nao configurada.');
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: settings.general.minichatModel || 'gemini-2.5-flash' });
    const prompt = [
      'Responda em pt-BR usando somente a transcricao abaixo como fonte principal.',
      'Se a resposta nao estiver na transcricao, diga isso objetivamente.',
      personaPrompt ? `Persona ativa:\n${personaPrompt}` : '',
      `Transcricao atual:\n${cleanTranscript}`,
      `Pergunta:\n${cleanQuestion}`
    ].filter(Boolean).join('\n\n');

    const result = await model.generateContent(prompt);
    return { text: result.response.text(), provider: 'gemini' };
  }

  /**
   * Generates a short, descriptive session title from the first user message.
   * @param {string} firstMessage - The first user message in the session.
   * @returns {Promise<string>}
   */
  async generateSessionTitle(firstMessage) {
    const settings = jsonStore.getSettings();
    const apiKey = settings.general.apiKey || process.env.VITE_GEMINI_API_KEY;
    if (!apiKey) return this._fallbackTitle(firstMessage);

    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
        systemInstruction: [
          'Você é um gerador de títulos de sessão. Dada a mensagem do usuário, produza um título conciso e descritivo.',
          'Regras:',
          '- Mínimo de 2 palavras, máximo de 5 palavras',
          '- Letra maiúscula em cada palavra principal (Title Case)',
          '- Sem pontuação no final',
          '- Sem aspas, sem emojis, sem markdown',
          '- Orientado a ação quando possível (ex: "Corrigindo Bug de Login", "Configurando Tema Escuro")',
          '- O TÍTULO DEVE SER GERADO EM PORTUGUÊS (PT-BR)',
          '- Retorne APENAS o título, nada mais'
        ].join('\n')
      });

      const result = await model.generateContent(firstMessage.substring(0, 500));
      const raw = result.response.text().trim();
      // Safety: strip any quotes, newlines, or extra spaces
      return raw.replace(/['"]/g, '').replace(/\n.*/g, '').trim() || this._fallbackTitle(firstMessage);
    } catch (err) {
      logger.error('AI', 'Error generating session title', err);
      return this._fallbackTitle(firstMessage);
    }
  }

  _fallbackTitle(text) {
    if (!text) return 'Nova Sessão';
    return text.substring(0, 40).trim() + (text.length > 40 ? '...' : '');
  }

  /**
   * Transcribes audio from base64 data.
   * @param {string} base64Audio - Audio data in base64.
   * @returns {Promise<string|null>}
   */
  async transcribeAudio(base64Audio) {
    const apiKey = jsonStore.getSettings().general.apiKey || process.env.VITE_GEMINI_API_KEY;
    if (!apiKey) {
      logger.warn('AI', 'VITE_GEMINI_API_KEY is not defined.');
      return null;
    }

    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

      const prompt = "Transcreva o áudio exatamente como ele é dito. Não adicione comentários, não interprete, apenas retorne o texto falado.";

      const result = await model.generateContent([
        prompt,
        {
          inlineData: {
            data: base64Audio,
            mimeType: "audio/webm" // Assumindo webm que é o padrão do MediaRecorder no Chrome/Electron
          }
        }
      ]);
      return result.response.text();
    } catch (err) {
      logger.error('AI', 'Error transcribing audio', err);
      throw err;
    }
  }
}

module.exports = new AIService();
