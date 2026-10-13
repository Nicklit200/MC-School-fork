import { describe, expect, it } from 'vitest';
import type { RenderableShape } from './annotations';
import { distanceToShape, shapeAt } from './hitTest';

const entry = (operationId: string, shape: RenderableShape['shape']): RenderableShape => ({
  operationId,
  layerOwnerId: 'u',
  sequence: 1,
  shape,
});

describe('distanceToShape', () => {
  it('measures to the nearest stroke segment', () => {
    const stroke = { kind: 'pen' as const, points: [[0.1, 0.5], [0.9, 0.5]] as [number, number][] };
    expect(distanceToShape({ x: 0.5, y: 0.52 }, stroke)).toBeCloseTo(0.02);
  });

  it('measures to a rectangle outline, not its fill', () => {
    const rect = { kind: 'rect' as const, x: 0.2, y: 0.2, w: 0.4, h: 0.4 };
    expect(distanceToShape({ x: 0.4, y: 0.4 }, rect)).toBeCloseTo(0.2);
    expect(distanceToShape({ x: 0.2, y: 0.4 }, rect)).toBeCloseTo(0);
  });

  it('treats a line as a segment, so past the end does not count as on it', () => {
    const line = { kind: 'line' as const, x1: 0.2, y1: 0.2, x2: 0.4, y2: 0.2 };
    expect(distanceToShape({ x: 0.6, y: 0.2 }, line)).toBeCloseTo(0.2);
  });

  it('gives a text box a body', () => {
    const text = { kind: 'text' as const, x: 0.1, y: 0.1, text: 'abcd', size: 0.05 };
    expect(distanceToShape({ x: 0.15, y: 0.12 }, text)).toBe(0);
  });
});

describe('shapeAt', () => {
  const stroke = entry('a', { kind: 'pen', points: [[0.1, 0.5], [0.9, 0.5]] });
  const above = entry('b', { kind: 'line', x1: 0.1, y1: 0.5, x2: 0.9, y2: 0.5 });

  it('returns the topmost shape when several overlap', () => {
    expect(shapeAt([stroke, above], { x: 0.5, y: 0.5 })?.operationId).toBe('b');
  });

  it('returns null away from everything', () => {
    expect(shapeAt([stroke], { x: 0.5, y: 0.9 })).toBeNull();
  });

  it('never selects partial-erase marks', () => {
    const mark = entry('e', { kind: 'erase', points: [[0.1, 0.5], [0.9, 0.5]] });
    expect(shapeAt([mark], { x: 0.5, y: 0.5 })).toBeNull();
  });

  it('keeps tolerance circular on a wide surface', () => {
    const dot = entry('d', { kind: 'pen', points: [[0.5, 0.5]] });
    // 0.01 away horizontally is 0.02 in y-units on a 2:1 board — outside 0.015.
    expect(shapeAt([dot], { x: 0.51, y: 0.5 }, 0.015, 2)).toBeNull();
    expect(shapeAt([dot], { x: 0.51, y: 0.5 }, 0.015, 1)?.operationId).toBe('d');
  });
});
