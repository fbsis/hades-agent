/**
 * Keeps an Electron window excluded from supported screen-capture APIs.
 * Protection is intentionally mandatory for every Metis surface.
 *
 * @param {import('electron').BrowserWindow} win
 * @returns {boolean}
 */
function protectWindow(win) {
  if (!win || win.isDestroyed()) return false;

  try {
    win.setContentProtection(true);
    return true;
  } catch {
    return false;
  }
}

// Reapply after compositor changes, just like the core window manager does.
// Call while the window is still hidden, before loading or showing any content.
function bindContentProtection(win) {
  if (!win || win.isDestroyed()) return false;
  const timers = new Set();
  const clearTimers = () => {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  };
  const enforce = () => {
    clearTimers();
    const applied = protectWindow(win);
    for (const delay of [50, 200, 500, 1500]) {
      const timer = setTimeout(() => {
        timers.delete(timer);
        protectWindow(win);
      }, delay);
      timer.unref?.();
      timers.add(timer);
    }
    return applied;
  };
  for (const event of ['show', 'restore', 'focus']) win.on(event, enforce);
  win.webContents.on('did-finish-load', () => protectWindow(win));
  win.once('closed', clearTimers);
  return enforce();
}

module.exports = { protectWindow, bindContentProtection };
