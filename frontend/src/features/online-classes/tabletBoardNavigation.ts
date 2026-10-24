/**
 * Safari delivers Apple Pencil through native Touch Events. Unlike Pointer
 * Events, those same Touch Events are reliable for two-finger navigation.
 *
 * This is intentionally independent from DOM/React so it can be tested with
 * iPad-like touch snapshots without a browser or physical tablet.
 */
import type { TabletInkContact } from '../../lib/tabletInkInput';
import { panBy, pinchView, type PageView, type Point } from './boardView';
import { panWithScroll, pinchWithScroll } from './continuousBoardNavigation';
import { documentPinch, type DocumentGesture } from './documentGesture';

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
  scrollAtFit: boolean;
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
  private continuousOrigin: Origin | null = null;

  reset(): void {
    this.anchor = null;
    this.continuousOrigin = null;
  }

  update(
    contacts: readonly TabletInkContact[],
    origin: Origin,
    view: PageView,
    board: BoardSize,
    options: { locked: boolean; allowOneFingerPan: boolean; onScrollGesture?: (dx: number, dy: number) => void;
      onDocumentGesture?: (gesture: DocumentGesture) => void },
  ): PageView | null {
    if (options.locked || board.width <= 0 || board.height <= 0 || contacts.length === 0) {
      this.reset();
      return null;
    }
    // The page itself moves while its document scrolls. Keep the contact
    // coordinate origin fixed for this gesture to avoid scroll feedback.
    const contactOrigin = options.onScrollGesture || options.onDocumentGesture ? (this.continuousOrigin ??= { ...origin }) : origin;

    if (contacts.length === 1) {
      if (!options.allowOneFingerPan) {
        this.reset();
        return null;
      }
      const contact = contacts[0];
      const point = inBoard(contact, contactOrigin);
      if (!this.anchor || this.anchor.kind !== 'pan' || this.anchor.id !== contact.id) {
        this.anchor = { kind: 'pan', id: contact.id, initial: point, view: { ...view } };
        return null;
      }
      if (options.onScrollGesture) {
        const next = panWithScroll(this.anchor.view, point.x - this.anchor.initial.x, point.y - this.anchor.initial.y,
          board, Boolean(options.onDocumentGesture));
        this.anchor.initial = point; this.anchor.view = next.view;
        if (next.scroll.x || next.scroll.y) options.onScrollGesture(next.scroll.x, next.scroll.y);
        return options.onDocumentGesture ? null : next.view;
      }
      return panBy(this.anchor.view,
        point.x - this.anchor.initial.x, point.y - this.anchor.initial.y, board);
    }

    // Choose a pair consistently even when Safari reports touches in a
    // different array order, or a third palm contact briefly appears.
    let a: TabletInkContact | undefined;
    let b: TabletInkContact | undefined;
    const existing = this.anchor;
    if (existing?.kind === 'pinch') {
      a = contacts.find((contact) => contact.id === existing.firstId);
      b = contacts.find((contact) => contact.id === existing.secondId);
    }
    if (!a || !b) {
      [a, b] = contacts;
      this.anchor = {
        kind: 'pinch', firstId: a.id, secondId: b.id,
        first: inBoard(a, contactOrigin), second: inBoard(b, contactOrigin),
        view: { ...view }, scrollAtFit: view.zoom <= 1,
      };
      return null;
    }

    const anchor = this.anchor as PinchAnchor;
    if (options.onDocumentGesture) {
      const first = inBoard(a, contactOrigin), second = inBoard(b, contactOrigin);
      const gesture = documentPinch([anchor.first, anchor.second], [first, second]);
      anchor.first = first; anchor.second = second;
      options.onDocumentGesture({ ...gesture, anchor: { x: gesture.anchor.x + contactOrigin.left, y: gesture.anchor.y + contactOrigin.top } });
      return null;
    }
    if (options.onScrollGesture) {
      const first = inBoard(a, contactOrigin), second = inBoard(b, contactOrigin);
      const next = pinchWithScroll(anchor.view, [anchor.first, anchor.second], [first, second], board, anchor.scrollAtFit);
      anchor.first = first; anchor.second = second; anchor.view = next.view;
      if (next.scroll.x || next.scroll.y) options.onScrollGesture(next.scroll.x, next.scroll.y);
      return next.view;
    }
    return pinchView(anchor.view, anchor.first, anchor.second,
      inBoard(a, origin), inBoard(b, origin), board);
  }
}
