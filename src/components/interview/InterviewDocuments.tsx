import React, { useState } from 'react';
import { ArrowLeft, Edit3, FileText, Plus, Trash2 } from 'lucide-react';
import { InterviewContextDocument } from '../../types/interview';

interface InterviewDocumentsProps {
  documents: InterviewContextDocument[];
  onBack: () => void;
  onSave: (document: Partial<InterviewContextDocument> & Pick<InterviewContextDocument, 'title' | 'content'>) => Promise<void>;
  onDelete: (document: InterviewContextDocument) => Promise<void>;
}

const emptyDocument = { title: '', content: '' };

export const InterviewDocuments: React.FC<InterviewDocumentsProps> = ({ documents, onBack, onSave, onDelete }) => {
  const [editing, setEditing] = useState<(typeof emptyDocument & { id?: string }) | null>(null);
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const save = async () => {
    if (!editing?.title.trim() || !editing.content.trim()) {
      setError('Informe o título e o conteúdo do documento.');
      return;
    }
    setIsSaving(true);
    setError('');
    try {
      await onSave(editing);
      setEditing(null);
      setError('');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Não foi possível salvar o documento.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <main className="interview-documents-page">
      <div className="interview-form-topbar">
        <button type="button" className="interview-back-button" onClick={onBack}><ArrowLeft size={15} /> Reuniões</button>
        {!editing && <button type="button" className="interview-primary-button" onClick={() => setEditing({ ...emptyDocument })}><Plus size={15} /> Novo documento</button>}
      </div>
      {editing ? <div className="interview-document-editor">
        <header><h1>{editing.id ? 'Editar documento' : 'Novo documento de contexto'}</h1><p>Este conteúdo poderá ser reutilizado em diferentes reuniões.</p></header>
        <label><span>Título *</span><input autoFocus value={editing.title} onChange={event => setEditing({ ...editing, title: event.target.value })} placeholder="Especialista em Inteligência Artificial" /></label>
        <label><span>Conteúdo *</span><textarea value={editing.content} onChange={event => setEditing({ ...editing, content: event.target.value })} rows={14} placeholder="Descreva conhecimentos, experiências, princípios e informações que a IA deve considerar..." /></label>
        {error && <div className="interview-error">{error}</div>}
        <footer><button type="button" className="interview-cancel-button" onClick={() => { setEditing(null); setError(''); }} disabled={isSaving}>Cancelar</button><button type="button" className="interview-primary-button" onClick={save} disabled={isSaving}>{isSaving ? 'Salvando…' : 'Salvar documento'}</button></footer>
      </div> : <div className="interview-documents-list">
        <header><h1>Documentos de contexto</h1><p>Crie conhecimentos reutilizáveis e escolha quais devem participar de cada reunião.</p></header>
        {documents.length ? <div className="interview-document-grid">{documents.map(document => <article key={document.id} className="interview-document-card">
          <FileText size={18} />
          <div><h2>{document.title}</h2><p>{document.content.slice(0, 120)}{document.content.length > 120 ? '…' : ''}</p><small>Atualizado em {new Date(document.updatedAt).toLocaleString()}</small></div>
          <div className="interview-document-actions"><button type="button" onClick={() => setEditing({ id: document.id, title: document.title, content: document.content })} title="Editar"><Edit3 size={14} /></button><button type="button" className="danger" onClick={() => onDelete(document)} title="Excluir"><Trash2 size={14} /></button></div>
        </article>)}</div> : <div className="interview-list-empty"><FileText size={28} /><strong>Nenhum documento criado</strong><span>Crie contextos como “Especialista em IA” ou “Especialista em Design System”.</span><button type="button" className="interview-primary-button" onClick={() => setEditing({ ...emptyDocument })}><Plus size={15} /> Novo documento</button></div>}
      </div>}
    </main>
  );
};
