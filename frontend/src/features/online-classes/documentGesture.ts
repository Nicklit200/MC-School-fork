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

/** A swipe keeps its original zoom despite finger-span jitter. Pointer Events
 * update one finger at a time, so neither intent is chosen from that first
 * incomplete snapshot. Native Touch Events can supply a coherent pair. */
export class TwoFingerNavigation {
  private initial: [Point, Point] | null = null;
  private previous: [Point, Point] | null = null;
  private intent: 'pending' | 'pan' | 'pinch' = 'pending';

  reset(): void {
    this.initial = this.previous = null;
    this.intent = 'pending';
  }

  begin(points: [Point, Point]): void {
    this.initial = this.previous = points.map(point => ({ ...point })) as [Point, Point];
    this.intent = 'pending';
  }

  update(points: [Point, Point], coherent = false): DocumentGesture {
    if (!this.initial || !this.previous) this.begin(points);
    const initial = this.initial!, previous = this.previous!;
    const gesture = documentPinch(previous, points);
    const previousIntent = this.intent;
    if (this.intent === 'pending' && (coherent || initial.every((point, index) => distance(point, points[index]) >= 2))) {
      const initialSpan = distance(...initial), spanChange = Math.abs(distance(...points) - initialSpan);
      const translation = distance(midpoint(...initial), midpoint(...points));
      if (spanChange >= Math.max(12, initialSpan * .06) && spanChange > translation * 1.5) this.intent = 'pinch';
      else if (translation >= 4) this.intent = 'pan';
    }
    this.previous = points.map(point => ({ ...point })) as [Point, Point];
    if (this.intent === 'pending') return { scale: 1, anchor: midpoint(...initial), pan: { x: 0, y: 0 } };
    // Release the small initial dead zone as one coherent movement, keeping
    // zoom anchored correctly even when pending translation hit a scroll edge.
    const result = previousIntent === 'pending' ? documentPinch(initial, points) : gesture;
    if (this.intent === 'pan') result.scale = 1;
    return result;
  }
}
