import { describe, expect, it } from 'vitest';
import selectionModule from './screenCaptureSelection.js';

const {
  getDisplayThumbnailSize,
  selectDisplaySource
} = selectionModule;

describe('screen capture display selection', () => {
  const displays = [
    { id: 11, size: { width: 1920, height: 1080 }, scaleFactor: 1 },
    { id: 22, size: { width: 3024, height: 1964 }, scaleFactor: 2 }
  ];
  const sources = [
    { id: 'screen:1:0', display_id: '11', name: 'Screen 1' },
    { id: 'screen:2:0', display_id: '22', name: 'Screen 2' }
  ];

  it('selects the source matching the display containing the Metis window', () => {
    expect(selectDisplaySource(sources, displays[1], displays)).toBe(sources[1]);
  });

  it('falls back to the corresponding source position when display_id is unavailable', () => {
    const sourcesWithoutDisplayId = sources.map(source => ({ ...source, display_id: '' }));
    expect(selectDisplaySource(sourcesWithoutDisplayId, displays[1], displays)).toBe(sourcesWithoutDisplayId[1]);
  });

  it('keeps a normal display at native resolution and caps high-DPI captures', () => {
    expect(getDisplayThumbnailSize(displays[0])).toEqual({ width: 1920, height: 1080 });
    expect(getDisplayThumbnailSize(displays[1])).toEqual({ width: 2464, height: 1600 });
  });
});
