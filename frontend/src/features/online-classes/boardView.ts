/**
 * Page navigation and canvas view (zoom / pan) state.
 *
 * Pure and framework-free. Each page keeps its own view, so flipping pages
 * never loses a student's place and a pinch on one page cannot move another.
 */

export interface PageView {
  /** 1 = the whole page fits the board. */
  zoom: number;
  /** Pan offset in board pixels, applied after zoom. */
  panX: number;
  panY: number;
}

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 5;
export const DEFAULT_VIEW: PageView = { zoom: 1, panX: 0, panY: 0 };

export interface BoardPages {
  /** Zero-based index of the visible page. */
  current: number;
  count: number;
  views: Record<number, PageView>;
}

export function initialPages(count = 1): BoardPages {
  return { current: 0, count: Math.max(1, count), views: {} };
}

export function clampPage(index: number, count: number): number {
  if (!Number.isFinite(index)) return 0;
  return Math.min(Math.max(0, Math.trunc(index)), Math.max(0, count - 1));
}

export function goToPage(pages: BoardPages, index: number): BoardPages {
  const current = clampPage(index, pages.count);
  return current === pages.current ? pages : { ...pages, current };
}

export function nextPage(pages: BoardPages): BoardPages {
  return goToPage(pages, pages.current + 1);
}

export function previousPage(pages: BoardPages): BoardPages {
  return goToPage(pages, pages.current - 1);
}

/** Appends an empty page and opens it. */
export function addPage(pages: BoardPages): BoardPages {
  return { ...pages, count: pages.count + 1, current: pages.count };
}

/** Raises the page count when the document turns out to be longer (never lowers it). */
export function ensurePageCount(pages: BoardPages, count: number): BoardPages {
  if (!Number.isFinite(count) || count <= pages.count) return pages;
  return { ...pages, count: Math.trunc(count) };
}

export function viewOf(pages: BoardPages, index = pages.current): PageView {
  return pages.views[index] ?? DEFAULT_VIEW;
}

export function withView(pages: BoardPages, view: PageView, index = pages.current): BoardPages {
  return { ...pages, views: { ...pages.views, [index]: view } };
}

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/**
 * Keeps a zoomed page covering the board: at zoom 1 there is no pan at all,
 * and at higher zoom the edge of the page can reach, but not pass, the edge of
 * the board.
 */
export function clampView(view: PageView, board: { width: number; height: number }): PageView {
  const zoom = clampZoom(view.zoom);
  const minX = board.width - board.width * zoom;
  const minY = board.height - board.height * zoom;
  return {
    zoom,
    panX: Math.min(0, Math.max(minX, Number.isFinite(view.panX) ? view.panX : 0)),
    panY: Math.min(0, Math.max(minY, Number.isFinite(view.panY) ? view.panY : 0)),
  };
}

export interface Point {
  x: number;
  y: number;
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * New view for a two-finger gesture.
 *
 * The board point under the gesture's start midpoint stays under the current
 * midpoint, which is what makes pinch feel anchored rather than drifting.
 */
export function pinchView(
  start: PageView,
  startA: Point,
  startB: Point,
  nowA: Point,
  nowB: Point,
  board: { width: number; height: number },
): PageView {
  const startDistance = distance(startA, startB);
  if (startDistance === 0) return clampView(start, board);
  const zoom = clampZoom((start.zoom * distance(nowA, nowB)) / startDistance);
  const startMid = midpoint(startA, startB);
  const nowMid = midpoint(nowA, nowB);
  // Board-space point that was under the start midpoint.
  const anchorX = (startMid.x - start.panX) / start.zoom;
  const anchorY = (startMid.y - start.panY) / start.zoom;
  return clampView(
    { zoom, panX: nowMid.x - anchorX * zoom, panY: nowMid.y - anchorY * zoom },
    board,
  );
}

/** Zooms about a fixed screen point (wheel or +/- buttons). */
export function zoomAbout(
  view: PageView,
  nextZoom: number,
  about: Point,
  board: { width: number; height: number },
): PageView {
  const zoom = clampZoom(nextZoom);
  const anchorX = (about.x - view.panX) / view.zoom;
  const anchorY = (about.y - view.panY) / view.zoom;
  return clampView({ zoom, panX: about.x - anchorX * zoom, panY: about.y - anchorY * zoom }, board);
}

export function panBy(view: PageView, dx: number, dy: number, board: { width: number; height: number }): PageView {
  return clampView({ ...view, panX: view.panX + dx, panY: view.panY + dy }, board);
}

/** Screen pixel → board-space pixel, undoing zoom and pan. */
export function screenToBoard(point: Point, view: PageView): Point {
  return { x: (point.x - view.panX) / view.zoom, y: (point.y - view.panY) / view.zoom };
}

/** "3 / 12" label for the page switcher. */
export function pageLabel(pages: BoardPages): string {
  return `${pages.current + 1} / ${pages.count}`;
}
