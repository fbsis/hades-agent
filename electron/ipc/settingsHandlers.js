const { ipcMain, BrowserWindow, dialog, globalShortcut } = require('electron');
const jsonStore = require('../store/jsonStore');
const logger = require('../services/logger');
const registerGlobalShortcuts = require('../shortcuts');
const { protectWindow } = require('../windows/contentProtection');
const windowManager = require('../windows/windowManager');
const { normalizeWindowOpacity } = require('../windows/windowOpacity');
const { normalizeConfig: normalizeMcpConfig, validateServer: validateMcpServer } = require('../services/mcpClientService');

function mcpExecutionChanged(current, next) {
  if (!current) return true;
  return current.enabled !== true
    || current.command !== next.command
    || current.cwd !== next.cwd
    || JSON.stringify(current.args || []) !== JSON.stringify(next.args || [])
    || JSON.stringify(current.env || {}) !== JSON.stringify(next.env || {});
}

async function confirmNewMcpExecutables(event, currentMcp, nextMcp) {
  if (!nextMcp.enabled) return true;
  const commands = nextMcp.servers.filter(server => {
    if (!server.enabled || server.transport !== 'stdio') return false;
    const current = currentMcp.servers.find(item => item.id === server.id);
    return !currentMcp.enabled || mcpExecutionChanged(current, server);
  });
  if (commands.length === 0) return true;

  const detail = commands
    .map(server => `${server.name}: ${server.command} ${(server.args || []).join(' ')}`.trim())
    .join('\n')
    .slice(0, 3000);
  const owner = BrowserWindow.fromWebContents(event.sender);
  const options = {
    type: 'warning',
    title: 'Autorizar servidores MCP',
    message: 'Estes servidores executarão programas com as permissões do seu usuário.',
    detail,
    buttons: ['Cancelar', 'Autorizar e salvar'],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  };
  const result = owner
    ? await dialog.showMessageBox(owner, options)
    : await dialog.showMessageBox(options);
  return result.response === 1;
}

function broadcastSettings(settings) {
  BrowserWindow.getAllWindows().forEach(win => {
    if (!win.isDestroyed()) {
      win.webContents.send('settings-updated', settings);
    }
  });
}

/**
 * Applies mandatory content protection to all active windows.
 */
function applyStealthMode() {
  const allWindows = BrowserWindow.getAllWindows();
  console.log(`[SETTINGS_STEALTH] Applying mandatory capture protection to ${allWindows.length} windows.`);
  
  allWindows.forEach(win => {
    if (!win.isDestroyed()) {
      const url = win.webContents.getURL();
      const match = /\?window=([^&]+)/.exec(url);
      const name = match ? match[1] : win.getTitle() || 'unknown';
      
      const protectedSuccessfully = protectWindow(win);
      console.log(`[SETTINGS_STEALTH] Window: ${name} (alwaysOnTop: ${win.isAlwaysOnTop()}, visible: ${win.isVisible()}) -> protected: ${protectedSuccessfully}`);
    }
  });

  logger.info('SETTINGS', 'Mandatory capture protection applied to all windows.');
}

/**
 * Registers IPC handlers for application settings (get, save, stealth mode).
 */
function registerSettingsHandlers() {
  // Returns all persisted settings
  ipcMain.handle('get-settings', () => {
    return jsonStore.getSettings();
  });

  // Persists all settings and applies side-effects immediately
  ipcMain.handle('save-settings', async (event, settings) => {
    try {
      const currentMcp = normalizeMcpConfig(jsonStore.getSettings()?.mcp || {});
      const nextMcp = normalizeMcpConfig(settings?.mcp || {});
      nextMcp.servers
        .filter(server => nextMcp.enabled && server.enabled)
        .forEach(validateMcpServer);
      if (!await confirmNewMcpExecutables(event, currentMcp, nextMcp)) {
        return { success: false, error: 'Configuração MCP não autorizada.' };
      }

      jsonStore.saveSettings({ ...settings, mcp: nextMcp });
      const savedSettings = jsonStore.getSettings();

      applyStealthMode();
      windowManager.applyAppWindowOpacity(savedSettings.general.windowOpacity);
      
      // Update global shortcuts dynamically on save
      registerGlobalShortcuts();

      await require('../services/mcpClientService').shutdown();

      // Notify all active windows that settings have been updated
      broadcastSettings(savedSettings);
      
      return { success: true };
    } catch (err) {
      logger.error('SETTINGS', 'save-settings error', err);
      return { success: false, error: err.message };
    }
  });

  // Persists and previews opacity without waiting for the remaining settings form.
  ipcMain.handle('set-window-opacity', (event, opacity) => {
    try {
      const windowOpacity = normalizeWindowOpacity(opacity);
      const settings = jsonStore.getSettings();
      jsonStore.saveSettings({
        ...settings,
        general: {
          ...settings.general,
          windowOpacity
        }
      });

      const savedSettings = jsonStore.getSettings();
      windowManager.applyAppWindowOpacity(windowOpacity);
      broadcastSettings(savedSettings);
      return { success: true, data: windowOpacity };
    } catch (err) {
      logger.error('SETTINGS', 'set-window-opacity error', err);
      return { success: false, error: err.message };
    }
  });

  // Applies a temporary opacity only to the calling window without changing the saved preference.
  ipcMain.handle('set-current-window-opacity', (event, opacity) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win || win.isDestroyed()) return { success: false, error: 'Window not found' };
      const windowOpacity = normalizeWindowOpacity(opacity);
      windowManager.applyWindowOpacity(win, windowOpacity, 'current-window');
      return { success: true, data: windowOpacity };
    } catch (err) {
      logger.error('SETTINGS', 'set-current-window-opacity error', err);
      return { success: false, error: err.message };
    }
  });

  // Backward-compatible IPC: callers can request protection, but cannot disable it.
  ipcMain.handle('apply-stealth-mode', () => {
    try {
      applyStealthMode();
      return { success: true };
    } catch (err) {
      logger.error('SETTINGS', 'apply-stealth-mode error', err);
      return { success: false, error: err.message };
    }
  });

  // Returns history data for the History tab — reads from sessions store (properly grouped)
  ipcMain.handle('get-history-data', () => {
    try {
      const sessions = jsonStore.getSessions();
      const minichat = sessions.filter(s => s.type !== 'susurro');
      const transcriptions = sessions.filter(s => s.type === 'susurro');
      return { success: true, data: { susurroHistory: transcriptions, chatHistory: minichat } };
    } catch (err) {
      logger.error('SETTINGS', 'get-history-data error', err);
      return { success: false, error: err.message };
    }
  });

  // Temporarily unregisters all global shortcuts to allow recording new keys without triggering actions
  ipcMain.handle('disable-shortcuts', () => {
    try {
      globalShortcut.unregisterAll();
      logger.info('SHORTCUTS', 'All global shortcuts temporarily unregistered (Keybind recording started).');
      return { success: true };
    } catch (err) {
      logger.error('SHORTCUTS', 'Failed to disable global shortcuts', err);
      return { success: false, error: err.message };
    }
  });

  // Re-registers all global shortcuts when recording is stopped or completed
  ipcMain.handle('enable-shortcuts', () => {
    try {
      registerGlobalShortcuts();
      logger.info('SHORTCUTS', 'All global shortcuts re-registered (Keybind recording stopped).');
      return { success: true };
    } catch (err) {
      logger.error('SHORTCUTS', 'Failed to enable global shortcuts', err);
      return { success: false, error: err.message };
    }
  });
}

module.exports = { registerSettingsHandlers, applyStealthMode };
