// Selection contents stay in memory. Never log or persist text/clipboard snapshots.
const SNAPSHOT_SCRIPT = `
function run(argv) {
  var se = Application('System Events');
  var app = se.applicationProcesses.whose({frontmost:true})[0];
  if (argv && argv[0] && Number(app.unixId()) !== Number(argv[0])) throw new Error('TARGET_CHANGED');
  var text = '', field = '', role = '', windowTitle = '', editable = false;
  try { windowTitle = app.windows[0].name(); } catch (_) {}
  try {
    var focused = app.attributes.byName('AXFocusedUIElement').value();
    try { text = focused.attributes.byName('AXSelectedText').value() || ''; } catch (_) {}
    try { field = focused.attributes.byName('AXIdentifier').value() || ''; } catch (_) {}
    try { role = focused.attributes.byName('AXRole').value() || ''; } catch (_) {}
    try { editable = focused.attributes.byName('AXSelectedText').settable(); } catch (_) {}
    if (!editable) try { editable = focused.attributes.byName('AXValue').settable(); } catch (_) {}
  } catch (_) {}
  return JSON.stringify({pid:app.unixId(),bundleId:app.bundleIdentifier(),windowTitle:windowTitle,text:String(text),field:String(field),role:String(role),editable:Boolean(editable)});
}`;
const KEY_SCRIPT = `
ObjC.import('AppKit');
function run(argv) {
  var se = Application('System Events'), pid = Number(argv[0]), action = argv[1];
  var target = se.applicationProcesses.whose({unixId:pid})[0];
  target.frontmost = true;
  delay(0.15);
  if (Number(se.applicationProcesses.whose({frontmost:true})[0].unixId()) !== pid) throw new Error('TARGET_CHANGED');
  if (action === 'activate') return 'ok';
  var attempts = 0;
  while ((Number($.NSEvent.modifierFlags) & 1966080) !== 0 && attempts++ < 40) delay(0.025);
  if ((Number($.NSEvent.modifierFlags) & 1966080) !== 0) throw new Error('RELEASE_SHORTCUT');
  if (argv[2]) {
    var title = ''; try { title = target.windows[0].name(); } catch (_) {}
    if (title !== argv[2]) throw new Error('TARGET_CHANGED');
  }
  se.keystroke(action === 'copy' ? 'c' : 'v', {using:['command down']});
  return 'ok';
}`;

