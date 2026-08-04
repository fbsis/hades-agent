import { useCallback, useState } from 'react';
import { ChatMessage } from '../types';
import { electronService } from '../services/electron';

type AddMessage = (
  text: string,
  sender: 'user' | 'ia',
  image?: string,
  options?: { id?: string; status?: ChatMessage['status']; allowEmpty?: boolean }
) => ChatMessage[];

const isProgrammingQuestion = (text: string) => (
  /(programa[cç][aã]o|c[oó]digo|debug|bug|erro|exception|typescript|javascript|react|node|python|java|php|sql|docker|electron|terminal|algoritmo|api|git|npm|tsx|jsx)/i
    .test(text || '')
);

const buildHermesContext = (history: ChatMessage[], maxChars: number) => {
  const context = history.slice(-12).map(message => {
    const role = message.sender === 'user' ? 'usuario' : 'metis';
    return `${role}: ${message.text || ''}`;
  }).join('\n\n');
  return context.length > maxChars ? context.slice(-maxChars) : context;
};

const estimateTokens = (result: any, prompt: string, context = '') => {
  const usage = result?.usage || {};
  const total = usage.total_tokens ?? usage.totalTokens ?? usage.total;
  if (Number.isFinite(Number(total))) return Number(total);
  return Math.max(1, Math.ceil((prompt.length + context.length + String(result?.text || '').length) / 4));
};

export const useAssistant = (
  addMessage: AddMessage,
  updateMessage: (id: string, updater: (message: ChatMessage) => ChatMessage) => ChatMessage[],
  appendMessageText: (id: string, delta: string) => ChatMessage[],
  removeMessage: (id: string) => ChatMessage[]
) => {
  const [isThinking, setIsThinking] = useState(false);
  const [activeTool, setActiveTool] = useState<string | null>(null);

  const createStreamMessage = useCallback(() => {
    const messageId = `ia_stream_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    addMessage('', 'ia', undefined, {
      id: messageId,
      status: 'pending',
      allowEmpty: true
    });
    return messageId;
  }, [addMessage]);

  const finishStreamMessage = useCallback((messageId: string, text: string) => {
    const finalText = text.trim();
    if (!finalText) {
      removeMessage(messageId);
      return false;
    }
    updateMessage(messageId, message => ({ ...message, text: finalText, status: 'sent' }));
    return true;
  }, [removeMessage, updateMessage]);

  const streamHermes = useCallback(async (args: any) => {
    const messageId = createStreamMessage();
    let streamedText = '';
    const result = await electronService.askHermesStream(args, event => {
      if (event.type === 'delta' && event.text) {
        streamedText += event.text;
        appendMessageText(messageId, event.text);
      }
      if (event.type === 'tool') {
        setActiveTool(event.text ? `hermes: ${event.text}` : 'hermes usando ferramenta');
      }
    });
    const finalText = String(result?.text || streamedText);
    if (result?.success !== false && finishStreamMessage(messageId, finalText)) {
      return { ...result, text: finalText.trim() };
    }
    if (streamedText.trim() && finishStreamMessage(messageId, streamedText)) {
      return { ...result, success: true, text: streamedText.trim() };
    }
    removeMessage(messageId);
    return result;
  }, [appendMessageText, createStreamMessage, finishStreamMessage, removeMessage]);

  const streamOpenAI = useCallback(async (args: any) => {
    const messageId = createStreamMessage();
    let streamedText = '';
    const result = await electronService.askOpenAIChatStream(args, event => {
      if (event.type === 'delta' && event.text) {
        streamedText += event.text;
        appendMessageText(messageId, event.text);
      }
    });
    const finalText = String(result?.text || streamedText);
    if (finishStreamMessage(messageId, finalText)) return result || { text: finalText };
    removeMessage(messageId);
    return null;
  }, [appendMessageText, createStreamMessage, finishStreamMessage, removeMessage]);

  const handleAIResponse = useCallback(async (
    userMsgText: string,
    currentHistory: ChatMessage[]
  ): Promise<number> => {
    setIsThinking(true);
    try {
      const settings = await electronService.getSettings();
      const codingQuestion = isProgrammingQuestion(userMsgText);
      const latestUser = [...currentHistory].reverse().find(message => message.sender === 'user');
      const image = latestUser?.image;
      const mode = settings?.assistant?.mode || 'auto';
      const preferredAnswerStyle = settings?.assistant?.preferredAnswerStyle || 'auto';

      let result: any = null;
      let context = '';
      const useHermes = !image
        && Boolean(settings?.hermes?.enabled)
        && settings?.assistant?.delegationEnabled !== false
        && (settings?.hermes?.useAsPrimaryAgent !== false || codingQuestion);

      if (useHermes) {
        setActiveTool('hermes');
        const maxContextChars = settings?.assistant?.compactContext === false
          ? settings?.hermes?.maxContextChars || 8000
          : Math.min(settings?.hermes?.maxContextChars || 3200, 3600);
        context = buildHermesContext(currentHistory, maxContextChars);
        result = await streamHermes({
          prompt: userMsgText,
          context,
          instruction: [
            'Voce e o agente principal do Metis. Responda diretamente em pt-BR.',
            'Use suas ferramentas e memoria persistente quando necessario.',
            'Para codigo, use blocos Markdown com a linguagem correta.',
            'Nao mencione provedores internos.'
          ].join(' '),
          mode,
          preferredAnswerStyle,
          maxOutputTokens: 1800,
          logType: 'primary_chat',
          primaryAgent: true
        });
      }

      if (!result?.text) {
        setActiveTool(image ? 'openai lendo imagem' : 'openai');
        result = await streamOpenAI({
          prompt: userMsgText,
          history: currentHistory.map(message => ({
            sender: message.sender,
            text: message.text
          })),
          image,
          codingQuestion,
          mode,
          preferredAnswerStyle
        });
      }

      if (!result?.text) throw new Error('Nenhum agente retornou uma resposta.');
      const tokens = estimateTokens(result, userMsgText, context);
      await electronService.updateTokens(tokens);
      await electronService.logSession({
        timestamp: new Date().toISOString(),
        messages: [...currentHistory, { text: result.text, role: 'ia' }],
        toolCalls: [{
          name: useHermes && !image ? 'hermes_primary' : 'openai_chat',
          args: { mode, style: preferredAnswerStyle, image: Boolean(image) },
          result: String(result.text).slice(0, 500),
          success: true
        }],
        totalTokens: tokens,
        skillsUsed: []
      });
      return tokens;
    } catch (error: any) {
      console.error('[useAssistant] inference error:', error);
      addMessage(`Erro: ${error.message}`, 'ia');
      return 0;
    } finally {
      setIsThinking(false);
      setActiveTool(null);
    }
  }, [addMessage, streamHermes, streamOpenAI]);

  return { isThinking, activeTool, handleAIResponse };
};
