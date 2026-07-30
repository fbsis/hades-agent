function selectDisplaySource(sources = [], targetDisplay, displays = []) {
  if (!sources.length || !targetDisplay) return sources[0] || null;

  const targetId = String(targetDisplay.id);
  const exactMatch = sources.find(source => (
    source.display_id && String(source.display_id) === targetId
  ));
  if (exactMatch) return exactMatch;

  const sourceIdMatch = sources.find(source => source.id === `screen:${targetId}:0`);
  if (sourceIdMatch) return sourceIdMatch;

  const displayIndex = displays.findIndex(display => String(display.id) === targetId);
  if (displayIndex >= 0 && sources.length === displays.length) {
    return sources[displayIndex] || null;
  }

  return sources[0] || null;
}

function getDisplayThumbnailSize(display, limits = { width: 2560, height: 1600 }) {
  const scaleFactor = Number(display?.scaleFactor) || 1;
  const pixelWidth = Math.max(1, Math.round((display?.size?.width || limits.width) * scaleFactor));
  const pixelHeight = Math.max(1, Math.round((display?.size?.height || limits.height) * scaleFactor));
  const scale = Math.min(1, limits.width / pixelWidth, limits.height / pixelHeight);

  return {
    width: Math.max(1, Math.round(pixelWidth * scale)),
    height: Math.max(1, Math.round(pixelHeight * scale))
  };
}

module.exports = {
  getDisplayThumbnailSize,
  selectDisplaySource
};
