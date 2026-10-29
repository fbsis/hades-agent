const { Tray, Menu, app } = require('electron');
const path = require('node:path');
const windowManager = require('./windows/windowManager');
const appState = require('./appState');

/** @type {Tray|null} */
let trayInstance = null;

/**
 * Creates the system tray icon and its associated context menu.
 * @returns {Tray|null}
 */
function createTray() {
  if (process.platform === 'darwin') return null;
  const iconPath = path.join(__dirname, '../public/icon/metis-icon.ico');
  trayInstance = new Tray(iconPath);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Abrir Metis (Alt+D)',
      click: () => {
        windowManager.showCommandPanel('command');
      }
    },
    {
      label: 'Abrir Chat',
      click: () => windowManager.showCommandPanel('chat')
    },
    {
      label: 'Abrir Transcrição (Alt+B)',
      click: () => windowManager.showCommandPanel('transcription')
    },
    {
      label: 'Configurações',
      click: () => windowManager.showCommandPanel('settings')
    },
    { type: 'separator' },
    {
      label: 'Sair',
      click: () => {
        appState.isQuitting = true;
        app.quit();
      }
    }
  ]);

  trayInstance.setToolTip('Metis');
  trayInstance.setContextMenu(contextMenu);

  return trayInstance;
}

module.exports = createTray;
