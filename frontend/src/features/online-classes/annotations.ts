/**
 * Annotation geometry and operation folding.
 *
 * Deliberately free of React and Konva so it can be tested without a canvas.
 * Coordinates here are always **normalized to the target surface** (0..1), never
 * CSS pixels — that is what lets two viewers on different screen sizes see the
 * same drawing.
 */

export type ShapeKind =
  | 'pen'
  | 'highlighter'
  | 'line'
  | 'arrow'
  | 'rect'
  | 'ellipse'
  | 'text'
  | 'erase';

export type OperationType =
  | 'ADD'
  | 'UPDATE'
  | 'ERASE'
  | 'CLEAR_LAYER'
  | 'CLEAR_ALL'
  | 'UNDO'
  | 'REDO';

export interface NormalizedPoint {
  x: number;
  y: number;
}

export interface Shape {
  kind: ShapeKind;
  color?: string;
  width?: number;
  points?: [number, number][];
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  text?: string;
  size?: number;
}

export interface Operation {
  operationId: string;
  sequence: number;
  actorId: string;
  layerOwnerId: string;
  operationType: OperationType;
  payload: string;
}

/** A shape ready to draw, with the operation it came from. */
export interface RenderableShape {
  operationId: string;
  layerOwnerId: string;
  sequence: number;
  shape: Shape;
}

export interface Viewport {
  width: number;
  height: number;
}

/**
 * The drawable box inside a viewport for a given source aspect ratio.
 *
 * Without this, annotating a 16:9 screen share inside a 4:3 panel would place
 * strokes in the letterbox bars — visible to the drawer in one place and to
 * everyone else in another.
 */
