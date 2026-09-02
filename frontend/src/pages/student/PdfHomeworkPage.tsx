import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { Homework } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import { toErrorMessage } from '../../lib/errors';

type Tool = 'pen' | 'eraser';
type TouchPoint = { x: number; y: number };
type MobileView = { scale: number; x: number; y: number };

export function PdfHomeworkPage() {
  const { homeworkId = '' } = useParams();
  const { language, t } = useI18n();
  const [homework, setHomework] = useState<Homework | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageUrls, setPageUrls] = useState<Record<number, string>>({});
  const [drawings, setDrawings] = useState<Record<number, string>>({});
  const [tool, setTool] = useState<Tool>('pen');
  const [desktopZoom, setDesktopZoom] = useState(100);
  const [desktopControls, setDesktopControls] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const media = window.matchMedia('(pointer: fine)');
    const update = () => setDesktopControls(media.matches);
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);

  useEffect(() => {
    api.study.homeworks()
      .then((items) => setHomework(items.find((item) => item.id === homeworkId) ?? null))
      .catch((e) => setError(toErrorMessage(e, t)));
  }, [homeworkId, t]);

  useEffect(() => {
    if (!homework?.hasWorksheet || pageUrls[pageIndex]) return;
    let cancelled = false;
    api.study.worksheetPageDataUrl(homeworkId, pageIndex)
      .then((dataUrl) => {
        if (!cancelled) setPageUrls((current) => ({ ...current, [pageIndex]: dataUrl.trim() }));
      })
      .catch((e) => setError(toErrorMessage(e, t)));
    return () => { cancelled = true; };
  }, [homework, homeworkId, pageIndex, pageUrls, t]);

  const pageCount = homework?.worksheetPageCount ?? 0;
  const pageUrl = pageUrls[pageIndex];
  const submittedText = useMemo(() => {
    if (!homework?.submittedAt) return null;
    return new Intl.DateTimeFormat(language === 'DE' ? 'de-DE' : 'ru-RU', {
      dateStyle: 'medium', timeStyle: 'short',
    }).format(new Date(homework.submittedAt));
  }, [homework?.submittedAt, language]);

  async function submitHomework() {
    if (!homework?.hasWorksheet || homework.submitted) return;
    if (!window.confirm(language === 'DE' ? 'Hausaufgabe jetzt abgeben?' : 'Сдать домашнюю работу сейчас?')) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const overlays = Object.entries(drawings).map(([index, imageBase64]) => ({ pageIndex: Number(index), imageBase64 }));
      await api.study.submitPdfHomework(homeworkId, overlays);
      setPageUrls({});
      const updated = (await api.study.homeworks()).find((item) => item.id === homeworkId) ?? null;
      setHomework(updated);
      setMessage(language === 'DE' ? 'Hausaufgabe wurde abgegeben.' : 'Домашняя работа сдана.');
    } catch (e) {
      setError(toErrorMessage(e, t));
    } finally {
      setBusy(false);
    }
  }

  if (!homework) {
    return <div>{error ? <div className="banner banner--error">{error}</div> : t('common.loading')}</div>;
  }

  if (!homework.hasWorksheet) {
    return (
      <div>
        <Link to={`/student/homeworks/${homeworkId}`} className="muted">← {t('common.back')}</Link>
        <div className="panel" style={{ marginTop: 16 }}>
          {language === 'DE' ? 'Für diese Hausaufgabe wurde noch kein PDF hochgeladen.' : 'Для этой домашки PDF пока не загружен.'}
        </div>
      </div>
    );
  }

  const documentWidth = desktopControls ? `${desktopZoom}%` : '100%';

  return (
    <div className="pdf-homework-page">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ minWidth: 0 }}>
          <Link to={`/student/homeworks/${homeworkId}`} className="muted">← {t('common.back')}</Link>
          <h1 style={{ margin: '8px 0 2px' }}>{language === 'DE' ? 'Hausaufgabe' : 'Домашка'}</h1>
          <div className="muted" style={{ overflowWrap: 'anywhere' }}>{homework.worksheetFilename}</div>
        </div>
        {homework.submitted && <span className="pill pill--learned">{language === 'DE' ? 'Abgegeben' : 'Сдано'}</span>}
      </div>

      {error && <div className="banner banner--error">{error}</div>}
      {message && <div className="banner banner--success">{message}</div>}
      {submittedText && (
        <div className="banner banner--info">
          {language === 'DE' ? 'Abgegeben:' : 'Сдано:'} {submittedText}. {language === 'DE' ? 'Die abgegebene Version ist schreibgeschützt.' : 'Сданная версия доступна только для просмотра.'}
        </div>
      )}

      <div className="panel" style={{ position: 'sticky', top: 8, zIndex: 5, marginBottom: 12 }}>
        <div className="row" style={{ alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          {!homework.submitted && (
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className={`btn ${tool === 'pen' ? '' : 'btn--secondary'}`} onClick={() => setTool('pen')}>
                {language === 'DE' ? 'Stift' : 'Ручка'}
              </button>
              <button type="button" className={`btn ${tool === 'eraser' ? '' : 'btn--secondary'}`} onClick={() => setTool('eraser')}>
                {language === 'DE' ? 'Radierer' : 'Ластик'}
              </button>
            </div>
          )}
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <button className="btn btn--secondary" type="button" disabled={pageIndex === 0} onClick={() => setPageIndex((p) => p - 1)}>←</button>
            <strong>{pageIndex + 1} / {pageCount}</strong>
            <button className="btn btn--secondary" type="button" disabled={pageIndex >= pageCount - 1} onClick={() => setPageIndex((p) => p + 1)}>→</button>
          </div>
        </div>
      </div>

      {!pageUrl ? (
        <div className="panel">{t('common.loading')}</div>
      ) : homework.submitted ? (
        <div style={{ position: 'relative', overflow: desktopControls ? 'auto' : 'visible', width: '100%' }}>
          {desktopControls && <DesktopZoomControls zoom={desktopZoom} onChange={setDesktopZoom} />}
          <div style={{ width: documentWidth, maxWidth: desktopControls ? 1500 : 1000, margin: '0 auto', background: '#fff' }}>
            <img src={pageUrl} alt="Submitted homework PDF page" style={{ display: 'block', width: '100%', height: 'auto' }} />
          </div>
        </div>
      ) : (
        <WorksheetCanvas
          key={pageIndex}
          pageUrl={pageUrl}
          initialDrawing={drawings[pageIndex]}
          tool={tool}
          language={language}
          desktopControls={desktopControls}
          desktopZoom={desktopZoom}
          onDesktopZoomChange={setDesktopZoom}
          onChange={(dataUrl) => setDrawings((current) => ({ ...current, [pageIndex]: dataUrl }))}
        />
      )}

      {!homework.submitted && (
        <div className="panel" style={{ marginTop: 12 }}>
          <button className="btn btn--block" type="button" onClick={submitHomework} disabled={busy}>
            {busy ? (language === 'DE' ? 'Wird abgegeben…' : 'Сохраняем…') : (language === 'DE' ? 'Hausaufgabe abgeben' : 'Сдать домашку')}
          </button>
          <p className="muted" style={{ marginBottom: 0, fontSize: 13 }}>
            {language === 'DE'
              ? 'Apple Pencil schreibt. Mit zwei Fingern kannst du das Blatt verschieben und zoomen.'
              : 'Apple Pencil пишет. Двумя пальцами можно двигать и приближать лист.'}
          </p>
        </div>
      )}
    </div>
  );
}

