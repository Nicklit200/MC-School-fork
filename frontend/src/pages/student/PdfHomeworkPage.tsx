import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { Homework } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import { toErrorMessage } from '../../lib/errors';
import { renderHomeworkInkStroke } from '../../lib/homeworkInk';
import { attachTabletInkInput, type TabletInkPoint } from '../../lib/tabletInkInput';

type Tool = 'pen' | 'eraser';
type PenColor = '#111111' | '#2563eb' | '#dc2626' | '#16a34a';
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
type StrokePoint = { x: number; y: number; pressure?: number };
type DrawingStroke = {
  tool: Tool;
  color: PenColor;
  size: number;
  points: StrokePoint[];
  pressureSensitive?: boolean;
};
type PageDrawing = {
  width: number;
  height: number;
  strokes: DrawingStroke[];
};

const PEN_COLORS: Array<{ value: PenColor; labelRu: string; labelDe: string }> = [
  { value: '#2563eb', labelRu: 'Синий', labelDe: 'Blau' },
  { value: '#111111', labelRu: 'Чёрный', labelDe: 'Schwarz' },
  { value: '#dc2626', labelRu: 'Красный', labelDe: 'Rot' },
  { value: '#16a34a', labelRu: 'Зелёный', labelDe: 'Grün' },
];

const PEN_SIZES = [3, 5, 8, 12];

export function PdfHomeworkPage({ onSubmitted }: { onSubmitted?: () => void } = {}) {
  const { homeworkId = '' } = useParams();
  const { language, t } = useI18n();
  const [homework, setHomework] = useState<Homework | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageUrls, setPageUrls] = useState<Record<number, string>>({});
  const drawingsRef = useRef<Record<number, PageDrawing>>({});
  const [tool, setTool] = useState<Tool>('pen');
  const [touchDrawingEnabled, setTouchDrawingEnabled] = useState(() =>
    typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)
  );
  const [penColor, setPenColor] = useState<PenColor>('#2563eb');
  const [penSize, setPenSize] = useState(5);
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
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      const overlays: Array<{ pageIndex: number; imageBase64: string }> = [];
      for (const [index, drawing] of Object.entries(drawingsRef.current)) {
        if (drawing.strokes.length === 0) continue;
        overlays.push({
          pageIndex: Number(index),
          imageBase64: await pageDrawingToDataUrl(drawing),
        });
      }
      await api.study.submitPdfHomework(homeworkId, overlays);
      setPageUrls({});
      const updated = (await api.study.homeworks()).find((item) => item.id === homeworkId) ?? null;
      setHomework(updated);
      onSubmitted?.();
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
          <div className="row" style={{ alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            {!homework.submitted && (
              <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <button type="button" className={tool === 'pen' ? 'is-active' : undefined} onClick={() => setTool('pen')}>
                  {language === 'DE' ? 'Stift' : 'Ручка'}
                </button>
                <button type="button" className={tool === 'eraser' ? 'is-active' : undefined} onClick={() => setTool('eraser')}>
                  {language === 'DE' ? 'Radierer' : 'Ластик'}
                </button>
                <button
                  type="button"
                  className={touchDrawingEnabled ? 'is-active' : undefined}
                  onClick={() => setTouchDrawingEnabled(!touchDrawingEnabled)}
                  title={language === 'DE' ? 'Für Android-Stifte, die als Touch erkannt werden' : 'Для Android-стилусов, которые определяются как касание'}
                >
                  {language === 'DE' ? 'Android/Finger' : 'Android/палец'}
                </button>
                <ColorPicker language={language} value={penColor} onChange={(color) => { setPenColor(color); setTool('pen'); }} />
                <SizePicker language={language} value={penSize} onChange={(size) => { setPenSize(size); setTool('pen'); }} />
              </div>
            )}
            <div className="row" style={{ gap: 8, alignItems: 'center' }}>
              <button className="btn btn--secondary" type="button" disabled={pageIndex === 0} onClick={() => setPageIndex((p) => p - 1)}>←</button>
              <strong>{pageIndex + 1} / {pageCount}</strong>
              <button type="button" disabled={pageIndex >= pageCount - 1} onClick={() => setPageIndex((p) => p + 1)}>→</button>
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
          initialDrawing={drawingsRef.current[pageIndex]}
          tool={tool}
          setTool={setTool}
          touchDrawingEnabled={touchDrawingEnabled}
          setTouchDrawingEnabled={setTouchDrawingEnabled}
          penColor={penColor}
          setPenColor={setPenColor}
          penSize={penSize}
          setPenSize={setPenSize}
          language={language}
          desktopControls={desktopControls}
          desktopZoom={desktopZoom}
          viewport={viewport}
          toolbarScale={toolbarScale}
          pageIndex={pageIndex}
          pageCount={pageCount}
          setPageIndex={setPageIndex}
          onDesktopZoomChange={setDesktopZoom}
          onChange={(drawing) => { drawingsRef.current[pageIndex] = drawing; }}
        />
      )}

      {!homework.submitted && (
        <div className="panel" style={{ marginTop: 12 }}>
          <button className="btn btn--block" type="button" onClick={submitHomework} disabled={busy}>
            {busy ? (language === 'DE' ? 'Wird abgegeben…' : 'Сохраняем…') : (language === 'DE' ? 'Hausaufgabe abgeben' : 'Сдать домашку')}
          </button>
          <p className="muted" style={{ marginBottom: 0, fontSize: 13 }}>
            {language === 'DE'
              ? 'Apple Pencil oder Android-Stift schreibt. Auf Android kann Einfinger-Schreiben aktiviert werden; mit zwei Fingern zoomst und verschiebst du die Seite.'
              : 'Apple Pencil и Android-стилус пишут прямо по листу. На Android можно включить режим «1 палец/стилус пишет», а двумя пальцами двигать и масштабировать страницу.'}
          </p>
        </div>
      )}
    </div>
  );
}

