const { BrowserWindow, shell, app, Menu, screen } = require('electron');
const configs = require('./windowConfigs');
const { protectWindow } = require('./contentProtection');
const { configureMacWindowPrivacy } = require('./macPrivacy');
const log = require('electron-log');

const FLOATING_HEAD_SIZE = 36;

/**
 * WindowManager handles the lifecycle and management of all application windows.
 * It provides a centralized way to create, retrieve, and configure windows.
 */
class WindowManager {
  constructor() {
    /** @type {Object<string, BrowserWindow>} */
    this.windows = {};
    this.layoutSaveTimers = {};
  }

  /**
   * Retrieves an existing window instance by name.
   * @param {string} name 
   * @returns {BrowserWindow|null}
   */
  get(name) {
    return this.windows[name];
  }

  /**
   * Hides all visible windows.
   */
  hideAllWindows() {
    log.info('[WINDOW_MANAGER] Hiding all windows');
    Object.values(this.windows).forEach(win => {
      if (win && !win.isDestroyed() && win.isVisible()) {
        win.hide();
      }
    });
  }

  /**
   * Hides application surfaces but leaves the floating head alone.
   */
  hideAppWindows() {
    log.info('[WINDOW_MANAGER] Hiding app windows');
    Object.entries(this.windows).forEach(([name, win]) => {
      if (name !== 'floatingHead' && win && !win.isDestroyed() && win.isVisible()) {
        win.hide();
      }
    });
  }

  /**
   * Hides all modes/windows except the specified one(s).
   * @param {string[]} excludeNames - Windows that should remain untouched.
   */
  hideAllExcept(excludeNames = []) {
    log.info(`[WINDOW_MANAGER] Hiding all windows except: ${excludeNames.join(', ')}`);
    Object.entries(this.windows).forEach(([name, win]) => {
      if (win && !win.isDestroyed() && win.isVisible() && !excludeNames.includes(name)) {
        win.hide();
      }
    });
  }

