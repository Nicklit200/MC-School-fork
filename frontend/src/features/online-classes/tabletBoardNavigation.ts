/**
 * Safari delivers Apple Pencil through native Touch Events. Unlike Pointer
 * Events, those same Touch Events are reliable for two-finger navigation.
 *
 * This is intentionally independent from DOM/React so it can be tested with
 * iPad-like touch snapshots without a browser or physical tablet.
 */
import type { TabletInkContact } from '../../lib/tabletInkInput';
import { panBy, pinchView, type PageView, type Point } from './boardView';

type BoardSize = { width: number; height: number };
type Origin = { left: number; top: number };

type PanAnchor = {
  kind: 'pan';
  id: number;
  initial: Point;
  view: PageView;
};

type PinchAnchor = {
  kind: 'pinch';
  firstId: number;
  secondId: number;
  first: Point;
  second: Point;
  view: PageView;
};

type Anchor = PanAnchor | PinchAnchor;

function inBoard(contact: TabletInkContact, origin: Origin): Point {
  return { x: contact.clientX - origin.left, y: contact.clientY - origin.top };
}

/**
 * Call with the entire set of fingers currently touching the drawing surface,
 * never with the stylus. One-finger panning can be disabled when a finger is
 * currently used to draw; two fingers ALWAYS pan and pinch together.
 */
export class TabletBoardNavigation {
  private anchor: Anchor | null = null;

  reset(): void {
    this.anchor = null;
  }

  update(
    contacts: readonly TabletInkContact[],
    origin: Origin,
    view: PageView,
    board: BoardSize,
    options: { locked: boolean; allowOneFingerPan: boolean },
  ): PageView | null {
    if (options.locked || board.width <= 0 || board.height <= 0 || contacts.length === 0) {
      this.reset();
      return null;
    }

    if (contacts.length === 1) {
      if (!options.allowOneFingerPan) {
        this.reset();
        return null;
      }
      const contact = contacts[0];
      const point = inBoard(contact, origin);
      if (!this.anchor || this.anchor.kind !== 'pan' || this.anchor.id !== contact.id) {
        this.anchor = { kind: 'pan', id: contact.id, initial: point, view: { ...view } };
        return null;
      }
      return panBy(this.anchor.view,
        point.x - this.anchor.initial.x, point.y - this.anchor.initial.y, board);
    }

    // Choose a pair consistently even when Safari reports touches in a
    // different array order, or a third palm contact briefly appears.
    let a: TabletInkContact | undefined;
    let b: TabletInkContact | undefined;
    if (this.anchor?.kind === 'pinch') {
      a = contacts.find((contact) => contact.id === this.anchor!.firstId);
      b = contacts.find((contact) => contact.id === this.anchor!.secondId);
    }
    if (!a || !b) {
      [a, b] = contacts;
      this.anchor = {
        kind: 'pinch', firstId: a.id, secondId: b.id,
        first: inBoard(a, origin), second: inBoard(b, origin),
        view: { ...view },
      };
      return null;
    }

    const anchor = this.anchor as PinchAnchor;
    return pinchView(anchor.view, anchor.first, anchor.second,
      inBoard(a, origin), inBoard(b, origin), board);
  }
}
