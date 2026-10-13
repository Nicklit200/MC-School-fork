import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n/I18nContext';
import { initialPages, nextPage, previousPage } from './boardView';
import { PageNavigator } from './PageNavigator';
import { MAX_ANSWERS_ZOOM, MIN_ANSWERS_ZOOM, type AnswersView } from './useAnswersPanel';
import type { PdfState } from './usePdf';
import { usePdfPage } from './usePdf';

const ZOOM_STEP = 0.25;

/**
 * Fixed-width answers panel pinned to the left, over the board.
 *
 * It floats above the board without resizing it, so the board's page, zoom,
 * tool and marks are untouched by opening or closing. The close "×" sits on the
 * panel's right border. Page, zoom and scroll are owned by the parent so they
 * survive close/reopen.
 */
export function AnswersPanel({
  pdf,
  view,
  getView,
  onViewChange,
  onScroll,
  onClose,
}: {
  pdf: PdfState;
  view: AnswersView;
  getView: () => AnswersView;
  onViewChange: (patch: Partial<AnswersView>) => void;
  onScroll: (top: number, left: number) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [width, setWidth] = useState(0);
  const doc = pdf.status === 'ready' ? pdf.doc : null;

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) setWidth(box.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const page = usePdfPage(doc, view.page, Math.max(1, width * view.zoom));

  // Draw the rendered page into the visible canvas, then put the scroll back
  // where the teacher left it (first paint after a reopen).
  const restored = useRef(false);
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !page) return;
    canvas.width = page.canvas.width;
    canvas.height = page.canvas.height;
    canvas.getContext('2d')?.drawImage(page.canvas, 0, 0);
    const container = scrollRef.current;
    if (!restored.current && container) {
      const saved = getView();
      container.scrollTop = saved.scrollTop;
      container.scrollLeft = saved.scrollLeft;
      // The browser clamps the offset while the page is still shorter than it
      // will be (a sharper render is on its way): keep trying until it sticks.
      restored.current =
        Math.abs(container.scrollTop - saved.scrollTop) < 2 &&
        Math.abs(container.scrollLeft - saved.scrollLeft) < 2;
    }
  }, [page, getView]);

  // A new page starts at its top; the very first paint keeps the restored scroll.
  const shownPage = useRef(view.page);
  useLayoutEffect(() => {
    if (shownPage.current === view.page) return;
    shownPage.current = view.page;
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [view.page]);

  const pages = { ...initialPages(doc?.pageCount ?? 1), current: view.page };

  return (
    <aside id="answers-panel" className="answers-panel" aria-label={t('onlineClass.answers.title')}>
      <button
        type="button"
        className="answers-panel__close"
        onClick={onClose}
        aria-label={t('onlineClass.answers.close')}
      >
        <span aria-hidden="true">×</span>
      </button>

      <div
        ref={scrollRef}
        className="answers-panel__scroll"
        onScroll={(event) => onScroll(event.currentTarget.scrollTop, event.currentTarget.scrollLeft)}
      >
        {pdf.status === 'loading' && <p role="status">{t('onlineClass.answers.loading')}</p>}
        {pdf.status === 'error' && <p role="alert">{t('onlineClass.answers.error')}</p>}
        {doc && (
          <canvas
            ref={canvasRef}
            className="answers-panel__page"
            style={{ width: `${view.zoom * 100}%` }}
            aria-label={t('onlineClass.board.page.current', {
              current: view.page + 1,
              total: doc.pageCount,
            })}
          />
        )}
      </div>

      {doc && (
        <div className="answers-panel__controls">
          <PageNavigator
            current={view.page}
            count={doc.pageCount}
            onPrevious={() => onViewChange({ page: previousPage(pages).current, scrollTop: 0 })}
            onNext={() => onViewChange({ page: nextPage(pages).current, scrollTop: 0 })}
          />
          <span className="answers-panel__zoom">
            <button
              type="button"
              onClick={() => onViewChange({ zoom: Math.max(MIN_ANSWERS_ZOOM, view.zoom - ZOOM_STEP) })}
              disabled={view.zoom <= MIN_ANSWERS_ZOOM}
              aria-label={t('onlineClass.board.zoomOut')}
            >
              −
            </button>
            <button
              type="button"
              onClick={() => onViewChange({ zoom: Math.min(MAX_ANSWERS_ZOOM, view.zoom + ZOOM_STEP) })}
              disabled={view.zoom >= MAX_ANSWERS_ZOOM}
              aria-label={t('onlineClass.board.zoomIn')}
            >
              +
            </button>
          </span>
        </div>
      )}
    </aside>
  );
}
