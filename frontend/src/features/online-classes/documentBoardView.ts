import { clampZoom } from './boardView';

export interface DocumentPoint { x: number; y: number }
export interface DocumentScroll { left: number; top: number }

export interface CompactPageReviewColumns {
  paperWidth: number;
  reviewWidth: number;
  gap: number;
}

/** In the all-pupils overview, reserve an A4-sized left column and give every
 * remaining horizontal pixel to the readable Kolyn feedback panel. */
export function compactPageReviewColumns(
  viewportWidth: number,
  viewportHeight: number,
  aspect: number,
  gap = 8,
  pageShare = 0.42,
  minimumReviewWidth = 120,
): CompactPageReviewColumns {
  const width = Number.isFinite(viewportWidth) ? Math.max(0, viewportWidth) : 0;
  const height = Number.isFinite(viewportHeight) ? Math.max(0, viewportHeight) : 0;
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 210 / 297;
  const safeGap = Math.min(width, Math.max(0, gap));
  const minimumPaperWidth = Math.min(96, Math.max(0, width - safeGap));
  const reviewFloor = Math.min(Math.max(0, minimumReviewWidth), Math.max(0, width - safeGap - minimumPaperWidth));
  const maximumPaperWidth = Math.max(0, width - safeGap - reviewFloor);
  const share = Math.min(1, Math.max(0, pageShare));
  const paperWidth = Math.min(maximumPaperWidth, width * share, height * safeAspect);
  return { paperWidth, reviewWidth: Math.max(0, width - paperWidth - safeGap), gap: safeGap };
}

/** Real page dimensions, so the canvas and its input coordinates resize together. */
export function documentPageSize(width: number, height: number, aspect: number, zoom = 1) {
  const baseWidth = Math.min(width, height * aspect);
  return { width: baseWidth * zoom, height: baseWidth / aspect * zoom };
}

/** Give a zooming page room to move in both directions before it becomes
 * wider than the viewport. No gutter at fit; blank margins stay bounded. */
export function documentRailWidth(baseWidth: number, viewportWidth: number, zoom: number): number {
  const gutter = Math.min(viewportWidth / 2, Math.max(0, zoom - 1) * baseWidth / 2);
  return Math.max(viewportWidth, baseWidth * zoom) + 2 * gutter;
}

/** Keep the same document point under the cursor while the entire rail grows. */
export function zoomDocumentScroll({ zoom, nextZoom, scroll, origin, railWidth, nextRailWidth, anchor, pan = { x: 0, y: 0 }, maxScroll }: {
  zoom: number; nextZoom: number; scroll: DocumentScroll; origin: DocumentPoint;
  railWidth: number; nextRailWidth: number; anchor: DocumentPoint; pan?: DocumentPoint;
  /** Bounds of the next layout, including the clear viewport and scaled gaps. */
  maxScroll?: DocumentScroll;
}): DocumentScroll {
  const next = clampZoom(nextZoom);
  const x = (scroll.left + anchor.x - origin.x - railWidth / 2) / zoom;
  const y = (scroll.top + anchor.y - origin.y) / zoom;
  return {
    left: Math.min(Math.max(0, maxScroll?.left ?? Infinity), Math.max(0, origin.x + nextRailWidth / 2 + x * next - anchor.x - pan.x)),
    top: Math.min(Math.max(0, maxScroll?.top ?? Infinity), Math.max(0, origin.y + y * next - anchor.y - pan.y)),
  };
}

/** The browser clamps scrolling to these limits after resizing the rail. Use
 * the same limits before composing another gesture, even before React commits. */
export function documentScrollBounds(rail: { width: number; height: number }, viewport: { width: number; height: number }): DocumentScroll {
  return { left: Math.max(0, rail.width - viewport.width), top: Math.max(0, rail.height - viewport.height) };
}
