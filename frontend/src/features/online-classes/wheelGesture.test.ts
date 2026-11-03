import { describe, expect, it } from 'vitest';
import { wheelDeltaPixels, wheelZoomScale } from './wheelGesture';

describe('wheel gesture units and sensitivity', () => {
  it('treats pixel, line and page deltas as equivalent movement', () => {
    expect(wheelDeltaPixels({ deltaX: 2, deltaY: -3, deltaMode: 1 }, 800)).toEqual({ x: 32, y: -48 });
    expect(wheelDeltaPixels({ deltaX: .25, deltaY: -.5, deltaMode: 2 }, 800)).toEqual({ x: 200, y: -400 });
    const pixel = wheelZoomScale({ deltaY: -48, deltaMode: 0, ctrlKey: true }, 800);
    expect(wheelZoomScale({ deltaY: -3, deltaMode: 1, ctrlKey: true }, 800)).toBe(pixel);
    expect(wheelZoomScale({ deltaY: -.06, deltaMode: 2, ctrlKey: true }, 800)).toBeCloseTo(pixel);
  });

  it('keeps fine trackpad zoom proportional and bounds a coarse mouse tick', () => {
    const fine = wheelZoomScale({ deltaY: -2, deltaMode: 0, ctrlKey: true }, 800);
    expect(fine).toBeCloseTo(Math.exp(.004));
    expect(fine).toBeLessThan(1.01);
    const coarse = wheelZoomScale({ deltaY: -120, deltaMode: 0, ctrlKey: true }, 800);
    expect(coarse).toBeGreaterThan(1);
    expect(coarse).toBeLessThan(1.25);
    expect(wheelZoomScale({ deltaY: -5000, deltaMode: 0, ctrlKey: true }, 800)).toBe(coarse);
  });

  it('makes opposite deltas reversible and ignores invalid movement', () => {
    const inward = wheelZoomScale({ deltaY: -20, deltaMode: 0, ctrlKey: true }, 800);
    const outward = wheelZoomScale({ deltaY: 20, deltaMode: 0, ctrlKey: true }, 800);
    expect(inward * outward).toBeCloseTo(1);
    expect(wheelZoomScale({ deltaY: Number.NaN, deltaMode: 0, ctrlKey: true }, 800)).toBe(1);
    expect(wheelDeltaPixels({ deltaX: Number.POSITIVE_INFINITY, deltaY: Number.NaN, deltaMode: 0 }, 800)).toEqual({ x: 0, y: 0 });
  });

  it('reads native WheelEvent prototype properties as well as plain snapshots', () => {
    expect(wheelZoomScale(new WheelEvent('wheel', { deltaY: -20, ctrlKey: true }), 800))
      .toBeCloseTo(Math.exp(.04));
  });
});