function ColorPicker({ language, value, onChange }: { language: 'DE' | 'RU'; value: PenColor; onChange: (value: PenColor) => void }) {
  return (
    <div className="row" style={{ gap: 6, alignItems: 'center' }} aria-label={language === 'DE' ? 'Stiftfarbe' : 'Цвет ручки'}>
      {PEN_COLORS.map((color) => (
        <button
          key={color.value}
          type="button"
          onClick={() => onChange(color.value)}
          title={language === 'DE' ? color.labelDe : color.labelRu}
          aria-label={language === 'DE' ? color.labelDe : color.labelRu}
          style={{
            width: 30,
            height: 30,
            borderRadius: '50%',
            background: color.value,
            border: value === color.value ? '3px solid #fff' : '2px solid rgba(0,0,0,.18)',
            boxShadow: value === color.value ? '0 0 0 2px #111827' : 'none',
            cursor: 'pointer',
            padding: 0,
          }}
        />
      ))}
    </div>
  );
}

function SizePicker({ language, value, onChange }: { language: 'DE' | 'RU'; value: number; onChange: (value: number) => void }) {
  return (
    <div className="row" style={{ gap: 5, alignItems: 'center' }} aria-label={language === 'DE' ? 'Stiftbreite' : 'Размер кисти'}>
      {PEN_SIZES.map((size) => (
        <button
          key={size}
          type="button"
          className={`btn ${value === size ? '' : 'btn--secondary'}`}
          onClick={() => onChange(size)}
          title={`${language === 'DE' ? 'Breite' : 'Толщина'}: ${size}`}
          style={{ minWidth: 38, padding: '6px 8px' }}
        >
          <span style={{ display: 'inline-block', width: 20, height: Math.max(2, size / 2), borderRadius: 999, background: 'currentColor', verticalAlign: 'middle' }} />
        </button>
      ))}
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

function redrawStrokes(ctx: CanvasRenderingContext2D, width: number, height: number, strokes: DrawingStroke[]) {
  ctx.clearRect(0, 0, width, height);
  for (const stroke of strokes) renderHomeworkInkStroke(ctx, stroke);
}

async function pageDrawingToDataUrl(drawing: PageDrawing): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = drawing.width;
  canvas.height = drawing.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not prepare homework drawing');
  redrawStrokes(ctx, canvas.width, canvas.height, drawing.strokes);

  return new Promise<string>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Could not encode homework drawing'));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error ?? new Error('Could not read homework drawing'));
      reader.readAsDataURL(blob);
    }, 'image/png');
  });
}

