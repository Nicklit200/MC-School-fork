import { describe, expect, it } from 'vitest';
import { canvasBackingRatio, MAX_CANVAS_PIXELS, MAX_CANVAS_SIDE } from './canvasBacking';

describe('logical canvas raster bounds', () => {
  it.each([[7000, 9900], [12000, 2000], [1000, 10000], [3000, 3000]])('bounds a %d × %d zoomed stage without changing logical size', (width, height) => {
    const ratio = canvasBackingRatio(width, height, 2);
    expect(width * ratio).toBeLessThanOrEqual(MAX_CANVAS_SIDE + 0.001);
    expect(height * ratio).toBeLessThanOrEqual(MAX_CANVAS_SIDE + 0.001);
    expect(width * height * ratio * ratio).toBeLessThanOrEqual(MAX_CANVAS_PIXELS + 0.001);
    expect(ratio).toBeLessThan(1);
  });
  it('retains retina detail for a visible small page and releases retained hidden page backing', () => {
    expect(canvasBackingRatio(1000, 500, 2)).toBe(2);
    const ratio = canvasBackingRatio(7000, 9900, 2, true);
    expect(9900 * ratio).toBeLessThanOrEqual(512);
    expect(7000 * 9900 * ratio * ratio).toBeLessThanOrEqual(262_144);
    expect(canvasBackingRatio(7000, 9900, 2)).toBeGreaterThan(ratio);
  });
});
