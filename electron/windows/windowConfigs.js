const { screen, app } = require('electron');
const path = require('node:path');

/**
 * Window Configurations for the Metis Application.
 * This acts as the Single Source of Truth for window dimensions, properties, and paths.
 */

const isPackaged = app.isPackaged;
const baseUrl = isPackaged
  ? `file://${path.join(__dirname, '../../dist/index.html')}`
  : 'http://localhost:3000';

const preloadPath = path.join(__dirname, '../../preload.js');
const { getMacOverlayOptions } = require('./macPrivacy');
const macOverlayOptions = getMacOverlayOptions();

const windowConfigs = {
  command: {
    ...macOverlayOptions,
    width: 730,
    height: 480,
    frame: false,
    transparent: true,
    hasShadow: false,
    alwaysOnTop: true,
    show: false,
    resizable: true,
    movable: true,
    backgroundColor: '#00000000',
    url: `${baseUrl}?window=command`,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
    onInit: (win) => {
      if (process.platform === 'win32') win.setBackgroundMaterial('mica');
      const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;
      win.setPosition(Math.floor((screenWidth - 730) / 2), 40);
    }
  },
  chat: {
    ...macOverlayOptions,
    width: 480,
    height: 490,
    frame: false,
    transparent: true,
    hasShadow: false,
    alwaysOnTop: true,
    show: false,
    resizable: true,
    minWidth: 400,
    minHeight: 400,
    backgroundColor: '#00000000',
    url: `${baseUrl}?window=chat`,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
    onInit: (win) => {
      if (process.platform === 'win32') win.setBackgroundMaterial('mica');
      const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;
      win.setPosition(Math.floor((screenWidth - 480) / 2), 180);
    }
  },
  voice: {
    ...macOverlayOptions,
    width: 480,
    height: 420,
    frame: false,
    transparent: true,
    hasShadow: false,
    alwaysOnTop: true,
    show: false,
    resizable: false,
    backgroundColor: '#00000000',
    url: `${baseUrl}?window=voice`,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
    onInit: (win) => {
      if (process.platform === 'win32') win.setBackgroundMaterial('mica');
    }
  },
  susurroSetup: {
    ...macOverlayOptions,
    width: 440,
    height: 520,
    frame: false,
    transparent: true,
    hasShadow: false,
    alwaysOnTop: true,
    show: false,
    resizable: false,
    backgroundColor: '#00000000',
    url: `${baseUrl}?window=susurro-setup`,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
    onInit: (win) => {
      if (process.platform === 'win32') win.setBackgroundMaterial('mica');
    }
  },
  susurro: {
    ...macOverlayOptions,
    width: 940,
    height: 720,
    frame: false,
    transparent: true,
    hasShadow: false,
    alwaysOnTop: true,
    show: false,
    resizable: true,
    minWidth: 700,
    minHeight: 520,
    backgroundColor: '#00000000',
    url: `${baseUrl}?window=susurro`,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
    onInit: (win) => {
      if (process.platform === 'win32') win.setBackgroundMaterial('mica');
    }
  },
  suggestions: {
    ...macOverlayOptions,
    width: 600,
    height: 60,
    frame: false,
    transparent: true,
    hasShadow: false,
    alwaysOnTop: true,
    show: false,
    resizable: false,
    focusable: false,
    backgroundColor: '#00000000',
    url: `${baseUrl}?window=suggestions`,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
    onInit: (win) => {
      const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;
      win.setPosition(Math.floor((screenWidth - 600) / 2), 20);
    }
  },
  textActions: {
    ...macOverlayOptions,
    width: 520,
    height: 430,
    frame: false,
    transparent: true,
    hasShadow: false,
    alwaysOnTop: true,
    show: false,
    resizable: false,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    url: `${baseUrl}?window=text-actions`,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
    onInit: (win) => {
      if (process.platform === 'win32') win.setBackgroundMaterial('mica');
    }
  },
  notification: {
    ...macOverlayOptions,
    width: 400,
    height: 100,
    frame: false,
    transparent: true,
    hasShadow: false,
    alwaysOnTop: true,
    resizable: false,
    show: false,
    focusable: false,
    url: `file://${path.join(__dirname, '../../public/notification.html')}`,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    },
    onInit: (win) => {
      const { width: screenWidth } = screen.getPrimaryDisplay().workArea;
      win.setPosition(Math.floor(screenWidth / 2 - 200), 50);
    }
  },
  floatingHead: {
    ...macOverlayOptions,
    width: 36,
    height: 36,
    frame: false,
    transparent: true,
    hasShadow: false,
    alwaysOnTop: true,
    resizable: false,
    movable: true,
    skipTaskbar: true,
    show: false,
    backgroundColor: '#00000000',
    url: `${baseUrl}?window=floating-head`,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
    onInit: (win) => {
      const area = screen.getPrimaryDisplay().workArea;
      const size = 36;
      const margin = 18;
      win.setBounds({
        x: Math.max(area.x + 8, area.x + area.width - size - margin),
        y: Math.max(area.y + 8, area.y + area.height - size - margin),
        width: size,
        height: size
      });
      win.setAlwaysOnTop(true, 'pop-up-menu');
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }
  },
  splash: {
    ...macOverlayOptions,
    width: 720,
    height: 260,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    focusable: false,
    hasShadow: false,
    show: false,
    backgroundColor: '#00000000',
    url: `${baseUrl}?window=splash`,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
    onInit: (win) => {
      const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
      win.setPosition(
        Math.floor((sw - 720) / 2),
        Math.floor((sh - 260) / 2)
      );
      win.setAlwaysOnTop(true, 'floating');
      win.once('ready-to-show', () => {
        console.log('[WINDOW_CONFIGS] Splash window ready-to-show, showing now');
        win.show();
      });
    }
  },
  settings: {
    ...macOverlayOptions,
    width: 820,
    height: 600,
    frame: false,
    transparent: true,
    hasShadow: false,
    alwaysOnTop: false,
    show: false,
    resizable: false,
    backgroundColor: '#00000000',
    url: `${baseUrl}?window=settings`,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
    onInit: (win) => {
      if (process.platform === 'win32') win.setBackgroundMaterial('mica');
      const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
      win.setPosition(
        Math.floor((sw - 820) / 2),
        Math.floor((sh - 600) / 2)
      );
    }
  }
};

module.exports = windowConfigs;
