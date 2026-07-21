const { ipcMain, BrowserWindow, screen } = require('electron');
const windowManager = require('../windows/windowManager');
const appState = require('../appState');

/**
 * Registers IPC handlers for window manipulation (close, minimize, resize).
 */
function registerWindowHandlers() {
  /**
   * Generic handler to hide the active window.
   */
  ipcMain.handle('close-window', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      const settingsWin = windowManager.get('settings');
      const floatingHeadWin = windowManager.get('floatingHead');
      if (win === floatingHeadWin) {
        windowManager.showCommandPanel('command');
      } else if (win === settingsWin) {
        win.hide();
      } else {
        windowManager.minimizeToFloatingHead();
      }
      return { success: true };
    }
    return { success: false, error: "Window not found" };
  });

  /**
   * Generic handler to minimize the active window.
   */
  ipcMain.handle('minimize-window', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      windowManager.minimizeToFloatingHead();
      return { success: true };
    }
    return { success: false, error: "Window not found" };
  });

  ipcMain.handle('minimize-to-head', () => {
    windowManager.minimizeToFloatingHead();
    return { success: true };
  });

  /**
   * Resizes the active window.
   */
  ipcMain.handle('resize-window', (event, { width, height }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      win.setSize(width, height);
      if (win === windowManager.get('command') && appState.isCommandPinned) {
        windowManager.enforceCommandAlwaysOnTop('resize-window');
      }
      return { success: true };
    }
    return { success: false, error: "Window not found" };
  });

  /**
   * Opens a native file dialog for images and returns a base64 string.
   * Temporarily lowers alwaysOnTop on all app windows so the OS dialog renders above them.
   */
  ipcMain.handle('open-file-dialog', async (event) => {
    const { dialog } = require('electron');
    const fs = require('node:fs');
    
    appState.isFileDialogOpen = true;
    
    // Snapshot which windows currently have alwaysOnTop, then lower them all
    const allWins = BrowserWindow.getAllWindows();
    const wasAlwaysOnTop = allWins.map(w => ({ win: w, flag: w.isAlwaysOnTop() }));
    wasAlwaysOnTop.forEach(({ win, flag }) => { if (flag) win.setAlwaysOnTop(false); });
    
    const restoreAlwaysOnTop = () => {
      wasAlwaysOnTop.forEach(({ win, flag }) => {
        if (!flag || win.isDestroyed()) return;
        const commandWin = windowManager.get('command');
        const floatingHeadWin = windowManager.get('floatingHead');
        if (win === commandWin && appState.isCommandPinned) {
          windowManager.enforceCommandAlwaysOnTop('file-dialog-restore');
        } else if (win === floatingHeadWin) {
          windowManager.applyAlwaysOnTop(win, true, 'screen-saver');
        } else {
          win.setAlwaysOnTop(true, 'pop-up-menu');
        }
      });
    };

    try {
      const callerWin = BrowserWindow.fromWebContents(event.sender);
      const result = await dialog.showOpenDialog(callerWin ?? undefined, {
        properties: ['openFile'],
        filters: [{ name: 'Images', extensions: ['jpg', 'png', 'gif', 'jpeg', 'webp'] }]
      });
      
      restoreAlwaysOnTop();
      
      if (!result.canceled && result.filePaths.length > 0) {
        const filePath = result.filePaths[0];
        const buffer = fs.readFileSync(filePath);
        let ext = filePath.split('.').pop().toLowerCase();
        if (ext === 'jpg') ext = 'jpeg';
        return `data:image/${ext};base64,${buffer.toString('base64')}`;
      }
    } catch (err) {
      console.error('[WINDOW_HANDLERS] Error in open-file-dialog:', err);
      restoreAlwaysOnTop();
    } finally {
      setTimeout(() => {
        appState.isFileDialogOpen = false;
        
        // Restore focus to the window that initiated the dialog
        const win = BrowserWindow.fromWebContents(event.sender);
        if (win && !win.isDestroyed() && win.isVisible()) {
          win.focus();
        }
      }, 150);
    }
    
    return null;
  });

  /**
   * Toggles the "always on top" state of the active window.
   */
  ipcMain.on('toggle-pin', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      const commandWin = windowManager.get('command');
      const chatWin = windowManager.get('chat');
      const susurroWin = windowManager.get('susurro');
      if (win === commandWin) {
        appState.isCommandPinned = !appState.isCommandPinned;
        if (appState.isCommandPinned) {
          windowManager.enforceCommandAlwaysOnTop('toggle-pin');
        } else {
          windowManager.applyAlwaysOnTop(win, false);
        }
      } else if (win === chatWin) {
        const isPinned = appState.isChatPinned;
        appState.isChatPinned = !isPinned;
        windowManager.applyAlwaysOnTop(win, appState.isChatPinned, 'screen-saver');
      } else if (win === susurroWin) {
        const isPinned = appState.isSusurroPinned;
        appState.isSusurroPinned = !isPinned;
        windowManager.applyAlwaysOnTop(win, appState.isSusurroPinned, 'screen-saver');
      } else {
        windowManager.applyAlwaysOnTop(win, !win.isAlwaysOnTop(), 'screen-saver');
      }
    }
  });

  /**
   * Returns whether the active window is pinned.
   */
  ipcMain.handle('is-pinned', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return false;
    
    // Return the user-facing pin state, not the internal alwaysOnTop (used for z-order)
    const commandWin = windowManager.get('command');
    const chatWin = windowManager.get('chat');
    const susurroWin = windowManager.get('susurro');
    if (win === commandWin) return appState.isCommandPinned;
    if (win === chatWin) return appState.isChatPinned;
    if (win === susurroWin) return appState.isSusurroPinned;
    return win.isAlwaysOnTop();
  });

  /**
   * Enables manual resizing for frameless windows.
   */
  ipcMain.on('start-resizing', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    // On Windows, we can use win.setResizable(true) if it was false, 
    // but usually we just want to trigger the system resize if possible.
    // For now, just ensuring it's resizable.
    if (win) win.setResizable(true);
  });

  /**
   * Specifically updates the chat/susurro pin state in appState.
   */
  ipcMain.on('update-chat-pin', (event, pinned) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      const commandWin = windowManager.get('command');
      const chatWin = windowManager.get('chat');
      const susurroWin = windowManager.get('susurro');
      if (win === commandWin) {
        appState.isCommandPinned = pinned;
        if (pinned) {
          windowManager.enforceCommandAlwaysOnTop('update-chat-pin');
        } else {
          windowManager.applyAlwaysOnTop(win, false);
        }
      } else if (win === chatWin) {
        appState.isChatPinned = pinned;
        windowManager.applyAlwaysOnTop(win, pinned, 'screen-saver');
      } else if (win === susurroWin) {
        appState.isSusurroPinned = pinned;
        windowManager.applyAlwaysOnTop(win, pinned, 'screen-saver');
      } else {
        windowManager.applyAlwaysOnTop(win, pinned, 'screen-saver');
      }
    }
  });

  /**
   * Shows the chat window.
   */
  ipcMain.on('show-chat', () => {
    windowManager.showCommandPanel('chat');
  });

  /**
   * Shows the settings window.
   */
  ipcMain.on('show-settings', () => {
    windowManager.showCommandPanel('settings');
  });

  /**
   * Shows the live transcription window and starts Susurro.
   */
  ipcMain.on('show-susurro', () => {
    windowManager.showCommandPanel('transcription');
  });

  ipcMain.on('command-window-ready', (event) => {
    const panel = appState.pendingCommandPanel;
    if (panel) {
      event.sender.send('open-command-panel', panel);
      appState.pendingCommandPanel = null;
    }
  });

  ipcMain.on('floating-head-click', () => {
    windowManager.showCommandPanel('command');
  });

  ipcMain.on('move-floating-head', (event, delta) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;

    const bounds = win.getBounds();
    const display = screen.getDisplayMatching(bounds);
    const area = display.workArea;
    const nextX = Math.min(Math.max(area.x, bounds.x + Math.round(delta?.x || 0)), area.x + area.width - bounds.width);
    const nextY = Math.min(Math.max(area.y, bounds.y + Math.round(delta?.y || 0)), area.y + area.height - bounds.height);
    win.setPosition(nextX, nextY);
  });

  /**
   * Returns whether the active window is minimized.
   */
  ipcMain.handle('is-minimized', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return win ? win.isMinimized() : false;
  });

  /**
   * Returns whether the active window is maximized.
   */
  ipcMain.handle('is-maximized', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return win ? win.isMaximized() : false;
  });

  /**
   * Hides the notification window after its exit animation completes.
   */
  ipcMain.on('notif-hidden', () => {
    const notifWin = windowManager.get('notification');
    if (notifWin && !notifWin.isDestroyed()) {
      notifWin.hide();
    }
  });

  /**
   * Shows a notification triggered by the AI tool ("notify").
   * Creates the window if needed, waits for it to load, then sends the text.
   */
  ipcMain.on('show-notification', (event, text) => {
    let notifWin = windowManager.get('notification');
    if (!notifWin) {
      notifWin = windowManager.createNotificationWindow();
    }
    const sendNotify = () => {
      notifWin.showInactive();
      notifWin.webContents.send('notify', text);
    };
    if (notifWin.webContents.isLoading()) {
      notifWin.webContents.once('did-finish-load', sendNotify);
    } else {
      sendNotify();
    }
  });
}

module.exports = registerWindowHandlers;
