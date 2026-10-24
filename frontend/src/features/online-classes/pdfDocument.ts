/**
 * Thin PDF loader around pdf.js.
 *
 * pdf.js is large, so it is imported lazily: classes that never open a PDF
 * never download it. Everything here returns plain canvases so the board and
 * the answers panel render pages the same way.
 */

import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker';

export interface RenderedPage {
  canvas: HTMLCanvasElement;
  /** Width / height of the page, used to letterbox marks onto it. */
  aspect: number;
}

export interface PdfDoc {
  pageCount: number;
  /** Renders a zero-based page to roughly `width` CSS pixels (device-pixel-ratio aware). */
  renderPage: (index: number, width: number) => Promise<RenderedPage>;
  destroy: () => void;
}

/** Sharper on retina, but capped so a 4K board does not make 100 MB canvases. */
const MAX_PIXEL_RATIO = 2;
/** Widths are bucketed so a small resize does not re-render every page. */
const WIDTH_BUCKET = 200;
/** Keep recent zoom levels without retaining a raster for every visited width. */
const MAX_RENDER_CACHE_ENTRIES = 4;

export function widthBucket(width: number): number {
  return Math.max(WIDTH_BUCKET, Math.ceil(width / WIDTH_BUCKET) * WIDTH_BUCKET);
}

export async function openPdf(data: ArrayBuffer): Promise<PdfDoc> {
  const pdfjs = await import('pdfjs-dist');
  // Bundle the PDF worker as a real Vite worker, rather than relying on
  // pdf.js to dynamically import a worker URL (which fails on iPad Safari).
  if (!pdfjs.GlobalWorkerOptions.workerPort) {
    pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();
  }

  const task = pdfjs.getDocument({ data: new Uint8Array(data), isEvalSupported: false });
  const document = await task.promise;
  const cache = new Map<string, Promise<RenderedPage>>();

  const renderPage = (index: number, width: number): Promise<RenderedPage> => {
    const bucket = widthBucket(width);
    const key = `${index}:${bucket}`;
    const cached = cache.get(key);
    if (cached) {
      cache.delete(key);
      cache.set(key, cached);
      return cached;
    }

    const rendering = (async () => {
      const page = await document.getPage(index + 1);
      const base = page.getViewport({ scale: 1 });
      const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
      // A document can be zoomed far beyond the viewport. Bound both sides
      // and area after learning its actual aspect, including unusually tall
      // pages, before pdf.js allocates any raster backing storage.
      const scale = Math.min((bucket * ratio) / base.width,
        3072 / base.width, 3072 / base.height, Math.sqrt(6_000_000 / base.width / base.height));
      const viewport = page.getViewport({ scale });
      const canvas = window.document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas is not available');
      await page.render({ canvasContext: context, viewport }).promise;
      return { canvas, aspect: base.width / base.height };
    })();
    // A failed render must not poison the cache: the next attempt retries.
    rendering.catch(() => {
      // An evicted request may reject after a replacement for this key began.
      if (cache.get(key) === rendering) cache.delete(key);
    });
    cache.set(key, rendering);
    while (cache.size > MAX_RENDER_CACHE_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    return rendering;
  };

  return {
    pageCount: document.numPages,
    renderPage,
    destroy: () => {
      cache.clear();
      void task.destroy();
    },
  };
}