export function letterbox(viewport: Viewport, sourceAspect: number | null) {
  if (!sourceAspect || !Number.isFinite(sourceAspect) || sourceAspect <= 0) {
    return { left: 0, top: 0, width: viewport.width, height: viewport.height };
  }
  const viewportAspect = viewport.width / viewport.height;
  if (viewportAspect > sourceAspect) {
    const width = viewport.height * sourceAspect;
    return { left: (viewport.width - width) / 2, top: 0, width, height: viewport.height };
  }
  const height = viewport.width / sourceAspect;
  return { left: 0, top: (viewport.height - height) / 2, width: viewport.width, height };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Pixel position within the viewport → normalized surface coordinate. */
export function toNormalized(
  pixel: { x: number; y: number },
  viewport: Viewport,
  sourceAspect: number | null,
): NormalizedPoint {
  const box = letterbox(viewport, sourceAspect);
  if (box.width === 0 || box.height === 0) return { x: 0, y: 0 };
  return {
    x: clamp01((pixel.x - box.left) / box.width),
    y: clamp01((pixel.y - box.top) / box.height),
  };
}

/** Normalized surface coordinate → pixel position within the viewport. */
export function toPixels(
  point: NormalizedPoint,
  viewport: Viewport,
  sourceAspect: number | null,
): { x: number; y: number } {
  const box = letterbox(viewport, sourceAspect);
  return { x: box.left + point.x * box.width, y: box.top + point.y * box.height };
}

/**
 * Drops points closer together than `minDistance`.
 *
 * Freehand input fires far faster than anyone can draw meaningfully; thinning
 * keeps a stroke under the server's point cap and keeps payloads small without
 * visibly changing the line.
 */
export function thinPoints(
  points: [number, number][],
  minDistance = 0.004,
): [number, number][] {
  if (points.length <= 2) return points;
  const kept: [number, number][] = [points[0]];
  for (let index = 1; index < points.length - 1; index += 1) {
    const [lastX, lastY] = kept[kept.length - 1];
    const [x, y] = points[index];
    if (Math.hypot(x - lastX, y - lastY) >= minDistance) kept.push([x, y]);
  }
  kept.push(points[points.length - 1]);
  return kept;
}

/**
 * Keeps normal handwriting visually identical when a stroke is finalized.
 *
 * The old distance-based thinning changed the set of Konva spline control
 * points when the Pencil was lifted, so handwritten letters could visibly
 * "jump". For ordinary strokes we only round normalized coordinates, which is
 * sub-pixel at classroom canvas sizes. Only exceptionally long uninterrupted
 * strokes are evenly resampled to stay safely below the server payload cap.
 */
export function compactStrokePoints(
  points: [number, number][],
  maxPoints = 600,
): [number, number][] {
  const rounded = points.map(
    ([x, y]) => [Number(x.toFixed(5)), Number(y.toFixed(5))] as [number, number],
  );
  if (rounded.length <= maxPoints) return rounded;

  const lastIndex = rounded.length - 1;
  const result: [number, number][] = [];
  for (let index = 0; index < maxPoints; index += 1) {
    const sourceIndex = Math.round((index * lastIndex) / (maxPoints - 1));
    result.push(rounded[sourceIndex]);
  }
  return result;
}

function parseShape(payload: string): Shape | null {
  try {
    const parsed = JSON.parse(payload);
    return parsed && typeof parsed === 'object' ? (parsed as Shape) : null;
  } catch {
    return null;
  }
}

function targetOf(payload: string): string | null {
  try {
    const parsed = JSON.parse(payload);
    return typeof parsed?.targetOperationId === 'string' ? parsed.targetOperationId : null;
  } catch {
    return null;
  }
}

/**
 * Folds an ordered operation stream into the shapes currently visible.
 *
 * The stream is append-only, so this is a pure function of the operations seen
 * so far — which is exactly what makes a late joiner's replay agree with
 * everyone else's live view.
 */
export function foldOperations(operations: Operation[]): RenderableShape[] {
  const ordered = [...operations].sort((a, b) => a.sequence - b.sequence);
  const shapes = new Map<string, RenderableShape>();
  const undone = new Set<string>();

  for (const operation of ordered) {
    switch (operation.operationType) {
      case 'ADD':
      case 'UPDATE':
      case 'ERASE': {
        const shape = parseShape(operation.payload);
        if (shape) {
          shapes.set(operation.operationId, {
            operationId: operation.operationId,
            layerOwnerId: operation.layerOwnerId,
            sequence: operation.sequence,
            shape,
          });
        }
        break;
      }
      case 'CLEAR_LAYER': {
        // Clears only the actor's own layer — never anyone else's.
        for (const [id, entry] of shapes) {
          if (entry.layerOwnerId === operation.layerOwnerId) shapes.delete(id);
        }
        break;
      }
      case 'CLEAR_ALL':
        shapes.clear();
        undone.clear();
        break;
      case 'UNDO': {
        const target = targetOf(operation.payload);
        const entry = target ? shapes.get(target) : undefined;
        // An undo may only hide the actor's own work, even if the payload
        // names someone else's operation.
        if (target && entry && entry.layerOwnerId === operation.layerOwnerId) {
          shapes.delete(target);
          undone.add(target);
        }
        break;
      }
      case 'REDO': {
        const target = targetOf(operation.payload);
        if (!target || !undone.has(target)) break;
        const original = ordered.find((candidate) => candidate.operationId === target);
        if (original && original.layerOwnerId === operation.layerOwnerId) {
          const shape = parseShape(original.payload);
          if (shape) {
            shapes.set(target, {
              operationId: target,
              layerOwnerId: original.layerOwnerId,
              sequence: original.sequence,
              shape,
            });
            undone.delete(target);
          }
        }
        break;
      }
      default:
        break;
    }
  }

  return [...shapes.values()].sort((a, b) => a.sequence - b.sequence);
}

/** The actor's own operations that can still be undone, newest last. */
export function undoableOperations(operations: Operation[], actorId: string): Operation[] {
  const visible = new Set(foldOperations(operations).map((entry) => entry.operationId));
  return operations
    .filter(
      (operation) =>
        operation.layerOwnerId === actorId &&
        ['ADD', 'UPDATE', 'ERASE'].includes(operation.operationType) &&
        visible.has(operation.operationId),
    )
    .sort((a, b) => a.sequence - b.sequence);
}
