import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { onlineClassesApi, type OnlineClassHomework } from '../../api/onlineClasses';
import { useI18n } from '../../i18n/I18nContext';
import { usePdf, usePdfPage } from './usePdf';

/** Compact Goodnotes-like assignment drawer, opened by one toolbar icon. */
export function HomeworkDrawer({ classId, onClose }: { classId: string; onClose: () => void }) {
  const { language } = useI18n();
  const de = language === 'DE';
  const [homework, setHomework] = useState<OnlineClassHomework | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [pageIndex, setPageIndex] = useState(0);
  const [width, setWidth] = useState(300);
  const pageArea = useRef<HTMLDivElement | null>(null);
  const pdfCanvas = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let active = true;
    onlineClassesApi.homework(classId).then((result) => {
      if (!active) return;
      setHomework(result);
      setStatus('ready');
    }).catch(() => { if (active) setStatus('error'); });
    return () => { active = false; };
  }, [classId]);

  useEffect(() => {
    if (status !== 'ready' || !homework?.hasDocument) return;
    const element = pageArea.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setWidth(w);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [status, homework?.hasDocument]);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [onClose]);

  // Participants access only the existing authorized classroom workbook API;
  // private answer keys stay behind the separate teacher-only route.
  const pdf = usePdf(status === 'ready' && homework?.hasDocument ? classId : null, async () => {
    const bytes = await onlineClassesApi.documentBytes(classId);
    if (!bytes) throw new Error('No worksheet');
    return bytes;
  });
  const doc = pdf.status === 'ready' ? pdf.doc : null;
  const current = Math.min(pageIndex, Math.max(0, (doc?.pageCount ?? 1) - 1));
  const page = usePdfPage(doc, current, width);

  useLayoutEffect(() => {
    const canvas = pdfCanvas.current;
    if (!canvas || !page) return;
    canvas.width = page.canvas.width;
    canvas.height = page.canvas.height;
    canvas.getContext('2d')?.drawImage(page.canvas, 0, 0);
  }, [page]);

  return (
    <aside id="classroom-homework-panel" className="classroom-homework"
      aria-label={de ? 'Hausaufgaben' : 'Домашнее задание'}>
      <header className="classroom-homework__header">
        <strong>{de ? 'Hausaufgaben' : 'Домашнее задание'}</strong>
        <button type="button" className="classroom-homework__close" onClick={onClose}
          aria-label={de ? 'Hausaufgaben schließen' : 'Закрыть домашнее задание'}>×</button>
      </header>
      <div className="classroom-homework__body">
        {status === 'loading' && <p role="status">{de ? 'Wird geladen…' : 'Загрузка…'}</p>}
        {status === 'error' && <p role="alert">{de ? 'Fehler beim Laden.' : 'Не удалось загрузить домашнее задание.'}</p>}
        {status === 'ready' && (
          <>
            {homework?.notes?.trim() && <div className="classroom-homework__notes">{homework.notes}</div>}
            {homework?.hasDocument && (
              <section className="classroom-homework__document" aria-label={de ? 'Aufgabenblatt' : 'Документ домашнего задания'}>
                {homework?.notes?.trim() && <h3>{de ? 'Dokument' : 'Документ'}</h3>}
                {pdf.status === 'loading' && <p role="status">{de ? 'PDF wird geladen…' : 'Загрузка PDF…'}</p>}
                {pdf.status === 'error' && <p role="alert">{de ? 'PDF konnte nicht geladen werden.' : 'Не удалось открыть PDF.'}</p>}
                <div ref={pageArea} className="classroom-homework__page-area">
                  {page && <canvas ref={pdfCanvas} className="classroom-homework__page"
                    aria-label={de ? `Seite ${current + 1}` : `Страница ${current + 1}`} />}
                </div>
              </section>
            )}
            {!homework?.notes?.trim() && !homework?.hasDocument &&
              <p className="classroom-homework__empty">{de ? 'Noch keine Hausaufgaben.' : 'Домашнее задание пока не добавлено.'}</p>}
          </>
        )}
      </div>
      {doc && doc.pageCount > 1 && (
        <nav className="classroom-homework__pagination" aria-label={de ? 'Dokumentseiten' : 'Страницы документа'}>
          <button type="button" onClick={() => setPageIndex((v) => Math.max(0, v - 1))}
            disabled={current === 0} aria-label={de ? 'Vorherige Seite' : 'Предыдущая страница'}>‹</button>
          <span>{current + 1} / {doc.pageCount}</span>
          <button type="button" onClick={() => setPageIndex((v) => Math.min(doc.pageCount - 1, v + 1))}
            disabled={current === doc.pageCount - 1} aria-label={de ? 'Nächste Seite' : 'Следующая страница'}>›</button>
        </nav>
      )}
    </aside>
  );
}
