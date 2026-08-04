const DEFAULT_WINDOW_OPACITY = 0.9;
const MIN_WINDOW_OPACITY = 0.5;
const MAX_WINDOW_OPACITY = 1;

function normalizeWindowOpacity(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_WINDOW_OPACITY;

  const clamped = Math.min(MAX_WINDOW_OPACITY, Math.max(MIN_WINDOW_OPACITY, parsed));
  return Math.round(clamped * 100) / 100;
}

module.exports = {
  DEFAULT_WINDOW_OPACITY,
  MIN_WINDOW_OPACITY,
  MAX_WINDOW_OPACITY,
  normalizeWindowOpacity
};
