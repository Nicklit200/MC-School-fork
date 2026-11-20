import { useEffect, useRef, useState } from 'react';
import { openPdf, type PdfDoc } from '../../features/online-classes/pdfDocument';

/**
 * iPad Safari often leaves an iframe pointing to a blob: PDF completely blank.
 * Render the authenticated, already-downloaded file with the same pdf.js worker
 * used on the online lesson board. No public URL or second backend request.
 */
export function PostLessonHomeworkPdfCanvas({ blob }: { blob: Blob }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<PdfDoc | null>(null);
  const [page, setPage] = useState(0);
  const [width, setWidth] = useState(720);
  const [zoom, setZoom] = useState(1);
  const [loading, setLoading] = useState(true);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    let opened: PdfDoc | null = null;
    setPdf(null);
    setPage(0);
    setZoom(1);
    setError('');
    setLoading(true);
    void blob.arrayBuffer()
      .then(bytes => openPdf(bytes))
      .then(document => {
        if (!active) { document.destroy(); return; }
        opened = document;
        setPdf(document);
      })
      .catch(() => { if (active) setError('Не удалось отобразить PDF. Попробуйте скачать файл.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => {
      active = false;
      opened?.destroy();
    };
  }, [blob]);

  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const measure = () => setWidth(Math.max(220, Math.round(scroll.clientWidth - 32)));
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(measure);
      observer.observe(scroll);
      return () => observer.disconnect();
    }
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  useEffect(() => {
    const host = pageRef.current;
    if (!pdf || !host) return;
    let active = true;
    setRendering(true);
    setError('');
    host.replaceChildren();
    const targetWidth = Math.max(220, Math.min(1600, Math.round(width * zoom)));
    void pdf.renderPage(page, targetWidth)
      .then(({ canvas }) => {
        if (!active) return;
        canvas.style.width = targetWidth + 'px';
        canvas.style.height = 'auto';
        canvas.style.display = 'block';
        host.replaceChildren(canvas);
        setRendering(false);
      })
      .catch(() => {
        if (!active) return;
        setRendering(false);
        setError('Не удалось нарисовать страницу PDF. Попробуйте скачать файл.');
      });
    return () => { active = false; };
  }, [pdf, page, width, zoom]);

  return (
    <div className="post-review-canvas-viewer">
      {pdf && <div className="post-review-pdf-tools">
        <span>Страницы: {pdf.pageCount}</span>
        <div role="group" aria-label="Масштаб PDF">
          <button type="button" aria-label="Уменьшить PDF" onClick={() => setZoom(v => Math.max(0.7, Math.round((v - 0.25) * 100) / 100))} disabled={zoom <= 0.7}>−</button>
          <button type="button" aria-label="Подогнать PDF" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
          <button type="button" aria-label="Увеличить PDF" onClick={() => setZoom(v => Math.min(2, Math.round((v + 0.25) * 100) / 100))} disabled={zoom >= 2}>+</button>
        </div>
        {pdf.pageCount > 1 && <div role="group" aria-label="Страницы PDF">
          <button type="button" onClick={() => setPage(v => Math.max(0, v - 1))} disabled={page === 0}>←</button>
          <span>{page + 1} / {pdf.pageCount}</span>
          <button type="button" onClick={() => setPage(v => Math.min(pdf.pageCount - 1, v + 1))} disabled={page === pdf.pageCount - 1}>→</button>
        </div>}
      </div>}
      <div ref={scrollRef} className="post-review-pdf-scroll">
        <div ref={pageRef} className="post-review-pdf-page" data-testid="homework-pdf-page" aria-label="Страница PDF" />
        {(loading || rendering) && !error && <p className="post-review-pdf-loading" role="status">Отображаем PDF…</p>}
        {error && <p className="post-review-pdf-loading" role="alert">{error}</p>}
      </div>
    </div>
  );
}
