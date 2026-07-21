import React, { useCallback, useEffect, useState } from 'react';
import { Activity, Bot, FileText, Gauge, HardDrive, KeyRound, MessageSquare, RefreshCcw, Send, Upload, Workflow } from 'lucide-react';
import { AssistantSettings, HermesDashboard, HermesSettings, HermesUsageEntry } from '../../types/electron';
import { electronService } from '../../services/electron';

interface HermesTabProps {
  hermes: HermesSettings;
  assistant: AssistantSettings;
  updateHermes: (updates: Partial<HermesSettings>) => void;
  updateAssistant: (updates: Partial<AssistantSettings>) => void;
}

const numberInput = (value: number, fallback: number) => Number.isFinite(Number(value)) ? Number(value) : fallback;

const HermesTab: React.FC<HermesTabProps> = ({ hermes, assistant, updateHermes, updateAssistant }) => {
  const [dashboard, setDashboard] = useState<HermesDashboard | null>(null);
  const [status, setStatus] = useState<string>('');
  const [isBusy, setIsBusy] = useState(false);
  const [lastConnected, setLastConnected] = useState<boolean | null>(null);
  const [docTitle, setDocTitle] = useState('');
  const [docType, setDocType] = useState('document');
  const [docText, setDocText] = useState('');
  const [agentPrompt, setAgentPrompt] = useState('');
  const [agentResponse, setAgentResponse] = useState('');

  const loadDashboard = useCallback(async () => {
    const data = await electronService.getHermesDashboard();
    setDashboard(data);
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const runAction = async (label: string, action: () => Promise<any>) => {
    setIsBusy(true);
    setStatus(label);
    try {
      const result = await action();
      if (result?.success === false || result?.connected === false) {
        setStatus(`${label}: ${result.error || result.reason || 'falhou'}`);
      } else {
        setStatus(`${label}: OK`);
      }
      await loadDashboard();
      return result;
    } catch (error: any) {
      setStatus(`${label}: ${error.message || 'erro'}`);
      return null;
    } finally {
      setIsBusy(false);
    }
  };

  const handleTestConnection = async () => {
    const result = await runAction('Testando Hermes', () => electronService.testHermesConnection());
    setLastConnected(!!result?.connected);
  };

  const handleSync = () => runAction('Sincronizando contexto local', () => electronService.syncHermesContext());

  const handleIngestDocument = async () => {
    if (!docText.trim()) {
      setStatus('Cole um texto para enviar ao Hermes.');
      return;
    }

    const result = await runAction('Enviando documento ao Hermes', () => electronService.ingestHermesDocument({
      title: docTitle.trim() || 'Documento sem titulo',
      type: docType,
      text: docText,
      source: 'settings'
    }));

    if (result?.success !== false) {
      setDocTitle('');
      setDocText('');
      setAgentResponse(result?.text || '');
    }
  };

  const handleAskHermes = async () => {
    if (!agentPrompt.trim()) {
      setStatus('Digite uma tarefa para o Hermes.');
      return;
    }

    const result = await runAction('Chamando Hermes', () => electronService.askHermes({
      prompt: agentPrompt,
      instruction: 'Resolva como agente principal do Hades. Use memoria, web, APIs ou CLI se isso for apropriado.',
      mode: assistant.mode,
      preferredAnswerStyle: assistant.preferredAnswerStyle,
      maxOutputTokens: 900,
      logType: 'manual_ask'
    }));

    setAgentResponse(result?.text || result?.error || '');
  };

  const counts = dashboard?.counts;
  const connected = lastConnected === true;
  const statusText = connected
    ? 'Hermes conectado'
    : hermes.enabled
      ? dashboard?.reason || 'Hermes configurado'
      : 'Hermes desativado';

  return (
    <div>
      <div className="tab-header">
        <h2 className="tab-title">Hermes Agent</h2>
        <p className="tab-subtitle">Use Hermes como agente principal do Hades, mantendo Gemini para transcricao rapida e titulos.</p>
      </div>

      <div className="agent-status-row">
        <div className={`agent-status-pill ${connected ? 'connected' : ''}`}>
          <Activity size={14} />
          <span>{statusText}</span>
        </div>
        <button type="button" className="settings-action-btn" onClick={loadDashboard} disabled={isBusy}>
          <RefreshCcw size={14} />
          <span>Atualizar</span>
        </button>
      </div>

      <div className="agent-metrics-grid">
        <Metric icon={<MessageSquare size={16} />} label="Chamadas" value={counts?.requests ?? 0} />
        <Metric icon={<Gauge size={16} />} label="Tokens estimados" value={counts?.estimatedTokens ?? 0} />
        <Metric icon={<FileText size={16} />} label="Chars enviados" value={counts?.promptChars ?? 0} />
        <Metric icon={<HardDrive size={16} />} label="Falhas" value={counts?.failures ?? 0} />
      </div>

      <div className="section-header">
        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Workflow size={16} /> Modo de Uso
        </span>
      </div>

      <div className="setting-row">
        <div className="setting-info">
          <div className="setting-title">Modo ativo</div>
          <div className="setting-desc">Define o comportamento padrao enviado para o Hermes.</div>
        </div>
        <div className="setting-control">
          <select
            className="settings-select"
            value={assistant.mode}
            onChange={(e) => updateAssistant({ mode: e.target.value as AssistantSettings['mode'] })}
          >
            <option value="auto">Auto</option>
            <option value="interview">Entrevista</option>
            <option value="help">Ajuda</option>
            <option value="idea">Ideias</option>
            <option value="coding">Código</option>
          </select>
        </div>
      </div>

      <div className="setting-row">
        <div className="setting-info">
          <div className="setting-title">Formato preferido</div>
          <div className="setting-desc">Controla se o Hades deve priorizar resposta curta, estrutura ou código.</div>
        </div>
        <div className="setting-control">
          <select
            className="settings-select"
            value={assistant.preferredAnswerStyle}
            onChange={(e) => updateAssistant({ preferredAnswerStyle: e.target.value as AssistantSettings['preferredAnswerStyle'] })}
          >
            <option value="auto">Auto</option>
            <option value="short">Curta</option>
            <option value="structured">Estruturada</option>
            <option value="code">Código</option>
            <option value="code_explained">Código + explicação</option>
          </select>
        </div>
      </div>

      <ToggleRow
        title="Hermes como agente principal"
        description="Quando ligado, o MiniChat usa Hermes para tudo. Gemini fica para transcrição rápida, títulos e fallback."
        checked={assistant.delegationEnabled && hermes.useAsPrimaryAgent}
        onChange={(value) => {
          updateAssistant({ delegationEnabled: value });
          updateHermes({ useAsPrimaryAgent: value });
        }}
      />

      <ToggleRow
        title="Contexto compacto"
        description="Envia somente um resumo local pequeno para reduzir uso de tokens."
        checked={assistant.compactContext}
        onChange={(value) => updateAssistant({ compactContext: value })}
      />

      <div className="section-header">
        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Bot size={16} /> Conexão Hermes
        </span>
      </div>

      <ToggleRow
        title="Ativar Hermes"
        description="Quando ligado, o Hades pode usar o Hermes como agente principal."
        checked={hermes.enabled}
        onChange={(value) => updateHermes({ enabled: value })}
      />

      <div className="setting-row">
        <div className="setting-info">
          <div className="setting-title">Base URL</div>
          <div className="setting-desc">Endpoint local do servidor Hermes. Pode incluir ou omitir /v1.</div>
        </div>
        <div className="setting-control">
          <input
            className="settings-input wide"
            placeholder="http://127.0.0.1:8642"
            value={hermes.baseUrl}
            onChange={(e) => updateHermes({ baseUrl: e.target.value })}
          />
        </div>
      </div>

      <div className="agent-form-grid">
        <Field label="Modelo" value={hermes.model} onChange={(value) => updateHermes({ model: value })} />
        <Field label="Session key" value={hermes.sessionKey} onChange={(value) => updateHermes({ sessionKey: value })} />
        <Field label="API key" type="password" value={hermes.apiKey} onChange={(value) => updateHermes({ apiKey: value })} />
        <Field label="Timeout ms" type="number" value={String(hermes.timeoutMs)} onChange={(value) => updateHermes({ timeoutMs: numberInput(Number(value), 30000) })} />
        <Field label="Contexto max" type="number" value={String(hermes.maxContextChars)} onChange={(value) => updateHermes({ maxContextChars: numberInput(Number(value), 3200) })} />
        <Field label="Resumo reunião max" type="number" value={String(hermes.meetingSummaryMaxChars)} onChange={(value) => updateHermes({ meetingSummaryMaxChars: numberInput(Number(value), 12000) })} />
      </div>

      <ToggleRow
        title="Hermes para ações externas"
        description="Prefere Hermes para tempo, Google, APIs externas, CLI e trabalhos com ferramentas fora do Hades."
        checked={hermes.useForExternalActions}
        onChange={(value) => updateHermes({ useForExternalActions: value })}
      />

      <ToggleRow
        title="Hermes para memória"
        description="Permite gravar ideias, currículo, preferências e contexto na memória persistente do Hermes."
        checked={hermes.useForMemory}
        onChange={(value) => updateHermes({ useForMemory: value })}
      />

      <ToggleRow
        title="Memorizar conversas automaticamente"
        description="Ao finalizar conversas, envia um resumo pequeno ao Hermes somente quando ligado."
        checked={hermes.autoForwardConversations}
        onChange={(value) => updateHermes({ autoForwardConversations: value })}
      />

      <ToggleRow
        title="Resumir reuniões automaticamente"
        description="Ao fechar uma transcrição, envia a reunião para o Hermes resumir e memorizar pontos importantes."
        checked={hermes.autoSummarizeMeetings}
        onChange={(value) => updateHermes({ autoSummarizeMeetings: value })}
      />

      <ToggleRow
        title="Sincronizar tasks e personas"
        description="Atualiza o Hermes quando tarefas ou personas locais mudarem."
        checked={hermes.autoForwardTasksPersonas}
        onChange={(value) => updateHermes({ autoForwardTasksPersonas: value })}
      />

      <div className="agent-actions">
        <button type="button" className="settings-action-btn" onClick={handleTestConnection} disabled={isBusy}>
          <KeyRound size={14} />
          <span>Testar Hermes</span>
        </button>
        <button type="button" className="settings-action-btn primary" onClick={handleSync} disabled={isBusy}>
          <RefreshCcw size={14} />
          <span>Sincronizar contexto</span>
        </button>
      </div>

      {status && <div className="agent-status-message">{status}</div>}

      <div className="section-header">
        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Upload size={16} /> Enviar Memória
        </span>
      </div>

      <div className="agent-document-form">
        <input
          className="settings-input wide"
          placeholder="Título do documento, currículo, ideia..."
          value={docTitle}
          onChange={(e) => setDocTitle(e.target.value)}
        />
        <select className="settings-select" value={docType} onChange={(e) => setDocType(e.target.value)}>
          <option value="document">Documento</option>
          <option value="resume">Currículo</option>
          <option value="interview">Entrevista</option>
          <option value="idea">Ideia</option>
          <option value="preference">Preferência</option>
          <option value="note">Nota</option>
        </select>
        <textarea
          className="settings-textarea agent-textarea"
          placeholder="Cole aqui o conteúdo para o Hermes resumir e memorizar."
          value={docText}
          onChange={(e) => setDocText(e.target.value)}
        />
        <button type="button" className="settings-action-btn primary" onClick={handleIngestDocument} disabled={isBusy}>
          <Upload size={14} />
          <span>Enviar ao Hermes</span>
        </button>
      </div>

      <div className="section-header">
        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Send size={16} /> Teste Manual
        </span>
      </div>

      <div className="agent-search-row">
        <input
          className="settings-input wide"
          placeholder="Ex: use minha memória e diga como eu responderia numa entrevista sobre React"
          value={agentPrompt}
          onChange={(e) => setAgentPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleAskHermes();
          }}
        />
        <button type="button" className="settings-action-btn" onClick={handleAskHermes} disabled={isBusy}>
          <Send size={14} />
          <span>Chamar</span>
        </button>
      </div>

      {agentResponse && (
        <div className="agent-results">
          <div className="agent-result">
            <div className="agent-result-meta">
              <span>Hermes</span>
              <span>{dashboard?.config?.sessionKey || hermes.sessionKey}</span>
            </div>
            <div className="agent-result-title">Resposta do agente</div>
            <div className="agent-result-text">{agentResponse}</div>
          </div>
        </div>
      )}

      <div className="section-header">Uso recente</div>
      <div className="agent-recent-grid">
        <UsageSummary counts={counts} />
        <RecentRequests items={dashboard?.recentRequests || []} />
      </div>
    </div>
  );
};

const Metric: React.FC<{ icon: React.ReactNode; label: string; value: number }> = ({ icon, label, value }) => (
  <div className="agent-metric">
    <div className="agent-metric-icon">{icon}</div>
    <div>
      <div className="agent-metric-value">{value.toLocaleString('pt-BR')}</div>
      <div className="agent-metric-label">{label}</div>
    </div>
  </div>
);

const ToggleRow: React.FC<{ title: string; description: string; checked: boolean; onChange: (value: boolean) => void }> = ({ title, description, checked, onChange }) => (
  <div className="setting-row">
    <div className="setting-info">
      <div className="setting-title">{title}</div>
      <div className="setting-desc">{description}</div>
    </div>
    <div className="setting-control">
      <label className="switch" aria-label={title}>
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="slider"></span>
      </label>
    </div>
  </div>
);

const Field: React.FC<{ label: string; value: string; type?: string; onChange: (value: string) => void }> = ({ label, value, type = 'text', onChange }) => (
  <label className="agent-field">
    <span>{label}</span>
    <input className="settings-input" type={type} value={value || ''} onChange={(e) => onChange(e.target.value)} />
  </label>
);

const UsageSummary: React.FC<{ counts: HermesDashboard['counts'] }> = ({ counts }) => (
  <div className="agent-recent-list">
    <div className="agent-recent-title">Uso local</div>
    <div className="agent-recent-item">
      <div>Contexto enviado</div>
      <span>{(counts?.promptChars ?? 0).toLocaleString('pt-BR')} chars</span>
    </div>
    <div className="agent-recent-item">
      <div>Resposta recebida</div>
      <span>{(counts?.responseChars ?? 0).toLocaleString('pt-BR')} chars</span>
    </div>
    <div className="agent-recent-item">
      <div>Memória</div>
      <span>Gerenciada internamente pelo Hermes</span>
    </div>
  </div>
);

const RecentRequests: React.FC<{ items: HermesUsageEntry[] }> = ({ items }) => (
  <div className="agent-recent-list">
    <div className="agent-recent-title">Chamadas recentes</div>
    {items.length === 0 ? (
      <div className="agent-empty">Nenhuma chamada registrada.</div>
    ) : items.map((item) => (
      <div className="agent-recent-item" key={item.id}>
        <div>{item.type} {item.success ? 'OK' : 'falhou'}</div>
        <span>
          {new Date(item.timestamp).toLocaleString('pt-BR')}
          {item.durationMs ? ` · ${item.durationMs}ms` : ''}
          {item.error ? ` · ${item.error}` : ''}
        </span>
      </div>
    ))}
  </div>
);

export default HermesTab;
