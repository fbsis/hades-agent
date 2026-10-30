import React, { useEffect, useRef, useState } from 'react';
import { Check, Clipboard, Expand, Languages, Lightbulb, LoaderCircle, Minimize2, PenLine, Scissors, Smile, Sparkles, WandSparkles, X } from 'lucide-react';
import { electronService } from '../services/electron';
import type { SelectedTextPayload, TextActionKind } from '../types/electron';
import { shouldAutoReplace } from '../utils/textActions';

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
  const [capture, setCapture] = useState<SelectedTextPayload>({});
  const [selection, setSelection] = useState('');
  const [result, setResult] = useState('');
  const [customInstruction, setCustomInstruction] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [shortcut, setShortcut] = useState('Alt+Space');
  const [busyAction, setBusyAction] = useState<TextActionKind | null>(null);
  const [resultAction, setResultAction] = useState<TextActionKind | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [copied, setCopied] = useState(false);
  const sequence = useRef(0);
  const contextActions = useRef(new Set<string>());

  useEffect(() => {
    let alive = true, eventSeen = false;
    const receive = (payload: SelectedTextPayload | null) => {
      if (!alive) return;
      sequence.current++;
      setCapture(payload || {});
      setSelection(payload?.text || '');
      setError(payload?.error || '');
      setResult(payload?.result || ''); setResultAction(null); setBusyAction(null); setReplacing(false); setCopied(false); setLoading(false);
      if (payload?.shortcut) setShortcut(payload.shortcut);
    };
    const unsubscribe = electronService.onSelectedTextCaptured(payload => { eventSeen = true; receive(payload); });
    // The main process retains success AND failure, so a lazy renderer cannot miss it.
    void electronService.getSelectedText().then(payload => { if (!eventSeen) receive(payload); }).catch(() => receive({ error: 'Não foi possível ler a seleção. Cole o texto abaixo.' }));
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { sequence.current++; electronService.closeTextActions(); }
    };
    globalThis.addEventListener('keydown', handleKeyDown);
    return () => { alive = false; sequence.current++; unsubscribe(); globalThis.removeEventListener('keydown', handleKeyDown); };
  }, []);

  const runAction = async (action: TextActionKind) => {
    if (!selection.trim() || busyAction) return;
    const request = ++sequence.current;
    setBusyAction(action); setError(capture.autoAction && !capture.canReplace && !PREVIEW_ACTIONS.has(action) ? capture.error || 'Não foi possível substituir nesta origem. Copie o resultado.' : ''); setResult(''); setResultAction(null);
    try {
      const text = await electronService.runSelectedTextAction({ action, text: selection, customInstruction, selectionId: capture.selectionId });
      if (request !== sequence.current) return;
      if (!text?.trim()) throw new Error('A IA não retornou texto. Tente novamente.');
      setResult(text); setResultAction(action);
      if (shouldAutoReplace(action, capture)) {
        setReplacing(true);
        await electronService.replaceSelectedText(text, capture.selectionId);
      }
    } catch (e) { if (request === sequence.current) setError((e as Error).message); }
    finally { if (request === sequence.current) { setBusyAction(null); setReplacing(false); } }
  };
  useEffect(() => {
    if (capture.autoAction && capture.selectionId && selection.trim() && !contextActions.current.has(capture.selectionId)) {
      contextActions.current.add(capture.selectionId);
      void runAction(capture.autoAction);
    }
  }, [capture.selectionId, capture.autoAction, selection]);
  const replace = async () => {
    setReplacing(true); setError('');
    try { await electronService.replaceSelectedText(result, capture.selectionId); }
    catch (e) { setError((e as Error).message); }
    finally { setReplacing(false); }
  };

  return <main className="text-actions-shell">
    <header className="text-actions-header">
      <div><WandSparkles size={15} /><strong>Ações de texto</strong><kbd>{shortcut.replace('Alt', '⌥').replace('Space', 'Espaço')}</kbd></div>
      <button type="button" onClick={() => { sequence.current++; electronService.closeTextActions(); }} aria-label="Fechar"><X size={15} /></button>
    </header>
    {loading && <p className="text-actions-hint" role="status"><LoaderCircle className="spin" size={13} />Lendo seleção…</p>}
    {error && <div className="text-actions-error" role="alert">{error}
      {/Acessibilidade|Automação/.test(error) && <button type="button" onClick={() => electronService.openTextAccessibility(/Automação/.test(error) ? 'automation' : 'accessibility')}>{/Automação/.test(error) ? 'Abrir Automação' : 'Abrir Acessibilidade'}</button>}
    </div>}
    <label className="text-actions-source"><span>Texto selecionado</span><textarea aria-label="Texto selecionado" value={selection} maxLength={30000} disabled={!!busyAction} placeholder="Selecione um trecho em outro app e use o atalho, ou cole seu texto aqui." onChange={event => { sequence.current++; setSelection(event.target.value); setResult(''); setResultAction(null); setError(''); }} /></label>
    <div className="text-actions-grid">
      {ACTIONS.map(({ action, label, icon }) => <button type="button" key={action} onClick={() => void runAction(action)} disabled={!selection.trim() || !!busyAction || replacing}>
        {busyAction === action ? <LoaderCircle className="spin" size={13} /> : icon}{label}
      </button>)}
    </div>
    <form className="text-actions-custom" onSubmit={event => { event.preventDefault(); void runAction('custom'); }}>
      <input aria-label="Instrução personalizada" value={customInstruction} onChange={event => setCustomInstruction(event.target.value)} placeholder="Ou descreva outra transformação…" />
      <button type="submit" disabled={!selection.trim() || !customInstruction.trim() || !!busyAction}>Gerar</button>
    </form>
    {(result || busyAction) && <section className="text-actions-result">
      <span>{replacing ? 'Aplicando na seleção original…' : 'Resultado'}</span>
      {busyAction ? <div className="text-actions-loading" role="status"><LoaderCircle className="spin" size={16} />Processando…</div> : <textarea aria-label="Resultado da transformação" value={result} onChange={event => setResult(event.target.value)} />}
    </section>}
    <footer className="text-actions-footer">
      <small>{selection ? 'Ao escolher uma transformação, aplica direto na seleção editável. Resumir e Explicar não substituem.' : 'Cole texto aqui se a captura não estiver disponível.'}</small>
      {result && <button type="button" onClick={async () => { await electronService.copySelectedTextResult(result); setCopied(true); }}><Clipboard size={13} />{copied ? 'Copiado' : 'Copiar'}</button>}
      {result && resultAction && !PREVIEW_ACTIONS.has(resultAction) && capture.canReplace && <button type="button" className="primary" disabled={replacing || !result.trim()} onClick={() => void replace()}>{replacing ? 'Substituindo…' : 'Substituir seleção'}</button>}
    </footer>
  </main>;
};
export default TextActions;
