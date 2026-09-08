import { describe, expect, it, vi } from 'vitest';

const mcpModule = await import('./mcpClientService.js');
const {
  McpClientService,
  buildChatKnowledge,
  buildKnowledgeParts,
  normalizeConfig,
  splitUtf8Text,
  validateServer,
  toolResultText
} = mcpModule.default;

describe('McpClientService', () => {
  it('normalizes limits, arguments and duplicate server ids', () => {
    const config = normalizeConfig({
      enabled: true,
      maxToolRounds: 99,
      servers: [
        { id: 'Files Server', command: 'node', args: ['server.js', ''] },
        { id: 'Files Server', command: 'node', args: ['other.js'] }
      ]
    });

    expect(config.maxToolRounds).toBe(12);
    expect(config.maxToolCalls).toBe(12);
    expect(config.servers.map(server => server.id)).toEqual(['files_server', 'files_server_2']);
    expect(config.servers[0].args).toEqual(['server.js']);
  });

  it('rejects insecure non-loopback HTTP servers', () => {
    expect(() => validateServer({ id: 'remote', name: 'Remote', transport: 'streamable-http', url: 'http://example.com/mcp' }))
      .toThrow(/HTTPS/);
  });

  it('accepts flexible remote transports and arbitrary headers', () => {
    const config = normalizeConfig({
      enabled: true,
      servers: [{
        id: 'memory',
        type: 'http',
        url: 'https://memory.example.com/mcp',
        headers: { 'X-API-Key': 'secret', 'X-Tenant': 'personal' },
        meetingKnowledge: {
          enabled: true,
          tool: 'memory_store',
          maxContentBytes: 32000,
          arguments: { namespace: 'team/meetings' },
          conversationArguments: { namespace: 'team/conversations' }
        }
      }, {
        id: 'legacy',
        transport: 'sse',
        url: 'https://legacy.example.com/sse'
      }]
    });

    expect(config.servers[0]).toMatchObject({
      transport: 'streamable-http',
      authType: 'x-api-key',
      headers: { 'X-API-Key': 'secret', 'X-Tenant': 'personal' },
      meetingKnowledge: {
        enabled: true,
        tool: 'memory_store',
        maxContentBytes: 32000,
        arguments: { namespace: 'team/meetings' },
        conversationArguments: { namespace: 'team/conversations' }
      }
    });
    expect(config.servers[1].transport).toBe('sse');
  });

  it('discovers tools and closes an isolated test connection', async () => {
    const client = {
      connect: vi.fn().mockResolvedValue(undefined),
      getServerCapabilities: vi.fn().mockReturnValue({ tools: {} }),
      listTools: vi.fn().mockResolvedValue({ tools: [{ name: 'read_file', description: 'Read a file' }] }),
      listResources: vi.fn().mockResolvedValue({ resources: [] }),
      listResourceTemplates: vi.fn().mockResolvedValue({ resourceTemplates: [] }),
      listPrompts: vi.fn().mockResolvedValue({ prompts: [] }),
      close: vi.fn().mockResolvedValue(undefined)
    };
    const service = new McpClientService({
      clientFactory: () => client,
      transportFactory: () => ({}),
      store: { getSettings: () => ({ mcp: { toolTimeoutMs: 1000 } }) }
    });

    const result = await service.testServer({ id: 'files', name: 'Files', transport: 'stdio', command: 'node' });

    expect(result).toMatchObject({ connected: true, server: 'Files', tools: [{ name: 'read_file' }] });
    expect(client.connect).toHaveBeenCalledOnce();
    expect(client.close).toHaveBeenCalledOnce();
  });

  it('redacts binary payloads and truncates oversized tool results', () => {
    const text = toolResultText({ content: [
      { type: 'text', text: 'abcdefghij' },
      { type: 'image', mimeType: 'image/png', data: 'secret-base64' }
    ] }, 8);

    expect(text).toContain('[resultado MCP truncado]');
    expect(text).not.toContain('secret-base64');
  });

  it('splits long meeting knowledge on valid UTF-8 boundaries', () => {
    const chunks = splitUtf8Text('á'.repeat(10), 7);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('')).toBe('á'.repeat(10));
    expect(chunks.every(chunk => Buffer.byteLength(chunk, 'utf8') <= 7)).toBe(true);

    const parts = buildKnowledgeParts({ title: 'Reunião', content: 'x'.repeat(20) }, 8);
    expect(parts).toHaveLength(3);
    expect(parts[0].title).toBe('Reunião — parte 1/3');
    expect(parts.map(part => part.content).join('')).toBe('x'.repeat(20));
  });

  it('builds complete chat knowledge with user and assistant roles', () => {
    const knowledge = buildChatKnowledge({
      id: 'chat-1',
      title: 'Fila de eventos',
      timestamp: '2026-09-08T12:00:00.000Z',
      type: 'minichat',
      messages: [
        { sender: 'user', text: 'Como evitar duplicação?' },
        { sender: 'ia', text: 'Use uma chave idempotente.' }
      ]
    });

    expect(knowledge.title).toBe('Conversa: Fila de eventos');
    expect(knowledge.content).toContain('ID: metis-chat-session:chat-1');
    expect(knowledge.content).toContain('Usuário: Como evitar duplicação?');
    expect(knowledge.content).toContain('Metis: Use uma chave idempotente.');
  });

  it('offers only tools explicitly allowed by the user', async () => {
    const client = {
      connect: vi.fn().mockResolvedValue(undefined),
      getServerCapabilities: vi.fn().mockReturnValue({ tools: {} }),
      listTools: vi.fn().mockResolvedValue({ tools: [
        { name: 'read_file', annotations: { readOnlyHint: true }, inputSchema: { type: 'object' } },
        { name: 'write_file', annotations: { readOnlyHint: false }, inputSchema: { type: 'object' } }
      ] }),
      listResources: vi.fn().mockResolvedValue({ resources: [] }),
      listResourceTemplates: vi.fn().mockResolvedValue({ resourceTemplates: [] }),
      listPrompts: vi.fn().mockResolvedValue({ prompts: [] }),
      close: vi.fn().mockResolvedValue(undefined)
    };
    const service = new McpClientService({
      clientFactory: () => client,
      transportFactory: () => ({}),
      store: { getSettings: () => ({ mcp: {
        enabled: true,
        servers: [{ id: 'files', name: 'Files', enabled: true, transport: 'stdio', command: 'node', allowedTools: ['read_file'] }]
      } }) }
    });

    const tools = await service.listOpenAITools();
    expect(tools.map(tool => tool.name)).toEqual(['mcp_files_read_file']);
    expect((await service.listOpenAITools()).map(tool => tool.name)).toEqual(['mcp_files_read_file']);
    await service.shutdown();
  });

  it('sends meeting knowledge independently to every opted-in memory server', async () => {
    const calls = [];
    const settings = { mcp: {
      enabled: true,
      toolTimeoutMs: 1000,
      servers: [
        {
          id: 'memory_a',
          name: 'Memory A',
          enabled: true,
          transport: 'stdio',
          command: 'memory-a',
          meetingKnowledge: { enabled: true }
        },
        {
          id: 'memory_b',
          name: 'Memory B',
          enabled: true,
          transport: 'stdio',
          command: 'memory-b',
          meetingKnowledge: {
            enabled: true,
            tool: 'memory_store',
            arguments: { namespace: 'custom/meetings' },
            conversationArguments: {
              namespace: 'custom/conversations',
              tags: ['custom', 'conversation']
            }
          }
        },
        {
          id: 'tools_only',
          name: 'Tools only',
          enabled: true,
          transport: 'stdio',
          command: 'tools-only',
          meetingKnowledge: { enabled: false }
        }
      ]
    } };
    const service = new McpClientService({
      clientFactory: () => {
        let serverId = '';
        return {
          connect: vi.fn().mockImplementation(transport => {
            serverId = transport.__serverId;
            return Promise.resolve();
          }),
          getServerCapabilities: vi.fn().mockReturnValue({ tools: {} }),
          listTools: vi.fn().mockResolvedValue({ tools: [{
            name: 'memory_store',
            inputSchema: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                content: { type: 'string' },
                namespace: { type: 'string' },
                tier: { type: 'string' },
                tags: { type: 'array' },
                source: { type: 'string' }
              }
            }
          }] }),
          listResources: vi.fn().mockResolvedValue({ resources: [] }),
          listResourceTemplates: vi.fn().mockResolvedValue({ resourceTemplates: [] }),
          listPrompts: vi.fn().mockResolvedValue({ prompts: [] }),
          callTool: vi.fn().mockImplementation(request => {
            calls.push({ serverId, request });
            return Promise.resolve({ content: [{ type: 'text', text: 'stored' }] });
          }),
          close: vi.fn().mockResolvedValue(undefined)
        };
      },
      transportFactory: server => ({ __serverId: server.id }),
      store: { getSettings: () => settings }
    });

    const results = await service.syncMeetingKnowledge({
      id: 'meeting-1',
      status: 'completed',
      title: 'Design review',
      startedAt: '2026-09-08T12:00:00.000Z',
      endedAt: '2026-09-08T13:00:00.000Z',
      config: { mode: 'meeting' }
    }, '- Decisão: manter filas duráveis.');

    expect(results).toHaveLength(2);
    expect(results.every(result => result.success)).toBe(true);
    expect(calls.map(call => call.serverId)).toEqual(['memory_a', 'memory_b']);
    expect(calls[0].request.arguments).toMatchObject({
      title: 'Reunião: Design review',
      namespace: 'metis/meetings',
      tier: 'long',
      tags: ['metis', 'meeting', 'transcript'],
      source: 'user'
    });
    expect(calls[0].request.arguments.content).toContain('metis-recorded-session:meeting-1');
    expect(calls[1].request.arguments.namespace).toBe('custom/meetings');

    const callsBeforeConversation = calls.length;
    const conversationOnly = await service.syncMeetingKnowledge({
      id: 'meeting-2',
      title: 'Incident review',
      config: { mode: 'meeting' },
      transcript: [{ source: 'interviewer', text: 'O incidente começou às dez.', pendingText: '' }]
    }, '', ['memory_b']);
    expect(conversationOnly[0]).toMatchObject({
      success: false,
      pendingSummary: true,
      conversationSynced: true,
      summarySynced: false
    });
    expect(calls).toHaveLength(callsBeforeConversation + 1);
    expect(calls.at(-1).request.arguments.title).toContain('— conversa');
    expect(calls.at(-1).request.arguments.content).toContain('O incidente começou às dez.');

    const callsBeforePendingRetry = calls.length;
    const pendingRetry = await service.syncMeetingKnowledge({
      id: 'meeting-2',
      title: 'Incident review',
      config: { mode: 'meeting' },
      transcript: [{ source: 'interviewer', text: 'O incidente começou às dez.', pendingText: '' }]
    }, '', ['memory_b'], {
      memory_a: { conversationSynced: true, summarySynced: false, parts: 1 }
    });
    expect(pendingRetry[0].pendingSummary).toBe(true);
    expect(calls).toHaveLength(callsBeforePendingRetry);

    const summaryRetry = await service.syncMeetingKnowledge({
      id: 'meeting-2',
      title: 'Incident review',
      config: { mode: 'meeting' },
      transcript: [{ source: 'interviewer', text: 'O incidente começou às dez.', pendingText: '' }]
    }, '- Causa: saturação da fila.', ['memory_b'], {
      memory_a: { conversationSynced: true, summarySynced: false, parts: 1 }
    });
    expect(summaryRetry[0]).toMatchObject({ success: true, conversationSynced: true, summarySynced: true });
    expect(calls.at(-1).request.arguments.title).toContain('— resumo');
    expect(calls.at(-1).request.arguments.content).not.toContain('O incidente começou às dez.');

    const chatResults = await service.syncChatConversationKnowledge({
      id: 'chat-2',
      title: 'Arquitetura',
      timestamp: '2026-09-08T14:00:00.000Z',
      type: 'minichat',
      messages: [
        { sender: 'user', text: 'Qual foi a decisão?' },
        { sender: 'ia', text: 'Manter filas duráveis.' }
      ]
    });
    expect(chatResults).toHaveLength(2);
    expect(chatResults.every(result => result.success)).toBe(true);
    expect(calls.at(-2).request.arguments).toMatchObject({
      title: 'Conversa: Arquitetura',
      namespace: 'metis/conversations',
      tags: ['metis', 'conversation']
    });
    expect(calls.at(-2).request.arguments.content).toContain('Usuário: Qual foi a decisão?');
    expect(calls.at(-1).request.arguments).toMatchObject({
      namespace: 'custom/conversations',
      tags: ['custom', 'conversation']
    });
    await service.shutdown();
  });

  it('recalls context from every enabled memory server using its configured name', async () => {
    const calls = [];
    const service = new McpClientService({
      clientFactory: () => {
        let serverId = '';
        return {
          connect: vi.fn().mockImplementation(transport => {
            serverId = transport.__serverId;
            return Promise.resolve();
          }),
          getServerCapabilities: vi.fn().mockReturnValue({ tools: {} }),
          listTools: vi.fn().mockResolvedValue({ tools: [{
            name: 'memory_recall',
            inputSchema: {
              type: 'object',
              properties: { context: { type: 'string' }, limit: { type: 'number' } }
            }
          }] }),
          listResources: vi.fn().mockResolvedValue({ resources: [] }),
          listResourceTemplates: vi.fn().mockResolvedValue({ resourceTemplates: [] }),
          listPrompts: vi.fn().mockResolvedValue({ prompts: [] }),
          callTool: vi.fn().mockImplementation(request => {
            calls.push({ serverId, request });
            return Promise.resolve({ content: [{ type: 'text', text: `memory from ${serverId}` }] });
          }),
          close: vi.fn().mockResolvedValue(undefined)
        };
      },
      transportFactory: server => ({ __serverId: server.id }),
      store: { getSettings: () => ({ mcp: {
        enabled: true,
        toolTimeoutMs: 1000,
        servers: [
          {
            id: 'career_memory',
            name: 'Memória de carreira',
            command: 'career-memory',
            meetingKnowledge: { enabled: true }
          },
          {
            id: 'project_memory',
            name: 'Project Knowledge',
            command: 'project-memory',
            memoryContext: {
              enabled: true,
              tool: 'memory_recall',
              arguments: { limit: 3 }
            }
          },
          {
            id: 'disabled_memory',
            name: 'Disabled Memory',
            command: 'disabled-memory',
            memoryContext: { enabled: false }
          }
        ]
      } }) }
    });

    const result = await service.recallMemoryContext('experiência com filas duráveis');

    expect(result.sources.map(source => source.server)).toEqual([
      'Memória de carreira',
      'Project Knowledge'
    ]);
    expect(result.text).toContain('Fonte MCP: Memória de carreira');
    expect(result.text).toContain('Fonte MCP: Project Knowledge');
    expect(calls.map(call => call.serverId)).toEqual(['career_memory', 'project_memory']);
    expect(calls[0].request.arguments).toMatchObject({
      context: 'experiência com filas duráveis',
      limit: 5
    });
    expect(calls[1].request.arguments.limit).toBe(3);
    await service.shutdown();
  });
});
