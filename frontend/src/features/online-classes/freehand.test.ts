import { describe, expect, it, vi } from 'vitest';
import { penOutline, tracePenOutline } from './freehand';

const viewport = { width: 1000, height: 600 };
const points: [number, number][] = [[0.1, 0.2], [0.2, 0.2], [0.3, 0.25], [0.4, 0.3]];

describe('Perfect Freehand pen', () => {
  it('smooths existing two-coordinate lesson ink', () => {
    const outline = penOutline({ points, width: 0.008 }, viewport, null);
    expect(outline.length).toBeGreaterThan(3);
    expect(outline.every((pair) => pair.every(Number.isFinite))).toBe(true);
  });

  it('varies its contour by stylus pressure', () => {
    const light = penOutline({ points, width: 0.008, pressures: [0.2, 0.2, 0.2, 0.2] }, viewport, null);
    const firm = penOutline({ points, width: 0.008, pressures: [0.9, 0.9, 0.9, 0.9] }, viewport, null);
    expect(light).not.toEqual(firm);
  });

  it('does not crash on no points or malformed pressures', () => {
    expect(penOutline({ points: [] }, viewport, null)).toEqual([]);
    expect(penOutline({ points, pressures: [2] }, viewport, null).length).toBeGreaterThan(0);
  });

  it('traces a fillable path suitable for on-screen rendering and PDF', () => {
    const context = { beginPath: vi.fn(), moveTo: vi.fn(), quadraticCurveTo: vi.fn(), closePath: vi.fn() };
    expect(tracePenOutline(context, [])).toBe(false);
    expect(tracePenOutline(context, [[0, 0], [10, 0], [10, 10], [0, 10]])).toBe(true);
    expect(context.beginPath).toHaveBeenCalledOnce();
    expect(context.quadraticCurveTo).toHaveBeenCalledTimes(3);
    expect(context.closePath).toHaveBeenCalledOnce();
  });
});
