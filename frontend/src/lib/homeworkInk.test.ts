import { describe, expect, it } from 'vitest';
import { getHomeworkInkOutline } from './homeworkInk';

describe('homework ink outlines', () => {
  it('handles an empty stroke', () => {
    expect(getHomeworkInkOutline({ tool: 'pen', color: '#111111', size: 5, points: [] })).toEqual([]);
  });

  it('smooths a pen stroke drawn without a pressure sensor', () => {
    const outline = getHomeworkInkOutline({
      tool: 'pen', color: '#2563eb', size: 5,
      points: [{ x: 10, y: 10 }, { x: 20, y: 18 }, { x: 30, y: 12 }],
    });
    expect(outline.length).toBeGreaterThan(2);
    expect(outline.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
  });

  it('accepts real stylus pressure', () => {
    const outline = getHomeworkInkOutline({
      tool: 'pen', color: '#111111', size: 5, pressureSensitive: true,
      points: [
        { x: 4, y: 5, pressure: 0.15 },
        { x: 14, y: 16, pressure: 0.7 },
        { x: 26, y: 9, pressure: 0.95 },
      ],
    });
    expect(outline.length).toBeGreaterThan(2);
  });

  it('preserves pressure-independent eraser outlines', () => {
    const outline = getHomeworkInkOutline({
      tool: 'eraser', color: '#111111', size: 5,
      points: [{ x: 10, y: 10 }, { x: 30, y: 30 }],
    });
    expect(outline.length).toBeGreaterThan(2);
  });
});
