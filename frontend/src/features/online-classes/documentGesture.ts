import { distance, midpoint, type Point } from './boardView';

export interface DocumentGesture {
  /** Incremental span ratio; the document controller applies its own zoom limits. */
  scale: number;
  /** Previous midpoint in viewport client CSS pixels at the component boundary. */
  anchor: Point;
  /** Current midpoint minus previous midpoint, in the same CSS pixels. */
  pan: Point;
}

/** Shared by pointer and native iPad input; local input yields a local anchor. */
export function documentPinch(previous: [Point, Point], current: [Point, Point]): DocumentGesture {
  const before = midpoint(...previous), after = midpoint(...current);
  const previousSpan = distance(...previous), currentSpan = distance(...current);
  const scale = previousSpan > 0 && currentSpan > 0 ? currentSpan / previousSpan : 1;
  return { scale: Number.isFinite(scale) && scale > 0 ? scale : 1,
    anchor: before, pan: { x: after.x - before.x, y: after.y - before.y } };
}
