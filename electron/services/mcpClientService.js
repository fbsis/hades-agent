const crypto = require('node:crypto');
const {
  Client,
  SSEClientTransport,
  StreamableHTTPClientTransport
} = require('@modelcontextprotocol/client');
const {
  StdioClientTransport,
  getDefaultEnvironment
} = require('@modelcontextprotocol/client/stdio');
const logger = require('./logger');

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_RESULT_CHARS = 24000;

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.round(Math.min(max, Math.max(min, number)));
}

function safeId(value, fallback = 'server') {
  const normalized = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 28);
  return normalized || fallback;
}

function normalizeRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, entry]) => key && typeof entry === 'string')
      .map(([key, entry]) => [String(key), entry])
  );
}

function normalizeMeetingKnowledge(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { enabled: false, tool: '', titleField: '', contentField: '', maxContentBytes: 48000, arguments: {}, conversationArguments: {} };
  }
  let argumentsValue = {};
  let conversationArguments = {};
  if (value.arguments && typeof value.arguments === 'object' && !Array.isArray(value.arguments)) {
    try {
      argumentsValue = JSON.parse(JSON.stringify(value.arguments));
    } catch {
      argumentsValue = {};
    }
  }
  if (value.conversationArguments && typeof value.conversationArguments === 'object' && !Array.isArray(value.conversationArguments)) {
    try {
      conversationArguments = JSON.parse(JSON.stringify(value.conversationArguments));
    } catch {
      conversationArguments = {};
    }
  }
  return {
    enabled: value.enabled === true,
    tool: String(value.tool || '').trim(),
    titleField: String(value.titleField || '').trim(),
    contentField: String(value.contentField || '').trim(),
    maxContentBytes: clampNumber(value.maxContentBytes, 48000, 4000, 1000000),
    arguments: argumentsValue,
    conversationArguments
  };
}

function normalizeMemoryContext(value, enabledByDefault = false) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      enabled: enabledByDefault,
      tool: '',
      queryField: '',
      maxResultChars: 6000,
      arguments: {}
    };
  }
  let argumentsValue = {};
  if (value.arguments && typeof value.arguments === 'object' && !Array.isArray(value.arguments)) {
    try {
      argumentsValue = JSON.parse(JSON.stringify(value.arguments));
    } catch {
      argumentsValue = {};
    }
  }
  return {
    enabled: value.enabled === true,
    tool: String(value.tool || '').trim(),
    queryField: String(value.queryField || '').trim(),
    maxResultChars: clampNumber(value.maxResultChars, 6000, 500, 24000),
    arguments: argumentsValue
  };
}

function splitUtf8Text(value, maxBytes) {
  const buffer = Buffer.from(String(value || ''), 'utf8');
  if (buffer.length <= maxBytes) return [buffer.toString('utf8')];
  const chunks = [];
  let offset = 0;
  while (offset < buffer.length) {
    let end = Math.min(buffer.length, offset + maxBytes);
    while (end < buffer.length && end > offset && (buffer[end] & 0xC0) === 0x80) end -= 1;
    if (end === offset) end = Math.min(buffer.length, offset + maxBytes);
    chunks.push(buffer.subarray(offset, end).toString('utf8'));
    offset = end;
  }
  return chunks;
}

function buildKnowledgeParts(knowledge, maxContentBytes) {
  const chunks = splitUtf8Text(knowledge.content, maxContentBytes);
  if (chunks.length === 1) return [{ title: knowledge.title, content: chunks[0] }];
  return chunks.map((content, index) => ({
    title: `${knowledge.title} — parte ${index + 1}/${chunks.length}`.slice(0, 512),
    content
  }));
}

function chatMessageText(message = {}) {
  if (typeof message.text === 'string') return message.text.trim();
  if (typeof message.content === 'string') return message.content.trim();
  if (Array.isArray(message.parts)) {
    return message.parts.map(part => String(part?.text || '')).filter(Boolean).join('\n').trim();
  }
  return '';
}

