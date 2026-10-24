import {
  type PageView,
  type Point,
  panBy,
  pinchView,
} from './boardView';
import {
  type InputMode,
  type PointerKind,
  actionFor,
  shouldCancelStroke,
} from './inputPolicy';
import { panWithScroll, pinchWithScroll } from './continuousBoardNavigation';

/**
 * Turns raw pointer events into board intents.
 *
 * Framework-free so stylus, palm and pinch behaviour can be tested without a
 * touch screen or a canvas. Positions are local pixels inside the board
 * container; the component converts stroke points to page coordinates.
 */

export type Intent =
  | { type: 'stroke-start'; point: Point; pointerKind: PointerKind; pressure?: number }
  | { type: 'stroke-move'; point: Point; pressure?: number }
  | { type: 'stroke-end' }
  | { type: 'stroke-cancel' }
  | { type: 'view'; view: PageView }
  | { type: 'scroll'; dx: number; dy: number };

type State = 'idle' | 'draw' | 'pan' | 'pinch';

export interface GestureDeps {
  mode: () => InputMode;
  view: () => PageView;
  board: () => { width: number; height: number };
  /** True when the viewer may not move the canvas (student under follow mode). */
  locked: () => boolean;
  /** Clock, injected to make post-pencil palm rejection deterministic in tests. */
  now?: () => number;
  continuous?: () => boolean;
}

export class GestureController {
  private state: State = 'idle';
  private readonly touches = new Map<number, Point>();
  private drawPointer: number | null = null;
  private penDown: number | null = null;
  /** A resting hand may still fire touch events immediately after pen-up. */
  private lastPenRelease = Number.NEGATIVE_INFINITY;
  private static readonly PALM_GRACE_MS = 350;
  private startView: PageView = { zoom: 1, panX: 0, panY: 0 };
  private anchors: [Point, Point] | null = null;
  private panStart: Point | null = null;
  private pinchStartedAtFit = false;

  constructor(private readonly deps: GestureDeps) {}

  /**
   * @param navigate forces a pan with this pointer (mouse: middle button or
   *   space held), so a mouse user can move a zoomed page without a touch screen
   */
  down(id: number, kind: PointerKind, position: Point, palm = false, navigate = false, pressure?: number): Intent[] {
    // Do not let a resting palm pinch the page during or just after writing.
    // iPadOS may report a palm as one or two regular touch pointers.
    if (kind === 'touch' && (
      palm ||
      this.penDown !== null ||
      (this.deps.mode() === 'stylus' && this.now() - this.lastPenRelease < GestureController.PALM_GRACE_MS)
    )) return [];
    if (navigate && this.state === 'idle') {
      if (kind === 'pen') this.penDown = id;
      this.touches.set(id, position);
      this.beginNavigation();
      return [];
    }

    const intents: Intent[] = [];
    if (kind === 'pen') {
      this.penDown = id;
      // Stale touches from under the resting hand must not turn into a pinch
      // after pen-up. Deliberate navigation can start with fresh fingers.
      this.touches.clear();
      if (this.state === 'draw' && this.drawPointer !== id) {
        intents.push({ type: 'stroke-cancel' });
        this.drawPointer = null;
        this.state = 'idle';
      }
      // A pen always pre-empts any pan/pinch made by fingers.
      if (this.state === 'pan' || this.state === 'pinch') {
        this.state = 'idle';
        this.anchors = null;
        this.panStart = null;
      }
    }
    if (kind === 'touch') this.touches.set(id, position);
    const count = this.touches.size;

    if (this.state === 'draw' && shouldCancelStroke(kind, count)) {
      intents.push({ type: 'stroke-cancel' });
      this.state = 'idle';
      this.drawPointer = null;
    }

    const action = actionFor(kind, this.deps.mode(), count);

    if (action === 'draw') {
      if (this.state === 'idle') {
        this.state = 'draw';
        this.drawPointer = id;
        intents.push({ type: 'stroke-start', point: position, pointerKind: kind, pressure });
      }
      return intents;
    }

    if (action === 'pan' && this.state !== 'draw') {
      this.beginNavigation();
    }
    return intents;
  }

