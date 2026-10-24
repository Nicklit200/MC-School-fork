import { describe, expect, it } from 'vitest';
import { documentPageSize, zoomDocumentScroll } from './documentBoardView';

describe('continuous document geometry', () => {
  it('scales portrait and landscape paper without changing their format', () => {
    expect(documentPageSize(800, 600, 4, 2)).toEqual({ width: 1600, height: 400 });
    const a4 = documentPageSize(800, 600, 210 / 297, 2);
    expect(a4.height).toBe(1200);
    expect(a4.width / a4.height).toBeCloseTo(210 / 297);
  });

  it('keeps a point on a later page anchored when zooming and moving two fingers', () => {
    const next = zoomDocumentScroll({ zoom: 1, nextZoom: 2, scroll: { left: 0, top: 500 },
      origin: { x: 20, y: 100 }, railWidth: 800, nextRailWidth: 1000,
      anchor: { x: 420, y: 400 }, pan: { x: 30, y: -20 } });
    expect(next).toEqual({ left: 70, top: 1320 });
    // 800 logical pixels below the rail's start remain at the new midpoint.
    expect(100 + 800 * 2 - next.top).toBe(380);
    expect(20 + 1000 / 2 - next.left).toBe(450);
  });

  it('reverses an anchored zoom and clamps the scroll at document edges', () => {
    const original = { left: 140, top: 1700 };
    const input = { origin: { x: 20, y: 100 }, anchor: { x: 450, y: 400 } };
    const larger = zoomDocumentScroll({ ...input, zoom: 2, nextZoom: 3, scroll: original, railWidth: 1000, nextRailWidth: 1500 });
    const restored = zoomDocumentScroll({ ...input, zoom: 3, nextZoom: 2, scroll: larger, railWidth: 1500, nextRailWidth: 1000 });
    expect(restored.left).toBeCloseTo(original.left);
    expect(restored.top).toBeCloseTo(original.top);
    expect(zoomDocumentScroll({ ...input, zoom: 2, nextZoom: 1, scroll: { left: 0, top: 0 }, railWidth: 1000, nextRailWidth: 800 }).top).toBe(0);
  });
});
