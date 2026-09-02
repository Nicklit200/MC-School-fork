import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { Homework } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import { toErrorMessage } from '../../lib/errors';

type Tool = 'pen' | 'eraser';
type ViewportState = {
  scale: number;
  offsetLeft: number;
  offsetTop: number;
  width: number;
  height: number;
};
type StrokeGeometry = {
  left: number;
  top: number;
  width: number;
  height: number;
  canvasWidth: number;
  canvasHeight: number;
};

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
  const [viewport, setViewport] = useState<ViewportState>({
    scale: 1,
    offsetLeft: 0,
    offsetTop: 0,
    width: typeof window === 'undefined' ? 1024 : window.innerWidth,
    height: typeof window === 'undefined' ? 768 : window.innerHeight,
  });
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
    const visual = window.visualViewport;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (visual) {
          setViewport({
            scale: visual.scale || 1,
            offsetLeft: visual.offsetLeft || 0,
            offsetTop: visual.offsetTop || 0,
            width: visual.width || window.innerWidth,
            height: visual.height || window.innerHeight,
          });
        } else {
          setViewport({ scale: 1, offsetLeft: 0, offsetTop: 0, width: window.innerWidth, height: window.innerHeight });
        }
      });
    };

    update();
    visual?.addEventListener('resize', update);
    visual?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => {
      cancelAnimationFrame(frame);
      visual?.removeEventListener('resize', update);
      visual?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
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
  const toolbarScale = desktopControls ? 1 : 1 / Math.max(viewport.scale, 0.5);

  return (
    <div className="pdf-homework-page" style={{ paddingLeft: desktopControls ? 0 : 72 }}>
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

      {desktopControls && (
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
      )}

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
          setTool={setTool}
          language={language}
          desktopControls={desktopControls}
          desktopZoom={desktopZoom}
          viewport={viewport}
          toolbarScale={toolbarScale}
          pageIndex={pageIndex}
          pageCount={pageCount}
          setPageIndex={setPageIndex}
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
              ? 'Apple Pencil schreibt. Mit zwei Fingern zoomst du die Seite; die Werkzeugleiste bleibt links am Bildschirm.'
              : 'Apple Pencil пишет. Двумя пальцами масштабируется страница, а панель инструментов остаётся слева на экране.'}
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

function WorksheetCanvas({ pageUrl, initialDrawing, tool, setTool, language, desktopControls, desktopZoom, viewport, toolbarScale, pageIndex, pageCount, setPageIndex, onDesktopZoomChange, onChange }: {
  pageUrl: string;
  initialDrawing?: string;
  tool: Tool;
  setTool: (tool: Tool) => void;
  language: 'DE' | 'RU';
  desktopControls: boolean;
  desktopZoom: number;
  viewport: ViewportState;
  toolbarScale: number;
  pageIndex: number;
  pageCount: number;
  setPageIndex: (updater: (page: number) => number) => void;
  onDesktopZoomChange: (value: number) => void;
  onChange: (dataUrl: string) => void;
}) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingPointerIdRef = useRef<number | null>(null);
  const strokeGeometryRef = useRef<StrokeGeometry | null>(null);
  const historyRef = useRef<string[]>([]);
  const [ready, setReady] = useState(false);
  const [undoCount, setUndoCount] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const guardTouch = (event: TouchEvent) => {
      if (event.touches.length < 2) event.preventDefault();
    };

    canvas.addEventListener('touchstart', guardTouch, { passive: false });
    canvas.addEventListener('touchmove', guardTouch, { passive: false });
    return () => {
      canvas.removeEventListener('touchstart', guardTouch);
      canvas.removeEventListener('touchmove', guardTouch);
    };
  }, []);

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

  function currentGeometry(canvas: HTMLCanvasElement): StrokeGeometry {
    const rect = canvas.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
    };
  }

  function point(event: React.PointerEvent<HTMLCanvasElement>, geometry?: StrokeGeometry | null) {
    const canvas = canvasRef.current!;
    const g = geometry ?? currentGeometry(canvas);
    return {
      x: (event.clientX - g.left) * (g.canvasWidth / g.width),
      y: (event.clientY - g.top) * (g.canvasHeight / g.height),
    };
  }

  function pushHistory(canvas: HTMLCanvasElement) {
    historyRef.current.push(canvas.toDataURL('image/png'));
    if (historyRef.current.length > 30) historyRef.current.shift();
    setUndoCount(historyRef.current.length);
  }

  function start(event: React.PointerEvent<HTMLCanvasElement>) {
    if (event.pointerType === 'touch') return;

    event.preventDefault();
    event.stopPropagation();
    const canvas = canvasRef.current;
    if (!canvas || drawingPointerIdRef.current !== null) return;

    const geometry = currentGeometry(canvas);
    strokeGeometryRef.current = geometry;
    const startPoint = point(event, geometry);

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
    if (event.pointerType === 'touch' || drawingPointerIdRef.current !== event.pointerId) return;

    event.preventDefault();
    event.stopPropagation();
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const p = point(event, strokeGeometryRef.current);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }

  function finish(event: React.PointerEvent<HTMLCanvasElement>) {
    if (event.pointerType === 'touch' || drawingPointerIdRef.current !== event.pointerId) return;

    event.preventDefault();
    event.stopPropagation();
    drawingPointerIdRef.current = null;
    strokeGeometryRef.current = null;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* no-op */ }
    const canvas = canvasRef.current;
    if (canvas) onChange(canvas.toDataURL('image/png'));
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
  const railLeft = viewport.offsetLeft + 8;
  const railTop = viewport.offsetTop + viewport.height / 2;

  return (
    <div>
      {!desktopControls && (
        <div
          aria-label={language === 'DE' ? 'Werkzeuge' : 'Инструменты'}
          style={{
            position: 'fixed',
            left: railLeft,
            top: railTop,
            zIndex: 60,
            display: 'flex',
            flexDirection: 'column',
            gap: 7,
            padding: 8,
            borderRadius: 14,
            background: 'rgba(255,255,255,.97)',
            boxShadow: '0 4px 18px rgba(0,0,0,.18)',
            touchAction: 'manipulation',
            transform: `translateY(-50%) scale(${toolbarScale})`,
            transformOrigin: 'left center',
          }}
        >
          <button type="button" className={`btn ${tool === 'pen' ? '' : 'btn--secondary'}`} onClick={() => setTool('pen')} title={language === 'DE' ? 'Stift' : 'Ручка'}>✎</button>
          <button type="button" className={`btn ${tool === 'eraser' ? '' : 'btn--secondary'}`} onClick={() => setTool('eraser')} title={language === 'DE' ? 'Radierer' : 'Ластик'}>⌫</button>
          <div style={{ height: 1, background: 'rgba(0,0,0,.12)' }} />
          <button className="btn btn--secondary" type="button" disabled={pageIndex === 0} onClick={() => setPageIndex((p) => p - 1)} title={language === 'DE' ? 'Vorherige Seite' : 'Предыдущая страница'}>↑</button>
          <div style={{ textAlign: 'center', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>{pageIndex + 1}/{pageCount}</div>
          <button className="btn btn--secondary" type="button" disabled={pageIndex >= pageCount - 1} onClick={() => setPageIndex((p) => p + 1)} title={language === 'DE' ? 'Nächste Seite' : 'Следующая страница'}>↓</button>
          <div style={{ height: 1, background: 'rgba(0,0,0,.12)' }} />
          <button className="btn btn--secondary" type="button" onClick={undo} disabled={undoCount === 0} title={language === 'DE' ? 'Rückgängig' : 'Шаг назад'}>↶</button>
          <button className="btn btn--ghost" type="button" onClick={clear} title={language === 'DE' ? 'Seite löschen' : 'Очистить страницу'}>×</button>
        </div>
      )}

      {desktopControls && (
        <div className="row" style={{ gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
          <button className="btn btn--secondary" type="button" onClick={undo} disabled={undoCount === 0}>
            {language === 'DE' ? 'Rückgängig' : '↶ Шаг назад'}
          </button>
          <button className="btn btn--ghost" type="button" onClick={clear}>
            {language === 'DE' ? 'Seite löschen' : 'Очистить страницу'}
          </button>
        </div>
      )}

      <div style={{ position: 'relative', overflow: desktopControls ? 'auto' : 'visible', width: '100%', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'none' }}>
        {desktopControls && <DesktopZoomControls zoom={desktopZoom} onChange={onDesktopZoomChange} />}
        <div
          style={{
            position: 'relative',
            width: documentWidth,
            maxWidth: desktopControls ? 1500 : 1000,
            margin: '0 auto',
            boxShadow: '0 2px 14px rgba(0,0,0,.12)',
            background: '#fff',
          }}
        >
          <img
            ref={imageRef}
            src={pageUrl}
            alt="Homework PDF page"
            onLoad={setupCanvas}
            style={{ display: 'block', width: '100%', height: 'auto', userSelect: 'none', WebkitUserSelect: 'none' }}
            draggable={false}
          />
          <canvas
            ref={canvasRef}
            onPointerDown={start}
            onPointerMove={move}
            onPointerUp={finish}
            onPointerCancel={finish}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              touchAction: 'pinch-zoom',
              cursor: tool === 'eraser' ? 'cell' : 'crosshair',
              opacity: ready ? 1 : 0,
            }}
          />
        </div>
      </div>
    </div>
  );
}
