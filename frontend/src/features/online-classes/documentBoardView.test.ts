import { describe, expect, it } from 'vitest';
import { documentPageSize, documentRailWidth, documentScrollBounds, zoomDocumentScroll } from './documentBoardView';

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

  it('matches browser scroll limits for centered fit pages and a shorter document', () => {
    expect(documentScrollBounds({ width: 800, height: 460 }, { width: 800, height: 500 })).toEqual({ left: 0, top: 0 });
    expect(documentScrollBounds({ width: 1200, height: 1600 }, { width: 800, height: 500 })).toEqual({ left: 400, top: 1100 });
    expect(zoomDocumentScroll({ zoom: 1, nextZoom: 1.1, scroll: { left: 0, top: 0 },
      origin: { x: 20, y: 100 }, railWidth: 800, nextRailWidth: 800, anchor: { x: 700, y: 450 },
      maxScroll: { left: 0, top: 6 } })).toEqual({ left: 0, top: 6 });
  });

  it.each([-.5, -.2, .2, .5])('keeps an off-centre point on a fit portrait page under the pinch centroid (%s)', fraction => {
    const baseWidth = 320, viewportWidth = 800, zoom = 1.5;
    const beforeWidth = documentRailWidth(baseWidth, viewportWidth, 1);
    const nextWidth = documentRailWidth(baseWidth, viewportWidth, zoom);
    const point = baseWidth * fraction;
    const anchor = { x: 20 + beforeWidth / 2 + point, y: 300 };
    const scroll = zoomDocumentScroll({ zoom: 1, nextZoom: zoom, scroll: { left: 0, top: 0 },
      origin: { x: 20, y: 100 }, railWidth: beforeWidth, nextRailWidth: nextWidth, anchor,
      maxScroll: { left: nextWidth - viewportWidth, top: 1000 } });
    expect((scroll.left + anchor.x - 20 - nextWidth / 2) / zoom).toBeCloseTo(point);
    expect(nextWidth).toBe(960);
  });

  it('composes several uncommitted gestures using the same anchor and next-layout limits', () => {
    const origin = { x: 20, y: 100 }, anchor = { x: 450, y: 300 };
    const initial = { left: 130, top: 700 };
    let scroll = initial, zoom = 2;
    for (const scale of [1.05, 1.08, 1.03]) {
      const nextZoom = zoom * scale;
      scroll = zoomDocumentScroll({ zoom, nextZoom, scroll, origin, anchor,
        railWidth: 500 * zoom, nextRailWidth: 500 * nextZoom,
        maxScroll: documentScrollBounds({ width: 500 * nextZoom, height: 2000 * nextZoom }, { width: 800, height: 500 }) });
      zoom = nextZoom;
    }
    const one = zoomDocumentScroll({ zoom: 2, nextZoom: zoom, scroll: initial, origin, anchor,
      railWidth: 1000, nextRailWidth: 500 * zoom });
    expect(scroll.left).toBeCloseTo(one.left);
    expect(scroll.top).toBeCloseTo(one.top);
  });
});
