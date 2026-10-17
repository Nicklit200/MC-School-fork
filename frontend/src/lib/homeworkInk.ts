import { getStroke } from 'perfect-freehand';

/** Strokes are stored in the worksheet's original PDF pixel coordinates. */
export type HomeworkInkPoint = { x: number; y: number; pressure?: number };

export type HomeworkInkStroke = {
  tool: 'pen' | 'eraser';
  color: string;
  size: number;
  points: HomeworkInkPoint[];
  /** Real PointerEvent.pressure data is available for this stroke. */
  pressureSensitive?: boolean;
};

/**
 * Perfect Freehand produces a filled outline instead of a chain of straight
 * canvas line segments. Keep eraser strokes pressure-independent so that they
 * really remove everything underneath them.
 */
export function getHomeworkInkOutline(stroke: HomeworkInkStroke): number[][] {
  if (stroke.points.length === 0) return [];

  return getStroke(stroke.points.map((point) => [point.x, point.y, point.pressure ?? 0.5]), {
    size: stroke.tool === 'eraser' ? Math.max(24, stroke.size * 5) : stroke.size,
    thinning: stroke.tool === 'eraser' ? 0 : 0.35,
    smoothing: 0.65,
    streamline: 0.28,
    simulatePressure: stroke.tool === 'pen' && !stroke.pressureSensitive,
    start: { cap: true, taper: 0 },
    end: { cap: true, taper: 0 },
    // Keep the live stroke under the tip rather than lagging behind it.
    last: true,
  });
}

/**
 * Paint a smooth, pressure-aware stroke on either the committed canvas or the
 * temporary preview canvas. Compatible with older strokes lacking pressure.
 */
export function renderHomeworkInkStroke(
  ctx: CanvasRenderingContext2D,
  stroke: HomeworkInkStroke,
): void {
  const outline = getHomeworkInkOutline(stroke);
  if (outline.length === 0) return;

  ctx.save();
  ctx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
  ctx.fillStyle = stroke.color;
  ctx.beginPath();
  ctx.moveTo(outline[0][0], outline[0][1]);
  for (let i = 0; i < outline.length; i += 1) {
    const current = outline[i];
    const next = outline[(i + 1) % outline.length];
    ctx.quadraticCurveTo(current[0], current[1], (current[0] + next[0]) / 2, (current[1] + next[1]) / 2);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
