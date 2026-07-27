import React from 'react';
import { Archive, Clock3, Play, Radio } from 'lucide-react';
import { InterviewConfig, InterviewSession } from '../../types/interview';

interface InterviewSetupProps {
  config: InterviewConfig;
  recentSessions: InterviewSession[];
  error: string;
  onConfigChange: (config: InterviewConfig) => void;
  onStart: () => void;
  onLoadSession: (session: InterviewSession) => void;
  onArchiveSession: (sessionId: string) => void;
}

export const InterviewSetup: React.FC<InterviewSetupProps> = ({
  config,
  recentSessions,
  error,
  onConfigChange,
  onStart,
  onLoadSession,
  onArchiveSession
}) => {
  const update = <K extends keyof InterviewConfig>(key: K, value: InterviewConfig[K]) => {
    onConfigChange({ ...config, [key]: value });
  };

  return (
    <div className="interview-setup">
      <div className="interview-setup-form">
        <div className="interview-section-title">Preparar entrevista</div>
        <div className="interview-form-grid">
          <label>
            <span>Cargo</span>
            <input value={config.role} onChange={event => update('role', event.target.value)} placeholder="Senior Software Engineer" />
          </label>
          <label>
            <span>Empresa</span>
            <input value={config.company} onChange={event => update('company', event.target.value)} placeholder="Empresa" />
          </label>
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

        <label className="interview-wide-field">
          <span>Descricao da vaga</span>
          <textarea value={config.jobDescription} onChange={event => update('jobDescription', event.target.value)} rows={3} />
        </label>
        <label className="interview-wide-field">
          <span>Instrucoes adicionais</span>
          <textarea value={config.extraInstructions} onChange={event => update('extraInstructions', event.target.value)} rows={2} />
        </label>

        <div className="interview-toggle-row">
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
        <button className="interview-primary-button" type="button" onClick={onStart}>
          <Radio size={16} />
          Iniciar entrevista
        </button>
      </div>

      <div className="interview-recents">
        <div className="interview-section-title">Sessoes recentes</div>
        <div className="interview-recent-list">
          {recentSessions.length === 0 && <div className="interview-empty-small">Nenhuma sessao salva.</div>}
          {recentSessions.map(item => (
            <div className="interview-recent-row" key={item.id}>
              <button type="button" className="interview-recent-open" onClick={() => onLoadSession(item)}>
                <Play size={13} />
                <span>
                  <strong>{item.title}</strong>
                  <small><Clock3 size={10} /> {new Date(item.updatedAt).toLocaleString()}</small>
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
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
