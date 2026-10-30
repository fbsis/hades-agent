// Wait for another app (e.g. WritingTools) to release a shortcut without
// unregistering unrelated Metis shortcuts or changing the other app's settings.
function registerWithHandoff({ globalShortcut, key, handler, onStatus = () => {}, interval = setInterval, clear = clearInterval }) {
  let timer;
  const attempt = () => {
    let registered = false;
    try { registered = globalShortcut.register(key, handler); } catch { /* Invalid/conflicting accelerator. */ }
    if (registered) {
      if (timer) clear(timer);
      timer = null;
      onStatus(true);
    }
    return registered;
  };
  const registered = attempt();
  if (!registered) {
    onStatus(false);
    timer = interval(attempt, 5000);
    timer.unref?.();
  }
  return { registered, cancel: () => { if (timer) clear(timer); timer = null; } };
}
module.exports = { registerWithHandoff };
