import React, { useEffect, useState } from 'react';
import { Check, Clipboard, Expand, Languages, Lightbulb, LoaderCircle, Minimize2, PenLine, Scissors, Smile, Sparkles, WandSparkles, X } from 'lucide-react';
import { electronService } from '../services/electron';
import type { SelectedTextPayload, TextActionKind } from '../types/electron';

const ACTIONS: Array<{ action: TextActionKind; label: string; icon: React.ReactNode }> = [
  { action: 'translate', label: 'Traduzir', icon: <Languages size={13} /> },
  { action: 'simplify', label: 'Simplificar', icon: <WandSparkles size={13} /> },
  { action: 'proofread', label: 'Corrigir', icon: <Check size={13} /> },
  { action: 'rewrite', label: 'Reescrever', icon: <PenLine size={13} /> },
  { action: 'professional', label: 'Profissional', icon: <Sparkles size={13} /> },
  { action: 'friendly', label: 'Amigável', icon: <Smile size={13} /> },
  { action: 'shorten', label: 'Encurtar', icon: <Scissors size={13} /> },
  { action: 'expand', label: 'Expandir', icon: <Expand size={13} /> },
  { action: 'summarize', label: 'Resumir', icon: <Minimize2 size={13} /> },
  { action: 'explain', label: 'Explicar', icon: <Lightbulb size={13} /> },
];

const PREVIEW_ACTIONS = new Set<TextActionKind>(['explain', 'summarize']);

const TextActions: React.FC = () => {
  const [selection, setSelection] = useState('');
  const [result, setResult] = useState('');
  const [customInstruction, setCustomInstruction] = useState('');
  const [error, setError] = useState('');
  const [busyAction, setBusyAction] = useState<TextActionKind | null>(null);
  const [resultAction, setResultAction] = useState<TextActionKind | null>(null);
  const [copied, setCopied] = useState(false);

  const receiveSelection = (payload: SelectedTextPayload | null) => {
    setSelection(payload?.text || '');
    setError(payload?.error || '');
    setResult('');
    setResultAction(null);
    setCopied(false);
  };

  useEffect(() => {
    const unsubscribe = electronService.onSelectedTextCaptured(receiveSelection);
    electronService.getSelectedText().then(receiveSelection);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') electronService.closeTextActions();
    };
    globalThis.addEventListener('keydown', handleKeyDown);
    return () => {
      unsubscribe();
      globalThis.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const runAction = async (action: TextActionKind) => {
    if (!selection || busyAction) return;
    setBusyAction(action);
    setError('');
    setResult('');
    setResultAction(null);
    try {
      const actionResult = await electronService.runSelectedTextAction({ action, text: selection, customInstruction });
      if (PREVIEW_ACTIONS.has(action)) {
        setResult(actionResult);
        setResultAction(action);
      } else {
        await electronService.replaceSelectedText(actionResult);
      }
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Não foi possível processar o texto.');
    } finally {
      setBusyAction(null);
    }
  };

  const copyResult = async () => {
    if (!result) return;
    await electronService.copySelectedTextResult(result);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <main className="text-actions-shell">
      <header className="text-actions-header">
        <div><WandSparkles size={15} /><strong>Ações de texto</strong><kbd>Alt+E</kbd></div>
        <button type="button" onClick={() => electronService.closeTextActions()} aria-label="Fechar"><X size={15} /></button>
      </header>

      {error && <div className="text-actions-error">{error}</div>}

      {selection && (
        <>
          <p className="text-actions-selection" title={selection}>{selection}</p>
          <div className="text-actions-grid">
            {ACTIONS.map(({ action, label, icon }) => (
              <button type="button" key={action} onClick={() => runAction(action)} disabled={Boolean(busyAction)}>
                {busyAction === action ? <LoaderCircle className="spin" size={13} /> : icon}{label}
              </button>
            ))}
          </div>
          <form className="text-actions-custom" onSubmit={(event) => { event.preventDefault(); runAction('custom'); }}>
            <input value={customInstruction} onChange={event => setCustomInstruction(event.target.value)} placeholder="Ou descreva outra transformação..." />
            <button type="submit" disabled={!customInstruction.trim() || Boolean(busyAction)}>Aplicar</button>
          </form>
        </>
      )}

      {(result || busyAction) && (
        <section className="text-actions-result">
          <span>Resultado</span>
          {busyAction ? <div className="text-actions-loading"><LoaderCircle className="spin" size={16} /> Processando...</div> : <textarea value={result} onChange={event => setResult(event.target.value)} />}
        </section>
      )}

      {result && (
        <footer className="text-actions-footer">
          <small>Somente o texto selecionado foi enviado à IA.</small>
          <button type="button" onClick={copyResult}><Clipboard size={13} />{copied ? 'Copiado' : 'Copiar'}</button>
          {resultAction && PREVIEW_ACTIONS.has(resultAction) && <span className="text-actions-preview-label">O texto original não será alterado</span>}
        </footer>
      )}
    </main>
  );
};

export default TextActions;
