/**
 * Thin PDF loader around pdf.js.
 *
 * pdf.js is large, so it is imported lazily: classes that never open a PDF
 * never download it. Everything here returns plain canvases so the board and
 * the answers panel render pages the same way.
 */

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

export function widthBucket(width: number): number {
  return Math.max(WIDTH_BUCKET, Math.ceil(width / WIDTH_BUCKET) * WIDTH_BUCKET);
}

export async function openPdf(data: ArrayBuffer): Promise<PdfDoc> {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

  const task = pdfjs.getDocument({ data: new Uint8Array(data), isEvalSupported: false });
  const document = await task.promise;
  const cache = new Map<string, Promise<RenderedPage>>();

  const renderPage = (index: number, width: number): Promise<RenderedPage> => {
    const bucket = widthBucket(width);
    const key = `${index}:${bucket}`;
    const cached = cache.get(key);
    if (cached) return cached;

    const rendering = (async () => {
      const page = await document.getPage(index + 1);
      const base = page.getViewport({ scale: 1 });
      const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
      const viewport = page.getViewport({ scale: (bucket * ratio) / base.width });
      const canvas = window.document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas is not available');
      await page.render({ canvasContext: context, viewport }).promise;
      return { canvas, aspect: base.width / base.height };
    })();
    // A failed render must not poison the cache: the next attempt retries.
    rendering.catch(() => cache.delete(key));
    cache.set(key, rendering);
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
