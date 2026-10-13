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

/**
 * Turns raw pointer events into board intents.
 *
 * Framework-free so stylus, palm and pinch behaviour can be tested without a
 * touch screen or a canvas. Positions are local pixels inside the board
 * container; the component converts stroke points to page coordinates.
 */

export type Intent =
  | { type: 'stroke-start'; point: Point; pointerKind: PointerKind }
  | { type: 'stroke-move'; point: Point }
  | { type: 'stroke-end' }
  | { type: 'stroke-cancel' }
  | { type: 'view'; view: PageView };

type State = 'idle' | 'draw' | 'pan' | 'pinch';

export interface GestureDeps {
  mode: () => InputMode;
  view: () => PageView;
  board: () => { width: number; height: number };
  /** True when the viewer may not move the canvas (student under follow mode). */
  locked: () => boolean;
}

export class GestureController {
  private state: State = 'idle';
  private readonly touches = new Map<number, Point>();
  private drawPointer: number | null = null;
  private penDown: number | null = null;
  private startView: PageView = { zoom: 1, panX: 0, panY: 0 };
  private anchors: [Point, Point] | null = null;
  private panStart: Point | null = null;

  constructor(private readonly deps: GestureDeps) {}

  /**
   * @param navigate forces a pan with this pointer (mouse: middle button or
   *   space held), so a mouse user can move a zoomed page without a touch screen
   */
  down(id: number, kind: PointerKind, position: Point, palm = false, navigate = false): Intent[] {
    if (navigate && this.state === 'idle') {
      this.touches.set(id, position);
      this.beginNavigation();
      return [];
    }
    // A palm resting while a pen writes (or a large contact area) never counts.
    if (kind === 'touch' && (palm || this.penDown !== null)) return [];

    const intents: Intent[] = [];
    if (kind === 'pen') {
      this.penDown = id;
      // The pen always wins over a finger that was moving the canvas: an idle
      // pen that waits for fingers to lift looks like a dead stylus.
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
        intents.push({ type: 'stroke-start', point: position, pointerKind: kind });
      }
      return intents;
    }

    if (action === 'pan' && this.state !== 'draw') {
      this.beginNavigation();
    }
    return intents;
  }

  move(id: number, position: Point): Intent[] {
    if (this.touches.has(id)) this.touches.set(id, position);

    if (this.state === 'draw' && id === this.drawPointer) {
      return [{ type: 'stroke-move', point: position }];
    }
    if (this.deps.locked()) return [];

    if (this.state === 'pinch' && this.anchors && this.touches.size >= 2) {
      const [a, b] = this.firstTwoTouches();
      return [
        {
          type: 'view',
          view: pinchView(this.startView, this.anchors[0], this.anchors[1], a, b, this.deps.board()),
        },
      ];
    }
    if (this.state === 'pan' && this.panStart && this.touches.has(id)) {
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
    if (this.penDown === id) this.penDown = null;
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
    this.anchors = null;
    this.panStart = null;
  }

  get isDrawing(): boolean {
    return this.state === 'draw';
  }

  private beginNavigation(): void {
    this.startView = this.deps.view();
    if (this.touches.size >= 2) {
      const [a, b] = this.firstTwoTouches();
      this.state = 'pinch';
      this.anchors = [a, b];
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
