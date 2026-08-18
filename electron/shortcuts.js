const { globalShortcut, app } = require('electron');
const windowManager = require('./windows/windowManager');
const jsonStore = require('./store/jsonStore');
const appState = require('./appState');

/**
 * Toggles the command window and associated chat window.
 */
function toggleCommandWindow() {
  const { BrowserWindow } = require('electron');
  console.log('');
  console.log('=== [SHORTCUTS] ============ TOGGLE COMMAND START ============');
  
  const win = windowManager.get('command') || windowManager.createCommandWindow();
  const chatWin = windowManager.get('chat');
  
  const logWinState = (label, w) => {
    if (!w || w.isDestroyed()) {
      console.log(`  [${label}] NULL or DESTROYED`);
      return;
    }
    const bounds = w.getBounds();
    console.log(`  [${label}] visible=${w.isVisible()} focused=${w.isFocused()} alwaysOnTop=${w.isAlwaysOnTop()} minimized=${w.isMinimized()} bounds=[${bounds.x},${bounds.y},${bounds.width}x${bounds.height}]`);
  };

  console.log('[SHORTCUTS] --- INITIAL STATE ---');
  logWinState('COMMAND', win);
  logWinState('CHAT', chatWin);
  console.log(`[SHORTCUTS] chatHasMessages=${appState.chatHasMessages} isChatPinned=${appState.isChatPinned}`);
  console.log(`[SHORTCUTS] Currently focused window: ${BrowserWindow.getFocusedWindow()?.getTitle?.() || 'NONE (external app)'}`);
  
  if (!win) {
    console.error('[SHORTCUTS] Command window is null or undefined. ABORTING.');
    return;
  }
  
  if (win.isVisible()) {
    console.log('[SHORTCUTS] === ACTION: HIDE APP WINDOWS ===');
    windowManager.minimizeToFloatingHead(win);
  } else {
    console.log('[SHORTCUTS] === ACTION: SHOW UNIFIED COMMAND ===');
    windowManager.showCommandPanel(appState.activeCommandPanel || 'command');

    // Deferred state check — see what happened after OS compositor settles
    setTimeout(() => {
      if (win.isDestroyed()) return;
      console.log('[SHORTCUTS] --- DEFERRED CHECK (50ms) ---');
      logWinState('COMMAND', win);
      logWinState('CHAT', chatWin);
      console.log(`[SHORTCUTS] Currently focused window: ${BrowserWindow.getFocusedWindow()?.getTitle?.() || 'NONE (external app)'}`);
    }, 50);

    setTimeout(() => {
      if (win.isDestroyed()) return;
      console.log('[SHORTCUTS] --- DEFERRED CHECK (300ms) ---');
      logWinState('COMMAND', win);
      logWinState('CHAT', chatWin);
      console.log(`[SHORTCUTS] Currently focused window: ${BrowserWindow.getFocusedWindow()?.getTitle?.() || 'NONE (external app)'}`);
    }, 300);
  }
  
  console.log('=== [SHORTCUTS] ============ TOGGLE COMMAND END ==============');
  console.log('');
}

/**
 * Toggles the settings window.
 */
function toggleSettingsWindow() {
  console.log('[SHORTCUTS] Toggle Settings pressed!');
  windowManager.showCommandPanel('settings');
}

function dispatchInterviewAction(channel, label) {
  const win = windowManager.get('command');
  if (!win || win.isDestroyed()) {
    console.warn(`[SHORTCUTS] ${label} ignored: command window is unavailable.`);
    return false;
  }

  const send = () => {
    if (win.isDestroyed()) return;
    console.log(`[SHORTCUTS] Dispatching ${label}.`);
    win.webContents.send(channel, { triggeredAt: Date.now() });
  };

  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', () => setTimeout(send, 50));
  } else {
    send();
  }
  return true;
}

function captureInterviewScreen() {
  return dispatchInterviewAction('interview-capture-screen', 'Interview Capture');
}

function quickAnswerInterview() {
  return dispatchInterviewAction('interview-quick-answer', 'Interview Quick Answer');
}

function registerShortcut(name, key, handler) {
  try {
    const registered = globalShortcut.register(key, handler);
    console.log(`[SHORTCUTS] Toggle ${name} shortcut (${key}): ${registered ? '✓ OK' : '✗ FAILED'}`);
    return registered;
  } catch (err) {
    console.error(`[SHORTCUTS] Toggle ${name} shortcut (${key}): EXCEPTION - ${err.message}`);
    return false;
  }
}

/**
 * Registers global keyboard shortcuts for the application.
 * Handles toggling main windows and starting features via hotkeys.
 */
function registerGlobalShortcuts(retryCount = 0) {
  // Wipe all active global shortcut registrations to prevent clashing and leaks when updating
  globalShortcut.unregisterAll();

  const settings = jsonStore.getSettings();
  const shortcuts = settings.shortcuts || {
    toggleCommand: 'Alt+D',
    toggleSettings: 'Alt+S',
    toggleSusurro: 'Alt+B',
    toggleVoice: 'Alt+V',
    interviewQuickAnswer: 'F4',
    interviewCaptureScreen: 'F5'
  };

  let allRegistered = true;

  // Interview actions have priority over customizable general shortcuts.
  if (!registerShortcut(
    'Interview Quick Answer',
    shortcuts.interviewQuickAnswer || 'F4',
    quickAnswerInterview
  )) allRegistered = false;
  if (!registerShortcut(
    'Interview Capture',
    shortcuts.interviewCaptureScreen || 'F5',
    captureInterviewScreen
  )) allRegistered = false;

  // Toggle Command Bar & Chat
  if (!registerShortcut('Command', shortcuts.toggleCommand || 'Alt+D', toggleCommandWindow)) allRegistered = false;

  // Toggle Settings
  if (!registerShortcut('Settings', shortcuts.toggleSettings || 'Alt+S', toggleSettingsWindow)) allRegistered = false;

  // Toggle Susurro (Live Transcription)
  if (!registerShortcut('Susurro', shortcuts.toggleSusurro || 'Alt+B', () => {
    windowManager.showCommandPanel('transcription');
  })) allRegistered = false;

  // Trigger Voice Command
  if (!registerShortcut('Voice', shortcuts.toggleVoice || 'Alt+V', () => {
    const win = windowManager.showCommandPanel('voice');
    setTimeout(() => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('start-voice');
      }
    }, 120);
  })) allRegistered = false;

  // Retry if any shortcut failed (zombie process may still be releasing)
  if (allRegistered) {
    console.log('[SHORTCUTS] ✓ All shortcuts registered successfully.');
  } else if (retryCount < 3) {
    const delay = (retryCount + 1) * 1500;
    console.warn(`[SHORTCUTS] ⚠ Some shortcuts failed to register. Retrying in ${delay}ms (attempt ${retryCount + 1}/3)...`);
    setTimeout(() => registerGlobalShortcuts(retryCount + 1), delay);
  } else {
    console.error('[SHORTCUTS] ✗ CRITICAL: Shortcuts failed after 3 retries. A zombie Electron process may be holding them.');
  }
}

module.exports = registerGlobalShortcuts;
module.exports.dispatchInterviewAction = dispatchInterviewAction;
