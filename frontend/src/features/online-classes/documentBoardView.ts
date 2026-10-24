import { clampZoom } from './boardView';

export interface DocumentPoint { x: number; y: number }
export interface DocumentScroll { left: number; top: number }

/** Real page dimensions, so the canvas and its input coordinates resize together. */
export function documentPageSize(width: number, height: number, aspect: number, zoom = 1) {
  const baseWidth = Math.min(width, height * aspect);
  return { width: baseWidth * zoom, height: baseWidth / aspect * zoom };
}

/** Keep the same document point under the cursor while the entire rail grows. */
export function zoomDocumentScroll({ zoom, nextZoom, scroll, origin, railWidth, nextRailWidth, anchor, pan = { x: 0, y: 0 } }: {
  zoom: number; nextZoom: number; scroll: DocumentScroll; origin: DocumentPoint;
  railWidth: number; nextRailWidth: number; anchor: DocumentPoint; pan?: DocumentPoint;
}): DocumentScroll {
  const next = clampZoom(nextZoom);
  const x = (scroll.left + anchor.x - origin.x - railWidth / 2) / zoom;
  const y = (scroll.top + anchor.y - origin.y) / zoom;
  return {
    left: Math.max(0, origin.x + nextRailWidth / 2 + x * next - anchor.x - pan.x),
    top: Math.max(0, origin.y + y * next - anchor.y - pan.y),
  };
}
