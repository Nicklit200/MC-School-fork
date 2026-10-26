import { useEffect, useRef, useState } from 'react';
import { type PdfDoc, type RenderedPage, openPdf, widthBucket } from './pdfDocument';

export type PdfState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; doc: PdfDoc }
  | { status: 'error'; message: string };

/**
 * Loads a PDF from a function that fetches its bytes.
 *
 * `fetchBytes` is passed in (rather than a URL) so each caller can use its own
 * authorization — the answers file needs the teacher's token. `key` identifies
 * the source: a new key loads a new document and releases the old one.
 */
export function usePdf(
  key: string | null,
  fetchBytes: () => Promise<ArrayBuffer>,
  open: (data: ArrayBuffer) => Promise<PdfDoc> = openPdf,
): PdfState {
  const [state, setState] = useState<PdfState>({ status: 'idle' });
  const fetchRef = useRef(fetchBytes);
  fetchRef.current = fetchBytes;
  // Callers pass inline functions; keying the effect on them would reload forever.
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    if (!key) {
      setState({ status: 'idle' });
      return;
    }
    let active = true;
    let loaded: PdfDoc | null = null;
    setState({ status: 'loading' });
    fetchRef
      .current()
      .then((bytes) => openRef.current(bytes))
      .then((doc) => {
        if (!active) {
          doc.destroy();
          return;
        }
        loaded = doc;
        setState({ status: 'ready', doc });
      })
      .catch((error: unknown) => {
        if (active) setState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
      });
    return () => {
      active = false;
      loaded?.destroy();
    };
  }, [key]);

  return state;
}

/** Renders one page of a loaded PDF whenever the page or width changes. */
export function usePdfPage(doc: PdfDoc | null, index: number, width: number): RenderedPage | null {
  const [rendered, setRendered] = useState<{ doc: PdfDoc; index: number; page: RenderedPage } | null>(null);
  // A pinch updates page width every frame. Render one PDF texture per
  // resolution bucket, instead of re-running this effect on every CSS pixel.
  const renderWidth = width > 0 ? Math.min(widthBucket(width), 4096) : 0;

  useEffect(() => {
    if (!doc || index < 0 || index >= doc.pageCount || renderWidth <= 0) return;
    let active = true;
    doc
      .renderPage(index, renderWidth)
      .then((page) => {
        if (active) setRendered({ doc, index, page });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [doc, index, renderWidth]);

  // Never show the previous page's pixels as the new page's content.
  return rendered && rendered.doc === doc && rendered.index === index ? rendered.page : null;
}
