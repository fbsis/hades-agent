function getMacOverlayOptions(platform = process.platform) {
  if (platform !== 'darwin') return {};

  return {
    type: 'panel',
    hiddenInMissionControl: true,
    skipTaskbar: true
  };
}

function configureMacWindowPrivacy(win, platform = process.platform) {
  if (platform !== 'darwin' || !win || win.isDestroyed()) return false;

  try {
    win.setHiddenInMissionControl(true);
    win.excludedFromShownWindowsMenu = true;
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  configureMacWindowPrivacy,
  getMacOverlayOptions
};
