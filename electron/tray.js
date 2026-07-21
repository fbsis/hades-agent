const { Tray, Menu, app } = require('electron');
const path = require('node:path');
const windowManager = require('./windows/windowManager');
const appState = require('./appState');

/** @type {Tray|null} */
let trayInstance = null;

/**
 * Creates the system tray icon and its associated context menu.
 * @returns {Tray}
 */
function createTray() {
  const iconPath = process.platform === 'darwin'
    ? path.join(__dirname, '../public/icon/hades-tray-icon-128.png')
    : path.join(__dirname, '../public/icon/hades-tray-icon.ico');
  trayInstance = new Tray(iconPath);

  if (process.platform === 'darwin') {
    app.dock.hide();
  }

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Abrir Hades (Alt+D)',
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

  trayInstance.setToolTip('Hades Agent');
  trayInstance.setContextMenu(contextMenu);

  return trayInstance;
}

module.exports = createTray;
