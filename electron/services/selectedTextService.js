const { clipboard, systemPreferences } = require('electron');
const { createSelectedTextService } = require('./selectedTextCore');
const { execute } = require('./selectedTextScriptTransport');
const { readSelection, captureBookmark } = require('./textSelectionBookmark');
const service = createSelectedTextService({
  clipboard,
  trusted: () => systemPreferences.isTrustedAccessibilityClient(false),
  execute,
  diagnose: event => require('electron-log').info('[TEXT ACTIONS] Safe diagnostic', event)
});
service.captureWindow = win => service.captureEditor(async () => {
  const selected = await readSelection(win);
  const bookmark = selected.text?.trim() && selected.text.length <= 30000 ? await captureBookmark(win, selected.text) : null;
  const restore = () => { if (!win.isDestroyed()) { win.show(); win.focus(); } };
  return { ...selected, restore, ...(bookmark ? { replace: async text => {
    const applied = await bookmark.replace(text);
    if (applied) restore();
    return applied;
  } } : {}) };
});
module.exports = service;