  move(id: number, position: Point, pressure?: number): Intent[] {
    if (this.touches.has(id)) this.touches.set(id, position);

    if (this.state === 'draw' && id === this.drawPointer) {
      return [{ type: 'stroke-move', point: position, pressure }];
    }
    // Ignored palms never become navigation pointers by moving later.
    if (!this.touches.has(id) || this.deps.locked()) return [];

    if (this.state === 'pinch' && this.anchors && this.touches.size >= 2) {
      const [a, b] = this.firstTwoTouches();
      if (this.deps.continuous?.()) {
        const next = pinchWithScroll(this.startView, this.anchors, [a, b], this.deps.board(), this.pinchStartedAtFit);
        this.anchors = [a, b];
        return this.applyContinuousNavigation(next);
      }
      return [
        {
          type: 'view',
          view: pinchView(this.startView, this.anchors[0], this.anchors[1], a, b, this.deps.board()),
        },
      ];
    }
    if (this.state === 'pan' && this.panStart && this.touches.has(id)) {
      if (this.deps.continuous?.()) {
        const next = panWithScroll(this.startView, position.x - this.panStart.x, position.y - this.panStart.y, this.deps.board());
        this.panStart = position;
        return this.applyContinuousNavigation(next);
      }
      return [
        {
          type: 'view',
          view: panBy(
            this.startView,
            position.x - this.panStart.x,
            position.y - this.panStart.y,
            this.deps.board(),
          ),
        },
      ];
    }
    return [];
  }

  up(id: number, cancelled = false): Intent[] {
    const intents: Intent[] = [];
    if (this.penDown === id) {
      this.penDown = null;
      this.lastPenRelease = this.now();
    }
    this.touches.delete(id);

    if (this.state === 'draw' && id === this.drawPointer) {
      intents.push({ type: cancelled ? 'stroke-cancel' : 'stroke-end' });
      this.state = 'idle';
      this.drawPointer = null;
    } else if (this.state === 'pinch') {
      if (this.touches.size >= 2) {
        this.beginNavigation();
      } else if (this.touches.size === 1) {
        // One finger left after a pinch: carry on as a pan from here, so the
        // view does not jump, and nothing is drawn until every finger lifts.
        this.beginNavigation();
      } else {
        this.state = 'idle';
      }
    } else if (this.state === 'pan' && this.touches.size === 0) {
      this.state = 'idle';
    }
    return intents;
  }

  /** Abandon everything, e.g. when the component unmounts mid-gesture. */
  reset(): void {
    this.state = 'idle';
    this.touches.clear();
    this.drawPointer = null;
    this.penDown = null;
    this.lastPenRelease = Number.NEGATIVE_INFINITY;
    this.anchors = null;
    this.panStart = null;
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  get isDrawing(): boolean {
    return this.state === 'draw';
  }

  get isNavigating(): boolean { return this.state === 'pan' || this.state === 'pinch'; }

  private applyContinuousNavigation(next: ReturnType<typeof panWithScroll>): Intent[] {
    const intents: Intent[] = [];
    if (next.view.zoom !== this.startView.zoom || next.view.panX !== this.startView.panX || next.view.panY !== this.startView.panY) {
      intents.push({ type: 'view', view: next.view });
    }
    this.startView = next.view;
    if (next.scroll.x || next.scroll.y) intents.push({ type: 'scroll', dx: next.scroll.x, dy: next.scroll.y });
    return intents;
  }

  private beginNavigation(): void {
    this.startView = this.deps.view();
    if (this.touches.size >= 2) {
      const [a, b] = this.firstTwoTouches();
      this.state = 'pinch';
      this.anchors = [a, b];
      this.pinchStartedAtFit = this.startView.zoom <= 1;
      this.panStart = null;
    } else {
      const only = [...this.touches.values()][0];
      this.state = only ? 'pan' : 'idle';
      this.anchors = null;
      this.panStart = only ?? null;
    }
  }

  private firstTwoTouches(): [Point, Point] {
    const [a, b] = [...this.touches.values()];
    return [a, b];
  }
}