  /**
   * Internal method to create a window based on configuration.
   * @param {string} name 
   * @returns {BrowserWindow}
   */
  createWindow(name) {
    log.info(`[WINDOW_MANAGER] createWindow called for: ${name}`);
    if (this.windows[name] && !this.windows[name].isDestroyed()) {
      log.info(`[WINDOW_MANAGER] Reusing existing window for: ${name}`);
      return this.windows[name];
    }

    log.info(`[WINDOW_MANAGER] Creating new window for: ${name}`);
    const config = configs[name];
    if (!config) throw new Error(`Window configuration for "${name}" not found.`);

    const win = new BrowserWindow(config);
    this.windows[name] = win;
    configureMacWindowPrivacy(win);

    // Load URL or File
    log.info(`[WINDOW_MANAGER] Loading URL for ${name}:`, config.url);
    win.loadURL(config.url);

    // Run custom initialization
    if (config.onInit) {
      log.info(`[WINDOW_MANAGER] Running onInit for: ${name}`);
      config.onInit(win);
    }

    if (name === 'command') {
      this.applySavedLayoutBounds(win, 'commandBounds');
      this.trackLayoutBounds(win, 'commandBounds');
    } else if (name === 'floatingHead') {
      this.applySavedLayoutBounds(win, 'floatingHeadBounds', {
        width: FLOATING_HEAD_SIZE,
        height: FLOATING_HEAD_SIZE
      });
      this.trackLayoutBounds(win, 'floatingHeadBounds', {
        width: FLOATING_HEAD_SIZE,
        height: FLOATING_HEAD_SIZE
      });
    }

    // Setup default handlers
    this.setupExternalLinks(win);

    // Setup DevTools and Shortcuts
    win.webContents.on('before-input-event', (event, input) => {
      if (input.control && input.shift && input.key.toLowerCase() === 'i') {
        log.info(`[WINDOW_MANAGER] Ctrl+Shift+I detected on window: ${name}`);
        if (win.webContents.isDevToolsOpened()) {
          log.info(`[WINDOW_MANAGER] Closing DevTools for: ${name}`);
          win.webContents.closeDevTools();
        } else {
          log.info(`[WINDOW_MANAGER] Opening DevTools for: ${name}`);
          win.webContents.openDevTools({ mode: 'detach' });
        }
        event.preventDefault();
      }
    });

    // Add specific event logs for debugging
    win.webContents.on('did-finish-load', () => {
      log.info(`[WINDOW_MANAGER] Window loaded: ${name}`);
      this.enforceContentProtection(win, name, 'did-finish-load');
    });

    win.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
      log.error(`[WINDOW_MANAGER] Window failed to load: ${name}. Error: ${errorCode} - ${errorDescription}`);
    });

    win.webContents.on('devtools-opened', () => {
      log.info(`[WINDOW_MANAGER] DevTools opened for: ${name}`);
    });

    win.webContents.on('devtools-closed', () => {
      log.info(`[WINDOW_MANAGER] DevTools closed for: ${name}`);
    });

    // Cleanup on close
    win.on('closed', () => {
      log.info(`[WINDOW_MANAGER] Window closed: ${name}`);
      this.windows[name] = null;
    });

    // Apply before the window is shown so the initial compositor surface is protected.
    this.enforceContentProtection(win, name, 'create');

    const enforceProtection = (eventSource) => {
      [50, 200, 500, 1500].forEach(delay => {
        setTimeout(() => {
          this.enforceContentProtection(win, name, `${eventSource}:${delay}ms`);
        }, delay);
      });
    };

    win.on('show', () => enforceProtection('show'));
    win.on('restore', () => enforceProtection('restore'));
    win.on('focus', () => enforceProtection('focus'));

    if (name === 'command') {
      win.once('ready-to-show', () => this.enforceCommandAlwaysOnTop('ready-to-show'));
      win.on('show', () => this.enforceCommandAlwaysOnTop('show'));
      win.on('restore', () => this.enforceCommandAlwaysOnTop('restore'));
      win.on('focus', () => this.enforceCommandAlwaysOnTop('focus'));
    }

    return win;
  }

  // --- Specific Window Wrappers ---

  createCommandWindow() {
    const win = this.createWindow('command');
    
    win.on('blur', () => {
      log.info('[WINDOW_MANAGER] >>> Command BLUR fired');
      setTimeout(() => {
        if (win.isDestroyed()) return;
        if (win.isFocused()) {
          log.info('[WINDOW_MANAGER] Command regained focus within 150ms, keeping visible');
          return;
        }
        
        // Se o DevTools estiver aberto, não esconde a janela no blur para permitir a depuração
        if (win.webContents.isDevToolsOpened()) {
          log.info('[WINDOW_MANAGER] DevTools estão abertos, mantendo a janela visível.');
          return;
        }
        
        const appState = require('../appState');
        
        // If a native file dialog is open, the blur is expected — do NOT hide.
        if (appState.isFileDialogOpen) {
          log.info('[WINDOW_MANAGER] >>> Command BLUR → file dialog open, keeping visible');
          return;
        }
        
        if (appState.isCommandPinned) {
          log.info('[WINDOW_MANAGER] >>> Command BLUR -> pinned, keeping visible');
          this.enforceCommandAlwaysOnTop('blur-pinned');
          return;
        }

        const focusedWin = BrowserWindow.getFocusedWindow();
        const chatWin = this.get('chat');
        const isChatFocused = focusedWin && focusedWin === chatWin;
        
        log.info(`[WINDOW_MANAGER] Command BLUR check: isChatFocused=${isChatFocused} focusedWin=${focusedWin ? 'APP_WINDOW' : 'NONE/EXTERNAL'} cmdVisible=${win.isVisible()}`);
        
        if (!isChatFocused && focusedWin !== win) {
          log.info('[WINDOW_MANAGER] >>> Command BLUR → HIDING command + chat');
          win.hide();
          if (chatWin && !chatWin.isDestroyed() && !appState.isChatPinned) {
            chatWin.hide();
          }
        } else {
          log.info('[WINDOW_MANAGER] >>> Command BLUR → keeping visible (chat or command focused)');
        }
      }, 150);
    });

    win.on('close', (event) => {
      if (!app.isQuitting) {
        event.preventDefault();
        win.hide();
      }
    });
    return win;
  }

  createChatWindow(showActive = true) {
    const win = this.createWindow('chat');
    
    win.on('blur', () => {
      log.info('[WINDOW_MANAGER] >>> Chat BLUR fired');
      setTimeout(() => {
        if (win.isDestroyed()) return;
        if (win.isFocused()) {
          log.info('[WINDOW_MANAGER] Chat regained focus within 150ms, keeping visible');
          return;
        }
        
        const appState = require('../appState');
        
        // If a native file dialog is open, the blur is expected — do NOT hide.
        if (appState.isFileDialogOpen) {
          log.info('[WINDOW_MANAGER] >>> Chat BLUR → file dialog open, keeping visible');
          return;
        }
        
        const focusedWin = BrowserWindow.getFocusedWindow();
        const cmdWin = this.get('command');
        const isCommandFocused = focusedWin && focusedWin === cmdWin;
        
        log.info(`[WINDOW_MANAGER] Chat BLUR check: isCommandFocused=${isCommandFocused} isChatPinned=${appState.isChatPinned} focusedWin=${focusedWin ? 'APP_WINDOW' : 'NONE/EXTERNAL'} chatVisible=${win.isVisible()}`);
        
        if (!appState.isChatPinned && !isCommandFocused && focusedWin !== win) {
          log.info('[WINDOW_MANAGER] >>> Chat BLUR → HIDING chat + command');
          win.hide();
          if (cmdWin && !cmdWin.isDestroyed()) {
            cmdWin.hide();
          }
        } else {
          log.info('[WINDOW_MANAGER] >>> Chat BLUR → keeping visible (pinned or command focused)');
        }
      }, 150);
    });

    if (showActive) {
      this.applyAlwaysOnTop(win, true, 'pop-up-menu');
      win.moveTop();
      win.show();
      win.focus();
    } else {
      // Due to Windows DWM bugs with Stealth Mode (setContentProtection) on transparent windows,
      // we CANNOT leave the window hidden after creation. We MUST show it immediately.
      // We use showInactive() to render the transparent surface without stealing focus.
      win.showInactive();
    }
    return win;
  }

  createVoiceWindow() {
    const win = this.createWindow('voice');
    win.on('close', (event) => {
      if (!app.isQuitting) {
        event.preventDefault();
        win.blur();
        win.hide();
      }
    });

    win.on('blur', () => {
      log.info('[WINDOW_MANAGER] Voice window blurred');
      if (win.webContents.isDevToolsOpened()) {
        log.info('[WINDOW_MANAGER] DevTools are open, keeping voice window visible.');
        return;
      }
      win.hide();
    });
    return win;
  }

  createSusurroSetupWindow() {
    const win = this.createWindow('susurroSetup');
    win.once('ready-to-show', () => win.show());
    return win;
  }

  createSusurroWindow() {
    const win = this.createWindow('susurro');
    
    win.on('blur', () => {
      log.info('[WINDOW_MANAGER] Susurro window blurred, checking in 150ms');
      setTimeout(() => {
        if (win.isDestroyed()) return;
        if (win.isFocused()) {
          log.info('[WINDOW_MANAGER] Susurro window regained focus, keeping visible');
          return;
        }
        
        if (win.webContents.isDevToolsOpened()) {
          log.info('[WINDOW_MANAGER] DevTools are open, keeping Susurro window visible.');
          return;
        }
        const appState = require('../appState');
        if (!appState.isSusurroPinned) {
          win.hide();
        }
      }, 150);
    });

    win.on('minimize', () => {
      log.info('[WINDOW_MANAGER] Susurro window minimized, stopping session');
      win.webContents.send('stop-susurro');
    });

    win.on('hide', () => {
      log.info('[WINDOW_MANAGER] Susurro window hidden, stopping session');
      win.webContents.send('stop-susurro');
    });

    win.on('close', (event) => {
      const { app } = require('electron');
      if (!app.isQuitting) {
        event.preventDefault();
        win.hide();
      }
    });
    
    return win;
  }

  createSuggestionsWindow() {
    return this.createWindow('suggestions');
  }

  createNotificationWindow() {
    return this.createWindow('notification');
  }

  getWindowName(targetWindow) {
    return Object.entries(this.windows).find(([, win]) => win === targetWindow)?.[0] || null;
  }

  isFiniteCoordinate(value) {
    return Number.isFinite(Number(value));
  }

  normalizeLayoutBounds(bounds, fixedSize = {}) {
    if (
      !bounds ||
      !this.isFiniteCoordinate(bounds.x) ||
      !this.isFiniteCoordinate(bounds.y)
    ) {
      return null;
    }

    const width = fixedSize.width ?? bounds.width;
    const height = fixedSize.height ?? bounds.height;
    if (!this.isFiniteCoordinate(width) || !this.isFiniteCoordinate(height)) {
      return null;
    }

    return {
      x: Math.round(Number(bounds.x)),
      y: Math.round(Number(bounds.y)),
      width: Math.round(Number(width)),
      height: Math.round(Number(height))
    };
  }

  constrainBoundsToVisibleArea(bounds, fixedSize = {}) {
    const normalized = this.normalizeLayoutBounds(bounds, fixedSize);
    if (!normalized) return null;

    const display = screen.getDisplayMatching(normalized);
    const area = display?.workArea || screen.getPrimaryDisplay().workArea;
    const padding = 8;
    const width = Math.min(
      Math.max(normalized.width, fixedSize.width || 32),
      Math.max(32, area.width - padding * 2)
    );
    const height = Math.min(
      Math.max(normalized.height, fixedSize.height || 32),
      Math.max(32, area.height - padding * 2)
    );
    const minX = area.x + padding;
    const minY = area.y + padding;
    const maxX = Math.max(minX, area.x + area.width - width - padding);
    const maxY = Math.max(minY, area.y + area.height - height - padding);

    return {
      x: Math.min(Math.max(normalized.x, minX), maxX),
      y: Math.min(Math.max(normalized.y, minY), maxY),
      width,
      height
    };
  }

  getSavedLayoutBounds(layoutKey, fixedSize = {}) {
    try {
      const jsonStore = require('../store/jsonStore');
      const bounds = jsonStore.getSettings()?.layout?.[layoutKey];
      return this.constrainBoundsToVisibleArea(bounds, fixedSize);
    } catch (error) {
      log.warn(`[WINDOW_MANAGER] Failed to read saved layout for ${layoutKey}:`, error.message);
      return null;
    }
  }

  applySavedLayoutBounds(win, layoutKey, fixedSize = {}) {
    if (!win || win.isDestroyed()) return;
    const bounds = this.getSavedLayoutBounds(layoutKey, fixedSize);
    if (bounds) {
      win.setBounds(bounds);
    }
  }

  saveLayoutBounds(layoutKey, bounds, fixedSize = {}) {
    const normalized = this.constrainBoundsToVisibleArea(bounds, fixedSize);
    if (!normalized) return;

    try {
      const jsonStore = require('../store/jsonStore');
      const settings = jsonStore.getSettings();
      jsonStore.saveSettings({
        ...settings,
        layout: {
          ...(settings.layout || {}),
          [layoutKey]: normalized
        }
      });
    } catch (error) {
      log.warn(`[WINDOW_MANAGER] Failed to save layout for ${layoutKey}:`, error.message);
    }
  }

  rememberLayoutBounds(layoutKey, bounds, fixedSize = {}, immediate = false) {
    if (immediate) {
      clearTimeout(this.layoutSaveTimers[layoutKey]);
      this.saveLayoutBounds(layoutKey, bounds, fixedSize);
      return;
    }

    clearTimeout(this.layoutSaveTimers[layoutKey]);
    this.layoutSaveTimers[layoutKey] = setTimeout(() => {
      this.saveLayoutBounds(layoutKey, bounds, fixedSize);
    }, 250);
  }

  trackLayoutBounds(win, layoutKey, fixedSize = {}) {
    const scheduleSave = () => {
      if (!win || win.isDestroyed()) return;
      this.rememberLayoutBounds(layoutKey, win.getBounds(), fixedSize);
    };
    const saveNow = () => {
      if (!win || win.isDestroyed()) return;
      this.rememberLayoutBounds(layoutKey, win.getBounds(), fixedSize, true);
    };

    win.on('move', scheduleSave);
    win.on('moved', scheduleSave);
    win.on('resize', scheduleSave);
    win.on('resized', scheduleSave);
    win.on('hide', saveNow);
    win.on('closed', () => clearTimeout(this.layoutSaveTimers[layoutKey]));
  }

  rememberFloatingHeadBounds(boundsOrWindow, immediate = false) {
    const bounds = typeof boundsOrWindow?.getBounds === 'function'
      ? boundsOrWindow.getBounds()
      : boundsOrWindow;
    this.rememberLayoutBounds(
      'floatingHeadBounds',
      bounds,
      { width: FLOATING_HEAD_SIZE, height: FLOATING_HEAD_SIZE },
      immediate
    );
  }

  applyAlwaysOnTop(win, enabled, level = 'floating') {
    if (!win || win.isDestroyed()) return;
    if (enabled) {
      win.setAlwaysOnTop(false);
      win.setAlwaysOnTop(true, level, 1);
    } else {
      win.setAlwaysOnTop(false);
    }
    try {
      win.setVisibleOnAllWorkspaces(!!enabled, {
        visibleOnFullScreen: true,
        skipTransformProcessType: true
      });
    } catch (e) {
      log.warn('[WINDOW_MANAGER] Failed to update workspace visibility:', e.message);
    }
    if (enabled && win.isVisible()) {
      win.moveTop();
    }

    this.enforceContentProtection(win, 'window', 'always-on-top');
    [50, 200].forEach(delay => {
      setTimeout(() => this.enforceContentProtection(win, 'window', `always-on-top:${delay}ms`), delay);
    });
  }

  enforceContentProtection(win, name = 'window', eventSource = 'manual') {
    if (!win || win.isDestroyed()) return false;

    const protectedSuccessfully = protectWindow(win);
    const details = `alwaysOnTop=${win.isAlwaysOnTop()}, visible=${win.isVisible()}`;
    if (protectedSuccessfully) {
      log.info(`[WINDOW_MANAGER] Content protection applied to ${name} from ${eventSource} (${details})`);
    } else {
      log.error(`[WINDOW_MANAGER] Failed to protect ${name} from ${eventSource} (${details})`);
    }
    return protectedSuccessfully;
  }

  enforceCommandAlwaysOnTop(eventSource = 'manual') {
    const win = this.get('command');
    if (!win || win.isDestroyed()) return;

    const appState = require('../appState');
    if (!appState.isCommandPinned) {
      this.applyAlwaysOnTop(win, false);
      return;
    }

    [0, 50, 200, 500, 1200].forEach(delay => {
      setTimeout(() => {
        if (win.isDestroyed() || !win.isVisible()) return;
        this.applyAlwaysOnTop(win, true, 'floating');
        log.info(`[WINDOW_MANAGER] Enforced command alwaysOnTop from ${eventSource} after ${delay}ms`);
      }, delay);
    });
  }

  createFloatingHeadWindow() {
    const win = this.createWindow('floatingHead');
    win.on('close', (event) => {
      if (!app.isQuitting) {
        event.preventDefault();
        win.hide();
      }
    });
    return win;
  }

  getFloatingHeadBounds(anchorBounds = null) {
    const savedBounds = this.getSavedLayoutBounds('floatingHeadBounds', {
      width: FLOATING_HEAD_SIZE,
      height: FLOATING_HEAD_SIZE
    });
    if (savedBounds) return savedBounds;

    const size = FLOATING_HEAD_SIZE;
    const margin = 18;
    const fallbackArea = screen.getPrimaryDisplay().workArea;
    const display = anchorBounds ? screen.getDisplayMatching(anchorBounds) : screen.getPrimaryDisplay();
    const area = display?.workArea || fallbackArea;

    const preferredX = anchorBounds
      ? anchorBounds.x + anchorBounds.width - size - margin
      : area.x + area.width - size - margin;
    const preferredY = anchorBounds
      ? anchorBounds.y + anchorBounds.height - size - margin
      : area.y + area.height - size - margin;

    const minX = area.x + 8;
    const minY = area.y + 8;
    const maxX = area.x + area.width - size - 8;
    const maxY = area.y + area.height - size - 8;

    return this.constrainBoundsToVisibleArea({
      x: Math.min(Math.max(Math.round(preferredX), minX), maxX),
      y: Math.min(Math.max(Math.round(preferredY), minY), maxY),
      width: size,
      height: size
    }, { width: size, height: size });
  }

  showFloatingHead(anchorBounds = null) {
    const win = this.get('floatingHead') || this.createFloatingHeadWindow();
    if (win.isDestroyed()) return null;

    const showHead = () => {
      if (win.isDestroyed()) return;
      win.setBounds(this.getFloatingHeadBounds(anchorBounds));
      this.applyAlwaysOnTop(win, true, 'pop-up-menu');
      if (typeof win.showInactive === 'function') {
        win.showInactive();
      } else {
        win.show();
      }
      win.moveTop();
      this.rememberFloatingHeadBounds(win.getBounds());
      log.info('[WINDOW_MANAGER] Floating head shown', win.getBounds());
    };

    if (win.webContents.isLoading()) {
      win.once('ready-to-show', () => setTimeout(showHead, 20));
      win.webContents.once('did-finish-load', () => setTimeout(showHead, 50));
      setTimeout(showHead, 700);
    } else {
      showHead();
    }

    return win;
  }

  hideFloatingHead() {
    const win = this.get('floatingHead');
    if (win && !win.isDestroyed()) {
      this.rememberFloatingHeadBounds(win, true);
      win.hide();
    }
  }

  minimizeToFloatingHead(sourceWindow = null) {
    const anchorWindow = sourceWindow && !sourceWindow.isDestroyed()
      ? sourceWindow
      : BrowserWindow.getFocusedWindow();
    const anchorBounds = anchorWindow && !anchorWindow.isDestroyed()
      ? anchorWindow.getBounds()
      : null;
    if (anchorWindow && this.getWindowName(anchorWindow) === 'command' && anchorBounds) {
      this.rememberLayoutBounds('commandBounds', anchorBounds, {}, true);
    }

    this.showFloatingHead(anchorBounds);
    this.hideAppWindows();
  }

  createSettingsWindow() {
    const win = this.createWindow('settings');
    win.once('ready-to-show', () => win.show());
    // Settings window should not close on blur
    win.on('close', (event) => {
      if (!app.isQuitting) {
        event.preventDefault();
        win.hide();
      }
    });
    return win;
  }

  /**
   * Shows the unified command window and opens a specific internal panel.
   * @param {'command'|'chat'|'history'|'settings'|'transcription'|'voice'} panel
   * @returns {BrowserWindow}
   */
  showCommandPanel(panel = 'command') {
    const win = this.get('command') || this.createCommandWindow();
    const appState = require('../appState');
    appState.pendingCommandPanel = panel;
    appState.activeCommandPanel = panel;
    this.hideFloatingHead();

    const openPanel = () => {
      if (win.isDestroyed()) return;
      win.webContents.send('open-command-panel', panel);
      if (panel === 'command') {
        win.webContents.send('focus-input');
      }
      appState.pendingCommandPanel = null;
    };

    this.hideAllExcept(['command', 'suggestions']);
    if (!win.isVisible()) {
      this.applySavedLayoutBounds(win, 'commandBounds');
    }
    win.show();
    win.focus();
    this.enforceCommandAlwaysOnTop('showCommandPanel');

    if (win.webContents.isLoading()) {
      win.webContents.once('did-finish-load', () => setTimeout(openPanel, 50));
    } else {
      setTimeout(openPanel, 0);
    }

    return win;
  }

  /**
   * Configures a window to open external links in the default system browser.
   * @param {BrowserWindow} window 
   */
  setupExternalLinks(window) {
    window.webContents.on('will-navigate', (event, url) => {
      // Allow internal navigation (localhost or file protocol)
      const isInternal = url.startsWith('http://localhost') || url.startsWith('file://');
      if (!isInternal) {
        event.preventDefault();
        shell.openExternal(url);
      }
    });

    window.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: 'deny' };
    });
  }
}

module.exports = new WindowManager();