function buildChatKnowledge(session = {}) {
  const conversation = (Array.isArray(session.messages) ? session.messages : [])
    .map(message => {
      const content = chatMessageText(message);
      if (!content) return '';
      const role = message.sender === 'ia' || message.role === 'assistant' ? 'Metis' : 'Usuário';
      return `${role}: ${content}`;
    })
    .filter(Boolean)
    .join('\n\n');
  return {
    title: `Conversa: ${session.title || 'Sem título'}`,
    content: [
      `ID: metis-chat-session:${session.id || 'unknown'}`,
      `Tipo: ${session.type === 'susurro' ? 'conversa de reunião' : 'chat'}`,
      `Data: ${session.timestamp || 'não informada'}`,
      conversation ? `Conversa:\n${conversation}` : ''
    ].filter(Boolean).join('\n\n'),
    conversation
  };
}

function normalizeServer(raw = {}, index = 0) {
  const requestedTransport = String(raw.transport || raw.type || '').toLowerCase();
  const transport = requestedTransport === 'sse'
    ? 'sse'
    : ['streamable-http', 'streamable_http', 'http'].includes(requestedTransport) || (!raw.command && raw.url)
      ? 'streamable-http'
      : 'stdio';
  const id = safeId(raw.id || raw.name, `server_${index + 1}`);
  const headers = normalizeRecord(raw.headers);
  const authType = ['bearer', 'x-api-key'].includes(raw.authType)
    ? raw.authType
    : headers['X-API-Key']
      ? 'x-api-key'
      : headers.Authorization
        ? 'bearer'
        : 'none';
  const meetingKnowledge = normalizeMeetingKnowledge(raw.meetingKnowledge);
  return {
    id,
    name: String(raw.name || id).trim().slice(0, 80) || id,
    enabled: raw.enabled !== false,
    transport,
    command: String(raw.command || '').trim(),
    args: Array.isArray(raw.args) ? raw.args.map(String).filter(Boolean) : [],
    cwd: String(raw.cwd || '').trim(),
    env: normalizeRecord(raw.env),
    url: String(raw.url || '').trim(),
    headers,
    authType,
    allowedTools: Array.isArray(raw.allowedTools)
      ? [...new Set(raw.allowedTools.map(String).filter(Boolean))].slice(0, 200)
      : [],
    allowResources: raw.allowResources === true,
    allowPrompts: raw.allowPrompts === true,
    meetingKnowledge,
    memoryContext: normalizeMemoryContext(raw.memoryContext, meetingKnowledge.enabled)
  };
}

function normalizeConfig(raw = {}) {
  const usedIds = new Set();
  const servers = Array.isArray(raw.servers)
    ? raw.servers.slice(0, 20).map((server, index) => {
      const normalized = normalizeServer(server, index);
      const baseId = normalized.id;
      let suffix = 2;
      while (usedIds.has(normalized.id)) normalized.id = `${baseId.slice(0, 24)}_${suffix++}`;
      usedIds.add(normalized.id);
      return normalized;
    })
    : [];
  return {
    enabled: raw.enabled === true,
    maxToolRounds: clampNumber(raw.maxToolRounds, 6, 1, 12),
    maxToolCalls: clampNumber(raw.maxToolCalls, 12, 1, 50),
    toolTimeoutMs: clampNumber(raw.toolTimeoutMs, DEFAULT_TIMEOUT_MS, 1000, 120000),
    maxResultChars: clampNumber(raw.maxResultChars, DEFAULT_MAX_RESULT_CHARS, 1000, 100000),
    servers
  };
}

function validateServer(server) {
  if (!server.id) throw new Error('Servidor MCP sem identificador.');
  if (server.transport === 'stdio') {
    if (!server.command) throw new Error(`Informe o comando do servidor ${server.name}.`);
    if (/\r|\n/.test(server.command)) throw new Error('O comando MCP contem caracteres invalidos.');
    return;
  }

  let url;
  try {
    url = new URL(server.url);
  } catch {
    throw new Error(`URL invalida para o servidor ${server.name}.`);
  }
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('MCP HTTP exige HTTPS; HTTP e permitido somente em localhost.');
  }
  if (url.username || url.password) throw new Error('Nao inclua credenciais diretamente na URL MCP.');
}