function DesktopZoomControls({ zoom, onChange }: { zoom: number; onChange: (value: number) => void }) {
  return (
    <div aria-label="Масштаб документа" style={{ position: 'absolute', right: 12, top: 12, zIndex: 4, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <button className="btn btn--secondary" type="button" onClick={() => onChange(Math.min(200, zoom + 20))} disabled={zoom >= 200}>+</button>
      <button className="btn btn--secondary" type="button" onClick={() => onChange(Math.max(60, zoom - 20))} disabled={zoom <= 60}>−</button>
    </div>
  );
}

function WorksheetCanvas({ pageUrl, initialDrawing, tool, language, desktopControls, desktopZoom, onDesktopZoomChange, onChange }: {
  pageUrl: string;
  initialDrawing?: string;
  tool: Tool;
  language: 'DE' | 'RU';
  desktopControls: boolean;
  desktopZoom: number;
  onDesktopZoomChange: (value: number) => void;
  onChange: (dataUrl: string) => void;
}) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingPointerIdRef = useRef<number | null>(null);
  const historyRef = useRef<string[]>([]);
  const touchesRef = useRef<Map<number, TouchPoint>>(new Map());
  const gestureStartRef = useRef<{ distance: number; center: TouchPoint; view: MobileView } | null>(null);
  const scrollLockRef = useRef<{ y: number; bodyStyle: string; htmlOverflow: string } | null>(null);
  const [ready, setReady] = useState(false);
  const [undoCount, setUndoCount] = useState(0);
  const [mobileView, setMobileView] = useState<MobileView>({ scale: 1, x: 0, y: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const blockTouch = (event: TouchEvent) => event.preventDefault();
    canvas.addEventListener('touchstart', blockTouch, { passive: false });
    canvas.addEventListener('touchmove', blockTouch, { passive: false });
    canvas.addEventListener('touchend', blockTouch, { passive: false });
    canvas.addEventListener('touchcancel', blockTouch, { passive: false });
    return () => {
      canvas.removeEventListener('touchstart', blockTouch);
      canvas.removeEventListener('touchmove', blockTouch);
      canvas.removeEventListener('touchend', blockTouch);
      canvas.removeEventListener('touchcancel', blockTouch);
      unlockPageScroll();
    };
  }, []);

  function lockPageScroll() {
    if (scrollLockRef.current) return;
    const y = window.scrollY;
    scrollLockRef.current = {
      y,
      bodyStyle: document.body.getAttribute('style') ?? '',
      htmlOverflow: document.documentElement.style.overflow,
    };
    document.documentElement.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.top = `-${y}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.width = '100%';
    document.body.style.overflow = 'hidden';
  }

  function unlockPageScroll() {
    const lock = scrollLockRef.current;
    if (!lock) return;
    document.documentElement.style.overflow = lock.htmlOverflow;
    if (lock.bodyStyle) document.body.setAttribute('style', lock.bodyStyle);
    else document.body.removeAttribute('style');
    scrollLockRef.current = null;
    window.scrollTo(0, lock.y);
  }

  function setupCanvas() {
    const image = imageRef.current;
    const canvas = canvasRef.current;
    if (!image || !canvas || !image.naturalWidth || !image.naturalHeight) return;
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (initialDrawing) {
      const saved = new Image();
      saved.onload = () => ctx.drawImage(saved, 0, 0, canvas.width, canvas.height);
      saved.src = initialDrawing;
    }
    setReady(true);
  }

  function point(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * (canvas.width / rect.width), y: (event.clientY - rect.top) * (canvas.height / rect.height) };
  }

  function pushHistory(canvas: HTMLCanvasElement) {
    historyRef.current.push(canvas.toDataURL('image/png'));
    if (historyRef.current.length > 30) historyRef.current.shift();
    setUndoCount(historyRef.current.length);
  }

  function touchGeometry() {
    const points = Array.from(touchesRef.current.values());
    if (points.length < 2) return null;
    const [a, b] = points;
    return { distance: Math.hypot(b.x - a.x, b.y - a.y), center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  }

  function beginTouch(event: React.PointerEvent<HTMLCanvasElement>) {
    event.preventDefault();
    touchesRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* no-op */ }
    if (touchesRef.current.size === 2) {
      const geometry = touchGeometry();
      if (geometry) gestureStartRef.current = { ...geometry, view: mobileView };
    }
  }

  function moveTouch(event: React.PointerEvent<HTMLCanvasElement>) {
    event.preventDefault();
    if (!touchesRef.current.has(event.pointerId)) return;
    touchesRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (touchesRef.current.size < 2 || !gestureStartRef.current) return;
    const geometry = touchGeometry();
    if (!geometry) return;
    const start = gestureStartRef.current;
    const scale = Math.max(1, Math.min(3, start.view.scale * (geometry.distance / start.distance)));
    setMobileView({ scale, x: start.view.x + (geometry.center.x - start.center.x), y: start.view.y + (geometry.center.y - start.center.y) });
  }

  function endTouch(event: React.PointerEvent<HTMLCanvasElement>) {
    event.preventDefault();
    touchesRef.current.delete(event.pointerId);
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* no-op */ }
    if (touchesRef.current.size < 2) gestureStartRef.current = null;
  }

  function start(event: React.PointerEvent<HTMLCanvasElement>) {
    if (event.pointerType === 'touch') {
      beginTouch(event);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const canvas = canvasRef.current;
    if (!canvas || drawingPointerIdRef.current !== null) return;

    // Read the Pencil coordinate BEFORE fixing the page. On iPad, changing body to
    // position: fixed can move the canvas' bounding rect during pointerdown and used
    // to create a long artificial line at the beginning of every stroke.
    const startPoint = point(event);

    lockPageScroll();
    drawingPointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    pushHistory(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.beginPath();
    ctx.moveTo(startPoint.x, startPoint.y);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = tool === 'eraser' ? 32 : 5;
    ctx.strokeStyle = '#111111';
    ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
  }

  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (event.pointerType === 'touch') {
      moveTouch(event);
      return;
    }
    if (drawingPointerIdRef.current !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const p = point(event);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }

  function finish(event: React.PointerEvent<HTMLCanvasElement>) {
    if (event.pointerType === 'touch') {
      endTouch(event);
      return;
    }
    if (drawingPointerIdRef.current !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    drawingPointerIdRef.current = null;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* no-op */ }
    const canvas = canvasRef.current;
    if (canvas) onChange(canvas.toDataURL('image/png'));
    unlockPageScroll();
  }

  function restore(dataUrl: string) {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      onChange(canvas.toDataURL('image/png'));
    };
    img.src = dataUrl;
  }

  function undo() {
    const previous = historyRef.current.pop();
    setUndoCount(historyRef.current.length);
    if (previous) restore(previous);
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    pushHistory(canvas);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    onChange(canvas.toDataURL('image/png'));
  }

  const documentWidth = desktopControls ? `${desktopZoom}%` : '100%';
  const mobileTransform = desktopControls ? undefined : `translate(${mobileView.x}px, ${mobileView.y}px) scale(${mobileView.scale})`;

  return (
    <div>
      <div className="row" style={{ gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <button className="btn btn--secondary" type="button" onClick={undo} disabled={undoCount === 0}>{language === 'DE' ? 'Rückgängig' : '↶ Шаг назад'}</button>
        <button className="btn btn--ghost" type="button" onClick={clear}>{language === 'DE' ? 'Seite löschen' : 'Очистить страницу'}</button>
      </div>

      <div style={{ position: 'relative', overflow: 'hidden', width: '100%', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'none' }}>
        {desktopControls && <DesktopZoomControls zoom={desktopZoom} onChange={onDesktopZoomChange} />}
        <div style={{ position: 'relative', width: documentWidth, maxWidth: desktopControls ? 1500 : 1000, margin: '0 auto', boxShadow: '0 2px 14px rgba(0,0,0,.12)', background: '#fff', transform: mobileTransform, transformOrigin: 'center center' }}>
          <img ref={imageRef} src={pageUrl} alt="Homework PDF page" onLoad={setupCanvas} style={{ display: 'block', width: '100%', height: 'auto', userSelect: 'none', WebkitUserSelect: 'none' }} draggable={false} />
          <canvas
            ref={canvasRef}
            onPointerDown={start}
            onPointerMove={move}
            onPointerUp={finish}
            onPointerCancel={finish}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none', cursor: tool === 'eraser' ? 'cell' : 'crosshair', opacity: ready ? 1 : 0 }}
          />
        </div>
      </div>
    </div>
  );
}