function WorksheetCanvas({ pageUrl, initialDrawing, tool, setTool, touchDrawingEnabled, setTouchDrawingEnabled, penColor, setPenColor, penSize, setPenSize, language, desktopControls, desktopZoom, viewport, toolbarScale, pageIndex, pageCount, setPageIndex, onDesktopZoomChange, onChange }: {
  pageUrl: string;
  initialDrawing?: PageDrawing;
  tool: Tool;
  setTool: (tool: Tool) => void;
  touchDrawingEnabled: boolean;
  setTouchDrawingEnabled: (enabled: boolean) => void;
  penColor: PenColor;
  setPenColor: (color: PenColor) => void;
  penSize: number;
  setPenSize: (size: number) => void;
  language: 'DE' | 'RU';
  desktopControls: boolean;
  desktopZoom: number;
  viewport: ViewportState;
  toolbarScale: number;
  pageIndex: number;
  pageCount: number;
  setPageIndex: (updater: (page: number) => number) => void;
  onDesktopZoomChange: (value: number) => void;
  onChange: (drawing: PageDrawing) => void;
}) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingPointerIdRef = useRef<number | null>(null);
  const drawingPointerTypeRef = useRef<string | null>(null);
  const previewFrameRef = useRef<number | null>(null);
  const activeTouchPointersRef = useRef<Set<number>>(new Set());
  const strokeGeometryRef = useRef<StrokeGeometry | null>(null);
  const strokesRef = useRef<DrawingStroke[]>(initialDrawing?.strokes.map((stroke) => ({
    ...stroke,
    points: stroke.points.map((point) => ({ ...point })),
  })) ?? []);
  const activeStrokeRef = useRef<DrawingStroke | null>(null);
  const [ready, setReady] = useState(false);
  const [undoCount, setUndoCount] = useState(strokesRef.current.length);
  const universalInputRef = useRef(false);
  const latestInkSettingsRef = useRef({ tool, penColor, penSize, touchDrawingEnabled, ready });
  latestInkSettingsRef.current = { tool, penColor, penSize, touchDrawingEnabled, ready };

  // Installed once per PDF page. Settings change via refs, without reattaching
  // listeners or postponing the next Pencil/Android stylus stroke.
  useEffect(() => {
    const surface = previewCanvasRef.current;
    if (!surface) return;
    const controller = attachTabletInkInput(surface, {
      onStart(point, meta) {
        const canvas = canvasRef.current;
        const settings = latestInkSettingsRef.current;
        if (!canvas || !settings.ready) return;
        if (activeStrokeRef.current) resetActiveStroke(true);
        const geometry = currentGeometry(canvas);
        if (geometry.width <= 0 || geometry.height <= 0) return;
        const first = pointFromClient(point, geometry);
        strokeGeometryRef.current = geometry;
        activeStrokeRef.current = {
          tool: settings.tool,
          color: settings.penColor,
          size: settings.penSize * geometry.canvasWidth / geometry.width,
          points: [{ ...first, pressure: point.pressure }],
          pressureSensitive: meta.device === 'pen',
        };
        if (settings.tool === 'eraser') drawTemporaryEraser(first, first, activeStrokeRef.current);
        else repaintActiveStroke();
      },
      onMove(point) {
        const geometry = strokeGeometryRef.current;
        const stroke = activeStrokeRef.current;
        if (!geometry || !stroke) return;
        const next = pointFromClient(point, geometry);
        const last = stroke.points[stroke.points.length - 1];
        if (last && Math.hypot(last.x - next.x, last.y - next.y) < 0.4) return;
        stroke.points.push({ ...next, pressure: point.pressure });
        if (last && stroke.tool === 'eraser') drawTemporaryEraser(last, next, stroke);
        else schedulePenPreview();
      },
      onEnd(point, meta, cancelled) {
        const geometry = strokeGeometryRef.current;
        const stroke = activeStrokeRef.current;
        if (!geometry || !stroke) return;
        const next = pointFromClient(point, geometry);
        const last = stroke.points[stroke.points.length - 1];
        if (!last || Math.hypot(last.x - next.x, last.y - next.y) > 0.4) {
          stroke.points.push({ ...next, pressure: point.pressure });
        }
        resetActiveStroke(!cancelled || meta.device !== 'finger');
      },
    }, {
      allowFinger: () => latestInkSettingsRef.current.touchDrawingEnabled,
      nativeFingerNavigation: true,
    });
    universalInputRef.current = true;
    return () => {
      universalInputRef.current = false;
      controller.destroy();
    };
    // The element is keyed by PDF page, while settings update via refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // iOS Safari / Android browsers may drop pointer capture when a system
  // gesture, notification, or tab switch interrupts the pen. Release any
  // abandoned pointer so the next contact can always start a new stroke.
  useEffect(() => {
    const recoverInterruptedInput = () => {
      if (drawingPointerIdRef.current !== null) resetActiveStroke(true);
      activeTouchPointersRef.current.clear();
    };
    const onVisibilityChange = () => {
      if (document.hidden) recoverInterruptedInput();
    };
    window.addEventListener('blur', recoverInterruptedInput);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('blur', recoverInterruptedInput);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (previewFrameRef.current !== null) window.cancelAnimationFrame(previewFrameRef.current);
    };
    // Handlers only depend on refs and onChange for this keyed worksheet page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function emitDrawing() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    onChange({
      width: canvas.width,
      height: canvas.height,
      strokes: strokesRef.current,
    });
  }

  function setupCanvas() {
    const image = imageRef.current;
    const canvas = canvasRef.current;
    if (!image || !canvas || !image.naturalWidth || !image.naturalHeight) return;
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const preview = previewCanvasRef.current;
    if (preview) { preview.width = canvas.width; preview.height = canvas.height; }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    redrawStrokes(ctx, canvas.width, canvas.height, strokesRef.current);
    setUndoCount(strokesRef.current.length);
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

  function pointFromClient(event: Pick<TabletInkPoint, 'clientX' | 'clientY'>, geometry: StrokeGeometry) {
    return {
      x: (event.clientX - geometry.left) * (geometry.canvasWidth / geometry.width),
      y: (event.clientY - geometry.top) * (geometry.canvasHeight / geometry.height),
    };
  }
  function pointFromPointer(event: PointerEvent, geometry: StrokeGeometry) {
    return pointFromClient(event, geometry);
  }

  function cancelPreviewFrame() {
    if (previewFrameRef.current !== null) {
      window.cancelAnimationFrame(previewFrameRef.current);
      previewFrameRef.current = null;
    }
  }

  function repaintActiveStroke() {
    const active = activeStrokeRef.current;
    const preview = previewCanvasRef.current;
    if (!active || !preview || active.tool === 'eraser') return;
    const ctx = preview.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, preview.width, preview.height);
    renderHomeworkInkStroke(ctx, active);
  }

  // Multiple pointermove events can arrive within one display frame.
  // Building the full Perfect Freehand outline every event causes severe
  // latency as a stroke grows; render just once per animation frame.
  function schedulePenPreview() {
    if (previewFrameRef.current !== null) return;
    previewFrameRef.current = window.requestAnimationFrame(() => {
      previewFrameRef.current = null;
      repaintActiveStroke();
    });
  }

  function drawTemporaryEraser(from: StrokePoint, to: StrokePoint, stroke: DrawingStroke) {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const radius = Math.max(24, stroke.size * 5) / 2;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = radius * 2;
    ctx.beginPath();
    if (from.x === to.x && from.y === to.y) {
      ctx.arc(to.x, to.y, radius, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function resetActiveStroke(commit: boolean) {
    cancelPreviewFrame();
    const stroke = activeStrokeRef.current;
    const canvas = canvasRef.current;
    const preview = previewCanvasRef.current;
    const previewCtx = preview?.getContext('2d');
    if (preview && previewCtx) previewCtx.clearRect(0, 0, preview.width, preview.height);
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        if (commit && stroke) {
          // The temporary eraser was drawn incrementally; rebuild the
          // committed layer once, then apply the final smooth outline.
          if (stroke.tool === 'eraser') redrawStrokes(ctx, canvas.width, canvas.height, strokesRef.current);
          renderHomeworkInkStroke(ctx, stroke);
        } else {
          redrawStrokes(ctx, canvas.width, canvas.height, strokesRef.current);
        }
      }
    }
    if (commit && stroke) {
      strokesRef.current = [...strokesRef.current, stroke];
      setUndoCount(strokesRef.current.length);
      emitDrawing();
    }
    activeStrokeRef.current = null;
    drawingPointerIdRef.current = null;
    drawingPointerTypeRef.current = null;
    strokeGeometryRef.current = null;
  }

  function canDrawWithPointer(event: React.PointerEvent<HTMLCanvasElement>) {
    if (event.pointerType !== 'touch') return true;
    if (drawingPointerIdRef.current !== null) return false;
    return touchDrawingEnabled && activeTouchPointersRef.current.size === 1;
  }

  function start(event: React.PointerEvent<HTMLCanvasElement>) {
    if (event.pointerType === 'touch') {
      // Ignore palm/finger input while a real stylus is already writing.
      if (drawingPointerTypeRef.current === 'pen') return;
      // On iPad, fingers navigate the worksheet; only track touch input
      // when the Android/finger drawing mode has been enabled.
      if (!touchDrawingEnabled) return;
      activeTouchPointersRef.current.add(event.pointerId);
      if (activeTouchPointersRef.current.size > 1) {
        if (drawingPointerTypeRef.current === 'touch') resetActiveStroke(false);
        return;
      }
    }

    const canvas = canvasRef.current;
    if (!canvas || !ready) return;
    if (drawingPointerIdRef.current !== null) {
      // A lost pointerup/lostpointercapture must not lock the pen forever.
      // Recover the previous stroke when a new pen/mouse contact begins.
      if (event.pointerType === 'pen' || event.pointerType === 'mouse') {
        resetActiveStroke(true);
      } else {
        return;
      }
    }
    if (!canDrawWithPointer(event)) return;
    event.preventDefault();
    event.stopPropagation();

    const geometry = currentGeometry(canvas);
    if (!geometry.width || !geometry.height) return;
    const first = pointFromPointer(event.nativeEvent, geometry);
    const stroke: DrawingStroke = {
      tool,
      color: penColor,
      size: penSize * geometry.canvasWidth / geometry.width,
      points: [{ ...first, pressure: event.pressure > 0 ? event.pressure : 0.5 }],
      pressureSensitive: event.pointerType === 'pen' && event.pressure > 0,
    };
    strokeGeometryRef.current = geometry;
    activeStrokeRef.current = stroke;
    drawingPointerIdRef.current = event.pointerId;
    drawingPointerTypeRef.current = event.pointerType;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Some Safari versions refuse capture during stylus/touch transitions.
      // The pointerleave / lostcapture handlers still release the session.
    }
    if (tool === 'eraser') drawTemporaryEraser(first, first, stroke);
    else repaintActiveStroke();
  }

  function appendPointerSamples(event: React.PointerEvent<HTMLCanvasElement>) {
    const geometry = strokeGeometryRef.current;
    const stroke = activeStrokeRef.current;
    if (!geometry || !stroke) return;

    const nativeEvent = event.nativeEvent;
    const samples = typeof nativeEvent.getCoalescedEvents === 'function'
      ? nativeEvent.getCoalescedEvents() : [nativeEvent];
    const input = samples.length > 0 ? samples : [nativeEvent];
    const step = 0.4 * geometry.canvasWidth / geometry.width;
    for (const sample of input) {
      const next = pointFromPointer(sample, geometry);
      const last = stroke.points[stroke.points.length - 1];
      if (last && Math.hypot(last.x - next.x, last.y - next.y) < step) continue;
      stroke.points.push({ ...next, pressure: sample.pressure > 0 ? sample.pressure : 0.5 });
      if (last && stroke.tool === 'eraser') drawTemporaryEraser(last, next, stroke);
    }
  }

  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (drawingPointerIdRef.current !== event.pointerId) return;
    if (!activeStrokeRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    appendPointerSamples(event);
    if (activeStrokeRef.current.tool === 'pen') schedulePenPreview();
  }

  function finish(event: React.PointerEvent<HTMLCanvasElement>) {
    if (event.pointerType === 'touch') activeTouchPointersRef.current.delete(event.pointerId);
    if (drawingPointerIdRef.current !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.type === 'pointerup') appendPointerSamples(event);
    // A browser's pointercancel should not silently delete Pencil work.
    // Touch gesture cancellations still discard accidental finger ink.
    resetActiveStroke(event.type === 'pointerup' || drawingPointerTypeRef.current !== 'touch');
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* no-op */ }
  }

  function lostCapture(event: React.PointerEvent<HTMLCanvasElement>) {
    if (event.pointerType === 'touch') activeTouchPointersRef.current.delete(event.pointerId);
    if (drawingPointerIdRef.current !== event.pointerId) return;
    // This was previously unhandled, leaving the canvas permanently locked
    // to an inactive pointerId until the whole page was reloaded.
    resetActiveStroke(drawingPointerTypeRef.current !== 'touch');
  }

  function pointerLeft(event: React.PointerEvent<HTMLCanvasElement>) {
    // Fallback when Safari declines setPointerCapture. Do not terminate
    // normal captured strokes simply because the tip leaves the page bounds.
    if (drawingPointerIdRef.current !== event.pointerId) return;
    const target = event.currentTarget;
    if (!target.hasPointerCapture?.(event.pointerId)) {
      resetActiveStroke(true);
    }
  }

  function undo() {
    if (strokesRef.current.length === 0) return;
    strokesRef.current = strokesRef.current.slice(0, -1);
    setUndoCount(strokesRef.current.length);
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) redrawStrokes(ctx, canvas.width, canvas.height, strokesRef.current);
    emitDrawing();
  }

  function clear() {
    if (strokesRef.current.length === 0) return;
    strokesRef.current = [];
    setUndoCount(0);
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    emitDrawing();
  }

  const documentWidth = desktopControls ? `${desktopZoom}%` : '100%';
  const railLeft = viewport.offsetLeft + 8;
  const railTop = viewport.offsetTop + viewport.height / 2;

  return (
    <div>
      {!desktopControls && (
        <div
          className="homework-island-rail"
          aria-label={language === 'DE' ? 'Werkzeuge' : 'Инструменты'}
          style={{
            left: railLeft,
            top: railTop,
            transform: `translateY(-50%) scale(${toolbarScale})`,
            transformOrigin: 'left center',
          }}
        >
          <div className="homework-island-rail-group">
          <button type="button" className={`btn ${tool === 'pen' ? '' : 'btn--secondary'}`} onClick={() => setTool('pen')} title={language === 'DE' ? 'Stift' : 'Ручка'}>✎</button>
          <button type="button" className={`btn ${tool === 'eraser' ? '' : 'btn--secondary'}`} onClick={() => setTool('eraser')} title={language === 'DE' ? 'Radierer' : 'Ластик'}>⌫</button>
          <button
            type="button"
            className={`btn ${touchDrawingEnabled ? '' : 'btn--secondary'}`}
            onClick={() => setTouchDrawingEnabled(!touchDrawingEnabled)}
            title={language === 'DE' ? 'Android/Finger schreiben' : 'Android: писать стилусом/пальцем'}
            aria-pressed={touchDrawingEnabled}
          >
            ☝
          </button>
          </div>
          <div className="homework-island-rail-group homework-island-colors">
          {PEN_COLORS.map((color) => (
            <button
              key={color.value}
              type="button"
              onClick={() => { setPenColor(color.value); setTool('pen'); }}
              title={language === 'DE' ? color.labelDe : color.labelRu}
              style={{
                width: 34,
                height: 34,
                alignSelf: 'center',
                borderRadius: '50%',
                background: color.value,
                border: penColor === color.value ? '3px solid #fff' : '2px solid rgba(0,0,0,.18)',
                boxShadow: penColor === color.value ? '0 0 0 2px #111827' : 'none',
                padding: 0,
              }}
            />
          ))}
          </div>
          <div className="homework-island-rail-group homework-island-size">
          {PEN_SIZES.map((size) => (
            <button
              key={size}
              type="button"
              className={penSize === size ? 'is-active' : undefined}
              onClick={() => { setPenSize(size); setTool('pen'); }}
              title={`${language === 'DE' ? 'Breite' : 'Толщина'}: ${size}`}
              style={{ padding: '6px 7px' }}
            >
              <span style={{ display: 'block', width: 20, height: Math.max(2, size / 2), borderRadius: 999, background: 'currentColor', margin: '0 auto' }} />
            </button>
          ))}
          </div>
          <div className="homework-island-rail-group homework-island-pager">
          <button type="button" disabled={pageIndex === 0} onClick={() => setPageIndex((p) => p - 1)} title={language === 'DE' ? 'Vorherige Seite' : 'Предыдущая страница'}>↑</button>
          <div style={{ textAlign: 'center', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>{pageIndex + 1}/{pageCount}</div>
          <button className="btn btn--secondary" type="button" disabled={pageIndex >= pageCount - 1} onClick={() => setPageIndex((p) => p + 1)} title={language === 'DE' ? 'Nächste Seite' : 'Следующая страница'}>↓</button>
          </div>
          <div className="homework-island-rail-group">
          <button type="button" onClick={undo} disabled={undoCount === 0} title={language === 'DE' ? 'Rückgängig' : 'Шаг назад'}>↶</button>
          <button type="button" onClick={clear} disabled={undoCount === 0} title={language === 'DE' ? 'Seite löschen' : 'Очистить страницу'}>×</button>
          </div>
        </div>
      )}

      {desktopControls && (
        <div className="row" style={{ gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
          <button className="btn btn--secondary" type="button" onClick={undo} disabled={undoCount === 0}>
            {language === 'DE' ? 'Rückgängig' : '↶ Шаг назад'}
          </button>
          <button className="btn btn--ghost" type="button" onClick={clear} disabled={undoCount === 0}>
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
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
          />
          <canvas
            ref={previewCanvasRef}
            onPointerDown={(event) => { if (!universalInputRef.current) start(event); }}
            onPointerMove={(event) => { if (!universalInputRef.current) move(event); }}
            onPointerUp={(event) => { if (!universalInputRef.current) finish(event); }}
            onPointerCancel={(event) => { if (!universalInputRef.current) finish(event); }}
            onLostPointerCapture={(event) => { if (!universalInputRef.current) lostCapture(event); }}
            onPointerLeave={(event) => { if (!universalInputRef.current) pointerLeft(event); }}
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
