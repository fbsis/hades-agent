import React, { useState } from 'react';
import { Archive, ArrowLeft, FileText, MoreHorizontal, Trash2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { InterviewSession } from '../../types/interview';
import { InterviewTranscript } from './InterviewTranscript';
import { WhiteboardGuidancePane } from './WhiteboardGuidancePane';

interface InterviewDetailsProps {
  session: InterviewSession;
  isSummarizing: boolean;
  onBack: () => void;
  onSummarize: () => void;
  onArchive: () => void;
  onDelete: () => void;
}

type DetailTab = 'overview' | 'transcript' | 'answers';

const duration = (session: InterviewSession) => {
  if (!session.startedAt || !session.endedAt) return '—';
  const seconds = Math.max(0, Math.floor((new Date(session.endedAt).getTime() - new Date(session.startedAt).getTime()) / 1000));
  return `${Math.floor(seconds / 60)} min ${seconds % 60}s`;
};

export const InterviewDetails: React.FC<InterviewDetailsProps> = ({ session, isSummarizing, onBack, onSummarize, onArchive, onDelete }) => {
  const [tab, setTab] = useState<DetailTab>('overview');
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <main className="interview-details">
      <div className="interview-details-topbar">
        <button type="button" className="interview-back-button" onClick={onBack}><ArrowLeft size={15} /> Reuniões</button>
        <div className="interview-details-menu-wrap">
          <button type="button" className="interview-icon-button" onClick={() => setMenuOpen(value => !value)} aria-label="Mais ações"><MoreHorizontal size={17} /></button>
          {menuOpen && <div className="interview-details-menu">
            <button type="button" onClick={() => { setMenuOpen(false); onSummarize(); }} disabled={isSummarizing || !session.transcript.length}><FileText size={14} /> {isSummarizing ? 'Resumindo…' : 'Gerar resumo'}</button>
            <button type="button" onClick={onArchive}><Archive size={14} /> Arquivar</button>
            <button type="button" className="danger" onClick={onDelete}><Trash2 size={14} /> Excluir</button>
          </div>}
        </div>
      </div>
      <header className="interview-details-header">
        <div><span className={`interview-status-badge status-${session.status}`}>Concluída</span><h1>{session.title}</h1><p>{session.config.mode === 'interview' ? 'Entrevista' : 'Reunião'}{session.config.company ? ` · ${session.config.company}` : ''}</p></div>
        <dl><div><dt>Data</dt><dd>{new Date(session.startedAt || session.updatedAt).toLocaleString()}</dd></div><div><dt>Duração</dt><dd>{duration(session)}</dd></div><div><dt>Turnos</dt><dd>{session.transcript.length}</dd></div></dl>
      </header>
      <nav className="interview-details-tabs" aria-label="Conteúdo da sessão">
        <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>Visão geral</button>
        <button className={tab === 'transcript' ? 'active' : ''} onClick={() => setTab('transcript')}>Transcrição</button>
        <button className={tab === 'answers' ? 'active' : ''} onClick={() => setTab('answers')}>Respostas <span>{session.answers.length}</span></button>
      </nav>
      <section className="interview-details-content">
        {tab === 'overview' && <div className="interview-overview-grid">
          {session.config.interviewFormat === 'whiteboard' && session.whiteboardState && <article className="interview-detail-card interview-whiteboard-detail"><h2>Última orientação Whiteboard</h2><WhiteboardGuidancePane state={session.whiteboardState} readOnly /></article>}
          <article className="interview-detail-card interview-summary-card"><h2>Resumo</h2>{session.summary ? <div className="interview-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{session.summary}</ReactMarkdown></div> : <div className="interview-detail-empty">Ainda não há resumo para esta sessão.<button type="button" onClick={onSummarize} disabled={isSummarizing || !session.transcript.length}>{isSummarizing ? 'Gerando…' : 'Gerar resumo'}</button></div>}</article>
          <article className="interview-detail-card"><h2>Informações</h2><dl className="interview-info-list">{session.config.mode === 'interview' && <div><dt>Formato</dt><dd>{session.config.interviewFormat === 'whiteboard' ? 'Whiteboard' : 'Tradicional'}</dd></div>}<div><dt>Idioma</dt><dd>{session.config.language}</dd></div><div><dt>Estilo de resposta</dt><dd>{session.config.answerStyle}</dd></div>{session.config.role && <div><dt>Cargo</dt><dd>{session.config.role}</dd></div>}<div><dt>Gravação</dt><dd>{session.config.retainAudio ? 'Mantida' : 'Não mantida'}</dd></div></dl></article>
        </div>}
        {tab === 'transcript' && <div className="interview-detail-transcript"><InterviewTranscript turns={session.transcript} selectedTurnId={null} onSelect={() => {}} onAnswer={() => {}} readOnly /></div>}
        {tab === 'answers' && <div className="interview-detail-answers">{session.answers.length === 0 ? <div className="interview-list-empty"><strong>Nenhuma resposta gerada</strong><span>As respostas criadas durante a sessão aparecerão aqui.</span></div> : session.answers.map(answer => <article className="interview-detail-card" key={answer.id}><small>{new Date(answer.createdAt).toLocaleString()}</small><h2>{answer.question || 'Resposta'}</h2><div className="interview-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{answer.text}</ReactMarkdown></div></article>)}</div>}
      </section>
    </main>
  );
};
