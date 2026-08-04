import React from 'react';
import {
  Archive,
  Clock3,
  Play,
  Radio,
  Save,
  Trash2
} from 'lucide-react';
import { InterviewConfig, InterviewSession } from '../../types/interview';

interface InterviewSetupProps {
  config: InterviewConfig;
  recentSessions: InterviewSession[];
  error: string;
  pendingSession?: InterviewSession | null;
  onConfigChange: (config: InterviewConfig) => void;
  onStart: () => void;
  onSavePending: () => void;
  onLoadSession: (session: InterviewSession) => void;
  onArchiveSession: (sessionId: string) => void;
  onDeleteSession: (session: InterviewSession) => void;
}

export const InterviewSetup: React.FC<InterviewSetupProps> = ({
  config,
  recentSessions,
  error,
  pendingSession,
  onConfigChange,
  onStart,
  onSavePending,
  onLoadSession,
  onArchiveSession,
  onDeleteSession
}) => {
  const update = <K extends keyof InterviewConfig>(key: K, value: InterviewConfig[K]) => {
    onConfigChange({ ...config, [key]: value });
  };

  return (
    <div className="interview-setup">
      <div className="interview-setup-form">
        <div className="interview-section-title">
          {pendingSession
            ? 'Editar entrevista pendente'
            : `Preparar ${config.mode === 'interview' ? 'entrevista' : 'reunião'}`}
        </div>
        <div className="interview-mode-selector" role="group" aria-label="Tipo de reunião">
          <button
            type="button"
            className={config.mode === 'meeting' ? 'active' : ''}
            onClick={() => update('mode', 'meeting')}
          >
            Reunião
          </button>
          <button
            type="button"
            className={config.mode === 'interview' ? 'active' : ''}
            onClick={() => update('mode', 'interview')}
          >
            Entrevista
          </button>
        </div>
        <div className="interview-form-grid">
          <label className="interview-title-field">
            <span>{config.mode === 'interview' ? 'Título da entrevista' : 'Título da chamada'}</span>
            <input
              value={config.title}
              onChange={event => update('title', event.target.value)}
              placeholder={config.mode === 'interview' ? 'Entrevista técnica' : 'Planejamento semanal'}
            />
          </label>
          {config.mode === 'interview' && (
            <>
          <label>
            <span>Cargo</span>
            <input value={config.role} onChange={event => update('role', event.target.value)} placeholder="Senior Software Engineer" />
          </label>
          <label>
            <span>Empresa</span>
            <input value={config.company} onChange={event => update('company', event.target.value)} placeholder="Empresa" />
          </label>
            </>
          )}
          {config.mode === 'meeting' && (
            <label>
              <span>Empresa ou pessoa (opcional)</span>
              <input
                value={config.company}
                onChange={event => update('company', event.target.value)}
                placeholder="Ex.: Acme ou Maria Silva"
              />
            </label>
          )}
          <label>
            <span>Idioma</span>
            <select value={config.language} onChange={event => update('language', event.target.value as InterviewConfig['language'])}>
              <option value="auto">Automatico</option>
              <option value="pt-BR">Portugues</option>
              <option value="en-US">English</option>
            </select>
          </label>
          <label>
            <span>Resposta</span>
            <select value={config.answerStyle} onChange={event => update('answerStyle', event.target.value as InterviewConfig['answerStyle'])}>
              <option value="natural">Natural</option>
              <option value="concise">Curta</option>
              <option value="star">STAR</option>
              <option value="technical">Tecnica</option>
            </select>
          </label>
        </div>

        {config.mode === 'interview' ? (
          <>
            <label className="interview-wide-field">
              <span>Assuntos previstos</span>
              <textarea
                value={config.topics}
                onChange={event => update('topics', event.target.value)}
                rows={3}
                placeholder="Ex.: event loop, React hooks, arquitetura, algoritmos e perguntas comportamentais."
              />
            </label>
            <label className="interview-wide-field">
              <span>Currículo</span>
              <textarea
                value={config.resume}
                onChange={event => update('resume', event.target.value)}
                rows={4}
                placeholder="Cole aqui o currículo usado para gerar respostas."
              />
            </label>
            <label className="interview-wide-field">
              <span>Descrição da vaga</span>
              <textarea value={config.jobDescription} onChange={event => update('jobDescription', event.target.value)} rows={3} />
            </label>
          </>
        ) : (
          <label className="interview-wide-field">
            <span>Descrição da reunião</span>
            <textarea
              value={config.description}
              onChange={event => update('description', event.target.value)}
              rows={4}
              placeholder="Objetivo, participantes, pauta e informações úteis."
            />
          </label>
        )}
        <label className="interview-wide-field">
          <span>Contexto adicional</span>
          <textarea value={config.extraInstructions} onChange={event => update('extraInstructions', event.target.value)} rows={2} />
        </label>

        <div className="interview-toggle-row">
          <label className="interview-toggle">
            <input
              type="checkbox"
              checked={config.saveTranscript}
              onChange={event => update('saveTranscript', event.target.checked)}
            />
            <span>Salvar transcrição</span>
          </label>
          <label className="interview-toggle">
            <input
              type="checkbox"
              checked={config.transcribeMicrophone}
              onChange={event => update('transcribeMicrophone', event.target.checked)}
            />
            <span>Transcrever meu microfone</span>
          </label>
          <label className="interview-toggle">
            <input
              type="checkbox"
              checked={config.retainAudio}
              onChange={event => update('retainAudio', event.target.checked)}
            />
            <span>Guardar gravacao</span>
          </label>
        </div>

        {error && <div className="interview-error">{error}</div>}
        <div className="interview-setup-actions">
          {config.mode === 'interview' && (
            <button className="interview-secondary-button" type="button" onClick={onSavePending}>
              <Save size={15} />
              {pendingSession ? 'Atualizar pendente' : 'Salvar como pendente'}
            </button>
          )}
          <button className="interview-primary-button" type="button" onClick={onStart}>
            <Radio size={16} />
            Iniciar {config.mode === 'interview' ? 'entrevista' : 'reunião'}
          </button>
        </div>
      </div>

      <div className="interview-recents">
        <div className="interview-section-title">Sessoes recentes</div>
        <div className="interview-recent-list">
          {recentSessions.length === 0 && <div className="interview-empty-small">Nenhuma sessao salva.</div>}
          {recentSessions.map(item => (
            <div className="interview-recent-row" key={item.id}>
              <button type="button" className="interview-recent-open" onClick={() => onLoadSession(item)}>
                {item.status === 'pending' ? <Clock3 size={13} /> : <Play size={13} />}
                <span>
                  <strong>{item.title}</strong>
                  <small>
                    <span className={`interview-session-status status-${item.status}`}>
                      {item.status === 'pending'
                        ? 'Pendente'
                        : item.status === 'completed'
                          ? 'Concluída'
                          : 'Em andamento'}
                    </span>
                    {item.status === 'completed' && item.config.retainAudio && (
                      <span
                        className={`interview-session-status status-${item.hermesMemory?.status === 'synced' ? 'completed' : 'pending'}`}
                        title={item.hermesMemory?.error || 'Memória persistente da reunião no Hermes'}
                      >
                        Hermes: {item.hermesMemory?.status === 'synced' ? 'memorizado' : 'pendente'}
                      </span>
                    )}
                    <Clock3 size={10} />
                    {new Date(item.updatedAt).toLocaleString()}
                  </small>
                </span>
              </button>
              <button
                type="button"
                className="interview-icon-button"
                onClick={() => onArchiveSession(item.id)}
                title="Arquivar sessao"
              >
                <Archive size={14} />
              </button>
              <button
                type="button"
                className="interview-icon-button danger"
                onClick={() => onDeleteSession(item)}
                title="Excluir permanentemente"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
