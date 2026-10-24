import { distance, midpoint, panBy, zoomAbout, type PageView, type Point } from './boardView';

type BoardSize = { width: number; height: number };

/** Consume drag in the zoomed page first, then scroll the document at its edge. */
export function panWithScroll(view: PageView, dx: number, dy: number, board: BoardSize, scrollOnly = false) {
  const next = scrollOnly ? view : panBy(view, dx, dy, board);
  return { view: next, scroll: { x: next.panX - view.panX - dx, y: next.panY - view.panY - dy } };
}

/** Translation and pinch share the page zoom, but fit-size translation moves the document. */
export function pinchWithScroll(view: PageView, previous: [Point, Point], current: [Point, Point], board: BoardSize, scrollOnly: boolean) {
  const before = midpoint(...previous), after = midpoint(...current);
  const span = distance(...previous);
  const zoom = span > 0 ? view.zoom * distance(...current) / span : view.zoom;
  const zoomed = zoomAbout(view, zoom, before, board);
  return panWithScroll(zoomed, after.x - before.x, after.y - before.y, board, scrollOnly);
}
