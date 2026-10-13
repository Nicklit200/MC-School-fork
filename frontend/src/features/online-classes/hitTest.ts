import type { RenderableShape, Shape } from './annotations';

/**
 * Hit testing for the "delete whole stroke" eraser and for selection.
 *
 * Works in normalized surface coordinates. `aspect` (width / height of the
 * surface) keeps the tolerance circular on screen: without it a 1% tolerance
 * would be a tall, narrow ellipse on a wide board.
 */

interface Pt {
  x: number;
  y: number;
}

function segmentDistance(p: Pt, a: Pt, b: Pt, aspect: number): number {
  const ax = a.x * aspect;
  const bx = b.x * aspect;
  const px = p.x * aspect;
  const dx = bx - ax;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(px - ax, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (p.y - a.y) * dy) / lengthSquared));
  return Math.hypot(px - (ax + t * dx), p.y - (a.y + t * dy));
}

function polylineDistance(p: Pt, points: [number, number][], aspect: number): number {
  if (points.length === 0) return Infinity;
  if (points.length === 1) {
    return Math.hypot((p.x - points[0][0]) * aspect, p.y - points[0][1]);
  }
  let best = Infinity;
  for (let index = 1; index < points.length; index += 1) {
    const a = { x: points[index - 1][0], y: points[index - 1][1] };
    const b = { x: points[index][0], y: points[index][1] };
    best = Math.min(best, segmentDistance(p, a, b, aspect));
  }
  return best;
}

/** Smallest distance from the point to the shape's drawn outline or body. */
export function distanceToShape(point: Pt, shape: Shape, aspect = 1): number {
  switch (shape.kind) {
    case 'pen':
    case 'highlighter':
    case 'erase':
      return polylineDistance(point, shape.points ?? [], aspect);
    case 'line':
    case 'arrow':
      return segmentDistance(
        point,
        { x: shape.x1 ?? 0, y: shape.y1 ?? 0 },
        { x: shape.x2 ?? 0, y: shape.y2 ?? 0 },
        aspect,
      );
    case 'rect':
    case 'ellipse': {
      const x = shape.x ?? 0;
      const y = shape.y ?? 0;
      const w = shape.w ?? 0;
      const h = shape.h ?? 0;
      const corners: [number, number][] = [
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h],
        [x, y],
      ];
      return polylineDistance(point, corners, aspect);
    }
    case 'text': {
      // Text has no outline; its box is roughly size tall and 0.6*size per glyph wide.
      const size = shape.size ?? 0.03;
      const width = (shape.text?.length ?? 0) * size * 0.6;
      const left = shape.x ?? 0;
      const top = shape.y ?? 0;
      const dx = Math.max(left - point.x, 0, point.x - (left + width));
      const dy = Math.max(top - point.y, 0, point.y - (top + size));
      return Math.hypot(dx * aspect, dy);
    }
    default:
      return Infinity;
  }
}

/**
 * The topmost visible shape within `tolerance` of the point, if any.
 *
 * Partial-erase marks (`erase`) are never selected: they are not content.
 */
export function shapeAt(
  shapes: RenderableShape[],
  point: Pt,
  tolerance = 0.015,
  aspect = 1,
): RenderableShape | null {
  for (let index = shapes.length - 1; index >= 0; index -= 1) {
    const entry = shapes[index];
    if (entry.shape.kind === 'erase') continue;
    const reach = tolerance + (entry.shape.width ?? 0) / 2;
    if (distanceToShape(point, entry.shape, aspect) <= reach) return entry;
  }
  return null;
}
