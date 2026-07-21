const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const store = require('../store/jsonStore');
const logger = require('./logger');

const MAX_USAGE_ENTRIES = 120;

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function clip(value, maxChars) {
  const text = String(value || '').trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[conteudo truncado para economizar tokens]`;
}

function safeReadJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    logger.error('HERMES', `read json failed: ${path.basename(filePath)}`, error);
    return fallback;
  }
}

function safeWriteJson(filePath, data) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    logger.error('HERMES', `write json failed: ${path.basename(filePath)}`, error);
  }
}

function maskSecret(value) {
  if (!value) return '';
  if (value.length <= 8) return '********';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function extractCompletionText(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map(part => typeof part?.text === 'string' ? part.text : '')
      .join('')
      .trim();
  }
  return '';
}

class HermesService {
  constructor() {
    this.usagePath = null;
  }

  getUsagePath() {
    if (!this.usagePath) {
      this.usagePath = path.join(app.getPath('userData'), 'hermes_usage.json');
    }
    return this.usagePath;
  }

  loadUsage() {
    const entries = safeReadJson(this.getUsagePath(), []);
    return Array.isArray(entries) ? entries : [];
  }

  appendUsage(entry) {
    const entries = this.loadUsage();
    entries.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      ...entry
    });
    safeWriteJson(this.getUsagePath(), entries.slice(-MAX_USAGE_ENTRIES));
  }

  getConfig() {
    const settings = store.getSettings();
    const hermes = settings?.hermes || {};

    const baseUrl = String(hermes.baseUrl || 'http://127.0.0.1:8642').replace(/\/+$/, '');
    const apiBaseUrl = baseUrl.endsWith('/v1') ? baseUrl : `${baseUrl}/v1`;

    return {
      enabled: !!hermes.enabled,
      baseUrl,
      apiBaseUrl,
      apiKey: hermes.apiKey || '',
      sessionKey: hermes.sessionKey || 'hades-default',
      model: hermes.model || 'hermes-agent',
      timeoutMs: clampNumber(hermes.timeoutMs, 30000, 3000, 120000),
      maxContextChars: clampNumber(hermes.maxContextChars, 3200, 800, 20000),
      meetingSummaryMaxChars: clampNumber(hermes.meetingSummaryMaxChars, 12000, 2000, 60000),
      useAsPrimaryAgent: hermes.useAsPrimaryAgent !== false,
      useForExternalActions: hermes.useForExternalActions !== false,
      useForMemory: hermes.useForMemory !== false,
      autoForwardConversations: !!hermes.autoForwardConversations,
      autoForwardTasksPersonas: !!hermes.autoForwardTasksPersonas,
      autoSummarizeMeetings: hermes.autoSummarizeMeetings !== false
    };
  }

  getHeaders(config) {
    const headers = {
      'Content-Type': 'application/json',
      'X-Hermes-Session-Key': config.sessionKey
    };

    if (config.apiKey) {
      headers.Authorization = `Bearer ${config.apiKey}`;
    }

    return headers;
  }

  async request(endpoint, options = {}) {
    const config = this.getConfig();
    if (!config.enabled) {
      throw new Error('Hermes esta desativado nas configuracoes.');
    }

    if (typeof fetch !== 'function') {
      throw new Error('fetch nao esta disponivel no processo Electron.');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs || config.timeoutMs);
    const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const url = `${config.apiBaseUrl}${normalizedEndpoint}`;

    try {
      const response = await fetch(url, {
        method: options.method || 'GET',
        headers: this.getHeaders(config),
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal
      });

      const rawText = await response.text();
      let data = null;
      try {
        data = rawText ? JSON.parse(rawText) : null;
      } catch {
        data = { text: rawText };
      }

      if (!response.ok) {
        const message = data?.error?.message || data?.message || rawText || response.statusText;
        throw new Error(`Hermes HTTP ${response.status}: ${message}`);
      }

      return data;
    } finally {
      clearTimeout(timeout);
    }
  }

  buildLocalContext(maxChars) {
    const tasks = store.getTasks()
      .filter(task => !task.completed)
      .slice(0, 12)
      .map(task => `- ${task.description} (${task.time})`)
      .join('\n');

    const personas = store.getPersonas()
      .slice(0, 8)
      .map(persona => {
        const name = persona.name || persona.id || 'persona';
        const prompt = clip(persona.systemPrompt || persona.description || '', 360);
        return `- ${name}: ${prompt}`;
      })
      .join('\n');

    let learnings = 'Nenhuma memoria consolidada local.';
    try {
      learnings = require('./dreamService').getLearnings();
    } catch (error) {
      logger.warn('HERMES', `dream learnings unavailable: ${error.message}`);
    }

    const now = new Date();
    const context = [
      `Data local: ${now.toLocaleDateString('en-CA')} ${now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`,
      `Fuso: ${Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo'}`,
      '',
      '<tarefas_pendentes>',
      tasks || 'Nenhuma tarefa pendente.',
      '</tarefas_pendentes>',
      '',
      '<personas_hades>',
      personas || 'Nenhuma persona salva.',
      '</personas_hades>',
      '',
      '<memoria_dream_hades>',
      clip(learnings, 1200),
      '</memoria_dream_hades>'
    ].join('\n');

    return clip(context, maxChars);
  }

  buildSystemPrompt(args, config) {
    const mode = args.mode || store.getSettings()?.assistant?.mode || 'auto';
    const style = args.preferredAnswerStyle || store.getSettings()?.assistant?.preferredAnswerStyle || 'auto';

    return [
      args.primaryAgent
        ? 'Voce e o Hermes Agent sendo usado como agente principal do Hades Agent.'
        : 'Voce e o Hermes Agent sendo chamado pelo Hades Agent como agente auxiliar.',
      'Use suas proprias ferramentas e memoria persistente quando isso for necessario.',
      'O Hades envia contexto compacto; nao assuma que ele enviou todo o historico.',
      'Priorize respostas curtas, verificaveis e acionaveis.',
      'Para clima, web atual, APIs externas, CLI, pesquisa e tarefas multi-step, execute a acao no Hermes quando suas ferramentas permitirem.',
      'Para memorias, curriculo, entrevistas, preferencias e documentos, use a memoria persistente do Hermes quando apropriado.',
      `Modo Hades: ${mode}. Estilo preferido: ${style}. Session key: ${config.sessionKey}.`
    ].join('\n');
  }

  async ask(args = {}) {
    const config = this.getConfig();
    if (!config.enabled) {
      return { success: false, error: 'Hermes esta desativado nas configuracoes.' };
    }

    const start = Date.now();
    const includeLocalContext = args.includeLocalContext !== false;
    const localContext = includeLocalContext ? this.buildLocalContext(config.maxContextChars) : '';
    const context = clip(args.context || '', config.maxContextChars);
    const prompt = clip(args.prompt || args.task || '', config.maxContextChars);
    const instruction = clip(args.instruction || 'Resolva a tarefa abaixo e retorne apenas o resultado util para o Hades.', 1200);

    const userContent = [
      '<instrucao_hades>',
      instruction,
      '</instrucao_hades>',
      '',
      localContext ? `<contexto_local_hades>\n${localContext}\n</contexto_local_hades>` : '',
      context ? `<contexto_turno>\n${context}\n</contexto_turno>` : '',
      '',
      '<tarefa>',
      prompt,
      '</tarefa>'
    ].filter(Boolean).join('\n');

    const messages = [
      { role: 'system', content: this.buildSystemPrompt(args, config) },
      { role: 'user', content: userContent }
    ];

    try {
      const data = await this.request('/chat/completions', {
        method: 'POST',
        body: {
          model: config.model,
          messages,
          temperature: 0.2,
          max_tokens: clampNumber(args.maxOutputTokens, 900, 64, 4096)
        },
        timeoutMs: args.timeoutMs || config.timeoutMs
      });

      const text = extractCompletionText(data) || 'Hermes nao retornou texto.';
      const durationMs = Date.now() - start;
      this.appendUsage({
        type: args.logType || 'ask',
        success: true,
        durationMs,
        promptChars: JSON.stringify(messages).length,
        responseChars: text.length,
        model: data?.model || config.model,
        usage: data?.usage || null
      });

      return {
        success: true,
        text,
        model: data?.model || config.model,
        usage: data?.usage || null,
        sessionKey: config.sessionKey,
        durationMs
      };
    } catch (error) {
      const durationMs = Date.now() - start;
      this.appendUsage({
        type: args.logType || 'ask',
        success: false,
        durationMs,
        promptChars: JSON.stringify(messages).length,
        responseChars: 0,
        error: error.message,
        model: config.model
      });
      logger.error('HERMES', 'ask failed', error);
      return { success: false, error: error.message, durationMs };
    }
  }

  async remember(args = {}) {
    const config = this.getConfig();
    if (!config.useForMemory) {
      return { success: false, error: 'Memoria via Hermes esta desativada.' };
    }

    const kind = args.kind || 'note';
    const text = clip(args.text || '', config.maxContextChars);
    if (!text) return { success: false, error: 'Nada para memorizar.' };

    return this.ask({
      prompt: [
        `Tipo: ${kind}`,
        args.title ? `Titulo: ${args.title}` : '',
        args.source ? `Fonte: ${args.source}` : '',
        '',
        text
      ].filter(Boolean).join('\n'),
      instruction: [
        'Analise o conteudo e use a memoria persistente do Hermes para registrar somente fatos, preferencias, experiencias, decisoes ou ideias reutilizaveis.',
        'Se for curriculo ou documento longo, grave um resumo fiel com palavras-chave e detalhes uteis para recuperacao futura.',
        'Se nada for util, diga que nada foi salvo.'
      ].join(' '),
      maxOutputTokens: 600,
      logType: 'remember'
    });
  }

  async ingestDocument(document = {}) {
    return this.remember({
      kind: document.type || 'document',
      title: document.title || 'Documento Hades',
      source: document.source || 'manual',
      text: document.text || ''
    });
  }

  async rememberConversation(sessionData = {}) {
    const config = this.getConfig();
    if (!config.enabled || !config.useForMemory || !config.autoForwardConversations) {
      return { success: false, skipped: true, reason: 'Auto-forward de conversas desativado.' };
    }

    const messages = Array.isArray(sessionData.messages) ? sessionData.messages.slice(-10) : [];
    const transcript = messages.map(message => {
      const role = message.role || message.sender || 'message';
      return `${role}: ${clip(message.text || message.content || '', 700)}`;
    }).join('\n');

    if (!transcript.trim()) {
      return { success: false, skipped: true, reason: 'Sessao sem mensagens.' };
    }

    return this.ask({
      prompt: transcript,
      instruction: 'Revise esta conversa do Hades e grave no Hermes apenas memorias futuras realmente uteis. Ignore conversa descartavel.',
      maxOutputTokens: 500,
      logType: 'conversation_memory'
    });
  }

  buildTranscript(messages = [], maxChars = 12000) {
    const transcript = messages.map((message, index) => {
      const timestamp = message.timestamp
        ? new Date(message.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
        : `${index + 1}`;
      const role = message.role || message.sender || 'fala';
      const text = message.text || message.content || message.pendingText || '';
      const translated = message.translatedText ? `\ntraducao: ${message.translatedText}` : '';
      return `[${timestamp}] ${role}: ${text}${translated}`;
    }).filter(line => line.trim().length > 0).join('\n');

    return clip(transcript, maxChars);
  }

  async summarizeMeeting(session = {}) {
    const config = this.getConfig();
    if (!config.enabled || !config.useForMemory || !config.autoSummarizeMeetings) {
      return { success: false, skipped: true, reason: 'Resumo automatico de reunioes desativado.' };
    }

    const messages = Array.isArray(session.messages) ? session.messages : [];
    const transcript = this.buildTranscript(messages, config.meetingSummaryMaxChars);
    if (!transcript.trim()) {
      return { success: false, skipped: true, reason: 'Reuniao sem transcricao.' };
    }

    const result = await this.ask({
      prompt: [
        `Titulo da sessao: ${session.title || 'Reuniao Hades'}`,
        `Data: ${session.timestamp || new Date().toISOString()}`,
        '',
        transcript
      ].join('\n'),
      instruction: [
        'Skill: hades_meeting_summary.',
        'Gere um resumo de reuniao em portugues com: objetivo, decisoes, tarefas, riscos, perguntas abertas e contexto importante.',
        'Use a memoria persistente do Hermes para guardar apenas decisoes, preferencias, compromissos e fatos reutilizaveis.',
        'Retorne um resumo curto e estruturado para ser anexado ao historico do Hades.'
      ].join(' '),
      includeLocalContext: false,
      maxOutputTokens: 1200,
      logType: 'meeting_summary',
      primaryAgent: true
    });

    if (result.success && session.id) {
      const sessions = store.getSessions();
      const index = sessions.findIndex(item => item.id === session.id);
      if (index !== -1) {
        sessions[index] = {
          ...sessions[index],
          hermesSummary: result.text,
          hermesSummaryAt: new Date().toISOString()
        };
        store.saveSessions(sessions);
      }
    }

    return result;
  }

  async syncLocalContext() {
    const config = this.getConfig();
    if (!config.enabled || !config.useForMemory) {
      return { success: false, error: 'Hermes/memoria desativado.' };
    }

    const context = this.buildLocalContext(config.maxContextChars);
    return this.ask({
      prompt: context,
      instruction: 'Sincronize no Hermes apenas tarefas, personas e preferencias locais que sejam uteis como memoria persistente. Nao duplique informacoes obvias.',
      maxOutputTokens: 700,
      logType: 'sync_context'
    });
  }

  async testConnection() {
    const config = this.getConfig();
    if (!config.enabled) {
      return {
        connected: false,
        enabled: false,
        reason: 'Hermes esta desativado.',
        endpoint: config.apiBaseUrl,
        sessionKey: config.sessionKey
      };
    }

    const start = Date.now();
    try {
      const data = await this.request('/models', { timeoutMs: 5000 });
      const models = Array.isArray(data?.data) ? data.data.map(model => model.id || model.name).filter(Boolean) : [];
      this.appendUsage({
        type: 'status',
        success: true,
        durationMs: Date.now() - start,
        promptChars: 0,
        responseChars: JSON.stringify(data || {}).length,
        model: config.model
      });
      return {
        connected: true,
        enabled: true,
        endpoint: config.apiBaseUrl,
        sessionKey: config.sessionKey,
        models
      };
    } catch (modelsError) {
      const probe = await this.ask({
        prompt: 'Responda apenas OK.',
        instruction: 'Teste minimo de conectividade com o Hermes.',
        includeLocalContext: false,
        maxOutputTokens: 16,
        timeoutMs: 8000,
        logType: 'status_probe'
      });

      if (probe.success) {
        return {
          connected: true,
          enabled: true,
          endpoint: config.apiBaseUrl,
          sessionKey: config.sessionKey,
          probe: probe.text
        };
      }

      return {
        connected: false,
        enabled: true,
        endpoint: config.apiBaseUrl,
        sessionKey: config.sessionKey,
        error: probe.error || modelsError.message
      };
    }
  }

  getDashboard() {
    const config = this.getConfig();
    const usage = this.loadUsage();
    const recentRequests = usage.slice(-8).reverse();
    const failures = usage.filter(entry => entry.success === false).length;
    const promptChars = usage.reduce((sum, entry) => sum + (entry.promptChars || 0), 0);
    const responseChars = usage.reduce((sum, entry) => sum + (entry.responseChars || 0), 0);

    return {
      enabled: config.enabled,
      connected: false,
      reason: config.enabled ? 'Use Testar Hermes para verificar sem gastar chamadas automaticas.' : 'Hermes desativado.',
      config: {
        baseUrl: config.baseUrl,
        apiBaseUrl: config.apiBaseUrl,
        model: config.model,
        sessionKey: config.sessionKey,
        apiKey: maskSecret(config.apiKey),
        timeoutMs: config.timeoutMs,
        maxContextChars: config.maxContextChars,
        meetingSummaryMaxChars: config.meetingSummaryMaxChars,
        useAsPrimaryAgent: config.useAsPrimaryAgent,
        useForExternalActions: config.useForExternalActions,
        useForMemory: config.useForMemory,
        autoSummarizeMeetings: config.autoSummarizeMeetings
      },
      counts: {
        requests: usage.length,
        failures,
        promptChars,
        responseChars,
        estimatedTokens: Math.ceil((promptChars + responseChars) / 4)
      },
      recentRequests
    };
  }
}

module.exports = new HermesService();
