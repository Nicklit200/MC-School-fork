import { describe, expect, it } from 'vitest';
import { shapeBounds, translateShape } from './shapeTransform';

describe('translateShape', () => {
  it('moves every coordinate of a stroke', () => {
    const moved = translateShape({ kind: 'pen', points: [[0.1, 0.1], [0.2, 0.3]] }, 0.1, 0.2);
    expect(moved.points?.[0][0]).toBeCloseTo(0.2);
    expect(moved.points?.[0][1]).toBeCloseTo(0.3);
    expect(moved.points?.[1][0]).toBeCloseTo(0.3);
    expect(moved.points?.[1][1]).toBeCloseTo(0.5);
  });

  it('moves both ends of a line and the origin of a rectangle', () => {
    const line = translateShape({ kind: 'line', x1: 0.1, y1: 0.1, x2: 0.3, y2: 0.2 }, 0.1, 0.1);
    expect([line.x1, line.y1, line.x2, line.y2].map((v) => Math.round((v ?? 0) * 100))).toEqual([20, 20, 40, 30]);
    const rect = translateShape({ kind: 'rect', x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, 0.1, 0);
    expect(rect.x).toBeCloseTo(0.2);
    expect(rect.w).toBe(0.2);
  });

  it('stops at the surface edge instead of leaving it', () => {
    const rect = translateShape({ kind: 'rect', x: 0.7, y: 0.1, w: 0.2, h: 0.2 }, 0.5, -0.5);
    expect(rect.x).toBeCloseTo(0.8);
    expect(rect.y).toBeCloseTo(0);
    expect(rect.w).toBe(0.2);
  });

  it('returns an empty shape unchanged', () => {
    const empty = { kind: 'pen' as const, points: [] };
    expect(translateShape(empty, 0.2, 0.2)).toBe(empty);
  });
});

describe('shapeBounds', () => {
  it('handles a rectangle drawn right-to-left (negative extent)', () => {
    expect(shapeBounds({ kind: 'rect', x: 0.5, y: 0.5, w: -0.2, h: -0.1 })).toEqual({
      minX: 0.3, minY: 0.4, maxX: 0.5, maxY: 0.5,
    });
  });
});
