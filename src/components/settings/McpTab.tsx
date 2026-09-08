import React, { useEffect, useState } from 'react';
import { Brain, Cable, Plus, RefreshCcw, Server, Trash2, Wrench } from 'lucide-react';
import { McpServerSettings, McpSettings, McpStatus } from '../../types/electron';
import { electronService } from '../../services/electron';

interface McpTabProps {
  settings: McpSettings;
  updateSettings: (updates: Partial<McpSettings>) => void;
}

const createServer = (): McpServerSettings => ({
  id: `server_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
  name: 'Novo servidor',
  enabled: true,
  transport: 'stdio',
  authType: 'none',
  command: '',
  args: []
});

const serializeMcpJson = (servers: McpServerSettings[]) => JSON.stringify({
  mcpServers: Object.fromEntries(servers.map(server => {
    const definition: Record<string, unknown> = {
      type: server.transport,
      enabled: server.enabled
    };
    if (server.transport === 'stdio') {
      definition.command = server.command || '';
      if (server.args?.length) definition.args = server.args;
      if (server.cwd) definition.cwd = server.cwd;
      if (server.env && Object.keys(server.env).length) definition.env = server.env;
    } else {
      definition.url = server.url || '';
      if (server.headers && Object.keys(server.headers).length) definition.headers = server.headers;
    }
    if (server.allowedTools?.length) definition.allowedTools = server.allowedTools;
    if (server.allowResources) definition.allowResources = true;
    if (server.allowPrompts) definition.allowPrompts = true;
    if (server.meetingKnowledge) definition.meetingKnowledge = server.meetingKnowledge;
    if (server.memoryContext) definition.memoryContext = server.memoryContext;
    return [server.id, definition];
  }))
}, null, 2);

const parseStringRecord = (value: unknown, field: string): Record<string, string> => {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`O campo ${field} precisa ser um objeto JSON.`);
  }
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => {
    if (typeof entry !== 'string') throw new Error(`${field}.${key} precisa ser texto.`);
    return [key, entry];
  }));
};

const parseMcpJson = (text: string): McpServerSettings[] => {
  const document = JSON.parse(text);
  const definitions = document?.mcpServers ?? document?.servers ?? document;
  if (!definitions || typeof definitions !== 'object') {
    throw new Error('Use um objeto "mcpServers" com pelo menos um servidor.');
  }
  const entries: Array<[string, any]> = Array.isArray(definitions)
    ? definitions.map((server, index) => [server.id || server.name || `server_${index + 1}`, server])
    : Object.entries(definitions);
  if (!entries.length) return [];

  return entries.map(([id, raw]) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(`A configuração de ${id} precisa ser um objeto.`);
    }
    const requestedTransport = String(raw.transport || raw.type || '').toLowerCase();
    const transport: McpServerSettings['transport'] = requestedTransport === 'sse'
      ? 'sse'
      : ['streamable-http', 'streamable_http', 'http'].includes(requestedTransport) || (!raw.command && raw.url)
        ? 'streamable-http'
        : 'stdio';
    if (transport === 'stdio' && typeof raw.command !== 'string') {
      throw new Error(`${id}: informe "command" para um servidor stdio.`);
    }
    if (transport !== 'stdio' && typeof raw.url !== 'string') {
      throw new Error(`${id}: informe "url" para um servidor remoto.`);
    }
    return {
      id,
      name: String(raw.name || id),
      enabled: raw.enabled !== false && raw.disabled !== true,
      transport,
      command: raw.command,
      args: Array.isArray(raw.args) ? raw.args.map(String) : [],
      cwd: raw.cwd,
      env: parseStringRecord(raw.env, `${id}.env`),
      url: raw.url,
      headers: parseStringRecord(raw.headers, `${id}.headers`),
      allowedTools: Array.isArray(raw.allowedTools)
        ? raw.allowedTools.map(String)
        : Array.isArray(raw.tools?.include)
          ? raw.tools.include.map(String)
          : [],
      allowResources: raw.allowResources === true,
      allowPrompts: raw.allowPrompts === true,
      meetingKnowledge: raw.meetingKnowledge && typeof raw.meetingKnowledge === 'object'
        ? {
            enabled: raw.meetingKnowledge.enabled === true,
            tool: raw.meetingKnowledge.tool ? String(raw.meetingKnowledge.tool) : undefined,
            titleField: raw.meetingKnowledge.titleField ? String(raw.meetingKnowledge.titleField) : undefined,
            contentField: raw.meetingKnowledge.contentField ? String(raw.meetingKnowledge.contentField) : undefined,
            maxContentBytes: raw.meetingKnowledge.maxContentBytes === undefined
              ? undefined
              : Number(raw.meetingKnowledge.maxContentBytes),
            arguments: raw.meetingKnowledge.arguments && typeof raw.meetingKnowledge.arguments === 'object'
              ? raw.meetingKnowledge.arguments
              : undefined,
            conversationArguments: raw.meetingKnowledge.conversationArguments
              && typeof raw.meetingKnowledge.conversationArguments === 'object'
              ? raw.meetingKnowledge.conversationArguments
              : undefined
          }
        : undefined,
      memoryContext: raw.memoryContext && typeof raw.memoryContext === 'object'
        ? {
            enabled: raw.memoryContext.enabled === true,
            tool: raw.memoryContext.tool ? String(raw.memoryContext.tool) : undefined,
            queryField: raw.memoryContext.queryField ? String(raw.memoryContext.queryField) : undefined,
            maxResultChars: raw.memoryContext.maxResultChars === undefined
              ? undefined
              : Number(raw.memoryContext.maxResultChars),
            arguments: raw.memoryContext.arguments && typeof raw.memoryContext.arguments === 'object'
              ? raw.memoryContext.arguments
              : undefined
          }
        : undefined
    };
  });
};

const McpTab: React.FC<McpTabProps> = ({ settings, updateSettings }) => {
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [message, setMessage] = useState('');
  const [busyServer, setBusyServer] = useState<string | null>(null);
  const [jsonDraft, setJsonDraft] = useState(() => serializeMcpJson(settings.servers));
  const [jsonError, setJsonError] = useState('');

  const memoryServers = settings.servers.filter(server => {
    const discovered = status?.servers.find(item => item.id === server.id);
    const identity = `${server.id} ${server.name}`;
    return server.meetingKnowledge?.enabled === true
      || /memory|memoria|memória|knowledge|remember/i.test(identity)
      || discovered?.tools.some(tool => /memory|memoria|knowledge|remember/i.test(tool.name));
  });

  useEffect(() => {
    electronService.getMcpStatus().then(setStatus);
  }, []);

  const replaceServers = (servers: McpServerSettings[]) => {
    updateSettings({ servers });
    setJsonDraft(serializeMcpJson(servers));
  };

  const updateServer = (id: string, patch: Partial<McpServerSettings>) => {
    const servers = settings.servers.map(server => server.id === id ? { ...server, ...patch } : server);
    replaceServers(servers);
  };

  const updateFromJson = (text: string) => {
    setJsonDraft(text);
    try {
      const servers = parseMcpJson(text);
      updateSettings({ servers });
      setJsonError('');
      setMessage(`JSON válido · ${servers.length} servidor(es). Salve para aplicar.`);
    } catch (error) {
      setJsonError(error instanceof Error ? error.message : 'JSON MCP inválido.');
    }
  };

  const testServer = async (server: McpServerSettings) => {
    setBusyServer(server.id);
    setMessage(`Conectando a ${server.name}...`);
    try {
      const result = await electronService.testMcpServer(server.id);
      setMessage(`${result.server}: conectado, ${result.tools.length} tool(s) encontrada(s).`);
      setStatus(await electronService.getMcpStatus());
    } catch (error: any) {
      setMessage(`${server.name}: ${error.message}`);
    } finally {
      setBusyServer(null);
    }
  };

  const refresh = async () => {
    setBusyServer('reload');
    setMessage('Recarregando servidores MCP...');
    try {
      const next = await electronService.reloadMcp();
      setStatus(next);
      setMessage(`${next.toolCount} tool(s) disponíveis.`);
    } catch (error: any) {
      setMessage(error.message);
    } finally {
      setBusyServer(null);
    }
  };

  return (
    <div>
      <div className="tab-header">
        <h2 className="tab-title">Model Context Protocol</h2>
        <p className="tab-subtitle">Conecte tools locais ou remotas ao agente OpenAI do Metis.</p>
      </div>

      <div className="mcp-summary">
        <div className={`agent-status-pill ${status?.toolCount ? 'connected' : ''}`}>
          <Cable size={14} />
          <span>{status?.toolCount || 0} tools · {status?.resourceCount || 0} resources · {status?.promptCount || 0} prompts</span>
        </div>
        <button type="button" className="settings-action-btn" onClick={refresh} disabled={busyServer !== null}>
          <RefreshCcw size={14} /> Recarregar
        </button>
      </div>

      <ToggleRow
        title="Ativar MCP"
        description="Quando ativo, o MiniChat usa OpenAI com as tools MCP em vez de delegar o turno ao Hermes."
        checked={settings.enabled}
        onChange={enabled => updateSettings({ enabled })}
      />

      <div className="mcp-memory-destinations">
        <div className="mcp-memory-title"><Brain size={15} /> MCPs de memória configurados</div>
        {memoryServers.length > 0 ? (
          <div className="mcp-memory-list">
            {memoryServers.map(server => {
              const serverStatus = status?.servers.find(item => item.id === server.id);
              return (
                <span className="mcp-memory-item" key={server.id}>
                  <strong>{server.name}</strong>
                  {' · '}{serverStatus?.connected ? 'conectado' : 'não conectado'}
                  {' · '}{server.meetingKnowledge?.enabled ? 'recebe reuniões e chats' : 'envio desativado'}
                  {' · '}{server.memoryContext?.enabled || (server.memoryContext === undefined && server.meetingKnowledge?.enabled) ? 'ajuda respostas' : 'consulta desativada'}
                </span>
              );
            })}
          </div>
        ) : (
          <div className="setting-desc">Nenhum MCP de memória foi reconhecido pelo nome ou pelas tools publicadas.</div>
        )}
      </div>

      <div className="mcp-json-editor">
        <div className="section-header mcp-section-title">
          <span>Configuração JSON</span>
          <button type="button" className="settings-action-btn" onClick={() => updateFromJson(serializeMcpJson(settings.servers))}>
            Formatar
          </button>
        </div>
        <p className="setting-desc">
          Aceita o formato padrão <code>mcpServers</code>, com <code>command</code>, <code>args</code>, <code>env</code>, <code>url</code>, <code>headers</code>, stdio, Streamable HTTP ou SSE.
        </p>
        <textarea
          className={`settings-textarea mcp-json-input ${jsonError ? 'invalid' : ''}`}
          spellCheck={false}
          aria-label="Configuração JSON dos servidores MCP"
          value={jsonDraft}
          onChange={event => updateFromJson(event.target.value)}
        />
        {jsonError && <div className="agent-status-message error">{jsonError}</div>}
      </div>

      <div className="agent-form-grid mcp-limits">
        <NumberField label="Máximo de rodadas" value={settings.maxToolRounds} min={1} max={12} onChange={maxToolRounds => updateSettings({ maxToolRounds })} />
        <NumberField label="Chamadas por turno" value={settings.maxToolCalls} min={1} max={50} onChange={maxToolCalls => updateSettings({ maxToolCalls })} />
        <NumberField label="Timeout por tool (ms)" value={settings.toolTimeoutMs} min={1000} max={120000} onChange={toolTimeoutMs => updateSettings({ toolTimeoutMs })} />
        <NumberField label="Resultado máximo (chars)" value={settings.maxResultChars} min={1000} max={100000} onChange={maxResultChars => updateSettings({ maxResultChars })} />
      </div>

      <div className="section-header mcp-section-title">
        <span><Server size={16} /> Servidores</span>
        <button type="button" className="settings-action-btn primary" onClick={() => replaceServers([...settings.servers, createServer()])}>
          <Plus size={14} /> Adicionar
        </button>
      </div>

      {settings.servers.length === 0 && (
        <div className="agent-empty mcp-empty">Nenhum servidor configurado. Adicione um servidor `stdio` local ou Streamable HTTP.</div>
      )}

      <div className="mcp-server-list">
        {settings.servers.map(server => {
          const serverStatus = status?.servers.find(item => item.id === server.id);
          const authType = server.authType
            || (server.headers?.['X-API-Key'] ? 'x-api-key' : server.headers?.Authorization ? 'bearer' : 'none');
          const authToken = authType === 'x-api-key'
            ? server.headers?.['X-API-Key'] || ''
            : (server.headers?.Authorization || '').replace(/^Bearer\s+/i, '');
          const updateAuth = (nextType: McpServerSettings['authType'], token = '') => {
            const headers = { ...(server.headers || {}) };
            delete headers.Authorization;
            delete headers['X-API-Key'];
            if (nextType === 'bearer' && token) headers.Authorization = `Bearer ${token}`;
            if (nextType === 'x-api-key' && token) headers['X-API-Key'] = token;
            updateServer(server.id, { authType: nextType, headers });
          };
          return (
            <div className="mcp-server-card" key={server.id}>
              <div className="mcp-server-head">
                <input
                  className="settings-input mcp-name-input"
                  aria-label="Nome do servidor"
                  value={server.name}
                  onChange={event => updateServer(server.id, { name: event.target.value })}
                />
                <label className="switch" aria-label={`Ativar ${server.name}`}>
                  <input type="checkbox" checked={server.enabled} onChange={event => updateServer(server.id, { enabled: event.target.checked })} />
                  <span className="slider"></span>
                </label>
                <button type="button" className="mcp-icon-button danger" aria-label={`Remover ${server.name}`} onClick={() => replaceServers(settings.servers.filter(item => item.id !== server.id))}>
                  <Trash2 size={15} />
                </button>
              </div>

              <div className="mcp-transport-row">
                <label className="agent-field">
                  <span>Transporte</span>
                  <select className="settings-select" value={server.transport} onChange={event => updateServer(server.id, { transport: event.target.value as McpServerSettings['transport'] })}>
                    <option value="stdio">stdio local</option>
                    <option value="streamable-http">Streamable HTTP</option>
                    <option value="sse">SSE legado</option>
                  </select>
                </label>
                <label className="agent-field">
                  <span>ID da tool</span>
                  <input className="settings-input" value={server.id} readOnly />
                </label>
              </div>

              {server.transport === 'stdio' ? (
                <>
                  <label className="agent-field">
                    <span>Executável</span>
                    <input className="settings-input wide" placeholder="npx, node ou caminho absoluto" value={server.command || ''} onChange={event => updateServer(server.id, { command: event.target.value })} />
                  </label>
                  <label className="agent-field">
                    <span>Argumentos, um por linha</span>
                    <textarea className="settings-textarea mcp-args" value={(server.args || []).join('\n')} onChange={event => updateServer(server.id, { args: event.target.value.split('\n') })} />
                  </label>
                  <label className="agent-field">
                    <span>Diretório de trabalho, opcional</span>
                    <input className="settings-input wide" value={server.cwd || ''} onChange={event => updateServer(server.id, { cwd: event.target.value })} />
                  </label>
                </>
              ) : (
                <>
                  <label className="agent-field">
                    <span>URL HTTPS ou localhost</span>
                    <input className="settings-input wide" placeholder="https://example.com/mcp" value={server.url || ''} onChange={event => updateServer(server.id, { url: event.target.value })} />
                  </label>
                  <label className="agent-field">
                    <span>Autenticação</span>
                    <select
                      className="settings-select"
                      value={authType}
                      onChange={event => updateAuth(event.target.value as McpServerSettings['authType'], authToken)}
                    >
                      <option value="none">Sem autenticação</option>
                      <option value="bearer">Bearer token</option>
                      <option value="x-api-key">X-API-Key</option>
                    </select>
                  </label>
                  {authType !== 'none' && <label className="agent-field">
                    <span>{authType === 'x-api-key' ? 'X-API-Key' : 'Bearer token'}</span>
                    <input
                      type="password"
                      className="settings-input wide"
                      value={authToken}
                      onChange={event => updateAuth(authType, event.target.value)}
                    />
                  </label>}
                </>
              )}

              <ToggleRow title="Permitir resources" description="Permite que o modelo leia resources e templates publicados por este servidor." checked={server.allowResources === true} onChange={allowResources => updateServer(server.id, { allowResources })} />
              <ToggleRow title="Permitir prompts" description="Permite que o modelo carregue prompts publicados por este servidor." checked={server.allowPrompts === true} onChange={allowPrompts => updateServer(server.id, { allowPrompts })} />
              <ToggleRow
                title="Enviar reuniões e chats como conhecimento"
                description="Envia conversas concluídas para a tool de memória deste servidor. O progresso é confirmado separadamente para cada MCP."
                checked={server.meetingKnowledge?.enabled === true}
                onChange={enabled => updateServer(server.id, {
                  meetingKnowledge: { ...server.meetingKnowledge, enabled }
                })}
              />
              <ToggleRow
                title="Usar memória nas respostas"
                description="Consulta automaticamente este MCP antes de responder em chats, reuniões e entrevistas."
                checked={server.memoryContext?.enabled ?? server.meetingKnowledge?.enabled ?? false}
                onChange={enabled => updateServer(server.id, {
                  memoryContext: { ...server.memoryContext, enabled }
                })}
              />

              <div className="mcp-card-footer">
                <div className={`mcp-connection ${serverStatus?.connected ? 'connected' : ''}`}>
                  {serverStatus?.connected ? `${serverStatus.tools.length} tools encontradas` : serverStatus?.error || 'Não testado'}
                </div>
                <button type="button" className="settings-action-btn" disabled={busyServer !== null} onClick={() => testServer(server)}>
                  <Wrench size={14} /> {busyServer === server.id ? 'Testando...' : 'Testar salvo'}
                </button>
              </div>

              {serverStatus?.tools?.length ? (
                <div className="mcp-tool-list">
                  {serverStatus.tools.map(tool => (
                    <label className="mcp-tool-option" key={tool.name} title={tool.description}>
                      <input
                        type="checkbox"
                        checked={(server.allowedTools || []).includes(tool.name)}
                        onChange={event => updateServer(server.id, {
                          allowedTools: event.target.checked
                            ? [...new Set([...(server.allowedTools || []), tool.name])]
                            : (server.allowedTools || []).filter(name => name !== tool.name)
                        })}
                      />
                      <code>{tool.name}</code>
                      {tool.readOnlyHint && <span>leitura</span>}
                    </label>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {message && <div className="agent-status-message">{message}</div>}
      <div className="mcp-warning">Servidores `stdio` executam programas com as permissões do seu usuário. Configure somente servidores confiáveis e revise os diretórios liberados.</div>
    </div>
  );
};

const ToggleRow: React.FC<{ title: string; description: string; checked: boolean; onChange: (value: boolean) => void }> = ({ title, description, checked, onChange }) => (
  <div className="setting-row">
    <div className="setting-info"><div className="setting-title">{title}</div><div className="setting-desc">{description}</div></div>
    <label className="switch" aria-label={title}><input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} /><span className="slider"></span></label>
  </div>
);

const NumberField: React.FC<{ label: string; value: number; min: number; max: number; onChange: (value: number) => void }> = ({ label, value, min, max, onChange }) => (
  <label className="agent-field"><span>{label}</span><input className="settings-input" type="number" min={min} max={max} value={value} onChange={event => onChange(Number(event.target.value))} /></label>
);

export default McpTab;
