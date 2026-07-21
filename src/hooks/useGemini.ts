import { useState, useCallback } from 'react';
import { ChatMessage } from '../types';
import { buildHadesContext, getHadesSystemPrompt } from '../constants/prompts';
import { GEMINI_TOOLS } from '../constants/tools';
import { electronService } from '../services/electron';
import { prepareGeminiPayload, processGeminiParts } from '../utils/ai';
import { mapModelIdToApiName } from '../constants/models';

/**
 * Hook to manage Gemini AI inference and tool execution.
 * Handles the conversational Hades agent, tool calls, and state management.
 *
 * Architecture:
 * - Main loop uses native google_search + code_execution (built-in Gemini tools)
 * - read_url uses a SEPARATE Gemini request with url_context (incompatible with function_declarations)
 * - web_search (Tavily) has been removed — replaced by native google_search
 */
export const useGemini = (
  currentModel: string,
  addMessage: (text: string, sender: 'user' | 'ia', image?: string) => ChatMessage[]
) => {
  const [isThinking, setIsThinking] = useState(false);
  const [activeTool, setActiveTool] = useState<string | null>(null);

  const buildCompactHermesContext = (contents: any[]) => {
    const lines = contents.slice(-6).map((content) => {
      const role = content.role || 'turn';
      const text = (content.parts || []).map((part: any) => {
        if (typeof part.text === 'string') return part.text;
        if (part.functionCall?.name) return `[tool_call:${part.functionCall.name}]`;
        if (part.functionResponse?.name) return `[tool_result:${part.functionResponse.name}]`;
        return '';
      }).filter(Boolean).join('\n');
      return text ? `${role}: ${text}` : '';
    }).filter(Boolean);

    const joined = lines.join('\n\n');
    return joined.length > 2400 ? joined.slice(-2400) : joined;
  };

  const buildHermesChatContext = (history: ChatMessage[], maxChars: number) => {
    const lines = history.slice(-12).map((message) => {
      const role = message.sender === 'user' ? 'usuario' : 'hades';
      const imageNote = message.image ? '\n[imagem anexada no Hades; o contexto visual lido pelo Gemini sera enviado separadamente quando disponivel]' : '';
      return `${role}: ${message.text || ''}${imageNote}`;
    });

    const context = lines.join('\n\n');
    return context.length > maxChars ? context.slice(-maxChars) : context;
  };

  const estimateHermesTokens = (result: any, prompt: string, context: string) => {
    const usageTotal = result?.usage?.total_tokens || result?.usage?.totalTokens;
    if (Number.isFinite(Number(usageTotal))) return Number(usageTotal);
    const responseChars = result?.text ? String(result.text).length : 0;
    return Math.max(1, Math.ceil((prompt.length + context.length + responseChars) / 4));
  };

  const isProgrammingQuestion = (text: string) => {
    const normalized = (text || '').toLowerCase();
    return /(programa[cç][aã]o|quest[aã]o de c[oó]digo|quest[aã]o de programa[cç][aã]o|c[oó]digo|codar|debug|bug|erro|exception|stack trace|compila|build|typescript|javascript|react|node|python|java|php|sql|docker|electron|terminal|algoritmo|leetcode|hackerrank|fun[cç][aã]o|classe|vari[aá]vel|api|regex|git|npm|yarn|pnpm|prisma|typescript|tsx|jsx)/i.test(normalized);
  };

  const isVisualAnswerRequest = (text: string) => {
    const normalized = (text || '').toLowerCase().trim();
    if (!normalized) return true;
    return /(imagem|foto|print|screenshot|captura|tela|janela|aqui|isso|essa|esse|nisto|descrev|analisa|interpreta|o que|qual|onde|transcrev|l[eê]|ler|conte[uú]do|temos|vendo|aparece)/i.test(normalized);
  };

  const getLatestUserImage = (history: ChatMessage[]) => {
    const latestUserMessage = [...history].reverse().find((message) => message.sender === 'user');
    return latestUserMessage?.image || null;
  };

  const parseDataUrl = (dataUrl: string) => {
    const match = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl || '');
    return {
      mimeType: match?.[1] || 'image/png',
      data: match?.[2] || dataUrl.split(',')[1] || dataUrl
    };
  };

  const parseVisualAnalysis = (rawText: string) => {
    const fallback = {
      summary: rawText.trim(),
      detectedQuestion: '',
      extractedText: '',
      programmingQuestionVisible: false,
      answerVisible: false,
      directAnswer: '',
      confidence: 0
    };

    const cleaned = rawText.replace(/```json|```/gi, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end <= start) return fallback;

    try {
      const parsed = JSON.parse(cleaned.slice(start, end + 1));
      return {
        summary: String(parsed.summary || fallback.summary || '').trim(),
        detectedQuestion: String(parsed.detectedQuestion || parsed.detected_question || '').trim(),
        extractedText: String(parsed.extractedText || parsed.extracted_text || '').trim(),
        programmingQuestionVisible: Boolean(parsed.programmingQuestionVisible ?? parsed.programming_question_visible),
        answerVisible: Boolean(parsed.answerVisible ?? parsed.answer_visible),
        directAnswer: String(parsed.directAnswer || parsed.direct_answer || '').trim(),
        confidence: Number(parsed.confidence || 0)
      };
    } catch {
      return fallback;
    }
  };

  const formatVisualContextForHermes = (analysis: any, sourceLabels: string[]) => {
    const lines = [
      'CONTEXTO VISUAL LIDO PELO GEMINI:',
      `Origem: ${sourceLabels.join(', ')}`,
      analysis.summary ? `Resumo visual: ${analysis.summary}` : '',
      analysis.detectedQuestion ? `Pergunta detectada: ${analysis.detectedQuestion}` : '',
      analysis.extractedText ? `Texto/codigo extraido:\n${analysis.extractedText}` : ''
    ].filter(Boolean);

    return lines.join('\n');
  };

  const appendContext = (baseContext: string, extraContext: string, maxChars: number) => {
    const combined = [baseContext, extraContext].filter(Boolean).join('\n\n');
    return combined.length > maxChars ? combined.slice(-maxChars) : combined;
  };

  const collectVisualSources = useCallback(async (
    history: ChatMessage[]
  ): Promise<Array<{ label: string; dataUrl: string }>> => {
    const sources: Array<{ label: string; dataUrl: string }> = [];
    const attachedImage = getLatestUserImage(history);

    if (attachedImage) {
      sources.push({ label: 'imagem anexada pelo usuario', dataUrl: attachedImage });
    }

    return sources;
  }, []);

  const analyzeVisualContextWithGemini = useCallback(async (
    apiKey: string,
    userPrompt: string,
    sources: Array<{ label: string; dataUrl: string }>,
    programmingQuestion: boolean
  ) => {
    if (!sources.length) return null;

    setActiveTool('gemini lendo imagem');
    const apiModel = mapModelIdToApiName(currentModel);
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${apiModel}:generateContent?key=${apiKey}`;
    const instruction = programmingQuestion
      ? [
        'Leia TODO o conteudo visivel nas imagens: codigo, enunciado, alternativas, erro, terminal, navegador e IDE.',
        'Identifique a pergunta correta antes de responder; coloque essa pergunta em detectedQuestion.',
        'Se a resposta final estiver visivel ou puder ser deduzida somente pelo que aparece na tela, marque answerVisible=true e preencha directAnswer com a resposta final em Markdown.',
        'Se a resposta exigir codigo, directAnswer deve conter o codigo em bloco Markdown com linguagem, por exemplo ```ts.',
        'Se precisar de trabalho adicional, marque answerVisible=false e compacte o contexto para outro agente responder.',
        `Pergunta do usuario: ${userPrompt || '(sem texto)'}`,
        'Retorne SOMENTE JSON valido neste formato: {"summary":"...","detectedQuestion":"...","extractedText":"...","programmingQuestionVisible":true,"answerVisible":false,"directAnswer":"","confidence":0.0}'
      ].join('\n')
      : [
        'Descreva objetivamente a imagem para um agente sem visao.',
        'Extraia qualquer texto, codigo, erro, tela, UI ou dado importante.',
        'Se o pedido do usuario for sobre o que aparece na imagem/tela, marque answerVisible=true e preencha directAnswer com a melhor resposta final para o usuario.',
        'Nao diga que o resumo esta truncado; se algo estiver ilegivel, diga apenas qual parte nao esta legivel e responda o restante com seguranca.',
        'Nao ofereca dividir por partes; responda diretamente ao pedido atual.',
        'Se a imagem contiver uma questao de programacao, codigo, erro ou enunciado tecnico, marque programmingQuestionVisible=true.',
        'Nesse caso, identifique a pergunta correta em detectedQuestion; se a resposta final estiver visivel ou dedutivel apenas pela imagem, marque answerVisible=true e preencha directAnswer em Markdown.',
        'Se directAnswer exigir codigo, use bloco Markdown com linguagem, por exemplo ```tsx.',
        'Se nao for pedido visual direto nem programacao, gere contexto reutilizavel para o Hermes.',
        `Pedido do usuario: ${userPrompt || '(sem texto)'}`,
        'Retorne SOMENTE JSON valido neste formato: {"summary":"...","detectedQuestion":"...","extractedText":"...","programmingQuestionVisible":false,"answerVisible":false,"directAnswer":"","confidence":0.0}'
      ].join('\n');

    const parts = [
      { text: instruction },
      ...sources.map((source) => {
        const { mimeType, data } = parseDataUrl(source.dataUrl);
        return { inline_data: { mime_type: mimeType, data } };
      })
    ];

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { temperature: 0.1, maxOutputTokens: programmingQuestion ? 2200 : 1800 }
      })
    });

    if (response.status === 429) {
      return {
        error: 'LIMIT',
        tokens: 0,
        analysis: null,
        context: 'Gemini atingiu o limite ao tentar ler a imagem/tela.'
      };
    }

    const data = await response.json();
    if (data.error && typeof data.error === 'object') {
      throw new Error(data.error.message || JSON.stringify(data.error));
    }

    const text = data.candidates?.[0]?.content?.parts
      ?.map((part: any) => part.text)
      .filter(Boolean)
      .join('\n') || '';
    const analysis = parseVisualAnalysis(text);
    const tokens = data.usageMetadata?.totalTokenCount || Math.max(1, Math.ceil((instruction.length + text.length) / 4));

    return {
      error: null,
      tokens,
      analysis,
      context: formatVisualContextForHermes(analysis, sources.map((source) => source.label))
    };
  }, [currentModel]);

  /**
   * Reads a URL by making a SEPARATE Gemini request using the native url_context tool.
   * This is necessary because url_context is incompatible with function_declarations
   * in the same request. Benefits over manual scraping: Cloudflare bypass, PDF support,
   * structured extraction, up to 20 URLs / 34MB per call.
   */
  const fetchWithUrlContext = useCallback(async (url: string, instruction?: string): Promise<string> => {
    const settings = await electronService.getSettings();
    const apiKey = settings?.general?.apiKey || import.meta.env.VITE_GEMINI_API_KEY;
    const apiModel = mapModelIdToApiName(currentModel);
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${apiModel}:generateContent?key=${apiKey}`;
    const prompt = instruction
      ? `${instruction}\n\nURL: ${url}`
      : `Leia e extraia o conteúdo principal desta URL de forma estruturada: ${url}`;

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          tools: [{ url_context: {} }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 4096 }
        })
      });

      if (!response.ok) {
        return `Erro ao acessar URL (HTTP ${response.status}).`;
      }

      const data = await response.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text
        || 'Não foi possível extrair o conteúdo da URL.';
    } catch (err) {
      console.error('[useGemini] fetchWithUrlContext error:', err);
      return 'Erro ao ler a URL.';
    }
  }, [currentModel]);

  /**
   * Executes a tool requested by the AI.
   */
  const executeTool = useCallback(async (name: string, args: any, currentContents: any[]) => {
    setActiveTool(name);

    try {
      switch (name) {
        case "get_open_windows":
          return await electronService.getSources();

        case "capture_screen": {
          const base64 = await electronService.captureSource(args.source_id);
          currentContents.push({
            role: 'user',
            parts: [
              { text: `CONTEXTO VISUAL DA TELA (${args.source_id}):` },
              { inline_data: { mime_type: "image/png", data: base64.split(',')[1] } }
            ]
          });
          return { status: "success", info: "Imagem capturada com sucesso." };
        }
        
        case "search_web":
          return await electronService.searchWeb(args.query);

        case "read_url":
          // Uses a separate Gemini request with native url_context (bypass Cloudflare, PDF support)
          return await fetchWithUrlContext(args.url, args.instruction);

        case "schedule_task":
          return await electronService.scheduleTask(args);

        case "list_tasks":
          return await electronService.getTasks();

        case "delete_task":
          return await electronService.deleteTask(args.id);

        case "save_skill":
          return await electronService.saveSkill(args);

        case "list_skills":
          return await electronService.listSkills();

        case "load_skill":
          return await electronService.loadSkill(args.name);

        case "ask_hermes": {
          const result = await electronService.askHermes({
            prompt: args.prompt || args.task || args.query || '',
            context: args.context || buildCompactHermesContext(currentContents),
            instruction: args.instruction,
            maxOutputTokens: args.max_output_tokens || args.maxOutputTokens || 900,
            logType: 'tool_ask'
          });
          if (!result || result.success === false) {
            return `Erro Hermes: ${result?.error || 'sem retorno'}`;
          }
          return result.text || 'Hermes executou, mas nao retornou texto.';
        }

        case "remember_with_hermes": {
          const result = await electronService.rememberWithHermes({
            kind: args.kind || 'note',
            title: args.title,
            source: 'hades_tool',
            text: args.text
          });
          if (!result || result.success === false) {
            return `Erro Hermes: ${result?.error || 'sem retorno'}`;
          }
          return result.text || 'Memoria enviada ao Hermes.';
        }

        case "complete_task":
          return args.answer || "Tarefa finalizada.";

        case "send_message":
          addMessage(args.text, 'ia');
          return "Mensagem enviada ao chat.";

        case "show_chat":
          electronService.showChat();
          return "Janela de chat aberta.";

        case "notify":
          electronService.showNotification(args.text);
          return "Notificação enviada.";

        default:
          return "Ferramenta não encontrada.";
      }
    } catch (err) {
      console.error(`[useGemini] Error executing tool ${name}:`, err);
      return `Erro ao executar ${name}.`;
    }
  }, [addMessage, fetchWithUrlContext]);

  /**
   * Performs a single fetch request to the Gemini API.
   * Native tools enabled: google_search (replaces Tavily), code_execution (new).
   */
  const fetchInference = async (url: string, contents: any[], toolsToInject: any) => {
    const payload = {
      contents,
      tools: [
        toolsToInject              // custom function_declarations
      ],
      generationConfig: { temperature: 0.7, maxOutputTokens: 4096 }
    };

    console.groupCollapsed("🤖 [Gemini API] Request Payload");
    console.log("URL:", url);
    console.log("System Prompt / Contents:", JSON.stringify(contents, null, 2));
    console.log("Tools injected:", JSON.stringify(payload.tools, null, 2));
    console.log("Full Payload size:", JSON.stringify(payload).length, "bytes");
    console.groupEnd();

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (response.status === 429) {
      console.warn("🤖 [Gemini API] 429 RATE LIMIT REACHED");
      return { error: "LIMIT" };
    }
    const data = await response.json();
    
    console.groupCollapsed("🤖 [Gemini API] Response Data");
    console.log("Response JSON:", JSON.stringify(data, null, 2));
    console.log("Total Tokens used:", data.usageMetadata?.totalTokenCount);
    console.log("Prompt tokens:", data.usageMetadata?.promptTokenCount);
    console.log("Candidates tokens:", data.usageMetadata?.candidatesTokenCount);
    console.groupEnd();

    if (data.error && typeof data.error === 'object') {
      throw new Error(data.error.message || JSON.stringify(data.error));
    }
    return data;
  };

  /**
   * Main ReAct loop: execute tools autonomously before responding.
   */
  const runReactLoop = async (url: string, contents: any[], toolsToInject: any) => {
    let callCount = 0;
    let aiText = "";
    let hasFinalAnswer = false;
    let hasUsedSendMessage = false;
    let totalTokens = 0;
    const toolCallsLog: any[] = [];

    while (callCount < 20 && !hasFinalAnswer) {
      const data = await fetchInference(url, contents, toolsToInject);
      if (data.error === "LIMIT") {
        aiText = "⚠️ LIMITE DE REQUISIÇÕES ATINGIDO.";
        break;
      }

      const parts = data.candidates?.[0]?.content?.parts || [];
      const { textContent, functionCalls } = processGeminiParts(parts);
      if (textContent) aiText = textContent;

      if (data.usageMetadata?.totalTokenCount) {
        const count = data.usageMetadata.totalTokenCount;
        totalTokens += count;
        await electronService.updateTokens(count);
      }

      if (functionCalls.length === 0) {
        hasFinalAnswer = true;
        continue;
      }

      contents.push(data.candidates[0].content);

      const toolResults = await Promise.all(functionCalls.map(async (fc) => {
        const { name, args } = fc;
        if (name === "complete_task") {
          aiText = args.answer || "";
          hasFinalAnswer = true;
          return { functionResponse: { name, response: { content: "OK" } } };
        }
        if (name === "send_message") {
          hasUsedSendMessage = true;
        }
        const start = Date.now();
        const result = await executeTool(name, args, contents);
        const duration = Date.now() - start;
        
        toolCallsLog.push({
          name,
          args,
          result: typeof result === 'string' ? result.substring(0, 500) : result,
          success: !String(result).startsWith("Erro"),
          duration_ms: duration
        });
        
        return { functionResponse: { name, response: { content: result } } };
      }));

      contents.push({ role: 'function', parts: toolResults as any });
      callCount++;
    }

    return { aiText, hasUsedSendMessage, totalTokens, toolCallsLog };
  };

  /**
   * Main entry point for AI inference.
   * Builds enriched context (date, time, timezone, etc.) and runs the ReAct loop.
   */
  const handleAIResponse = useCallback(async (userMsgText: string, currentHistory: ChatMessage[]): Promise<number> => {
    setIsThinking(true);

    try {
      const settings = await electronService.getSettings();
      const assistantMode = settings?.assistant?.mode || 'auto';
      const preferredAnswerStyle = settings?.assistant?.preferredAnswerStyle || 'auto';
      const apiKey = settings?.general?.apiKey || import.meta.env.VITE_GEMINI_API_KEY;
      let codingQuestion = isProgrammingQuestion(userMsgText);
      const hermesPrimary = !!settings?.hermes?.enabled
        && settings?.hermes?.useAsPrimaryAgent !== false
        && settings?.assistant?.delegationEnabled !== false;
      let hermesAvailableForFallback = true;
      let visualContext = '';
      let visualTokens = 0;
      const wantsDirectVisualAnswer = isVisualAnswerRequest(userMsgText);

      const visualSources = await collectVisualSources(currentHistory);
      if (visualSources.length > 0) {
        if (!apiKey) {
          visualContext = 'O usuario anexou imagem ou pediu leitura da tela, mas a API key do Gemini nao esta configurada para gerar contexto visual.';
        } else {
          try {
            const visualResult = await analyzeVisualContextWithGemini(apiKey, userMsgText, visualSources, codingQuestion);
            visualContext = visualResult?.context || '';
            visualTokens = visualResult?.tokens || 0;
            if (visualResult?.analysis?.programmingQuestionVisible) {
              codingQuestion = true;
            }

            if (visualTokens > 0) {
              await electronService.updateTokens(visualTokens);
            }

            const directAnswer = visualResult?.analysis?.directAnswer?.trim();
            const confidence = Number(visualResult?.analysis?.confidence || 0);
            if ((codingQuestion || wantsDirectVisualAnswer) && visualResult?.analysis?.answerVisible && directAnswer) {
              addMessage(directAnswer, 'ia');
              try {
                await electronService.logSession({
                  timestamp: new Date().toISOString(),
                  messages: [...currentHistory, { text: directAnswer, role: 'ia' }],
                  toolCalls: [{
                    name: codingQuestion ? 'gemini_visual_code_answer' : 'gemini_visual_direct_answer',
                    args: { sourceCount: visualSources.length, confidence, codingQuestion },
                    result: directAnswer.substring(0, 500),
                    success: true,
                    duration_ms: 0
                  }],
                  totalTokens: visualTokens,
                  skillsUsed: []
                });
              } catch (logErr) {
                console.error("Erro ao fazer log da leitura visual Gemini", logErr);
              }
              return visualTokens;
            }
          } catch (visualErr: any) {
            console.error('[useGemini] Gemini visual read failed:', visualErr);
            visualContext = `Falha ao gerar contexto visual pelo Gemini: ${visualErr?.message || 'erro desconhecido'}.`;
          }
        }
      }

      const effectiveUserPrompt = userMsgText.trim()
        || (visualContext ? 'Analise a imagem/tela enviada e responda ao usuario.' : userMsgText);

      if (hermesPrimary) {
        setActiveTool('hermes');
        const maxContextChars = settings?.assistant?.compactContext === false
          ? settings?.hermes?.maxContextChars || 8000
          : Math.min(settings?.hermes?.maxContextChars || 3200, 3600);
        const context = appendContext(buildHermesChatContext(currentHistory, maxContextChars), visualContext, maxContextChars);
        const result = await electronService.askHermes({
          prompt: effectiveUserPrompt,
          context,
          instruction: [
            'Voce e o agente principal do Hades no MiniChat.',
            'Responda diretamente ao usuario em pt-BR.',
            'Use suas ferramentas e memoria persistente para web atual, Google, APIs, CLI, pesquisa, contexto pessoal e tarefas multi-step.',
            'Quando o usuario pedir para lembrar/salvar ou quando surgir uma preferencia, decisao, fato pessoal ou ideia reutilizavel, use sua memoria persistente.',
            'Gemini fica reservado para transcricao rapida, titulos de sessao e fallback; nao diga para o usuario trocar de modelo.',
            'Quando houver CONTEXTO VISUAL LIDO PELO GEMINI, use esse contexto como a leitura oficial da imagem/tela pelo Hades.',
            'Em questoes de programacao, considere codigo, erro, terminal e enunciado extraidos pelo Gemini antes de responder.',
            'Nao diga que o resumo visual esta truncado; se faltar contexto visual indispensavel, diga exatamente o que falta.',
            'Quando responder com codigo, use blocos Markdown com a linguagem correta.'
          ].join(' '),
          mode: assistantMode,
          preferredAnswerStyle,
          maxOutputTokens: 1600,
          logType: 'primary_chat',
          primaryAgent: true
        });

        if (result?.success !== false && result?.text) {
          addMessage(result.text, 'ia');
          const hermesTokens = estimateHermesTokens(result, effectiveUserPrompt, context);
          const totalTurnTokens = visualTokens + hermesTokens;
          await electronService.updateTokens(hermesTokens);

          try {
            await electronService.logSession({
              timestamp: new Date().toISOString(),
              messages: [...currentHistory, { text: result.text, role: 'ia' }],
              toolCalls: [{
                name: 'hermes_primary',
                args: { mode: assistantMode, style: preferredAnswerStyle },
                result: result.text.substring(0, 500),
                success: true,
                duration_ms: result.durationMs || 0
              }],
              totalTokens: totalTurnTokens,
              skillsUsed: []
            });
          } catch (logErr) {
            console.error("Erro ao fazer log da sessão Hermes", logErr);
          }

          return totalTurnTokens;
        }

        hermesAvailableForFallback = false;
        console.warn('[useGemini] Hermes primary failed, falling back to Gemini:', result?.error);
      }

      if (!apiKey) throw new Error("API Key não configurada.");

      // Fetch dynamic context
      const skillsResp = await electronService.listSkills();
      const activeSkills = skillsResp && Array.isArray(skillsResp) && skillsResp.length > 0 
          ? `[${skillsResp.map((s: any) => s.name).join(', ')}]` 
          : 'Nenhuma skill disponível.';
      
      const learnings = await electronService.getLearnings();
      const delegationEnabled = settings?.assistant?.delegationEnabled !== false;
      const hermesEnabled = !!settings?.hermes?.enabled && delegationEnabled && hermesAvailableForFallback;

      const msgLower = userMsgText.toLowerCase();
      const hermesStatus = hermesEnabled
        ? `Hermes disponivel em ${settings?.hermes?.baseUrl || 'http://127.0.0.1:8642'} com session key ${settings?.hermes?.sessionKey || 'hades-default'}.`
        : 'Hermes desativado ou delegacao desligada.';

      if (!hermesPrimary && hermesEnabled && codingQuestion) {
        setActiveTool('hermes');
        const maxContextChars = settings?.assistant?.compactContext === false
          ? settings?.hermes?.maxContextChars || 8000
          : Math.min(settings?.hermes?.maxContextChars || 3200, 3600);
        const context = appendContext(buildHermesChatContext(currentHistory, maxContextChars), visualContext, maxContextChars);
        const result = await electronService.askHermes({
          prompt: effectiveUserPrompt,
          context,
          instruction: [
            'Responda diretamente em pt-BR como agente auxiliar do Hades.',
            'Esta e uma pergunta de programacao; use o contexto visual lido pelo Gemini quando ele existir.',
            'Se o contexto visual trouxe codigo, erro, terminal ou enunciado, trate-o como fonte principal.',
            'Se a resposta for objetiva, devolva somente a resposta necessaria.',
            'Nao diga que o resumo visual esta truncado; se faltar contexto visual indispensavel, diga exatamente o que falta.',
            'Quando responder com codigo, use blocos Markdown com a linguagem correta.'
          ].join(' '),
          mode: assistantMode,
          preferredAnswerStyle,
          maxOutputTokens: 1600,
          logType: 'coding_chat',
          primaryAgent: false
        });

        if (result?.success !== false && result?.text) {
          addMessage(result.text, 'ia');
          const hermesTokens = estimateHermesTokens(result, effectiveUserPrompt, context);
          const totalTurnTokens = visualTokens + hermesTokens;
          await electronService.updateTokens(hermesTokens);

          try {
            await electronService.logSession({
              timestamp: new Date().toISOString(),
              messages: [...currentHistory, { text: result.text, role: 'ia' }],
              toolCalls: [{
                name: 'hermes_coding',
                args: { mode: assistantMode, style: preferredAnswerStyle, visualContext: !!visualContext },
                result: result.text.substring(0, 500),
                success: true,
                duration_ms: result.durationMs || 0
              }],
              totalTokens: totalTurnTokens,
              skillsUsed: []
            });
          } catch (logErr) {
            console.error("Erro ao fazer log da sessão Hermes/código", logErr);
          }

          return totalTurnTokens;
        }

        console.warn('[useGemini] Hermes coding failed, falling back to Gemini:', result?.error);
      }

      // Build rich context for system prompt (Phases 1, 2, 4, 5)
      const ctx = buildHadesContext(activeSkills, learnings, assistantMode, preferredAnswerStyle, hermesStatus);
      const systemPrompt = getHadesSystemPrompt(ctx);

      console.groupCollapsed("🧠 [Hades Context] Generation");
      console.log("Active Skills Length (chars):", activeSkills.length);
      console.log("Learnings Length (chars):", learnings ? JSON.stringify(learnings).length : 0);
      console.log("System Prompt Length (chars):", systemPrompt.length);
      console.log("System Prompt Preview:", systemPrompt.substring(0, 500) + "...");
      console.groupEnd();

      // --- Lightweight Intent Router (Phase 4) ---
      const needsWeb = /(pesquis|busc|not[íi]cia|google|site|web|link|url|resum|leia|youtube)/i.test(msgLower);
      const needsHermesExternal = /(tempo|clima|weather|previs[aã]o|pesquis|busc|google|not[íi]cia|api|extern|cli|terminal|shell|comando|github|npm|site atual|web atual|cota[cç][aã]o|pre[cç]o)/i.test(msgLower);
      const needsHermesMemory = /(curr[íi]culo|cv|entrevist|vaga|recrut|experi[eê]ncia|projeto|mem[óo]ria|lembra|ideia|document|hist[oó]rico|prefer[eê]ncia|perfil|arquitetura|contexto)/i.test(msgLower);
      const needsSystem = /(tira|captur|tela|agend|lembr|taref|chat|notific|skill|mem[óo]ria)/i.test(msgLower);
      const shouldSaveMemory = /(lembra|lembrar|guarda|guardar|salva|salvar|memoriza|ideia nova|anota)/i.test(msgLower);

      let filteredTools = GEMINI_TOOLS.function_declarations.filter(t => t.name === 'complete_task' || t.name === 'send_message');

      if (hermesEnabled && (
        (settings?.hermes?.useForExternalActions !== false && needsHermesExternal) ||
        (settings?.hermes?.useForMemory !== false && needsHermesMemory) ||
        codingQuestion ||
        assistantMode !== 'auto'
      )) {
        filteredTools.push(...GEMINI_TOOLS.function_declarations.filter(t => t.name === 'ask_hermes'));
      }
      if (hermesEnabled && settings?.hermes?.useForMemory !== false && shouldSaveMemory) {
        filteredTools.push(...GEMINI_TOOLS.function_declarations.filter(t => t.name === 'remember_with_hermes'));
      }
      if (needsWeb && (!hermesEnabled || settings?.hermes?.useForExternalActions === false)) {
        filteredTools.push(...GEMINI_TOOLS.function_declarations.filter(t => ['search_web', 'read_url'].includes(t.name)));
      }
      if (needsSystem) {
        filteredTools.push(...GEMINI_TOOLS.function_declarations.filter(t => 
          ['capture_screen', 'get_open_windows', 'schedule_task', 'list_tasks', 'delete_task', 'notify', 'show_chat'].includes(t.name)
        ));
      }
      if (!needsWeb && !needsSystem && msgLower.length > 60) {
        filteredTools = GEMINI_TOOLS.function_declarations.filter(t => {
          if (['ask_hermes', 'remember_with_hermes'].includes(t.name)) return hermesEnabled;
          if (['search_web', 'read_url'].includes(t.name)) return !hermesEnabled || settings?.hermes?.useForExternalActions === false;
          return true;
        });
      }

      const toolsToInject = { function_declarations: filteredTools };
      // ------------------------------------------

      const apiModel = mapModelIdToApiName(currentModel);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${apiModel}:generateContent?key=${apiKey}`;
      const contents = prepareGeminiPayload(systemPrompt, currentHistory);

      if (userMsgText && !currentHistory.some(m => m.text === userMsgText)) {
        contents.push({ role: 'user', parts: [{ text: userMsgText }] });
      }
      if (visualContext) {
        contents.push({
          role: 'user',
          parts: [{
            text: [
              visualContext,
              codingQuestion
                ? 'Use este contexto visual para responder. Se precisar de raciocinio/ferramentas fora do Gemini, chame ask_hermes e envie este contexto.'
                : 'Use este contexto visual no lugar de pedir acesso direto a imagem.'
            ].join('\n\n')
          }]
        });
      }

      const { aiText, hasUsedSendMessage, totalTokens, toolCallsLog } = await runReactLoop(url, contents, toolsToInject);
      const totalTurnTokens = visualTokens + totalTokens;

      if (aiText && !hasUsedSendMessage) {
        addMessage(aiText, 'ia');
      }

      // Log Session for Dreaming (Phase 5)
      try {
        await electronService.logSession({
          timestamp: new Date().toISOString(),
          messages: [...currentHistory, { text: userMsgText, role: 'user' }, { text: aiText, role: 'ia' }],
          toolCalls: toolCallsLog,
          totalTokens: totalTurnTokens,
          skillsUsed: toolCallsLog.filter(t => t.name === 'load_skill').map(t => t.args.name)
        });
      } catch (logErr) {
        console.error("Erro ao fazer log da sessão", logErr);
      }

      return totalTurnTokens;

    } catch (error: any) {
      console.error("[useGemini] Inference error:", error);
      addMessage(`Erro: ${error.message}`, 'ia');
      return 0;
    } finally {
      setIsThinking(false);
      setActiveTool(null);
    }
  }, [currentModel, addMessage, executeTool]);

  return {
    isThinking,
    activeTool,
    handleAIResponse
  };
};
