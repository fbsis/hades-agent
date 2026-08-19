const { clipboard } = require('electron');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const COPY_SCRIPT = [
  'tell application "System Events"',
  'set activeProcess to first application process whose frontmost is true',
  'set activeBundle to bundle identifier of activeProcess',
  'keystroke "c" using command down',
  'return activeBundle',
  'end tell'
].join('\n');
const PASTE_SCRIPT = [
  'on run argv',
  'set targetBundle to item 1 of argv',
  'tell application "System Events"',
  'set frontmost of first application process whose bundle identifier is targetBundle to true',
  'delay 0.18',
  'keystroke "v" using command down',
  'end tell',
  'end run'
].join('\n');

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function readClipboardSnapshot() {
  const image = clipboard.readImage();
  return {
    text: clipboard.readText(),
    html: clipboard.readHTML(),
    rtf: clipboard.readRTF(),
    ...(!image.isEmpty() ? { image } : {})
  };
}

function restoreClipboard(snapshot) {
  clipboard.write(snapshot);
}

class SelectedTextService {
  constructor() {
    this.selection = null;
  }

  async capture() {
    this.selection = null;
    if (process.platform !== 'darwin') {
      throw new Error('As ações de texto selecionado estão disponíveis inicialmente no macOS.');
    }

    const previousClipboard = readClipboardSnapshot();
    const marker = `__METIS_SELECTION_${Date.now()}__`;
    clipboard.writeText(marker);

    try {
      const { stdout } = await execFileAsync('osascript', ['-e', COPY_SCRIPT], { timeout: 3000 });
      let selectedText = marker;
      for (let attempt = 0; attempt < 8 && selectedText === marker; attempt += 1) {
        await wait(45);
        selectedText = clipboard.readText();
      }

      selectedText = String(selectedText || '').trim();
      if (!selectedText || selectedText === marker) {
        throw new Error('Nenhum texto selecionado. Selecione um texto e pressione Alt+E novamente.');
      }

      this.selection = {
        text: selectedText.slice(0, 30000),
        bundleId: String(stdout || '').trim(),
        capturedAt: Date.now()
      };
      return { text: this.selection.text };
    } catch (error) {
      if (/not authorized|assistive|1002|1743/i.test(String(error?.message || ''))) {
        throw new Error('Permita o Metis em Ajustes do Sistema → Privacidade e Segurança → Acessibilidade.');
      }
      throw error;
    } finally {
      restoreClipboard(previousClipboard);
    }
  }

  getSelection() {
    return this.selection ? { text: this.selection.text } : null;
  }

  copy(text) {
    clipboard.writeText(String(text || ''));
  }

  async replace(text) {
    const replacement = String(text || '').trim();
    if (!replacement) throw new Error('Não existe resultado para substituir.');
    if (!this.selection?.bundleId) throw new Error('O aplicativo original não está mais disponível.');

    const previousClipboard = readClipboardSnapshot();
    clipboard.writeText(replacement);
    try {
      await execFileAsync('osascript', ['-e', PASTE_SCRIPT, this.selection.bundleId], { timeout: 4000 });
      await wait(350);
    } catch (error) {
      if (/not authorized|assistive|1002|1743/i.test(String(error?.message || ''))) {
        throw new Error('Permita o Metis em Ajustes do Sistema → Privacidade e Segurança → Acessibilidade.');
      }
      throw new Error('Não foi possível substituir o texto no aplicativo original.');
    } finally {
      restoreClipboard(previousClipboard);
    }
  }
}

module.exports = new SelectedTextService();
