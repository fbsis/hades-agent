import React, { useState } from 'react';
import { ArrowLeft, ChevronDown, Radio, Save } from 'lucide-react';
import { InterviewConfig, InterviewContextDocument } from '../../types/interview';

interface InterviewSetupProps {
  config: InterviewConfig;
  error: string;
  isEditing?: boolean;
  onConfigChange: (config: InterviewConfig) => void;
  onStart: () => void;
  onSavePending: () => void;
  onCancel: () => void;
  documents: InterviewContextDocument[];
}

export const InterviewSetup: React.FC<InterviewSetupProps> = ({ config, error, isEditing = false, onConfigChange, onStart, onSavePending, onCancel, documents }) => {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const update = <K extends keyof InterviewConfig>(key: K, value: InterviewConfig[K]) => onConfigChange({ ...config, [key]: value });

  return (
    <main className="interview-form-page">
      <div className="interview-form-topbar">
        <button type="button" className="interview-back-button" onClick={onCancel}><ArrowLeft size={15} /> Voltar para reuniões</button>
      </div>
      <div className="interview-form-scroll">
        <header className="interview-form-heading"><h1>{isEditing ? 'Editar sessão pendente' : 'Nova reunião ou entrevista'}</h1><p>Defina o contexto principal. Você pode ajustar as opções avançadas quando precisar.</p></header>
        <section className="interview-form-card">
          <div className="interview-mode-selector" role="group" aria-label="Tipo de sessão">
            <button type="button" className={config.mode === 'meeting' ? 'active' : ''} onClick={() => update('mode', 'meeting')}>Reunião</button>
            <button type="button" className={config.mode === 'interview' ? 'active' : ''} onClick={() => update('mode', 'interview')}>Entrevista</button>
          </div>
          <div className="interview-form-grid">
            <label className="interview-title-field"><span>Título *</span><input autoFocus value={config.title} onChange={event => update('title', event.target.value)} placeholder={config.mode === 'interview' ? 'Entrevista técnica' : 'Planejamento semanal'} /></label>
            {config.mode === 'interview' ? <><label><span>Cargo</span><input value={config.role} onChange={event => update('role', event.target.value)} placeholder="Senior Software Engineer" /></label><label><span>Empresa</span><input value={config.company} onChange={event => update('company', event.target.value)} placeholder="Empresa" /></label></> : <label className="interview-title-field"><span>Empresa ou pessoa</span><input value={config.company} onChange={event => update('company', event.target.value)} placeholder="Acme ou Maria Silva" /></label>}
            <label><span>Idioma</span><select value={config.language} onChange={event => update('language', event.target.value as InterviewConfig['language'])}><option value="auto">Automático</option><option value="pt-BR">Português</option><option value="en-US">English</option></select></label>
            <label><span>Estilo da resposta</span><select value={config.answerStyle} onChange={event => update('answerStyle', event.target.value as InterviewConfig['answerStyle'])}><option value="natural">Natural</option><option value="concise">Curta</option><option value="star">STAR</option><option value="technical">Técnica</option></select></label>
          </div>
          <div className="interview-context-selector">
            <div><strong>Documentos de contexto</strong><small>Opcional · selecione tudo que a IA deve considerar</small></div>
            {documents.length ? <div className="interview-context-options">{documents.map(document => {
              const selected = config.contextDocumentIds.includes(document.id);
              return <label className={selected ? 'selected' : ''} key={document.id}><input type="checkbox" checked={selected} onChange={() => update('contextDocumentIds', selected ? config.contextDocumentIds.filter(id => id !== document.id) : [...config.contextDocumentIds, document.id])} /><span><strong>{document.title}</strong><small>Texto de contexto</small></span></label>;
            })}</div> : <p className="interview-context-empty">Nenhum documento criado. Use a área “Documentos” na tela de reuniões para montar contextos reutilizáveis.</p>}
          </div>
        </section>

        <section className={`interview-advanced-card ${advancedOpen ? 'open' : ''}`}>
          <button type="button" className="interview-advanced-toggle" onClick={() => setAdvancedOpen(value => !value)} aria-expanded={advancedOpen}><span><strong>Configurações avançadas</strong><small>Contexto, transcrição e gravação</small></span><ChevronDown size={17} /></button>
          {advancedOpen && <div className="interview-advanced-content">
            {config.mode === 'interview' ? <><label className="interview-wide-field"><span>Assuntos previstos</span><textarea value={config.topics} onChange={event => update('topics', event.target.value)} rows={3} placeholder="React, arquitetura, algoritmos..." /></label><label className="interview-wide-field"><span>Currículo</span><textarea value={config.resume} onChange={event => update('resume', event.target.value)} rows={4} placeholder="Cole o currículo usado como contexto." /></label><label className="interview-wide-field"><span>Descrição da vaga</span><textarea value={config.jobDescription} onChange={event => update('jobDescription', event.target.value)} rows={3} /></label></> : <label className="interview-wide-field"><span>Descrição da reunião</span><textarea value={config.description} onChange={event => update('description', event.target.value)} rows={4} placeholder="Objetivo, participantes, pauta e informações úteis." /></label>}
            <label className="interview-wide-field"><span>Contexto adicional</span><textarea value={config.extraInstructions} onChange={event => update('extraInstructions', event.target.value)} rows={3} /></label>
            <div className="interview-toggle-row"><label className="interview-toggle"><input type="checkbox" checked={config.saveTranscript} onChange={event => update('saveTranscript', event.target.checked)} /><span>Salvar transcrição</span></label><label className="interview-toggle"><input type="checkbox" checked={config.transcribeMicrophone} onChange={event => update('transcribeMicrophone', event.target.checked)} /><span>Transcrever meu microfone</span></label><label className="interview-toggle"><input type="checkbox" checked={config.retainAudio} onChange={event => update('retainAudio', event.target.checked)} /><span>Guardar gravação</span></label></div>
          </div>}
        </section>
        {error && <div className="interview-error interview-form-error">{error}</div>}
      </div>
      <footer className="interview-form-actions"><button type="button" className="interview-cancel-button" onClick={onCancel}>Cancelar</button><button type="button" className="interview-secondary-button" onClick={onSavePending}><Save size={15} /> {isEditing ? 'Salvar alterações' : 'Salvar como pendente'}</button><button type="button" className="interview-primary-button" onClick={onStart}><Radio size={16} /> Iniciar {config.mode === 'interview' ? 'entrevista' : 'reunião'}</button></footer>
    </main>
  );
};
