import React, { useEffect, useState } from 'react';
import { ArrowLeft, BookOpen, ChevronRight, Lightbulb, LoaderCircle, MessageCircle, RefreshCw, Sparkles } from 'lucide-react';
import { ConversationSuggestion, ConversationSuggestionExpansion } from '../../types/interview';

interface ConversationSuggestionsPaneProps {
  suggestions: ConversationSuggestion[];
  selectedId: string | null;
  expansion: ConversationSuggestionExpansion | null;
  isLoading: boolean;
  isExpanding: boolean;
  onRefresh: (hint?: string) => void;
  onMore: (hint?: string) => void;
  onSelect: (suggestion: ConversationSuggestion) => void;
  onBack: () => void;
  onHoverChange: (hovered: boolean) => void;
}

const typeLabel: Record<ConversationSuggestion['type'], string> = {
  say: 'Falar',
  question: 'Perguntar',
  social: 'Conexão'
};

export const ConversationSuggestionsPane: React.FC<ConversationSuggestionsPaneProps> = ({
  suggestions,
  selectedId,
  expansion,
  isLoading,
  isExpanding,
  onRefresh,
  onMore,
  onSelect,
  onBack,
  onHoverChange
}) => {
  const [hint, setHint] = useState('');
  const [isHovering, setIsHovering] = useState(false);

  useEffect(() => {
    if (hint.trim() || selectedId) return;
    const timer = globalThis.setInterval(() => {
      if (!isHovering && !isLoading) onRefresh();
    }, 5000);
    return () => globalThis.clearInterval(timer);
  }, [hint, isHovering, isLoading, onRefresh, selectedId]);

  useEffect(() => () => onHoverChange(false), [onHoverChange]);

  const selectedSuggestion = suggestions.find(suggestion => suggestion.id === selectedId);
  if (selectedSuggestion) {
    return <div className="conversation-suggestions-pane conversation-suggestion-detail">
      <header>
        <button type="button" onClick={() => { onHoverChange(false); onBack(); }}><ArrowLeft size={14} /> Voltar às opções</button>
        <span>{typeLabel[selectedSuggestion.type]} · {Math.round(selectedSuggestion.probability * 100)}%</span>
      </header>
      <div className="conversation-suggestion-detail-scroll">
        <section className="conversation-suggestion-detail-intro">
          <span className="conversation-suggestion-rank">{selectedSuggestion.rank}</span>
          <div><h2>{selectedSuggestion.title}</h2><p>{selectedSuggestion.intent}</p></div>
        </section>
        {selectedSuggestion.type === 'social' && <section className="conversation-suggestion-detail-context">
          <strong>Clima e motivação</strong>
          <p>{[selectedSuggestion.mood, selectedSuggestion.motivation].filter(Boolean).join(' · ')}</p>
        </section>}
        {isExpanding && <div className="conversation-suggestion-detail-loading"><LoaderCircle className="spin" size={20} /><strong>Preparando como abordar…</strong><small>A opção já foi escolhida; agora o copiloto está aprofundando o contexto.</small></div>}
        {expansion && <>
          <section className="conversation-suggestion-detail-quick">
            <span><MessageCircle size={14} /> Para usar agora</span>
            <ol>{expansion.quickResponses.map((response, index) => <li key={`quick-${index}`}>{response}</li>)}</ol>
          </section>
          <section className="conversation-suggestion-detail-deep">
            <span><BookOpen size={14} /> Aprofundamento</span>
            <ul>{expansion.deepDive.map((topic, index) => <li key={`deep-${index}`}>{topic}</li>)}</ul>
          </section>
        </>}
      </div>
    </div>;
  }

  return <div className="conversation-suggestions-pane">
    <form className="conversation-suggestions-hint" onSubmit={event => { event.preventDefault(); onRefresh(hint); }}>
      <Lightbulb size={15} />
      <input value={hint} onChange={event => setHint(event.target.value)} placeholder="Poucas palavras para orientar, por exemplo: prazo, discordar, descontrair…" />
      <button type="submit" disabled={isLoading || !hint.trim()}>Sugerir</button>
    </form>
    <div className="conversation-suggestions-toolbar">
      <div><strong>Próximos movimentos</strong><small>Ordenados pela chance de serem úteis agora</small></div>
      <button type="button" onClick={() => onRefresh(hint)} disabled={isLoading}>
        {isLoading ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}
        {isLoading ? 'Analisando' : 'Atualizar'}
      </button>
    </div>
    <div
      className="conversation-suggestions-scroll"
      onMouseEnter={() => { setIsHovering(true); onHoverChange(true); }}
      onMouseLeave={() => { setIsHovering(false); onHoverChange(false); }}
    >
      {!suggestions.length && !isLoading && <div className="conversation-suggestions-empty">
        <Sparkles size={22} />
        <strong>O copiloto está acompanhando</strong>
        <p>Assim que houver conversa transcrita, você receberá cinco possibilidades para falar ou perguntar.</p>
      </div>}
      {suggestions.map(suggestion => {
        return <article className="conversation-suggestion" key={suggestion.id}>
          <button type="button" onClick={() => { onHoverChange(true); onSelect(suggestion); }} disabled={isExpanding}>
            <span className="conversation-suggestion-rank">{suggestion.rank}</span>
            <span className="conversation-suggestion-copy">
              <span className="conversation-suggestion-meta"><b>{typeLabel[suggestion.type]}</b><small>{Math.round(suggestion.probability * 100)}%</small></span>
              <strong>{suggestion.title}</strong>
              <small>{suggestion.intent}</small>
              {suggestion.type === 'social' && <em>{[suggestion.mood, suggestion.motivation].filter(Boolean).join(' · ')}</em>}
            </span>
            <ChevronRight size={15} />
          </button>
        </article>;
      })}
      {!!suggestions.length && <button className="conversation-suggestions-more" type="button" onClick={() => onMore(hint)} disabled={isLoading}>
        <span>6</span>
        <strong>{isLoading ? 'Buscando outras opções…' : 'Mostrar mais'}</strong>
        <small>Processar outras perguntas e sugestões</small>
        {isLoading ? <LoaderCircle className="spin" size={15} /> : <ChevronRight size={15} />}
      </button>}
    </div>
  </div>
};
