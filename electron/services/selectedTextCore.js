// Selection contents stay in memory. Never log or persist text/clipboard snapshots.
const { SNAPSHOT_SCRIPT, KEY_SCRIPT } = require('./selectedTextScripts');
function createSelectedTextService({ clipboard, execute, trusted = () => true, platform = process.platform, wait = ms => new Promise(resolve => setTimeout(resolve, ms)), id = () => require('node:crypto').randomUUID(), diagnose = () => {} }) {
  let target = null;
  let state = { selectionId: id(), text: '', canReplace: false };
  const publicState = () => ({ ...state });
  const reset = () => { target = null; state = { selectionId: id(), text: '', canReplace: false }; };
  const friendly = error => {
    const detail = String(error?.stderr || error?.message || error);
    if (/1743|not authorized to send Apple events/i.test(detail)) return 'Permita o Metis Dev/Electron em Privacidade e Segurança → Automação → System Events. A permissão de Acessibilidade também é necessária.';
    if (/not authorized|assistive|1002|AX_NOT_TRUSTED/i.test(detail)) return 'Permita o Metis Dev/Electron em Ajustes do Sistema → Privacidade e Segurança → Acessibilidade. O app instalado e o dev têm permissões separadas.';
    if (/RELEASE_SHORTCUT/.test(detail)) return 'Solte as teclas do atalho e tente novamente.';
    if (/TARGET_CHANGED/.test(detail)) return 'A seleção ou janela original mudou. Selecione o texto e abra as ações novamente; ou copie o resultado.';
    return error?.stderr || error?.killed ? 'Não foi possível acessar o aplicativo original. Confira as permissões de Acessibilidade e tente novamente.' : error?.message || 'Não foi possível ler o texto selecionado.';
  };
  function report(stage, error) {
    const detail = String(error?.stderr || error?.message || error);
    const reason = /TARGET_CHANGED:([a-z]+)/.exec(detail)?.[1];
    // Whitelist only: never record the error body, title, field, clipboard or text.
    diagnose({ stage, reason: ['process', 'window', 'field', 'role', 'range', 'text', 'editable', 'activation', 'editor', 'expired'].includes(reason) ? reason : /Nenhum texto/.test(detail) ? 'empty' : 'unavailable' });
  }
  async function snapshot(expectedPid) { return JSON.parse(await execute(SNAPSHOT_SCRIPT, expectedPid ? [String(expectedPid)] : [])); }
  function difference(current, source) {
    if (current.pid !== source.pid || current.bundleId !== source.bundleId) return 'process';
    if (current.window && source.window) {
      const a = current.window, b = source.window;
      if (!b.title && !(b.identifier && b.frame)) return 'window';
      if ((b.frame && a.frame !== b.frame) || (b.identifier && a.identifier && b.frame ? a.identifier !== b.identifier : a.title !== b.title || (b.identifier && a.identifier !== b.identifier))) return 'window';
    } else if (current.windowTitle !== source.windowTitle) return 'window';
    if (source.field && current.field !== source.field) return 'field';
    if (source.role && current.role !== source.role) return 'role';
    if (source.range && current.range !== source.range) return 'range';
    if (!current.editable) return 'editable';
    return '';
  }
  function clipboardSnapshot() {
    const image = clipboard.readImage();
    return { text: clipboard.readText(), html: clipboard.readHTML(), rtf: clipboard.readRTF(), ...(!image.isEmpty() ? { image } : {}) };
  }
  async function copySelection(meta) {
    const previous = clipboardSnapshot();
    const marker = `__METIS_SELECTION_${id()}__`;
    let captured = marker;
    clipboard.writeText(marker);
    try {
      await execute(KEY_SCRIPT, [String(meta.pid), 'copy', JSON.stringify(meta)]);
      for (let attempt = 0; attempt < 20 && captured === marker; attempt++) { await wait(40); captured = clipboard.readText(); }
      if (captured === marker) throw new Error('Nenhum texto foi copiado. Selecione o texto, ou cole-o no painel.');
      return String(captured || '');
    } finally {
      const current = clipboard.readText();
      if (current === marker || current === captured) clipboard.write(previous);
    }
  }
  return {
    getSelection: publicState,
    adopt(text, error) { target = null; state = { selectionId: id(), text: String(text || '').slice(0, 30000), canReplace: false, error: error || '' }; },
    presentResult(text, result, error, restore) { target = restore ? { editorRestore: restore } : null; state = { selectionId: id(), text: String(text || '').slice(0, 30000), result, canReplace: false, error: error || '' }; },
    setAction(action) { if (!['translate', 'proofread', 'rewrite', 'summarize', 'explain'].includes(action)) throw new Error('Ação inválida'); state = { ...state, autoAction: action }; },
    clear: reset,
    restoreSource: () => target?.editorRestore?.(),
    isCurrent: selectionId => selectionId === state.selectionId,
    async captureEditor(read) {
      reset(); const selectionId = state.selectionId;
      try {
        const editor = await read();
        if (state.selectionId !== selectionId) throw new Error('TARGET_CHANGED:expired');
        if (!editor.text?.trim()) throw new Error(editor.error || 'Nenhum texto selecionado no editor. Selecione um trecho antes de usar o atalho.');
        const truncated = editor.text.length > 30000;
        state = { ...state, text: editor.text.slice(0, 30000), canReplace: !truncated && typeof editor.replace === 'function', ...(truncated ? { error: 'Seleção acima de 30.000 caracteres: prévia limitada, disponível somente para copiar.' } : {}) };
        target = { editorReplace: editor.replace, editorRestore: editor.restore };
        return publicState();
      } catch (error) {
        report('capture-editor', error);
        if (state.selectionId === selectionId) state = { ...state, error: friendly(error), canReplace: false };
        throw new Error(friendly(error));
      }
    },
    async capture(expectedPid) {
      reset(); const selectionId = state.selectionId;
      try {
        if (platform !== 'darwin') throw new Error('Captura de seleção disponível inicialmente no macOS. Cole o texto no painel.');
        if (!trusted()) throw new Error('AX_NOT_TRUSTED');
        const meta = await snapshot(expectedPid);
        if (expectedPid && meta.pid !== expectedPid) throw new Error('TARGET_CHANGED:process');
        if (!meta.pid || !meta.bundleId) throw new Error('Não foi possível identificar o aplicativo de origem.');
        const text = meta.text?.trim() ? meta.text : await copySelection(meta);
        if (state.selectionId !== selectionId) throw new Error('TARGET_CHANGED:expired');
        if (!text.trim()) throw new Error('Nenhum texto selecionado. Selecione um trecho ou cole-o no painel.');
        const truncated = text.length > 30000;
        const knownWindow = !meta.window || Boolean(meta.window.title || (meta.window.identifier && meta.window.frame));
        const editable = knownWindow && meta.editable === true && !/terminal|iterm|warp|ghostty|alacritty|kitty/i.test(meta.bundleId);
        state = { ...state, text: text.slice(0, 30000), canReplace: !truncated && editable, ...(truncated ? { error: 'Seleção acima de 30.000 caracteres: prévia limitada, disponível somente para copiar.' } : !knownWindow ? { error: 'Não foi possível identificar a janela original. O resultado estará disponível para copiar.' } : {}) };
        target = { ...meta, text };
        return publicState();
      } catch (error) {
        report('capture', error);
        if (state.selectionId === selectionId) state = { ...state, error: friendly(error), canReplace: false };
        throw new Error(friendly(error));
      }
    },
    copy(text) { clipboard.writeText(String(text || '')); },
    async replace(text, selectionId) {
      if (selectionId !== state.selectionId || !state.canReplace || !target) throw new Error('Seleção expirada ou indisponível. Selecione novamente, ou copie o resultado.');
      if (!String(text || '').trim()) throw new Error('Não existe resultado para substituir.');
      const source = target;
      try {
        if (source.editorReplace) {
          if (!await source.editorReplace(String(text))) throw new Error('TARGET_CHANGED:editor');
        } else {
          await execute(KEY_SCRIPT, [String(source.pid), 'activate', JSON.stringify(source)]);
          // AX focus can settle later than window activation. Retry observation,
          // never restore a stale text range or guess a different input field.
          let reason = 'activation', verified = null;
          for (let attempt = 0; attempt < 8; attempt++) {
            if (state.selectionId !== selectionId) throw new Error('TARGET_CHANGED:expired');
            try {
              const current = await snapshot(source.pid);
              reason = difference(current, source);
              if (!reason) {
                const currentText = current.text?.trim() ? current.text : await copySelection(current);
                reason = currentText === source.text ? '' : 'text';
                if (!reason) { verified = current; break; }
              }
            } catch (error) {
              if (!/TARGET_CHANGED/.test(String(error?.stderr || error?.message))) throw error;
              reason = 'activation';
            }
            if (attempt < 7) await wait(80);
          }
          if (reason) throw new Error('TARGET_CHANGED:' + reason);
          if (state.selectionId !== selectionId) throw new Error('TARGET_CHANGED:expired');
          const previous = clipboardSnapshot();
          clipboard.writeText(String(text));
          try {
            // The script rechecks source window/field/range/text immediately
            // before Cmd+V; it never activates an arbitrary application window.
            await execute(KEY_SCRIPT, [String(source.pid), 'paste', JSON.stringify({ ...source, window: verified.window, windowTitle: verified.windowTitle })]);
            await wait(350);
          } finally { if (clipboard.readText() === String(text)) clipboard.write(previous); }
        }
        if (state.selectionId === selectionId) state = { ...state, canReplace: false };
      } catch (error) { report('replace', error); throw new Error(friendly(error)); }
    }
  };
}
module.exports = { createSelectedTextService, SNAPSHOT_SCRIPT, KEY_SCRIPT };