function withTimeout(promise, timeoutMs, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} excedeu ${timeoutMs}ms.`)), timeoutMs);
    })
  ]).finally(() => clearTimeout(timer));
}

function toolResultText(result, maxChars = DEFAULT_MAX_RESULT_CHARS) {
  const content = Array.isArray(result?.content)
    ? result.content
    : Array.isArray(result?.contents)
      ? result.contents
      : Array.isArray(result?.messages)
        ? result.messages.map(message => message.content || message)
        : [];
  const text = content.map(item => {
    if (item?.type === 'text') return item.text || '';
    if (typeof item?.text === 'string') return item.text;
    if (item?.type === 'resource') {
      if (item.resource?.blob || item.resource?.data) {
        return JSON.stringify({ type: 'resource', uri: item.resource.uri, mimeType: item.resource.mimeType, omitted: true });
      }
      return JSON.stringify(item.resource || item);
    }
    if (item?.blob || item?.data || item?.type === 'image' || item?.type === 'audio') {
      return JSON.stringify({ type: item.type, mimeType: item.mimeType, omitted: true });
    }
    return JSON.stringify(item);
  }).filter(Boolean).join('\n');
  const normalized = text || JSON.stringify(result || {});
  return normalized.length > maxChars
    ? `${normalized.slice(0, maxChars)}\n[resultado MCP truncado]`
    : normalized;
}

class McpClientService {
  constructor(options = {}) {
    this.clients = new Map();
    this.connecting = new Map();
    this.toolIndex = new Map();
    this.generation = 0;
    this.clientFactory = options.clientFactory || ((info, clientOptions) => new Client(info, clientOptions));
    this.transportFactory = options.transportFactory || (server => this.createTransport(server));
    this.store = options.store || null;
  }

  getConfig() {
    if (!this.store) this.store = require('../store/jsonStore');
    return normalizeConfig(this.store.getSettings()?.mcp || {});
  }

  createTransport(server) {
    if (server.transport === 'stdio') {
      return new StdioClientTransport({
        command: server.command,
        args: server.args,
        cwd: server.cwd || undefined,
        env: { ...getDefaultEnvironment(), ...server.env },
        stderr: 'pipe'
      });
    }
    const options = {
      requestInit: { headers: server.headers }
    };
    if (server.transport === 'sse') {
      return new SSEClientTransport(new URL(server.url), {
        ...options,
        eventSourceInit: { fetch: (url, init) => fetch(url, { ...init, headers: server.headers }) }
      });
    }
    return new StreamableHTTPClientTransport(new URL(server.url), options);
  }

  fingerprint(server) {
    return crypto.createHash('sha256').update(JSON.stringify(server)).digest('hex');
  }

  registerToolName(baseName, target) {
    const base = baseName.slice(0, 58);
    let name = base;
    let suffix = 2;
    while (this.toolIndex.has(name)) {
      const existing = this.toolIndex.get(name);
      if (existing.serverId === target.serverId
        && existing.toolName === target.toolName
        && existing.kind === target.kind) {
        this.toolIndex.set(name, target);
        return name;
      }
      name = `${base.slice(0, 55)}_${suffix++}`;
    }
    this.toolIndex.set(name, target);
    return name;
  }

  async connectServer(rawServer, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const server = normalizeServer(rawServer);
    validateServer(server);
    const fingerprint = this.fingerprint(server);
    const existing = this.clients.get(server.id);
    if (existing?.fingerprint === fingerprint) return existing;
    if (existing) await this.disconnectServer(server.id);
    if (this.connecting.has(server.id)) return this.connecting.get(server.id).promise;

    const generation = this.generation;
    const client = this.clientFactory(
      { name: 'metis-agent', version: '1.0.0' },
      { versionNegotiation: { mode: 'auto' }, inputRequired: { autoFulfill: false } }
    );
    const transport = this.transportFactory(server);
    const connection = (async () => {
      try {
        if (transport.stderr?.on) {
          transport.stderr.on('data', chunk => {
            logger.warn('MCP', `${server.name}: ${String(chunk).trim().slice(0, 500)}`);
          });
        }
        await withTimeout(client.connect(transport), timeoutMs, `Conexao MCP ${server.name}`);
        if (generation !== this.generation) {
          await client.close().catch(() => {});
          throw new Error(`Conexao MCP ${server.name} cancelada por recarga.`);
        }
        const entry = { client, transport, server, fingerprint };
        this.clients.set(server.id, entry);
        return entry;
      } catch (error) {
        await client.close().catch(() => {});
        throw error;
      } finally {
        if (this.connecting.get(server.id)?.generation === generation) {
          this.connecting.delete(server.id);
        }
      }
    })();

    this.connecting.set(server.id, { promise: connection, generation, client, transport, server });
    return connection;
  }

  async disconnectServer(serverId) {
    const entry = this.clients.get(serverId);
    this.clients.delete(serverId);
    if (entry) {
      if (entry.server.transport === 'streamable-http' && typeof entry.transport.terminateSession === 'function') {
        await entry.transport.terminateSession().catch(() => {});
      }
      await entry.client.close().catch(() => {});
    }
  }

  async discoverServer(rawServer, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const server = normalizeServer(rawServer);
    const { client } = await this.connectServer(server, timeoutMs);
    const capabilities = client.getServerCapabilities?.() || {};
    const [toolsResult, resourcesResult, templatesResult, promptsResult] = await Promise.all([
      capabilities.tools
        ? withTimeout(client.listTools(), timeoutMs, `Lista de tools ${server.name}`)
        : Promise.resolve({ tools: [] }),
      capabilities.resources
        ? withTimeout(client.listResources(), timeoutMs, `Lista de resources ${server.name}`)
        : Promise.resolve({ resources: [] }),
      capabilities.resources
        ? withTimeout(client.listResourceTemplates(), timeoutMs, `Lista de resource templates ${server.name}`)
        : Promise.resolve({ resourceTemplates: [] }),
      capabilities.prompts
        ? withTimeout(client.listPrompts(), timeoutMs, `Lista de prompts ${server.name}`)
        : Promise.resolve({ prompts: [] })
    ]);
    return {
      server,
      tools: Array.isArray(toolsResult?.tools) ? toolsResult.tools : [],
      resources: Array.isArray(resourcesResult?.resources) ? resourcesResult.resources : [],
      resourceTemplates: Array.isArray(templatesResult?.resourceTemplates) ? templatesResult.resourceTemplates : [],
      prompts: Array.isArray(promptsResult?.prompts) ? promptsResult.prompts : []
    };
  }

  async listOpenAITools() {
    const config = this.getConfig();
    if (!config.enabled) return [];

    const servers = config.servers.filter(server => server.enabled);
    const discoveries = await Promise.allSettled(
      servers.map(server => this.discoverServer(server, config.toolTimeoutMs))
    );
    const tools = [];

    discoveries.forEach((result, serverIndex) => {
      const server = servers[serverIndex];
      if (result.status === 'rejected') {
        logger.error('MCP', `Could not discover ${server.name}`, result.reason);
        return;
      }
      result.value.tools.slice(0, 100).forEach((tool, toolIndex) => {
        if (!server.allowedTools.includes(tool.name)) return;
        const exportedName = this.registerToolName(
          `mcp_${safeId(server.id)}_${safeId(tool.name, `tool_${toolIndex + 1}`)}`,
          { serverId: server.id, toolName: tool.name, generation: this.generation }
        );
        tools.push({
          type: 'function',
          name: exportedName,
          description: `[MCP: ${server.name}] ${String(tool.description || tool.name).slice(0, 900)}`,
          parameters: tool.inputSchema || { type: 'object', properties: {} },
          strict: false
        });
      });
      if (server.allowResources && (result.value.resources.length > 0 || result.value.resourceTemplates.length > 0)) {
        const exportedName = this.registerToolName(
          `mcp_${safeId(server.id)}_read_resource`,
          { serverId: server.id, kind: 'resource', generation: this.generation }
        );
        const knownResources = result.value.resources.slice(0, 30).map(resource => resource.uri).filter(Boolean);
        const templates = result.value.resourceTemplates.slice(0, 20).map(template => template.uriTemplate).filter(Boolean);
        tools.push({
          type: 'function',
          name: exportedName,
          description: `[MCP: ${server.name}] Read a server resource. Known URIs: ${knownResources.join(', ') || 'none'}. Templates: ${templates.join(', ') || 'none'}.`.slice(0, 1000),
          parameters: {
            type: 'object',
            properties: { uri: { type: 'string', description: 'Exact resource URI to read.' } },
            required: ['uri'],
            additionalProperties: false
          },
          strict: false
        });
      }
      if (server.allowPrompts && result.value.prompts.length > 0) {
        const exportedName = this.registerToolName(
          `mcp_${safeId(server.id)}_get_prompt`,
          { serverId: server.id, kind: 'prompt', generation: this.generation }
        );
        tools.push({
          type: 'function',
          name: exportedName,
          description: `[MCP: ${server.name}] Load an MCP prompt. Available prompts: ${result.value.prompts.slice(0, 30).map(prompt => prompt.name).join(', ')}.`.slice(0, 1000),
          parameters: {
            type: 'object',
            properties: {
              name: { type: 'string', enum: result.value.prompts.slice(0, 100).map(prompt => prompt.name) },
              arguments: { type: 'object', additionalProperties: { type: 'string' } }
            },
            required: ['name'],
            additionalProperties: false
          },
          strict: false
        });
      }
    });

    return tools.slice(0, 200);
  }

  async callOpenAITool(exportedName, args = {}, maxResultChars) {
    const config = this.getConfig();
    const target = this.toolIndex.get(exportedName);
    if (!target) throw new Error(`Tool MCP desconhecida: ${exportedName}`);
    if (target.generation !== this.generation) throw new Error('A configuracao MCP mudou durante esta chamada. Tente novamente.');
    const server = config.servers.find(item => item.id === target.serverId && item.enabled);
    if (!server) throw new Error(`Servidor MCP indisponivel: ${target.serverId}`);

    try {
      const { client } = await this.connectServer(server, config.toolTimeoutMs);
      let result;
      if (target.kind === 'resource') {
        if (!args.uri) throw new Error('A URI do resource MCP e obrigatoria.');
        result = await withTimeout(client.readResource({ uri: String(args.uri) }), config.toolTimeoutMs, 'Leitura de resource MCP');
      } else if (target.kind === 'prompt') {
        if (!args.name) throw new Error('O nome do prompt MCP e obrigatorio.');
        result = await withTimeout(client.getPrompt({
          name: String(args.name),
          arguments: args.arguments && typeof args.arguments === 'object' ? args.arguments : undefined
        }), config.toolTimeoutMs, 'Leitura de prompt MCP');
      } else {
        result = await withTimeout(client.callTool({
          name: target.toolName,
          arguments: args && typeof args === 'object' ? args : {}
        }), config.toolTimeoutMs, `Tool MCP ${target.toolName}`);
      }
      return {
        isError: result?.isError === true,
        text: toolResultText(result, Math.max(1, Math.min(config.maxResultChars, maxResultChars || config.maxResultChars))),
        server: server.name,
        tool: target.toolName || target.kind
      };
    } catch (error) {
      await this.disconnectServer(server.id);
      throw error;
    }
  }

  async storeKnowledge(server, knowledge, options = {}) {
    const config = this.getConfig();
    const discovery = await this.discoverServer(server, config.toolTimeoutMs);
    const preferredTools = ['memory_store', 'store_memory', 'add_memory', 'create_memory', 'remember'];
    const configuredTool = server.meetingKnowledge.tool;
    const tool = configuredTool
      ? discovery.tools.find(candidate => candidate.name === configuredTool)
      : preferredTools.map(name => discovery.tools.find(candidate => candidate.name === name)).find(Boolean);
    if (!tool) throw new Error(configuredTool
      ? `A tool ${configuredTool} não foi publicada pelo servidor.`
      : 'Nenhuma tool de armazenamento de memória compatível foi encontrada.');

    const properties = tool.inputSchema?.properties || {};
    const titleField = server.meetingKnowledge.titleField
      || (properties.title ? 'title' : properties.name ? 'name' : '');
    const contentField = server.meetingKnowledge.contentField
      || ['content', 'text', 'memory', 'knowledge'].find(field => properties[field])
      || (tool.name === 'memory_store' ? 'content' : '');
    if (!contentField) throw new Error(`Defina meetingKnowledge.contentField para a tool ${tool.name}.`);

    const { client } = await this.connectServer(server, config.toolTimeoutMs);
    const parts = buildKnowledgeParts(knowledge, server.meetingKnowledge.maxContentBytes);
    const responses = [];
    for (const part of parts) {
      const args = {
        ...server.meetingKnowledge.arguments,
        ...(options.arguments || {})
      };
      if (titleField) args[titleField] = part.title;
      args[contentField] = part.content;
      if (properties.tier && args.tier === undefined) args.tier = 'long';
      if (properties.namespace && args.namespace === undefined) args.namespace = options.namespace;
      if (properties.tags && args.tags === undefined) args.tags = options.tags;
      if (properties.source && args.source === undefined) args.source = 'user';
      const result = await withTimeout(client.callTool({ name: tool.name, arguments: args }),
        config.toolTimeoutMs, options.label || `Conhecimento via ${server.name}`);
      if (result?.isError === true) {
        throw new Error(toolResultText(result, 1000) || `A tool ${tool.name} retornou erro.`);
      }
      responses.push(toolResultText(result, 1000));
    }
    return {
      tool: tool.name,
      parts: parts.length,
      response: responses.join('\n').slice(0, 1000)
    };
  }

  async syncMeetingKnowledge(session, summary, skipServerIds = [], deliveryStates = {}) {
    const config = this.getConfig();
    if (!config.enabled) return [];
    const skipped = new Set(skipServerIds);
    const servers = config.servers.filter(server => (
      server.enabled
      && server.meetingKnowledge.enabled
      && !skipped.has(server.id)
    ));
    if (servers.length === 0) return [];

    const { buildMeetingKnowledge, buildRecordedTranscript } = require('./recordedMeetingMemory');
    const transcript = buildRecordedTranscript(session);
    const hasSummary = Boolean(String(summary || session.summary || '').trim());
    return Promise.all(servers.map(async server => {
      const previousState = deliveryStates[server.id] || {};
      if (previousState.conversationSynced && !hasSummary) {
        return {
          serverId: server.id,
          server: server.name,
          tool: previousState.tool || server.meetingKnowledge.tool || '',
          success: false,
          pendingSummary: true,
          conversationSynced: true,
          summarySynced: false,
          parts: previousState.parts || 0,
          error: 'Conversa enviada; resumo ainda pendente.'
        };
      }
      try {
        const includeConversation = !previousState.conversationSynced;
        const knowledge = buildMeetingKnowledge(
          includeConversation ? session : { ...session, transcript: [] },
          summary
        );
        if (!hasSummary && transcript) knowledge.title = `${knowledge.title} — conversa`.slice(0, 512);
        if (!includeConversation && hasSummary) knowledge.title = `${knowledge.title} — resumo`.slice(0, 512);
        const stored = await this.storeKnowledge(server, knowledge, {
          namespace: 'metis/meetings',
          tags: ['metis', 'meeting', 'transcript'],
          label: `Memória de reunião via ${server.name}`
        });
        return {
          serverId: server.id,
          server: server.name,
          tool: stored.tool,
          success: previousState.summarySynced || hasSummary,
          pendingSummary: !hasSummary,
          conversationSynced: true,
          summarySynced: previousState.summarySynced || hasSummary,
          parts: stored.parts,
          response: stored.response
        };
      } catch (error) {
        await this.disconnectServer(server.id);
        return {
          serverId: server.id,
          server: server.name,
          tool: server.meetingKnowledge.tool || '',
          success: false,
          conversationSynced: previousState.conversationSynced === true,
          summarySynced: previousState.summarySynced === true,
          parts: previousState.parts || 0,
          error: error.message
        };
      }
    }));
  }

  async recallMemoryContext(query) {
    const cleanQuery = String(query || '').replace(/\s+/g, ' ').trim().slice(0, 4000);
    const config = this.getConfig();
    if (!cleanQuery || !config.enabled) return { text: '', sources: [], failures: [] };

    const servers = config.servers.filter(server => server.enabled && server.memoryContext.enabled);
    if (servers.length === 0) return { text: '', sources: [], failures: [] };
    const recallTimeoutMs = Math.min(config.toolTimeoutMs, 8000);
    const preferredTools = [
      'memory_recall',
      'memory_search',
      'recall_memory',
      'search_memory',
      'query_memory',
      'search_knowledge'
    ];
    const results = await Promise.all(servers.map(async server => {
      try {
        const discovery = await this.discoverServer(server, recallTimeoutMs);
        const configuredTool = server.memoryContext.tool;
        const tool = configuredTool
          ? discovery.tools.find(candidate => candidate.name === configuredTool)
          : preferredTools.map(name => discovery.tools.find(candidate => candidate.name === name)).find(Boolean);
        if (!tool) {
          throw new Error(configuredTool
            ? `A tool ${configuredTool} não foi publicada pelo servidor.`
            : 'Nenhuma tool de recuperação de memória compatível foi encontrada.');
        }

        const properties = tool.inputSchema?.properties || {};
        const queryField = server.memoryContext.queryField
          || ['context', 'query', 'text', 'prompt', 'search', 'term'].find(field => properties[field])
          || (tool.name === 'memory_recall' ? 'context' : tool.name === 'memory_search' ? 'query' : '');
        if (!queryField) throw new Error(`Defina memoryContext.queryField para a tool ${tool.name}.`);

        const args = { ...server.memoryContext.arguments, [queryField]: cleanQuery };
        if (properties.limit && args.limit === undefined) args.limit = 5;
        if (properties.max_results && args.max_results === undefined) args.max_results = 5;

        const { client } = await this.connectServer(server, recallTimeoutMs);
        const result = await withTimeout(client.callTool({
          name: tool.name,
          arguments: args
        }), recallTimeoutMs, `Consulta de memória via ${server.name}`);
        if (result?.isError === true) {
          throw new Error(toolResultText(result, 1000) || `A tool ${tool.name} retornou erro.`);
        }
        return {
          success: true,
          serverId: server.id,
          server: server.name,
          tool: tool.name,
          text: toolResultText(result, server.memoryContext.maxResultChars)
        };
      } catch (error) {
        await this.disconnectServer(server.id);
        return {
          success: false,
          serverId: server.id,
          server: server.name,
          tool: server.memoryContext.tool || '',
          error: error.message
        };
      }
    }));

    const successes = results.filter(result => result.success && result.text);
    const failures = results.filter(result => !result.success);
    return {
      text: successes.map(result => (
        `Fonte MCP: ${result.server}\n${result.text}`
      )).join('\n\n').slice(0, 12000),
      sources: successes.map(result => ({
        serverId: result.serverId,
        server: result.server,
        tool: result.tool
      })),
      failures
    };
  }

  async syncChatConversationKnowledge(session, skipServerIds = []) {
    const config = this.getConfig();
    if (!config.enabled) return [];
    const skipped = new Set(skipServerIds);
    const servers = config.servers.filter(server => (
      server.enabled && server.meetingKnowledge.enabled && !skipped.has(server.id)
    ));
    if (servers.length === 0) return [];

    const knowledge = buildChatKnowledge(session);
    if (!knowledge.conversation) return servers.map(server => ({
      serverId: server.id,
      server: server.name,
      success: false,
      error: 'Conversa sem mensagens de texto para armazenar.'
    }));
    return Promise.all(servers.map(async server => {
      try {
        const stored = await this.storeKnowledge(server, knowledge, {
          namespace: 'metis/conversations',
          tags: ['metis', 'conversation'],
          arguments: server.meetingKnowledge.conversationArguments,
          label: `Conversa via ${server.name}`
        });
        return {
          serverId: server.id,
          server: server.name,
          tool: stored.tool,
          success: true,
          parts: stored.parts,
          response: stored.response
        };
      } catch (error) {
        await this.disconnectServer(server.id);
        return {
          serverId: server.id,
          server: server.name,
          tool: server.meetingKnowledge.tool || '',
          success: false,
          error: error.message
        };
      }
    }));
  }

  async testServer(rawServer) {
    const server = normalizeServer(rawServer);
    const timeoutMs = this.getConfig().toolTimeoutMs;
    const isolated = new McpClientService({
      clientFactory: this.clientFactory,
      transportFactory: this.transportFactory,
      store: this.store
    });
    try {
      const discovery = await isolated.discoverServer(server, timeoutMs);
      return {
        connected: true,
        server: server.name,
        tools: discovery.tools.map(tool => ({ name: tool.name, description: tool.description || '' })),
        resources: discovery.resources.map(resource => ({ name: resource.name || resource.uri, uri: resource.uri })),
        prompts: discovery.prompts.map(prompt => ({ name: prompt.name, description: prompt.description || '' }))
      };
    } finally {
      await isolated.shutdown();
    }
  }

  async getStatus() {
    const config = this.getConfig();
    if (!config.enabled) return { enabled: false, servers: [], toolCount: 0 };
    const results = await Promise.all(config.servers.map(async server => {
      if (!server.enabled) return { id: server.id, name: server.name, enabled: false, connected: false, tools: [] };
      try {
        const discovery = await this.discoverServer(server, config.toolTimeoutMs);
        const availableTools = discovery.tools.filter(tool => server.allowedTools.includes(tool.name));
        return {
          id: server.id,
          name: server.name,
          enabled: true,
          connected: true,
          tools: discovery.tools.map(tool => ({
            name: tool.name,
            description: tool.description || '',
            readOnlyHint: tool.annotations?.readOnlyHint === true,
            allowed: availableTools.some(available => available.name === tool.name)
          })),
          resources: discovery.resources.map(resource => ({ name: resource.name || resource.uri, uri: resource.uri })),
          prompts: discovery.prompts.map(prompt => ({ name: prompt.name, description: prompt.description || '' }))
        };
      } catch (error) {
        return { id: server.id, name: server.name, enabled: true, connected: false, tools: [], resources: [], prompts: [], error: error.message };
      }
    }));
    return {
      enabled: true,
      servers: results,
      toolCount: results.reduce((total, result) => total + result.tools.filter(tool => tool.allowed).length, 0),
      resourceCount: results.reduce((total, result) => total + (result.resources?.length || 0), 0),
      promptCount: results.reduce((total, result) => total + (result.prompts?.length || 0), 0)
    };
  }

  async reload() {
    await this.shutdown();
    return this.getStatus();
  }

  async shutdown() {
    this.generation += 1;
    const clients = [...this.clients.values()];
    const pending = [...this.connecting.values()];
    this.clients.clear();
    this.connecting.clear();
    const entries = [...clients, ...pending];
    const closing = Promise.allSettled(entries.map(async entry => {
      if (entry.server.transport === 'streamable-http' && typeof entry.transport.terminateSession === 'function') {
        await entry.transport.terminateSession().catch(() => {});
      }
      await entry.client.close();
    }));
    await Promise.race([closing, new Promise(resolve => setTimeout(resolve, 1500))]);
  }
}

module.exports = new McpClientService();
module.exports.McpClientService = McpClientService;
module.exports.normalizeConfig = normalizeConfig;
module.exports.normalizeServer = normalizeServer;
module.exports.buildKnowledgeParts = buildKnowledgeParts;
module.exports.buildChatKnowledge = buildChatKnowledge;
module.exports.splitUtf8Text = splitUtf8Text;
module.exports.validateServer = validateServer;
module.exports.toolResultText = toolResultText;
