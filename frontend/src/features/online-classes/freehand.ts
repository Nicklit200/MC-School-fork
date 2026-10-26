import { getStroke } from 'perfect-freehand';
import { type Shape, type Viewport, letterbox, toPixels } from './annotations';

/** Match ink thickness to the actual sheet, not a viewer's surrounding letterbox. */
export function strokeWidthPixels(width: number | undefined, viewport: Viewport, aspect: number | null): number {
  return Math.max(1, (width ?? 0.004) * letterbox(viewport, aspect).width);
}

/** Same pressure-aware ink geometry for whiteboard, previews and PDF export. */
export function penOutline(
  shape: Pick<Shape, 'points' | 'pressures' | 'width'>,
  viewport: Viewport,
  aspect: number | null,
): number[][] {
  const points = shape.points ?? [];
  if (!points.length || viewport.width <= 0 || viewport.height <= 0) return [];
  const pressure = shape.pressures;
  const hasPressure = pressure?.length === points.length &&
    pressure.every((value) => Number.isFinite(value) && value >= 0 && value <= 1);
  return getStroke(points.map(([x, y], index) => {
    const pixel = toPixels({ x, y }, viewport, aspect);
    return hasPressure ? [pixel.x, pixel.y, pressure![index]] : [pixel.x, pixel.y];
  }), {
    size: strokeWidthPixels(shape.width, viewport, aspect),
    thinning: 0.55,
    smoothing: 0.6,
    streamline: 0.5,
    simulatePressure: !hasPressure,
    last: true,
  });
}

export function tracePenOutline(
  ctx: {
    beginPath: () => void;
    moveTo: (x: number, y: number) => void;
    quadraticCurveTo: (cx: number, cy: number, x: number, y: number) => void;
    closePath: () => void;
  },
  outline: number[][],
): boolean {
  if (!outline.length) return false;
  ctx.beginPath();
  ctx.moveTo(outline[0][0], outline[0][1]);
  for (let i = 1; i < outline.length; i++) {
    const [x, y] = outline[i];
    const [nextX, nextY] = outline[(i + 1) % outline.length];
    ctx.quadraticCurveTo(x, y, (x + nextX) / 2, (y + nextY) / 2);
  }
  ctx.closePath();
  return true;
}
