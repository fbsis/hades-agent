const { ipcMain, shell } = require('electron');
const selectedTextService = require('../services/selectedTextService');
const textActionService = require('../services/textActionService');
const windowManager = require('../windows/windowManager');
const store = require('../store/jsonStore');

function registerTextActionHandlers() {
  function trusted(event) {
    const win = windowManager.get('textActions');
    if (!win || event.sender !== win.webContents || event.senderFrame !== event.sender.mainFrame) throw new Error('Janela de ações de texto necessária.');
    return win;
  }
  function trustedSetup(event) {
    const owner = ['command', 'settings'].map(name => windowManager.get(name)).find(win => win && win.webContents === event.sender);
    if (!owner || event.senderFrame !== event.sender.mainFrame) throw new Error('Configuração disponível somente na janela principal.');
    return owner;
  }
  for (const [channel, operation] of [['text-actions-setup-status', 'status'], ['text-actions-setup-configure', 'configure'], ['text-actions-setup-remove', 'remove']]) {
    ipcMain.handle(channel, async event => {
      const owner = trustedSetup(event);
      try { return { success: true, data: await require('../services/textServices')[operation](owner) }; }
      catch (error) { return { success: false, error: error.message }; }
    });
  }
  ipcMain.handle('text-actions-get-selection', event => {
    trusted(event);
    return { success: true, data: { ...selectedTextService.getSelection(), shortcut: store.getSettings().shortcuts?.selectedTextActions || 'Alt+Space' } };
  });
  ipcMain.handle('text-actions-run', async (event, args = {}) => {
    trusted(event);
    try {
      if (!selectedTextService.isCurrent(args.selectionId)) throw new Error('A seleção mudou. Execute a ação novamente.');
      const text = await textActionService.runTextAction(args);
      if (!selectedTextService.isCurrent(args.selectionId)) throw new Error('A seleção mudou durante o processamento.');
      return { success: true, data: text };
    } catch (error) { return { success: false, error: error.message }; }
  });
  ipcMain.handle('text-actions-copy', (event, text) => {
    trusted(event); selectedTextService.copy(text);
    return { success: true };
  });
  ipcMain.handle('text-actions-replace', async (event, text, selectionId) => {
    const win = trusted(event);
    try {
      win.hide();
      await selectedTextService.replace(text, selectionId);
      selectedTextService.clear();
      return { success: true };
    } catch (error) {
      if (!win.isDestroyed()) { win.show(); win.focus(); }
      return { success: false, error: error.message };
    }
  });
  ipcMain.handle('text-actions-accessibility', (event, section) => {
    if (windowManager.get('textActions')?.webContents === event.sender) trusted(event); else trustedSetup(event);
    return shell.openExternal(section === 'services' ? 'x-apple.systempreferences:com.apple.preference.keyboard?Services' : section === 'automation' ? 'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation' : 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
  });
  ipcMain.handle('text-actions-close', event => {
    trusted(event).hide(); selectedTextService.clear(); return { success: true };
  });
}
module.exports = registerTextActionHandlers;
