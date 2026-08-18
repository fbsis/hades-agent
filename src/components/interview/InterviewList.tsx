import React, { useMemo, useState } from 'react';
import { Archive, Edit3, FileText, FolderOpen, Play, Plus, Search, Trash2, X } from 'lucide-react';
import { InterviewSession, InterviewSessionStatus, MeetingMode } from '../../types/interview';
import { filterInterviewSessions } from '../../utils/interview';

interface InterviewListProps {
  sessions: InterviewSession[];
  onCreate: () => void;
  onOpen: (session: InterviewSession) => void;
  onEdit: (session: InterviewSession) => void;
  onStart: (session: InterviewSession) => void;
  onArchive: (sessionId: string) => void;
  onDelete: (session: InterviewSession) => void;
  onDocuments: () => void;
}

const statusLabel: Record<InterviewSessionStatus, string> = {
  pending: 'Pendente', active: 'Em andamento', completed: 'Concluída', archived: 'Arquivada'
};

export const InterviewList: React.FC<InterviewListProps> = ({
  sessions, onCreate, onOpen, onEdit, onStart, onArchive, onDelete, onDocuments
}) => {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'all' | MeetingMode>('all');
  const [status, setStatus] = useState<'all' | InterviewSessionStatus>('all');
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filtered = useMemo(
    () => filterInterviewSessions(sessions, { query: normalizedQuery, mode, status }),
    [mode, normalizedQuery, sessions, status]
  );
  const hasFilters = Boolean(normalizedQuery || mode !== 'all' || status !== 'all');

  return (
    <main className="interview-crud-list">
      <div className="interview-crud-toolbar">
        <div>
          <h1>Reuniões e entrevistas</h1>
          <p>Organize, retome e consulte suas sessões.</p>
        </div>
        <div className="interview-crud-primary-actions"><button type="button" className="interview-secondary-button" onClick={onDocuments}><FileText size={15} /> Documentos</button><button type="button" className="interview-primary-button" onClick={onCreate}><Plus size={16} /> Nova reunião</button></div>
      </div>

      <div className="interview-list-filters">
        <label className="interview-search-field">
          <Search size={15} />
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar por título, empresa ou cargo" />
        </label>
        <select aria-label="Filtrar por tipo" value={mode} onChange={event => setMode(event.target.value as 'all' | MeetingMode)}>
          <option value="all">Todos os tipos</option>
          <option value="meeting">Reuniões</option>
          <option value="interview">Entrevistas</option>
        </select>
        <select aria-label="Filtrar por status" value={status} onChange={event => setStatus(event.target.value as 'all' | InterviewSessionStatus)}>
          <option value="all">Todos os status</option>
          <option value="pending">Pendentes</option>
          <option value="active">Em andamento</option>
          <option value="completed">Concluídas</option>
        </select>
        {hasFilters && (
          <button type="button" className="interview-clear-filters" onClick={() => { setQuery(''); setMode('all'); setStatus('all'); }}>
            <X size={14} /> Limpar
          </button>
        )}
      </div>

      {filtered.length ? (
        <div className="interview-table-wrap">
          <table className="interview-session-table">
            <thead><tr><th>Título</th><th>Tipo</th><th>Empresa / cargo</th><th>Status</th><th>Atualizada</th><th><span className="sr-only">Ações</span></th></tr></thead>
            <tbody>{filtered.map(session => (
              <tr key={session.id}>
                <td data-label="Título"><button className="interview-title-link" type="button" onClick={() => onOpen(session)}>{session.title}</button></td>
                <td data-label="Tipo">{session.config.mode === 'interview' ? 'Entrevista' : 'Reunião'}</td>
                <td data-label="Empresa / cargo">{[session.config.company, session.config.role].filter(Boolean).join(' · ') || '—'}</td>
                <td data-label="Status"><span className={`interview-status-badge status-${session.status}`}>{statusLabel[session.status]}</span></td>
                <td data-label="Atualizada">{new Date(session.updatedAt).toLocaleString()}</td>
                <td className="interview-row-actions">
                  <button type="button" onClick={() => onOpen(session)} title="Abrir"><FolderOpen size={14} /></button>
                  {session.status === 'pending' && <button type="button" onClick={() => onEdit(session)} title="Editar"><Edit3 size={14} /></button>}
                  {(session.status === 'pending' || session.status === 'active') && <button type="button" onClick={() => onStart(session)} title={session.status === 'active' ? 'Continuar' : 'Iniciar'}><Play size={14} /></button>}
                  <button type="button" onClick={() => onArchive(session.id)} title="Arquivar"><Archive size={14} /></button>
                  <button type="button" className="danger" onClick={() => onDelete(session)} title="Excluir"><Trash2 size={14} /></button>
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : (
        <div className="interview-list-empty">
          <FolderOpen size={28} />
          <strong>{hasFilters ? 'Nenhuma sessão encontrada' : 'Nenhuma reunião criada'}</strong>
          <span>{hasFilters ? 'Ajuste ou limpe os filtros para tentar novamente.' : 'Crie sua primeira reunião ou entrevista para começar.'}</span>
          {hasFilters
            ? <button type="button" className="interview-secondary-button" onClick={() => { setQuery(''); setMode('all'); setStatus('all'); }}>Limpar filtros</button>
            : <button type="button" className="interview-primary-button" onClick={onCreate}><Plus size={15} /> Nova reunião</button>}
        </div>
      )}
    </main>
  );
};
