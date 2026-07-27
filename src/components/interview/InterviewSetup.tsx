import React from 'react';
import {
  Archive,
  BadgeDollarSign,
  CheckCircle2,
  Clock3,
  Cloud,
  LoaderCircle,
  LogIn,
  Play,
  Radio
} from 'lucide-react';
import { GoogleCloudAuthStatus, InterviewConfig, InterviewSession } from '../../types/interview';

interface InterviewSetupProps {
  config: InterviewConfig;
  recentSessions: InterviewSession[];
  error: string;
  cloudAuthStatus: GoogleCloudAuthStatus | null;
  isAuthenticatingCloud: boolean;
  onConfigChange: (config: InterviewConfig) => void;
  onAuthenticateCloud: () => void;
  onOpenCloudDataLogging: () => void;
  onStart: () => void;
  onLoadSession: (session: InterviewSession) => void;
  onArchiveSession: (sessionId: string) => void;
}

export const InterviewSetup: React.FC<InterviewSetupProps> = ({
  config,
  recentSessions,
  error,
  cloudAuthStatus,
  isAuthenticatingCloud,
  onConfigChange,
  onAuthenticateCloud,
  onOpenCloudDataLogging,
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
        <div className="interview-section-title">
          Preparar {config.mode === 'interview' ? 'entrevista' : 'reunião'}
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
          <label className="interview-transcription-provider-field">
            <span>Transcricao</span>
            <select
              value={config.transcriptionProvider}
              onChange={event => update(
                'transcriptionProvider',
                event.target.value as InterviewConfig['transcriptionProvider']
              )}
            >
              <option value="whisper-local">Whisper local (privado e sem custo)</option>
              <option value="gemini-live">Gemini Live (apos pausas)</option>
              <option value="google-cloud">Google Cloud (transcricao continua)</option>
            </select>
          </label>
        </div>

        {config.mode === 'interview' ? (
          <>
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

        {config.transcriptionProvider === 'google-cloud' && (
        <>
        <label className="interview-wide-field">
          <span>Google Cloud Project ID</span>
          <input
            value={config.googleCloudProjectId}
            onChange={event => update('googleCloudProjectId', event.target.value)}
            placeholder="meu-projeto-google-cloud"
          />
        </label>
        <div className={`interview-cloud-auth ${cloudAuthStatus?.authenticated ? 'connected' : ''}`}>
          <div className="interview-cloud-auth-state">
            {cloudAuthStatus?.authenticated ? <CheckCircle2 size={16} /> : <Cloud size={16} />}
            <span>
              <strong>Google Cloud Speech-to-Text</strong>
              <small>
                {cloudAuthStatus === null
                  ? 'Verificando'
                  : cloudAuthStatus.authenticated
                    ? cloudAuthStatus.projectId || 'Conectado'
                    : cloudAuthStatus.error || 'Nao conectado'}
              </small>
            </span>
          </div>
          <div className="interview-cloud-auth-actions">
            <button
              type="button"
              className="interview-cloud-auth-button discount"
              onClick={onOpenCloudDataLogging}
              title="Abrir configuracao de data logging e desconto"
            >
              <BadgeDollarSign size={14} />
              Menor custo
            </button>
            <button
              type="button"
              className="interview-cloud-auth-button"
              onClick={onAuthenticateCloud}
              disabled={isAuthenticatingCloud}
            >
              {isAuthenticatingCloud
                ? <LoaderCircle className="spin" size={14} />
                : <LogIn size={14} />}
              {isAuthenticatingCloud
                ? 'Aguardando login'
                : cloudAuthStatus?.authenticated
                  ? 'Reconectar'
                  : 'Conectar'}
            </button>
          </div>
        </div>
        </>
        )}

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
        <button className="interview-primary-button" type="button" onClick={onStart}>
          <Radio size={16} />
          Iniciar {config.mode === 'interview' ? 'entrevista' : 'reunião'}
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