function createSelectedTextService({ clipboard, execute, trusted = () => true, platform = process.platform, wait = ms => new Promise(resolve => setTimeout(resolve, ms)), id = () => require('node:crypto').randomUUID() }) {
  let target = null;
  let state = { selectionId: id(), text: '', canReplace: false };
  const publicState = () => ({ ...state });
  const friendly = error => {
    const detail = String(error?.stderr || error?.message || error);
    if (/1743|not authorized to send Apple events/i.test(detail)) return 'Permita o Metis Dev/Electron em Privacidade e Segurança → Automação → System Events. A permissão de Acessibilidade também é necessária.';
    if (/not authorized|assistive|1002|AX_NOT_TRUSTED/i.test(detail)) return 'Permita o Metis Dev/Electron em Ajustes do Sistema → Privacidade e Segurança → Acessibilidade. O app instalado e o dev têm permissões separadas.';
    if (/RELEASE_SHORTCUT/.test(detail)) return 'Solte as teclas do atalho e tente novamente.';
    if (/TARGET_CHANGED/.test(detail)) return 'A seleção ou janela original mudou. Selecione o texto e abra as ações novamente; ou copie o resultado.';
    return error?.stderr || error?.killed ? 'Não foi possível acessar o aplicativo original. Confira as permissões de Acessibilidade e tente novamente.' : error?.message || 'Não foi possível ler o texto selecionado.';
  };
  async function snapshot(expectedPid) { return JSON.parse(await execute(SNAPSHOT_SCRIPT, expectedPid ? [String(expectedPid)] : [])); }
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
      await execute(KEY_SCRIPT, [String(meta.pid), 'copy', meta.windowTitle || '']);
      for (let attempt = 0; attempt < 20 && captured === marker; attempt++) {
        await wait(40);
        captured = clipboard.readText();
      }
      if (captured === marker) throw new Error('Nenhum texto foi copiado. Selecione o texto, ou cole-o no painel.');
      return String(captured || '');
    } finally {
      // Do not overwrite a newer clipboard change made by the user/another app.
      const current = clipboard.readText();
      if (current === marker || current === captured) clipboard.write(previous);
    }
  }
  return {
    getSelection: publicState,
    adopt(text, error) { target = null; state = { selectionId: id(), text: String(text || '').slice(0, 30000), canReplace: false, error: error || '' }; },
    setAction(action) { if (!['translate', 'proofread', 'rewrite', 'summarize', 'explain'].includes(action)) throw new Error('Ação inválida'); state = { ...state, autoAction: action }; },
    clear() { target = null; state = { selectionId: id(), text: '', canReplace: false }; },
    isCurrent: selectionId => selectionId === state.selectionId,
    async capture(expectedPid) {
      target = null;
      state = { selectionId: id(), text: '', canReplace: false };
      try {
        if (platform !== 'darwin') throw new Error('Captura de seleção disponível inicialmente no macOS. Cole o texto no painel.');
        if (!trusted()) throw new Error('AX_NOT_TRUSTED');
        const meta = await snapshot(expectedPid);
        if (expectedPid && meta.pid !== expectedPid) throw new Error('TARGET_CHANGED');
        if (!meta.pid || !meta.bundleId) throw new Error('Não foi possível identificar o aplicativo de origem.');
        // Prefer Accessibility: it does not touch the clipboard or depend on released modifier keys.
        const text = meta.text?.trim() ? meta.text : await copySelection(meta);
        if (!text.trim()) throw new Error('Nenhum texto selecionado. Selecione um trecho ou cole-o no painel.');
        const truncated = text.length > 30000;
        const editable = meta.editable === true && !/terminal|iterm|warp|ghostty|alacritty|kitty/i.test(meta.bundleId);
        state = { ...state, text: text.slice(0, 30000), canReplace: !truncated && editable, ...(truncated ? { error: 'Seleção acima de 30.000 caracteres: prévia limitada, disponível somente para copiar.' } : {}) };
        target = { ...meta, text };
        return publicState();
      } catch (error) {
        state = { ...state, error: friendly(error), canReplace: false };
        throw new Error(state.error);
      }
    },
    copy(text) { clipboard.writeText(String(text || '')); },
    async replace(text, selectionId) {
      if (selectionId !== state.selectionId || !state.canReplace || !target) throw new Error('Seleção expirada ou indisponível. Selecione novamente, ou copie o resultado.');
      if (!String(text || '').trim()) throw new Error('Não existe resultado para substituir.');
      try {
        await execute(KEY_SCRIPT, [String(target.pid), 'activate']);
        const current = await snapshot(target.pid);
        if (!current.editable || current.pid !== target.pid || current.bundleId !== target.bundleId || current.windowTitle !== target.windowTitle || (target.field && current.field !== target.field)) throw new Error('TARGET_CHANGED');
        const currentText = current.text?.trim() ? current.text : await copySelection(current);
        if (currentText !== target.text) throw new Error('TARGET_CHANGED');
        if (selectionId !== state.selectionId) throw new Error('TARGET_CHANGED');
        const previous = clipboardSnapshot();
        clipboard.writeText(String(text));
        try {
          await execute(KEY_SCRIPT, [String(target.pid), 'paste', target.windowTitle || '']);
          await wait(350);
          state = { ...state, canReplace: false };
        } finally {
          if (clipboard.readText() === String(text)) clipboard.write(previous);
        }
      } catch (error) { throw new Error(friendly(error)); }
    }
  };
}
module.exports = { createSelectedTextService, SNAPSHOT_SCRIPT, KEY_SCRIPT };
