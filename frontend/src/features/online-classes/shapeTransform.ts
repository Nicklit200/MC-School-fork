import type { Shape } from './annotations';

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * Moves a shape by a normalized delta.
 *
 * The whole shape is kept on the surface: the delta is limited so the
 * shape's own bounds stay within 0..1, which stops a drag from throwing a
 * stroke off the edge where the server's range check would reject it.
 */
export function translateShape(shape: Shape, dx: number, dy: number): Shape {
  const bounds = shapeBounds(shape);
  if (!bounds) return shape;
  const limitedDx = Math.min(Math.max(dx, -bounds.minX), 1 - bounds.maxX);
  const limitedDy = Math.min(Math.max(dy, -bounds.minY), 1 - bounds.maxY);

  const moved: Shape = { ...shape };
  if (shape.points) {
    moved.points = shape.points.map(([x, y]) => [clamp01(x + limitedDx), clamp01(y + limitedDy)]);
  }
  for (const key of ['x', 'x1', 'x2'] as const) {
    if (shape[key] !== undefined) moved[key] = clamp01((shape[key] as number) + limitedDx);
  }
  for (const key of ['y', 'y1', 'y2'] as const) {
    if (shape[key] !== undefined) moved[key] = clamp01((shape[key] as number) + limitedDy);
  }
  return moved;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Axis-aligned bounds in normalized coordinates, or null for an empty shape. */
export function shapeBounds(shape: Shape): Bounds | null {
  switch (shape.kind) {
    case 'pen':
    case 'highlighter':
    case 'erase': {
      const points = shape.points ?? [];
      if (points.length === 0) return null;
      return {
        minX: Math.min(...points.map(([x]) => x)),
        minY: Math.min(...points.map(([, y]) => y)),
        maxX: Math.max(...points.map(([x]) => x)),
        maxY: Math.max(...points.map(([, y]) => y)),
      };
    }
    case 'line':
    case 'arrow':
      return {
        minX: Math.min(shape.x1 ?? 0, shape.x2 ?? 0),
        minY: Math.min(shape.y1 ?? 0, shape.y2 ?? 0),
        maxX: Math.max(shape.x1 ?? 0, shape.x2 ?? 0),
        maxY: Math.max(shape.y1 ?? 0, shape.y2 ?? 0),
      };
    case 'rect':
    case 'ellipse': {
      const x = shape.x ?? 0;
      const y = shape.y ?? 0;
      const w = shape.w ?? 0;
      const h = shape.h ?? 0;
      return { minX: Math.min(x, x + w), minY: Math.min(y, y + h), maxX: Math.max(x, x + w), maxY: Math.max(y, y + h) };
    }
    case 'text': {
      const size = shape.size ?? 0.03;
      const x = shape.x ?? 0;
      const y = shape.y ?? 0;
      return { minX: x, minY: y, maxX: Math.min(1, x + (shape.text?.length ?? 0) * size * 0.6), maxY: Math.min(1, y + size) };
    }
    default:
      return null;
  }
}
