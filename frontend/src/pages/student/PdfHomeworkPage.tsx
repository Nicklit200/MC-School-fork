import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { Homework } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import { toErrorMessage } from '../../lib/errors';

type Tool = 'pen' | 'eraser';

type TouchPoint = { x: number; y: number };

export function PdfHomeworkPage() {
  const { homeworkId = '' } = useParams();
  const { language, t } = useI18n();
  const [homework, setHomework] = useState<Homework | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageUrls, setPageUrls] = useState<Record<number, string>>({});
  const [drawings, setDrawings] = useState<Record<number, string>>({});
  const [tool, setTool] = useState<Tool>('pen');
  const [zoom, setZoom] = useState(140);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

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

  return (
    <div className="pdf-homework-page" style={{ maxWidth: 1500, margin: '0 auto' }}>
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
          {language === 'DE' ? 'Abgegeben:' : 'Сдано:'} {submittedText}. {language === 'DE' ? 'Die abgegebene Version ist schreibgeschützt.' : 'Сейчас показывается сохранённая версия PDF, редактирование закрыто.'}
        </div>
      )}

      <div className="panel" style={{ position: 'sticky', top: 8, zIndex: 5, marginBottom: 12, padding: 12 }}>
        <div className="row" style={{ alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          {!homework.submitted && (
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className={`btn ${tool === 'pen' ? '' : 'btn--secondary'}`} onClick={() => setTool('pen')}>
                {language === 'DE' ? 'Stift' : 'Ручка'}
              </button>
              <button type="button" className={`btn ${tool === 'eraser' ? '' : 'btn--secondary'}`} onClick={() => setTool('eraser')}>
                {language === 'DE' ? 'Radierer' : 'Ластик'}
              </button>
            </div>
          )}

          <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn--secondary" type="button" onClick={() => setZoom((z) => Math.max(80, z - 20))} disabled={zoom <= 80}>−</button>
            <strong style={{ minWidth: 56, textAlign: 'center' }}>{Math.round(zoom)}%</strong>
            <button className="btn btn--secondary" type="button" onClick={() => setZoom((z) => Math.min(240, z + 20))} disabled={zoom >= 240}>+</button>
            <button className="btn btn--ghost" type="button" onClick={() => setZoom(140)}>
              {language === 'DE' ? 'Standard' : 'Обычный'}
            </button>
          </div>

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
        <div style={{ overflow: 'auto', width: '100%', WebkitOverflowScrolling: 'touch' }}>
          <div style={{ width: `${zoom}%`, minWidth: zoom > 100 ? 720 : undefined, margin: '0 auto', background: '#fff' }}>
            <img src={pageUrl} alt="Submitted homework PDF page" style={{ display: 'block', width: '100%', height: 'auto' }} />
          </div>
        </div>
      ) : (
        <WorksheetCanvas
          key={pageIndex}
          pageUrl={pageUrl}
          initialDrawing={drawings[pageIndex]}
          tool={tool}
          zoom={zoom}
          language={language}
          onZoomChange={setZoom}
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
              ? 'Mit Apple Pencil schreiben. Mit zwei Fingern zoomen.'
              : 'Пиши Apple Pencil. Двумя пальцами можно приближать и отдалять — пальцы не рисуют.'}
          </p>
        </div>
      )}
    </div>
  );
}

function WorksheetCanvas({ pageUrl, initialDrawing, tool, zoom, language, onZoomChange, onChange }: {
  pageUrl: string;
  initialDrawing?: string;
  tool: Tool;
  zoom: number;
  language: 'DE' | 'RU';
  onZoomChange: (zoom: number) => void;
  onChange: (dataUrl: string) => void;
}) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingPointerIdRef = useRef<number | null>(null);
  const historyRef = useRef<string[]>([]);
  const touchPointsRef = useRef<Map<number, TouchPoint>>(new Map());
  const pinchStartDistanceRef = useRef<number | null>(null);
  const pinchStartZoomRef = useRef(zoom);
  const [ready, setReady] = useState(false);
  const [undoCount, setUndoCount] = useState(0);

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
    return {
      x: (event.clientX - rect.left) * (canvas.width / rect.width),
      y: (event.clientY - rect.top) * (canvas.height / rect.height),
    };
  }

  function distanceBetweenTouches() {
    const values = Array.from(touchPointsRef.current.values());
    if (values.length < 2) return null;
    const [a, b] = values;
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  function pushHistory(canvas: HTMLCanvasElement) {
    historyRef.current.push(canvas.toDataURL('image/png'));
    if (historyRef.current.length > 30) historyRef.current.shift();
    setUndoCount(historyRef.current.length);
  }

  function start(event: React.PointerEvent<HTMLCanvasElement>) {
    if (event.pointerType === 'touch') {
      touchPointsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touchPointsRef.current.size === 2) {
        pinchStartDistanceRef.current = distanceBetweenTouches();
        pinchStartZoomRef.current = zoom;
      }
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas || drawingPointerIdRef.current !== null) return;
    drawingPointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    pushHistory(canvas);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const p = point(event);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = tool === 'eraser' ? 32 : 5;
    ctx.strokeStyle = '#111111';
    ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
  }

  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (event.pointerType === 'touch') {
      if (!touchPointsRef.current.has(event.pointerId)) return;
      touchPointsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touchPointsRef.current.size >= 2 && pinchStartDistanceRef.current) {
        const currentDistance = distanceBetweenTouches();
        if (currentDistance) {
          const scale = currentDistance / pinchStartDistanceRef.current;
          const nextZoom = Math.max(80, Math.min(240, pinchStartZoomRef.current * scale));
          onZoomChange(nextZoom);
        }
      }
      return;
    }

    if (drawingPointerIdRef.current !== event.pointerId) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const p = point(event);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }

  function finish(event: React.PointerEvent<HTMLCanvasElement>) {
    if (event.pointerType === 'touch') {
      touchPointsRef.current.delete(event.pointerId);
      if (touchPointsRef.current.size < 2) {
        pinchStartDistanceRef.current = null;
      }
      return;
    }

    if (drawingPointerIdRef.current !== event.pointerId) return;
    drawingPointerIdRef.current = null;
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

  return (
    <div>
      <div className="row" style={{ gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <button className="btn btn--secondary" type="button" onClick={undo} disabled={undoCount === 0}>
          {language === 'DE' ? 'Einen Schritt zurück' : '↶ Шаг назад'}
        </button>
        <button className="btn btn--ghost" type="button" onClick={clear}>
          {language === 'DE' ? 'Seite löschen' : 'Очистить страницу'}
        </button>
      </div>

      <div style={{ overflow: 'auto', width: '100%', paddingBottom: 8, WebkitOverflowScrolling: 'touch' }}>
        <div
          style={{
            position: 'relative',
            width: `${zoom}%`,
            minWidth: zoom > 100 ? 720 : undefined,
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
            style={{ display: 'block', width: '100%', height: 'auto', userSelect: 'none' }}
            draggable={false}
          />
          <canvas
            ref={canvasRef}
            onPointerDown={start}
            onPointerMove={move}
            onPointerUp={finish}
            onPointerCancel={finish}
            onPointerLeave={(event) => {
              if (event.pointerType === 'touch') finish(event);
            }}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              touchAction: 'none',
              cursor: tool === 'eraser' ? 'cell' : 'crosshair',
              opacity: ready ? 1 : 0,
            }}
          />
        </div>
      </div>
    </div>
  );
}
