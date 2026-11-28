import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { Homework } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import { toErrorMessage } from '../../lib/errors';
import { renderHomeworkInkStroke } from '../../lib/homeworkInk';
import { attachTabletInkInput, type TabletInkPoint } from '../../lib/tabletInkInput';
import { BoardToolbar } from '../../features/online-classes/BoardToolbar';
import { DEFAULT_TOOL_SETTINGS, type ToolSettings } from '../../features/online-classes/boardTools';
import type { Tool as BoardTool } from '../../features/online-classes/WhiteboardCanvas';
import '../../pdf-homework.css';

type Tool = 'pan' | 'pen' | 'eraser';
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
  tool: Exclude<Tool, 'pan'>;
  color: string;
  size: number;
  points: StrokePoint[];
  pressureSensitive?: boolean;
};
type PageDrawing = {
  width: number;
  height: number;
  strokes: DrawingStroke[];
};

type PageControls = { undo: () => void; redo: () => void; clear: () => void };
type PageHistory = { canUndo: boolean; canRedo: boolean };
const HOMEWORK_TOOLS: BoardTool[] = ['pan', 'pen', 'erase'];

export function PdfHomeworkPage({ onSubmitted }: { onSubmitted?: () => void } = {}) {
  const { homeworkId = '' } = useParams();
  const { language, t } = useI18n();
  const [homework, setHomework] = useState<Homework | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const pageElements = useRef<Record<number, HTMLElement | null>>({});
  const drawingsRef = useRef<Record<number, PageDrawing>>({});
  const pageControls = useRef<Record<number, PageControls | null>>({});
  const [pageHistory, setPageHistory] = useState<Record<number, PageHistory>>({});
  const [tool, setTool] = useState<Tool>('pen');
  // Fingers scroll the document by default; a stylus still writes. Older
  // Android pens reported as fingers can opt into the existing drawing mode.
  const [touchDrawingEnabled, setTouchDrawingEnabled] = useState(false);
  const [toolSettings, setToolSettings] = useState<Record<BoardTool, ToolSettings>>(() => ({
    ...DEFAULT_TOOL_SETTINGS,
    pen: { ...DEFAULT_TOOL_SETTINGS.pen, color: '#2563eb', width: 0.005 },
  }));
  const [desktopZoom, setDesktopZoom] = useState(100);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setHomework(null);
    setPageIndex(0);
    drawingsRef.current = {};
    pageElements.current = {};
    pageControls.current = {};
    setPageHistory({});
  }, [homeworkId]);

  useEffect(() => {
    let cancelled = false;
    api.study.homeworks()
      .then((items) => { if (!cancelled) setHomework(items.find((item) => item.id === homeworkId) ?? null); })
      .catch((e) => { if (!cancelled) setError(toErrorMessage(e, t)); });
    return () => { cancelled = true; };
  }, [homeworkId, t]);

  const pageCount = homework?.hasWorksheet ? Math.max(1, homework.worksheetPageCount ?? 1) : 0;
  useEffect(() => {
    if (!pageCount) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const anchor = window.innerHeight * 0.35;
        let nearest = 0;
        let distance = Infinity;
        for (const [index, element] of Object.entries(pageElements.current)) {
          if (!element) continue;
          const rect = element.getBoundingClientRect();
          const nextDistance = rect.top <= anchor && rect.bottom >= anchor
            ? 0 : Math.min(Math.abs(rect.top - anchor), Math.abs(rect.bottom - anchor));
          if (nextDistance < distance) {
            distance = nextDistance;
            nearest = Number(index);
          }
        }
        setPageIndex(nearest);
      });
    };
    update();
    window.addEventListener('scroll', update, { capture: true, passive: true });
    window.addEventListener('resize', update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [homeworkId, pageCount]);

  function scrollToPage(index: number) {
    const next = Math.max(0, Math.min(pageCount - 1, index));
    setPageIndex(next);
    pageElements.current[next]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
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

  async function downloadWorksheet() {
    if (!homework?.hasWorksheet || downloading) return;
    setDownloading(true);
    setError(null);
    try {
      // Request with the student's bearer token. Do not place tokens in URLs.
      const pdf = await api.study.worksheet(homeworkId);
      const url = URL.createObjectURL(pdf);
      const link = document.createElement('a');
      const originalName = (homework.worksheetFilename || 'hausaufgabe.pdf').split(/[\\/]/).pop() || 'hausaufgabe.pdf';
      link.href = url;
      link.download = originalName.toLowerCase().endsWith('.pdf') ? originalName : `${originalName}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      // Keep the blob URL alive while mobile browsers hand the file to Files or a PDF app.
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      setError(toErrorMessage(e, t));
    } finally {
      setDownloading(false);
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

  const documentWidth = `${desktopZoom}%`;
  const boardTool: BoardTool = tool === 'eraser' ? 'erase' : tool;
  const activeSettings = toolSettings[boardTool];
  const activeHistory = pageHistory[pageIndex];

  return (
    <div className="pdf-homework-page">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ minWidth: 0 }}>
          <Link to={`/student/homeworks/${homeworkId}`} className="muted">← {t('common.back')}</Link>
          <h1 style={{ margin: '8px 0 2px' }}>{language === 'DE' ? 'Hausaufgabe' : 'Домашка'}</h1>
          <div className="muted" style={{ overflowWrap: 'anywhere' }}>{homework.worksheetFilename}</div>
        </div>
        <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn--secondary" onClick={() => void downloadWorksheet()} disabled={downloading}>
            {downloading
              ? (language === 'DE' ? 'PDF wird geladen…' : 'Скачиваем PDF…')
              : (language === 'DE' ? '↓ PDF herunterladen' : '↓ Скачать PDF')}
          </button>
          {homework.submitted && <span className="pill pill--learned">{language === 'DE' ? 'Abgegeben' : 'Сдано'}</span>}
        </div>
      </div>

      {error && <div className="banner banner--error">{error}</div>}
      {message && <div className="banner banner--success">{message}</div>}
      {submittedText && (
        <div className="banner banner--info">
          {language === 'DE' ? 'Abgegeben:' : 'Сдано:'} {submittedText}. {language === 'DE' ? 'Die abgegebene Version ist schreibgeschützt.' : 'Сданная версия доступна только для просмотра.'}
        </div>
      )}

      <div className="pdf-homework-toolbar">
        {!homework.submitted && <BoardToolbar
          ariaLabel={language === 'DE' ? 'Werkzeuge' : 'Инструменты'}
          clearLabel={language === 'DE' ? 'Seite leeren' : 'Очистить страницу'}
          colorPopoverClassName="pdf-homework-color-popover"
          availableTools={HOMEWORK_TOOLS} eraserModes={['partial']}
          tool={boardTool}
          onToolChange={(next) => { if (next === 'pan' || next === 'pen' || next === 'erase') setTool(next === 'erase' ? 'eraser' : next); }}
          settings={toolSettings}
          onSettingsChange={(selected, patch) => setToolSettings(previous => ({ ...previous, [selected]: { ...previous[selected], ...patch } }))}
          eraserMode="partial" onEraserModeChange={() => {}}
          inputMode={touchDrawingEnabled ? 'finger' : 'stylus'}
          onInputModeChange={(mode) => setTouchDrawingEnabled(mode === 'finger')}
          canUndo={activeHistory?.canUndo ?? false} canRedo={activeHistory?.canRedo ?? false}
          onUndo={() => pageControls.current[pageIndex]?.undo()}
          onRedo={() => pageControls.current[pageIndex]?.redo()}
          onClearMine={() => pageControls.current[pageIndex]?.clear()}
        />}
        <div className="pdf-homework-navigation">
          <div className="pdf-homework-toolbar-island" role="group" aria-label={language === 'DE' ? 'Seitennavigation' : 'Навигация по страницам'}>
            <button type="button" disabled={pageIndex === 0} onClick={() => scrollToPage(pageIndex - 1)}
              aria-label={language === 'DE' ? 'Vorherige Seite' : 'Предыдущая страница'} title={language === 'DE' ? 'Vorherige Seite' : 'Предыдущая страница'}>↑</button>
            <output aria-live="polite" aria-label={language === 'DE' ? 'Aktuelle Seite' : 'Текущая страница'}>{pageIndex + 1} / {pageCount}</output>
            <button type="button" disabled={pageIndex >= pageCount - 1} onClick={() => scrollToPage(pageIndex + 1)}
              aria-label={language === 'DE' ? 'Nächste Seite' : 'Следующая страница'} title={language === 'DE' ? 'Nächste Seite' : 'Следующая страница'}>↓</button>
          </div>
          <div className="pdf-homework-toolbar-island" role="group" aria-label={language === 'DE' ? 'Dokumentzoom' : 'Масштаб документа'}>
            <button type="button" onClick={() => setDesktopZoom(value => Math.max(60, value - 20))} disabled={desktopZoom <= 60}
              aria-label={language === 'DE' ? 'Verkleinern' : 'Уменьшить'}>−</button>
            <button type="button" className="pdf-homework-zoom-value" onClick={() => setDesktopZoom(100)}
              aria-label={language === 'DE' ? 'Originalgröße' : 'Исходный масштаб'}>{desktopZoom}%</button>
            <button type="button" onClick={() => setDesktopZoom(value => Math.min(200, value + 20))} disabled={desktopZoom >= 200}
              aria-label={language === 'DE' ? 'Vergrößern' : 'Увеличить'}>+</button>
          </div>
        </div>
      </div>

      <div className="pdf-homework-pages" aria-label={language === 'DE' ? 'PDF-Seiten' : 'Страницы PDF'}>
        {Array.from({ length: pageCount }, (_, index) => (
          <WorksheetPage key={`${homeworkId}:${index}:${homework.submitted ? 'submitted' : 'draft'}`}
            homeworkId={homeworkId} pageIndex={index} pageCount={pageCount}
            active={pageIndex === index} language={language} loadingText={t('common.loading')}
            elementRef={(element) => { pageElements.current[index] = element; }}
            onActivate={() => setPageIndex(index)}>
            {(pageUrl) => homework.submitted ? (
              <div className="pdf-homework-sheet-scroll">
                <div style={{ width: documentWidth, margin: '0 auto', background: '#fff' }}>
                  <img src={pageUrl} alt={`${language === 'DE' ? 'Abgegebene PDF-Seite' : 'Сданная страница PDF'} ${index + 1}`} style={{ display: 'block', width: '100%', height: 'auto' }} />
                </div>
              </div>
            ) : (
              <WorksheetCanvas
                pageUrl={pageUrl}
                initialDrawing={drawingsRef.current[index]}
                tool={tool}
                touchDrawingEnabled={touchDrawingEnabled}
                penColor={activeSettings.color}
                penSize={activeSettings.width * 1000}
                language={language}
                zoom={desktopZoom}
                pageIndex={index}
                onControls={(controls) => { pageControls.current[index] = controls; }}
                onHistoryChange={(history) => setPageHistory(previous => ({ ...previous, [index]: history }))}
                onChange={(drawing) => { drawingsRef.current[index] = drawing; }}
              />
            )}
          </WorksheetPage>
        ))}
      </div>

      {!homework.submitted && (
        <div className="panel" style={{ marginTop: 12 }}>
          <button className="btn btn--block" type="button" onClick={submitHomework} disabled={busy}>
            {busy ? (language === 'DE' ? 'Wird abgegeben…' : 'Сохраняем…') : (language === 'DE' ? 'Hausaufgabe abgeben' : 'Сдать домашку')}
          </button>
          <p className="muted" style={{ marginBottom: 0, fontSize: 13 }}>
            {language === 'DE'
              ? 'Alle Seiten stehen untereinander. Mit dem Finger scrollst du, mit dem Stift schreibst du. Für ältere Android-Stifte kannst du Einfinger-Schreiben aktivieren.'
              : 'Все страницы идут друг за другом. Пальцем листай документ, стилусом пиши. Для старых Android-стилусов можно включить рисование пальцем.'}
          </p>
        </div>
      )}
    </div>
  );
}

function WorksheetPage({ homeworkId, pageIndex, pageCount, active, language, loadingText, elementRef, onActivate, children }: {
  homeworkId: string;
  pageIndex: number;
  pageCount: number;
  active: boolean;
  language: 'DE' | 'RU';
  loadingText: string;
  elementRef: (element: HTMLElement | null) => void;
  onActivate: () => void;
  children: (pageUrl: string) => ReactNode;
}) {
  const { t } = useI18n();
  const element = useRef<HTMLElement | null>(null);
  const [requested, setRequested] = useState(active);
  const [pageUrl, setPageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => { if (active) setRequested(true); }, [active]);
  useEffect(() => {
    const target = element.current;
    if (!target || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setRequested(true);
        observer.disconnect();
      }
    }, { rootMargin: '500px 0px' });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!requested) return;
    let cancelled = false;
    setError(null);
    api.study.worksheetPageDataUrl(homeworkId, pageIndex)
      .then((value) => {
        const url = value.trim();
        if (!url) throw new Error('PDF page is empty');
        if (!cancelled) setPageUrl(url);
      })
      .catch((failure) => { if (!cancelled) setError(toErrorMessage(failure, t)); });
    return () => { cancelled = true; };
  }, [homeworkId, pageIndex, requested, attempt, t]);

  const label = `${language === 'DE' ? 'Seite' : 'Страница'} ${pageIndex + 1}`;
  return (
    <section className="pdf-homework-sheet" aria-label={label} data-page-index={pageIndex}
      ref={(target) => { element.current = target; elementRef(target); }}
      onPointerDownCapture={onActivate} onTouchStartCapture={onActivate} onFocusCapture={onActivate}>
      <div className="pdf-homework-sheet-label">{label} / {pageCount}</div>
      {pageUrl ? children(pageUrl) : (
        <div className="pdf-homework-sheet-placeholder" aria-busy={!error}>
          {error ? <div className="banner banner--error" role="alert">
            <p>{error}</p>
            <button type="button" onClick={() => setAttempt((value) => value + 1)}>
              {language === 'DE' ? 'Seite erneut laden' : 'Загрузить страницу ещё раз'}
            </button>
          </div> : <span>{loadingText}</span>}
        </div>
      )}
    </section>
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

function WorksheetCanvas({ pageUrl, initialDrawing, tool, touchDrawingEnabled, penColor, penSize, language, zoom, pageIndex, onControls, onHistoryChange, onChange }: {
  pageUrl: string;
  initialDrawing?: PageDrawing;
  tool: Tool;
  touchDrawingEnabled: boolean;
  penColor: string;
  penSize: number;
  language: 'DE' | 'RU';
  zoom: number;
  pageIndex: number;
  onControls: (controls: PageControls | null) => void;
  onHistoryChange: (history: PageHistory) => void;
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
  const redoRef = useRef<DrawingStroke[]>([]);
  const panRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const universalInputRef = useRef(false);
  const latestInkSettingsRef = useRef({ tool, penColor, penSize, touchDrawingEnabled, ready });
  latestInkSettingsRef.current = { tool, penColor, penSize, touchDrawingEnabled, ready };

  useEffect(() => {
    onControls({ undo, redo, clear });
    return () => onControls(null);
    // Actions use refs so the toolbar can control an offscreen page without
    // recreating its canvas or its input listeners.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        if (settings.tool === 'pan') {
          panRef.current = { clientX: point.clientX, clientY: point.clientY };
          return;
        }
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
        if (panRef.current) { movePan(point); return; }
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
        if (panRef.current) { panRef.current = null; return; }
        const geometry = strokeGeometryRef.current;
        const stroke = activeStrokeRef.current;
        if (!geometry || !stroke) return;
        // An inferred end reuses an already delivered sample; commit the
        // existing ink without adding another position from that old contact.
        if (!meta.recovered) {
          const next = pointFromClient(point, geometry);
          const last = stroke.points[stroke.points.length - 1];
          if (!last || Math.hypot(last.x - next.x, last.y - next.y) > 0.4) {
            stroke.points.push({ ...next, pressure: point.pressure });
          }
        }
        resetActiveStroke(!cancelled || meta.device !== 'finger');
      },
    }, {
      allowFinger: () => latestInkSettingsRef.current.touchDrawingEnabled && latestInkSettingsRef.current.tool !== 'pan',
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
      panRef.current = null;
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

  function publishHistory() {
    onHistoryChange({ canUndo: strokesRef.current.length > 0, canRedo: redoRef.current.length > 0 });
  }

  function movePan(point: Pick<TabletInkPoint, 'clientX' | 'clientY'>) {
    const previous = panRef.current;
    if (!previous) return;
    const horizontal = previous.clientX - point.clientX;
    const vertical = previous.clientY - point.clientY;
    previewCanvasRef.current?.closest('.pdf-homework-sheet-scroll')?.scrollBy(horizontal, 0);
    window.scrollBy(0, vertical);
    panRef.current = { clientX: point.clientX, clientY: point.clientY };
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
    publishHistory();
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
      redoRef.current = [];
      publishHistory();
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
    if (tool === 'pan') {
      if (event.pointerType === 'touch' || !ready || event.button !== 0) return;
      event.preventDefault();
      panRef.current = { clientX: event.clientX, clientY: event.clientY };
      drawingPointerIdRef.current = event.pointerId;
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* pointerleave fallback */ }
      return;
    }
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
    if (panRef.current) { event.preventDefault(); movePan(event); return; }
    if (!activeStrokeRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    appendPointerSamples(event);
    if (activeStrokeRef.current.tool === 'pen') schedulePenPreview();
  }

  function finish(event: React.PointerEvent<HTMLCanvasElement>) {
    if (event.pointerType === 'touch') activeTouchPointersRef.current.delete(event.pointerId);
    if (drawingPointerIdRef.current !== event.pointerId) return;
    if (panRef.current) {
      panRef.current = null;
      drawingPointerIdRef.current = null;
      try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* no-op */ }
      return;
    }
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
    panRef.current = null;
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
      panRef.current = null;
      resetActiveStroke(true);
    }
  }

  function undo() {
    if (strokesRef.current.length === 0) return;
    if (activeStrokeRef.current) resetActiveStroke(true);
    redoRef.current.push(strokesRef.current[strokesRef.current.length - 1]);
    strokesRef.current = strokesRef.current.slice(0, -1);
    publishHistory();
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) redrawStrokes(ctx, canvas.width, canvas.height, strokesRef.current);
    emitDrawing();
  }

  function redo() {
    const stroke = redoRef.current.pop();
    if (!stroke) return;
    strokesRef.current = [...strokesRef.current, stroke];
    publishHistory();
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) redrawStrokes(ctx, canvas.width, canvas.height, strokesRef.current);
    emitDrawing();
  }

  function clear() {
    resetActiveStroke(false);
    strokesRef.current = [];
    redoRef.current = [];
    publishHistory();
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    emitDrawing();
  }

  const documentWidth = `${zoom}%`;

  return (
    <div className="pdf-homework-sheet-scroll">
        <div
          style={{
            position: 'relative',
            width: documentWidth,
            margin: '0 auto',
            boxShadow: '0 2px 14px rgba(0,0,0,.12)',
            background: '#fff',
          }}
        >
          <img
            ref={imageRef}
            src={pageUrl}
            alt={`${language === 'DE' ? 'PDF-Seite' : 'Страница PDF'} ${pageIndex + 1}`}
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
            data-testid={`homework-ink-${pageIndex}`}
            aria-label={`${language === 'DE' ? 'Schreibfläche Seite' : 'Поле для записей, страница'} ${pageIndex + 1}`}
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
              // A legacy Android pen may arrive as one finger. In that opt-in
              // mode reserve single contacts for ink while keeping pinch zoom.
              touchAction: touchDrawingEnabled && tool !== 'pan' ? 'pinch-zoom' : 'pan-x pan-y pinch-zoom',
              cursor: tool === 'pan' ? 'grab' : tool === 'eraser' ? 'cell' : 'crosshair',
              opacity: ready ? 1 : 0,
            }}
          />
        </div>
    </div>
  );
}
