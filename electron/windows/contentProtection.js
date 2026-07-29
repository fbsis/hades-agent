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

module.exports = { protectWindow };
