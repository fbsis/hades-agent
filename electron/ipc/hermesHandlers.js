const { ipcMain } = require('electron');
const hermesService = require('../services/hermesService');
const logger = require('../services/logger');

function wrap(handler) {
  return async (event, ...args) => {
    try {
      const data = await handler(event, ...args);
      return { success: true, data };
    } catch (error) {
      logger.error('HERMES_IPC', 'handler error', error);
      return { success: false, error: error.message };
    }
  };
}

function registerHermesHandlers() {
  ipcMain.handle('hermes-dashboard', wrap(() => {
    return hermesService.getDashboard();
  }));

  ipcMain.handle('hermes-test-connection', wrap(() => {
    return hermesService.testConnection();
  }));

  ipcMain.handle('hermes-ask', wrap((event, args) => {
    return hermesService.ask(args || {});
  }));

  ipcMain.handle('hermes-remember', wrap((event, args) => {
    return hermesService.remember(args || {});
  }));

  ipcMain.handle('hermes-ingest-document', wrap((event, document) => {
    return hermesService.ingestDocument(document || {});
  }));

  ipcMain.handle('hermes-sync-context', wrap(() => {
    return hermesService.syncLocalContext();
  }));
}

module.exports = registerHermesHandlers;
