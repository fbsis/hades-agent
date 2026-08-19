const { ipcMain, BrowserWindow } = require('electron');
const selectedTextService = require('../services/selectedTextService');
const textActionService = require('../services/textActionService');
const windowManager = require('../windows/windowManager');
const logger = require('../services/logger');

function registerTextActionHandlers() {
  ipcMain.handle('text-actions-get-selection', () => ({
    success: true,
    data: selectedTextService.getSelection()
  }));

  ipcMain.handle('text-actions-run', async (_event, args = {}) => {
    try {
      const text = await textActionService.runTextAction(args);
      return { success: true, data: text };
    } catch (error) {
      logger.error('TEXT_ACTIONS', 'action failed', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('text-actions-copy', (_event, text) => {
    selectedTextService.copy(text);
    return { success: true };
  });

  ipcMain.handle('text-actions-replace', async (_event, text) => {
    const win = windowManager.get('textActions');
    try {
      if (win && !win.isDestroyed()) win.hide();
      await selectedTextService.replace(text);
      return { success: true };
    } catch (error) {
      if (win && !win.isDestroyed()) {
        win.show();
        win.focus();
      }
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('text-actions-close', event => {
    BrowserWindow.fromWebContents(event.sender)?.hide();
    return { success: true };
  });
}

module.exports = registerTextActionHandlers;
