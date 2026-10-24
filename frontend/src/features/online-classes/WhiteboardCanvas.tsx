import Konva from 'konva';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Arrow, Circle, Ellipse, Image as KonvaImage, Layer, Line, Rect, Shape as KonvaShape, Stage, Text } from 'react-konva';
import {
  type RenderableShape,
  type Shape,
  letterbox,
  toNormalized,
  toPixels,
} from './annotations';
import {
  DEFAULT_VIEW,
  type PageView,
  type Point,
  panBy,
  resizeView,
  screenToBoard,
  zoomAbout,
} from './boardView';
import { GestureController, type Intent } from './gestureController';
import { shapeAt } from './hitTest';
import { type InputMode, isPalmContact, normalizePointerKind } from './inputPolicy';
import { shapeBounds, translateShape } from './shapeTransform';
import { penOutline, tracePenOutline } from './freehand';
import { attachTabletInkInput, detectTabletInkBackend, getTabletInkPlatform } from '../../lib/tabletInkInput';
import { normalizedTextSize, shapeTextSizePx, textStyleFor } from './textStyles';
import { TabletBoardNavigation } from './tabletBoardNavigation';
import type { DocumentRenderer } from '../notebook-camera/cameraModules';
import {
  createNotebookProjection,
  notebookCanvasSource,
  notebookRawToScreen,
  notebookScreenToRaw,
  paintNotebookProjection,
  type NotebookCameraGeometry,
} from './notebookCameraGeometry';

export type Tool =
  | 'pen'
  | 'highlighter'
  | 'line'
  | 'arrow'
  | 'rect'
  | 'ellipse'
  | 'text'
  | 'erase'
  | 'select'
  | 'laser'
  | 'pan';

/** Eraser behaviour: wipe the part under the eraser, or delete the whole stroke. */
export type EraserMode = 'partial' | 'stroke';

/** Freehand input fires far faster than the wire needs; sampling caps it. */
const SAMPLE_INTERVAL_MS = 16;

/** Hit tolerance for the eraser and selection, in normalized units. */
const HIT_TOLERANCE = 0.015;

export interface WhiteboardCanvasHandle {
  /** PNG of the board as currently drawn, or null before it has a size. */
  toDataURL: (mimeType?: 'image/png' | 'image/jpeg') => string | null;
  /** Current size of the drawing surface in CSS pixels. */
  getSize: () => { width: number; height: number };
}

export interface RemoteLaser {
  id: string;
  x: number;
  y: number;
}

interface Props {
  shapes: RenderableShape[];
  tool: Tool;
  color: string;
  strokeWidth: number;
  textFont?: string;
  textFontSize?: number;
  textBold?: boolean;
  sourceAspect: number | null;
  readOnly?: boolean;
  eraserMode?: EraserMode;
  inputMode?: InputMode;
  /** Zoom and pan for the visible page. Controlled by the parent. */
  view?: PageView;
  onViewChange?: (view: PageView) => void;
  /** Continuous document navigation; positive deltas scroll right/down. */
  onScrollGesture?: (dx: number, dy: number) => void;
  /** Student under follow mode: the canvas may not be moved by the viewer. */
  navigationLocked?: boolean;
  /** Rendered page content (PDF page) under the marks. */
  background?: CanvasImageSource | null;
  /** Project the raw camera plus every annotation together, without changing stored coordinates. */
  notebookView?: NotebookCameraGeometry | null;
  /** Page fill shares the background geometry and cannot be removed by erasers. */
  paperColor?: string | null;
  /** Redraw only the background layer while a live video/canvas is visible. */
  backgroundLive?: boolean;
  active?: boolean;
  lasers?: RemoteLaser[];
  /** Other people's strokes that are still being drawn (preview only). */
  remoteDrafts?: { id: string; shape: Shape }[];
  /** Whose marks this viewer may delete or move. */
  actorId?: string;
  /** False means persistence failed; the local ink remains visible for retry. */
  onCommit: (shape: Shape, strokeId?: string) => void | boolean | Promise<boolean | void>;
  /** Board plus page key, so pending ink never leaks to another page. */
  pageKey?: string;
  onEraseShape?: (operationId: string) => void;
  onMoveShape?: (operationId: string, shape: Shape) => void;
  onLaserMove?: (point: { x: number; y: number }) => void;
  /** The stroke being drawn changed; `null` once the pen is up or it was cancelled. */
  onDraftChange?: (shape: Shape | null, strokeId?: string, finished?: boolean) => void;
}

/**
 * Konva rendering surface.
 *
 * <p>Deliberately thin: geometry, folding, permissions and the pointer state
 * machine live in `annotations.ts`, `useAnnotationBoard` and
 * `gestureController.ts`, which are unit-tested without a canvas. This
 * component converts pointer events to normalized coordinates and draws what it
 * is given.
 */
export const WhiteboardCanvas = forwardRef<WhiteboardCanvasHandle, Props>(function WhiteboardCanvas(
  {
    shapes,
    tool,
    color,
    strokeWidth,
    textFont = 'clean',
    textFontSize = 24,
    textBold = false,
    sourceAspect,
    readOnly = false,
    eraserMode = 'partial',
    inputMode = 'finger',
    view = DEFAULT_VIEW,
    onViewChange,
    onScrollGesture,
    navigationLocked = false,
    background = null,
    notebookView = null,
    paperColor = null,
    backgroundLive = false,
    active = true,
    lasers = [],
    remoteDrafts = [],
    actorId,
    onCommit,
    pageKey = 'default',
    onEraseShape,
    onMoveShape,
    onLaserMove,
    onDraftChange,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const nativeAppleInkRef = useRef(false);
  const tabletNavigation = useMemo(() => new TabletBoardNavigation(), []);
  const onViewChangeRef = useRef(onViewChange);
  onViewChangeRef.current = onViewChange;
  const onScrollGestureRef = useRef(onScrollGesture);
  onScrollGestureRef.current = onScrollGesture;
  const gestureOrigin = useRef<{ left: number; top: number } | null>(null);
  const stageRef = useRef<Konva.Stage | null>(null);
  const backgroundLayerRef = useRef<Konva.Layer | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const projectionKey = notebookView ? JSON.stringify(notebookView.view) : '';
  const projection = useMemo(() => createNotebookProjection(notebookView),
    [notebookView?.renderer, notebookView?.rawWidth, notebookView?.rawHeight, projectionKey]);
  const projectionRef = useRef(projection);
  projectionRef.current = projection;
  const sceneViewport = projection?.rawSize ?? viewport;
  const sceneAspect = projection ? notebookView!.rawWidth / notebookView!.rawHeight : sourceAspect;
  const projectedCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const projectorRef = useRef<{ renderer: DocumentRenderer; renderFrame: () => void } | null>(null);
  const projectionPainted = useRef(false);
  const [projectionReady, setProjectionReady] = useState(false);
  const [projectionError, setProjectionError] = useState(false);
  const [projectionAttempt, setProjectionAttempt] = useState(0);
  const [draft, setDraft] = useState<Shape | null>(null);
  type PendingInk = { id: string; page: string; shape: Shape; status: 'saving' | 'saved' | 'failed' };
  const [pendingInk, setPendingInk] = useState<PendingInk[]>([]);
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const pendingOnPage = pendingInk.filter((entry) => entry.page === pageKey);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragDelta, setDragDelta] = useState<{ dx: number; dy: number } | null>(null);
  const [textEdit, setTextEdit] = useState<{ px: Point; nx: number; ny: number } | null>(null);
  const draftRef = useRef<Shape | null>(null);
  const inkStrokeIdRef = useRef<string | null>(null);
  const [ownLaser, setOwnLaser] = useState<{ x: number; y: number } | null>(null);
  const ownLaserTimer = useRef<number | undefined>(undefined);
  const lastSample = useRef(0);
  const dragStart = useRef<{ point: { x: number; y: number }; id: string } | null>(null);
  const dragDeltaRef = useRef<{ dx: number; dy: number } | null>(null);

  // Latest values for the long-lived gesture controller and its callbacks.
  const effectiveReadOnly = readOnly || Boolean(notebookView && (!projection || !projectionReady || projectionError));
  const live = useRef({ tool, color, strokeWidth, eraserMode, readOnly: effectiveReadOnly, view, viewport, sourceAspect, shapes, actorId, projection });
  live.current = { tool, color, strokeWidth, eraserMode, readOnly: effectiveReadOnly, view, viewport, sourceAspect, shapes, actorId, projection };

  useImperativeHandle(ref, () => ({
    toDataURL: (mimeType = 'image/png') => {
      if (projectionRef.current) {
        projectorRef.current?.renderFrame();
        return projectionPainted.current ? projectedCanvasRef.current?.toDataURL(mimeType, 0.9) ?? null : null;
      }
      return stageRef.current?.toDataURL({ pixelRatio: 1, mimeType, quality: 0.9 }) ?? null;
    },
    getSize: () => live.current.viewport,
  }));

  useEffect(() => {
    const layer = backgroundLayerRef.current;
    if (projection || !active || !backgroundLive || !background || !layer) return;
    const animation = new Konva.Animation(() => {}, layer);
    animation.start();
    return () => { animation.stop(); };
  }, [active, backgroundLive, background, Boolean(projection)]);

  // The Konva scene remains in canonical raw-camera space. The display canvas
  // is the single projective warp of its complete video/marks/selection layers.
  useLayoutEffect(() => {
    const currentProjection = projectionRef.current;
    const output = projectedCanvasRef.current;
    const stage = stageRef.current;
    projectionPainted.current = false;
    setProjectionReady(false);
    setProjectionError(false);
    if (!currentProjection || !notebookView || !output || !stage) return;
    let disposed = false;
    const raw = document.createElement('canvas');
    raw.width = currentProjection.rawSize.width; raw.height = currentProjection.rawSize.height;
    const context = raw.getContext('2d');
    const fail = () => {
      if (disposed) return;
      projectionPainted.current = false; setProjectionReady(false); setProjectionError(true);
      output.getContext('2d')?.clearRect(0, 0, output.width, output.height);
    };
    if (!context) { fail(); return; }
    let renderer: DocumentRenderer;
    let configured = '';
    const ratios = stage.getLayers().map(layer => ({ layer, ratio: layer.getCanvas().getPixelRatio() }));
    // The raw stage already renders at source resolution; extra device pixels
    // would consume memory without adding detail to the final projection.
    for (const { layer } of ratios) layer.getCanvas().setPixelRatio(1);
    try {
      renderer = new notebookView.renderer.LiveDocumentRenderer(notebookCanvasSource(raw), document.createElement('canvas'), {
        maxDimension: 1920,
        onFrame: canvas => {
          const mapping = projectionRef.current;
          if (disposed || !mapping) return;
          try {
            if (paintNotebookProjection(output, canvas, live.current.viewport, live.current.view, mapping.aspect)) {
              projectionPainted.current = true; setProjectionReady(true); setProjectionError(false);
            }
          } catch { fail(); }
        },
        onError: fail,
      });
    } catch {
      fail();
      return () => { disposed = true; for (const { layer, ratio } of ratios) layer.getCanvas().setPixelRatio(ratio); };
    }
    const renderFrame = () => {
      const mapping = projectionRef.current;
      if (disposed || !mapping) return;
      try {
        stage.draw();
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.globalCompositeOperation = 'source-over';
        context.clearRect(0, 0, raw.width, raw.height);
        // Erasing has already affected only the marks layer; compositing that
        // transparent layer over the camera cannot erase the source frame.
        for (const layer of stage.getLayers()) context.drawImage(layer.getCanvas()._canvas, 0, 0, raw.width, raw.height);
        const key = JSON.stringify(mapping.view);
        if (configured !== key) { configured = key; renderer.setView(mapping.view); }
        else renderer.render();
      } catch { fail(); }
    };
    projectorRef.current = { renderer, renderFrame };
    renderFrame();
    return () => {
      disposed = true; renderer.stop();
      if (projectorRef.current?.renderer === renderer) projectorRef.current = null;
      projectionPainted.current = false;
      for (const { layer, ratio } of ratios) layer.getCanvas().setPixelRatio(ratio);
    };
  }, [Boolean(projection), notebookView?.renderer, projection?.rawSize.width, projection?.rawSize.height, projectionAttempt]);

  useLayoutEffect(() => {
    projectorRef.current?.renderFrame();
  }, [projection, shapes, draft, pendingInk, remoteDrafts, ownLaser, lasers, selectedId, dragDelta,
    viewport.width, viewport.height, view.zoom, view.panX, view.panY, background, paperColor]);

  useEffect(() => {
    if (!projection || !active) return;
    let job = 0, previous = 0;
    const tick = (time: number) => {
      const current = projectorRef.current;
      const runtime = current?.renderer as (DocumentRenderer & { gl?: unknown; renderMs?: number }) | undefined;
      const interval = !runtime?.gl && projectionRef.current?.view.corners ? Math.max(100, (runtime?.renderMs ?? 0) * 1.6) : 30;
      if (time - previous >= interval) { previous = time; current?.renderFrame(); }
      job = requestAnimationFrame(tick);
    };
    job = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(job);
  }, [Boolean(projection), active]);

  // ResizeObserver updates the canvas dimensions whenever a teacher opens the
  // answers column. Annotations remain normalized; only pixel pan is rescaled
  // so no old zoom offset pushes the displayed page outside the new viewport.
  const previousViewport = useRef<{ width: number; height: number } | null>(null);
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box || box.width <= 0 || box.height <= 0) return;
      const next = { width: box.width, height: box.height };
      const before = previousViewport.current;
      if (before && (Math.abs(before.width - next.width) >= 2 || Math.abs(before.height - next.height) >= 2)) {
        // Avoid unnecessary view updates at normal zoom; page already fits.
        if (live.current.view.zoom > 1) {
          onViewChangeRef.current?.(resizeView(live.current.view, before, next));
        }
      }
      previousViewport.current = next;
      setViewport(current =>
        current.width === next.width && current.height === next.height ? current : next,
      );
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const eraseHits = useRef(new Set<string>());
  const spaceHeld = useRef(false);

  /** Local pixel → normalized page coordinate, through the current zoom/pan. */
  const toPage = useCallback((local: Point) => {
    const { view: currentView, viewport: size, sourceAspect: aspect, projection: mapping } = live.current;
    const point = mapping ? notebookScreenToRaw(local, mapping, size, currentView)
      : toNormalized(screenToBoard(local, currentView), size, aspect);
    // Exactly the same stable positions are used for instant display, LiveKit
    // updates, persistence and PDF export. Avoid 16-digit float packets.
    return { x: Math.round(point.x * 10000) / 10000, y: Math.round(point.y * 10000) / 10000 };
  }, []);

  const aspectOfBoard = () => {
    if (live.current.projection) {
      const { width, height } = live.current.projection.rawSize;
      return width / height;
    }
    const { viewport: size, sourceAspect: aspect } = live.current;
    const box = letterbox(size, aspect);
    return box.height > 0 ? box.width / box.height : 1;
  };

  /** Points the laser: others see it via the callback, and so do you. */
  const pointLaser = (point: { x: number; y: number }) => {
    onLaserMove?.(point);
    setOwnLaser(point);
    window.clearTimeout(ownLaserTimer.current);
    ownLaserTimer.current = window.setTimeout(() => setOwnLaser(null), 1200);
  };
  useEffect(() => () => window.clearTimeout(ownLaserTimer.current), []);

  const startStroke = (local: Point, pressure?: number) => {
    const { tool: active, color: ink, strokeWidth: width, eraserMode: eraser } = live.current;
    const point = toPage(local);

    if (active === 'pan') return;
    if (active === 'laser') {
      pointLaser(point);
      return;
    }
    if (active === 'text') {
      setTextEdit({ px: local, nx: point.x, ny: point.y });
      return;
    }
    if (active === 'select') {
      const hit = shapeAt(live.current.shapes, point, HIT_TOLERANCE, aspectOfBoard());
      setSelectedId(hit?.operationId ?? null);
      if (hit) {
        dragStart.current = { point, id: hit.operationId };
        dragDeltaRef.current = { dx: 0, dy: 0 };
        setDragDelta({ dx: 0, dy: 0 });
      }
      return;
    }
    if (active === 'erase' && eraser === 'stroke') {
      eraseHits.current = new Set();
      eraseAt(point);
      return;
    }

    const next: Shape =
      active === 'pen' || active === 'highlighter' || active === 'erase'
        ? { kind: active, color: ink, width, points: [[point.x, point.y]],
            ...(active === 'pen' && pressure !== undefined && Number.isFinite(pressure)
              ? { pressures: [Math.round(Math.max(0, Math.min(1, pressure)) * 100) / 100] } : {}) }
        : active === 'line' || active === 'arrow'
          ? { kind: active, color: ink, width, x1: point.x, y1: point.y, x2: point.x, y2: point.y }
          : { kind: active, color: ink, width, x: point.x, y: point.y, w: 0, h: 0 };
    draftRef.current = next;
    inkStrokeIdRef.current = crypto.randomUUID();
    setDraft(next);
    onDraftChange?.(next, inkStrokeIdRef.current);
  };

  const submitInk = (shape: Shape, id: string) => {
    let outcome: void | boolean | Promise<boolean | void>;
    try { outcome = onCommitRef.current(shape, id); }
    catch { outcome = false; }
    void Promise.resolve(outcome).then(
      (saved) => setPendingInk((current) =>
        current.map((entry) => entry.id === id
          ? { ...entry, status: saved === false ? 'failed' : 'saved' } : entry)),
      () => setPendingInk((current) =>
        current.map((entry) => entry.id === id ? { ...entry, status: 'failed' } : entry)),
    );
  };

  const commitInk = (shape: Shape, operationId?: string) => {
    const id = operationId ?? crypto.randomUUID();
    setPendingInk((current) => [
      ...current.filter((entry) => entry.id !== id),
      { id, page: pageKey, shape, status: 'saving' },
    ]);
    submitInk(shape, id);
  };

  const retryInk = (entry: PendingInk) => {
    setPendingInk((current) => current.map((item) =>
      item.id === entry.id ? { ...item, status: 'saving' } : item));
    // The same operation ID makes network retries idempotent on the server.
    submitInk(entry.shape, entry.id);
  };

  // Never remove a just-written shape until the acknowledged server copy has
  // rendered. While it is pending, hide its optimistic twin to avoid a flash.
  const renderedIds = shapes.map((entry) => entry.operationId).join(',');
  const confirmedIds = pendingInk.filter((entry) => entry.status === 'saved').map((entry) => entry.id).join(',');
  useEffect(() => {
    const visible = new Set(renderedIds ? renderedIds.split(',') : []);
    setPendingInk((current) => {
      const next = current.filter((entry) =>
        !(entry.status === 'saved' && entry.page === pageKey && visible.has(entry.id)));
      return next.length === current.length ? current : next;
    });
  }, [pageKey, renderedIds, confirmedIds]);

  const eraseAt = (point: { x: number; y: number }) => {
    const hit = shapeAt(live.current.shapes, point, HIT_TOLERANCE, aspectOfBoard());
    if (!hit || eraseHits.current.has(hit.operationId)) return;
    // Only your own marks can be deleted; the board enforces it too.
    if (live.current.actorId && hit.layerOwnerId !== live.current.actorId) return;
    eraseHits.current.add(hit.operationId);
    onEraseShape?.(hit.operationId);
  };

  const moveStroke = (local: Point, pressure?: number, force = false) => {
    const { tool: active, eraserMode: eraser } = live.current;
    const now = performance.now();
    if (!force && now - lastSample.current < SAMPLE_INTERVAL_MS) return;
    lastSample.current = now;
    const point = toPage(local);

    if (active === 'laser') {
      pointLaser(point);
      return;
    }
    if (active === 'select' && dragStart.current) {
      const delta = { dx: point.x - dragStart.current.point.x, dy: point.y - dragStart.current.point.y };
      dragDeltaRef.current = delta;
      setDragDelta(delta);
      return;
    }
    if (active === 'erase' && eraser === 'stroke') {
      eraseAt(point);
      return;
    }

    const current = draftRef.current;
    if (!current) return;
    if (current.points) {
      const end = current.points[current.points.length - 1];
      if (end && Math.hypot(point.x - end[0], point.y - end[1]) < 0.0001) return;
    }
    let next: Shape;
    if (current.points) {
      // Bounded append-only ink prevents a single very long contact from
      // exceeding the server's 16 KB payload cap. No pen-up resampling.
      const atLimit = current.points.length >= 480;
      const points = atLimit
        ? [...current.points.slice(0, -1), [point.x, point.y] as [number, number]]
        : [...current.points, [point.x, point.y] as [number, number]];
      const pressures = current.pressures
        ? (atLimit ? current.pressures.slice(0, -1) : current.pressures).concat(
          pressure !== undefined && Number.isFinite(pressure)
            ? Math.round(Math.max(0, Math.min(1, pressure)) * 100) / 100
            : current.pressures[current.pressures.length - 1],
        )
        : undefined;
      next = { ...current, points, ...(pressures ? { pressures } : {}) };
    } else if (current.x1 !== undefined) {
      next = { ...current, x2: point.x, y2: point.y };
    } else {
      next = { ...current, w: point.x - (current.x ?? 0), h: point.y - (current.y ?? 0) };
    }
    draftRef.current = next;
    setDraft(next);
    onDraftChange?.(next, inkStrokeIdRef.current ?? undefined);
  };

  const endStroke = () => {
    if (dragStart.current) {
      const { id } = dragStart.current;
      const delta = dragDeltaRef.current;
      dragStart.current = null;
      dragDeltaRef.current = null;
      setDragDelta(null);
      const original = live.current.shapes.find((entry) => entry.operationId === id);
      if (original && delta && Math.hypot(delta.dx, delta.dy) > 0.002) {
        onMoveShape?.(id, translateShape(original.shape, delta.dx, delta.dy));
      }
      return;
    }
    const finished = draftRef.current;
    const strokeId = inkStrokeIdRef.current ?? undefined;
    draftRef.current = null;
    inkStrokeIdRef.current = null;
    setDraft(null);
    // Keep final geometry visible remotely until its exact saved operation
    // appears. Merely sending "null" causes a visible gap on slow networks.
    onDraftChange?.(finished, strokeId, true);
    if (!finished) return;
    // Keep precisely the geometry already displayed under the Pencil.
    // Previously thinning at pen-up made the written glyph morph visibly.
    commitInk(finished, strokeId);
  };

  const cancelStroke = () => {
    onDraftChange?.(null, inkStrokeIdRef.current ?? undefined);
    inkStrokeIdRef.current = null;
    draftRef.current = null;
    setDraft(null);
    onDraftChange?.(null);
    dragStart.current = null;
    dragDeltaRef.current = null;
    setDragDelta(null);
  };

  const applyIntents = (intents: Intent[]) => {
    for (const intent of intents) {
      switch (intent.type) {
        case 'stroke-start':
          if (!live.current.readOnly || live.current.tool === 'laser') startStroke(intent.point, intent.pointerKind === 'pen' ? intent.pressure : undefined);
          break;
        case 'stroke-move':
          if (!live.current.readOnly || live.current.tool === 'laser') moveStroke(intent.point, intent.pressure);
          break;
        case 'stroke-end':
          endStroke();
          break;
        case 'stroke-cancel':
          cancelStroke();
          break;
        case 'view':
          onViewChange?.(intent.view);
          break;
        case 'scroll':
          if (!lockedRef.current) onScrollGestureRef.current?.(intent.dx, intent.dy);
          break;
      }
    }
  };

  const controller = useMemo(
    () =>
      new GestureController({
        mode: () => inputModeRef.current,
        view: () => live.current.view,
        board: () => live.current.viewport,
        locked: () => lockedRef.current,
        continuous: () => Boolean(onScrollGestureRef.current),
      }),
    [],
  );
  const inputModeRef = useRef(inputMode);
  // A viewer who cannot draw has nothing for one finger to do but move the page.
  inputModeRef.current = readOnly ? 'stylus' : inputMode;
  const lockedRef = useRef(navigationLocked);
  lockedRef.current = navigationLocked;

  useEffect(() => () => controller.reset(), [controller]);

  const localPoint = (event: React.MouseEvent): Point => {
    const rect = containerRef.current?.getBoundingClientRect();
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
  };
  const gesturePoint = (event: React.MouseEvent): Point => {
    const origin = onScrollGestureRef.current && !controller.isDrawing ? gestureOrigin.current : null;
    return origin ? { x: event.clientX - origin.left, y: event.clientY - origin.top } : localPoint(event);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    // On iPadOS native Touch Events own Pencil strokes; pointer events would
    // otherwise duplicate or drop fast short strokes when Scribble is enabled.
    if (nativeAppleInkRef.current && event.pointerType !== 'mouse') return;
    if (textEdit) return;
    const kind = normalizePointerKind(event.pointerType);
    if (onScrollGestureRef.current && ((!controller.isDrawing && !controller.isNavigating) || kind === 'pen')) {
      const rect = containerRef.current?.getBoundingClientRect();
      gestureOrigin.current = rect ? { left: rect.left, top: rect.top } : null;
    }
    // A resting hand must not change the zoom in stylus mode either.
    const palm = isPalmContact(kind, event.width, event.height);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Capture is a nicety (keeps a drag alive off-surface); not required.
    }
    // Middle button, or space held, moves the page instead of drawing.
    const navigate = (live.current.tool === 'pan' && !lockedRef.current) || (kind === 'mouse' && (event.button === 1 || spaceHeld.current));
    if (navigate) event.preventDefault();
    applyIntents(controller.down(event.pointerId, kind, gesturePoint(event), palm, navigate, kind === 'pen' ? event.pressure : undefined));
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (nativeAppleInkRef.current && event.pointerType !== 'mouse') return;
    // A laser follows the pointer even with no button down, like a real one.
    if (live.current.tool === 'laser' && event.buttons === 0) {
      const now = performance.now();
      if (now - lastSample.current >= SAMPLE_INTERVAL_MS) {
        lastSample.current = now;
        pointLaser(toPage(localPoint(event)));
      }
      return;
    }
    applyIntents(controller.move(event.pointerId, gesturePoint(event), event.pointerType === 'pen' ? event.pressure : undefined));
  };
  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (nativeAppleInkRef.current && event.pointerType !== 'mouse') return;
    // Preserve the final position even when the entire short stroke fits in
    // one 16ms sample window; do not turn quick crossbars into dots.
    if (controller.isDrawing) moveStroke(localPoint(event), event.pressure, true);
    applyIntents(controller.up(event.pointerId));
  };
  const onPointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    if (nativeAppleInkRef.current && event.pointerType !== 'mouse') return;
    applyIntents(controller.up(event.pointerId, true));
  };

  // Keep callbacks current across React renders without ever detaching the
  // Pencil input listeners during a stroke.
  const applyInkIntentsRef = useRef(applyIntents);
  applyInkIntentsRef.current = applyIntents;
  useEffect(() => {
    const surface = containerRef.current;
    if (!surface || detectTabletInkBackend(getTabletInkPlatform()) !== 'ios-touch') return;
    const local = (x: number, y: number): Point => {
      const rect = surface.getBoundingClientRect();
      return { x: x - rect.left, y: y - rect.top };
    };
    const driver = attachTabletInkInput(surface, {
      onStart(point, meta) {
        // React owns real mouse events; the native driver owns Pencil/touch.
        if (meta.device === 'mouse') return;
        if (textEdit) return;
        if (meta.device === 'pen') tabletNavigation.reset();
        applyInkIntentsRef.current(controller.down(meta.inputId, meta.device === 'finger' ? 'touch' : meta.device,
          local(point.clientX, point.clientY), false, live.current.tool === 'pan' && !lockedRef.current,
          meta.device === 'pen' ? point.pressure : undefined));
      },
      onMove(point, meta) {
        if (meta.device === 'mouse') return;
        applyInkIntentsRef.current(controller.move(meta.inputId,
          local(point.clientX, point.clientY), meta.device === 'pen' ? point.pressure : undefined));
      },
      onEnd(point, meta, cancelled) {
        if (meta.device === 'mouse') return;
        if (!cancelled && controller.isDrawing) {
          moveStroke(local(point.clientX, point.clientY), point.pressure, true);
        }
        applyInkIntentsRef.current(controller.up(meta.inputId, cancelled));
      },
      onGesture(contacts) {
        // Track actual native fingers, not the duplicate Safari Pointer Events.
        // Never navigate while a Pencil stroke is active, nor while the
        // participant is locked into following the teacher's view.
        if (controller.isDrawing) {
          tabletNavigation.reset();
          return;
        }
        const rect = surface.getBoundingClientRect();
        const next = tabletNavigation.update(
          contacts,
          { left: rect.left, top: rect.top },
          live.current.view,
          live.current.viewport,
          {
            locked: lockedRef.current,
            // Stylus mode: one finger pans; finger-draw mode: only two fingers
            // navigate, preventing unintended marks from the pinch.
            allowOneFingerPan: inputModeRef.current === 'stylus' || live.current.tool === 'pan',
            onScrollGesture: onScrollGestureRef.current,
          },
        );
        if (next) onViewChangeRef.current?.(next);
      },
    }, {
      allowFinger: () => inputModeRef.current === 'finger' && !live.current.readOnly && live.current.tool !== 'pan',
      // Do NOT hand fingers to Safari's native pinch zoom. The board itself
      // interprets touch contacts and transforms only its Konva stage.
      nativeFingerNavigation: false,
      pointerCapture: false,
    });
    nativeAppleInkRef.current = true;
    return () => {
      nativeAppleInkRef.current = false;
      tabletNavigation.reset();
      driver.destroy();
    };
  }, [controller, tabletNavigation, textEdit]);

  const onWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (navigationLocked || controller.isDrawing) { if (onScrollGesture) event.stopPropagation(); return; }
    const local = localPoint(event);
    // Ctrl/⌘ + wheel (and trackpad pinch, which arrives the same way) zooms;
    // a plain wheel scrolls the zoomed page.
    if (event.ctrlKey || event.metaKey) {
      event.stopPropagation();
      onViewChange?.(zoomAbout(view, view.zoom * Math.exp(-event.deltaY * 0.01), local, viewport));
    } else if (onScrollGesture) {
      event.stopPropagation();
      onScrollGesture(event.deltaX, event.deltaY);
    } else if (view.zoom > 1) {
      onViewChange?.(panBy(view, -event.deltaX, -event.deltaY, viewport));
    }
  };
  useEffect(() => {
    const surface = containerRef.current;
    if (!surface) return;
    // React's wheel listener is passive in browsers. Prevent native scrolling
    // separately, so one wheel event cannot move the document twice.
    const preventNativeWheel = (event: WheelEvent) => {
      if (onScrollGestureRef.current || ((event.ctrlKey || event.metaKey) && onViewChangeRef.current)) event.preventDefault();
    };
    surface.addEventListener('wheel', preventNativeWheel, { passive: false });
    return () => surface.removeEventListener('wheel', preventNativeWheel);
  }, []);

  const onKeyUp = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === ' ') spaceHeld.current = false;
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === ' ') {
      spaceHeld.current = true;
      event.preventDefault();
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId && !live.current.readOnly) {
      onEraseShape?.(selectedId);
      setSelectedId(null);
    }
    if (event.key === 'Escape') setSelectedId(null);
  };

  // A tool switch ends any selection: the box only makes sense for 'select'.
  useEffect(() => {
    if (tool !== 'select') setSelectedId(null);
  }, [tool]);
  // A page flip or a delete can leave the selection pointing at nothing.
  useEffect(() => {
    if (selectedId && !shapes.some((entry) => entry.operationId === selectedId)) setSelectedId(null);
  }, [shapes, selectedId]);

  // Enter commits and unmounts the box, and some browsers then fire blur on the
  // removed input; the ref makes the second call see "nothing being edited".
  const textEditRef = useRef(textEdit);
  textEditRef.current = textEdit;
  const commitText = (value: string) => {
    const edit = textEditRef.current;
    textEditRef.current = null;
    setTextEdit(null);
    const text = value.trim();
    if (!edit || !text || live.current.readOnly) return;
    commitInk({ kind: 'text', x: edit.nx, y: edit.ny, text: text.slice(0, 500),
      size: normalizedTextSize(textFontSize), font: textFont, bold: textBold, color });
  };

  // The board takes focus back right after the pointer goes down, which would
  // blur a box focused on mount and close it empty. Focusing a frame later wins.
  const focusTextInput = useCallback((element: HTMLTextAreaElement | null) => {
    if (element) window.requestAnimationFrame(() => element.focus());
  }, []);

  const flatten = (points: [number, number][]) =>
    points.flatMap(([x, y]) => {
      const pixel = toPixels({ x, y }, sceneViewport, sceneAspect);
      return [pixel.x, pixel.y];
    });

  const renderShape = (key: string, shape: Shape, dim = false) => {
    const stroke = shape.color ?? '#111111';
    // Stroke width is normalized to the surface, so it scales with the view.
    const width = Math.max(1, (shape.width ?? 0.004) * sceneViewport.width);
    const opacity = (shape.kind === 'highlighter' ? 0.35 : 1) * (dim ? 0.7 : 1);

    switch (shape.kind) {
      case 'pen': {
        const outline = penOutline(shape, sceneViewport, sceneAspect);
        return <KonvaShape key={key} fill={stroke} opacity={opacity}
          sceneFunc={(context, node) => { if (tracePenOutline(context, outline)) context.fillStrokeShape(node); }} />;
      }
      case 'highlighter':
      case 'erase':
        return (
          <Line
            key={key}
            points={flatten(shape.points ?? [])}
            stroke={shape.kind === 'erase' ? '#ffffff' : stroke}
            strokeWidth={shape.kind === 'erase' ? width * 3 : width}
            opacity={opacity}
            lineCap="round"
            lineJoin="round"
            tension={0.3}
            globalCompositeOperation={shape.kind === 'erase' ? 'destination-out' : 'source-over'}
          />
        );
      case 'line':
      case 'arrow': {
        const from = toPixels({ x: shape.x1 ?? 0, y: shape.y1 ?? 0 }, sceneViewport, sceneAspect);
        const to = toPixels({ x: shape.x2 ?? 0, y: shape.y2 ?? 0 }, sceneViewport, sceneAspect);
        const points = [from.x, from.y, to.x, to.y];
        return shape.kind === 'arrow' ? (
          <Arrow key={key} points={points} stroke={stroke} fill={stroke} strokeWidth={width} opacity={opacity} />
        ) : (
          <Line key={key} points={points} stroke={stroke} strokeWidth={width} opacity={opacity} />
        );
      }
      case 'rect': {
        const origin = toPixels({ x: shape.x ?? 0, y: shape.y ?? 0 }, sceneViewport, sceneAspect);
        const box = letterbox(sceneViewport, sceneAspect);
        return (
          <Rect
            key={key}
            x={origin.x}
            y={origin.y}
            width={(shape.w ?? 0) * box.width}
            height={(shape.h ?? 0) * box.height}
            stroke={stroke}
            strokeWidth={width}
            opacity={opacity}
          />
        );
      }
      case 'ellipse': {
        const origin = toPixels({ x: shape.x ?? 0, y: shape.y ?? 0 }, sceneViewport, sceneAspect);
        const box = letterbox(sceneViewport, sceneAspect);
        return (
          <Ellipse
            key={key}
            x={origin.x + ((shape.w ?? 0) * box.width) / 2}
            y={origin.y + ((shape.h ?? 0) * box.height) / 2}
            radiusX={Math.abs(((shape.w ?? 0) * box.width) / 2)}
            radiusY={Math.abs(((shape.h ?? 0) * box.height) / 2)}
            stroke={stroke}
            strokeWidth={width}
            opacity={opacity}
          />
        );
      }
      case 'text': {
        const origin = toPixels({ x: shape.x ?? 0, y: shape.y ?? 0 }, sceneViewport, sceneAspect);
        const box = letterbox(sceneViewport, sceneAspect);
        return (
          <Text
            key={key}
            x={origin.x}
            y={origin.y}
            // Konva draws text as canvas glyphs, never as DOM, so markup in a
            // label cannot become an element.
            text={shape.text ?? ''}
            fontSize={shapeTextSizePx(shape.size, box.height)}
            fontFamily={textStyleFor(shape.font, shape.bold).fontFamily}
            fontStyle={textStyleFor(shape.font, shape.bold).fontStyle}
            lineHeight={1.22}
            wrap="word"
            width={Math.max(10, box.width - (origin.x - box.left))}
            fill={stroke}
            opacity={opacity}
          />
        );
      }
      default:
        return null;
    }
  };

  const pendingIds = new Set(pendingOnPage.map((entry) => entry.id));
  const visibleRemoteDrafts = remoteDrafts.filter((entry) => {
    // Avoid double-thick ink while the old preview and saved line overlap.
    const id = entry.id.slice(entry.id.lastIndexOf(':') + 1);
    return !shapes.some((saved) => saved.operationId === id);
  });
  const selectedShape = selectedId ? shapes.find((entry) => entry.operationId === selectedId) : undefined;
  const movedShape =
    selectedShape && dragDelta ? translateShape(selectedShape.shape, dragDelta.dx, dragDelta.dy) : null;
  const selectionBounds = (movedShape ?? selectedShape?.shape) && shapeBounds(movedShape ?? selectedShape!.shape);

  const backgroundBox = letterbox(sceneViewport, sceneAspect);
  const textPosition = textEdit && projection ? notebookRawToScreen({ x: textEdit.nx, y: textEdit.ny }, projection, viewport, view) : textEdit?.px;
  const textBoxHeight = projection ? letterbox(viewport, projection.aspect).height * view.zoom : backgroundBox.height;

  return (
    <div
      ref={containerRef}
      className="whiteboard__surface"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onWheel={onWheel}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onBlur={() => {
        spaceHeld.current = false;
      }}
      onContextMenu={(event) => event.preventDefault()}
      style={{ touchAction: 'none', overflow: projection ? 'hidden' : undefined }}
    >
      {projection && <canvas ref={projectedCanvasRef} aria-hidden="true" data-notebook-projection=""
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />}
      <Stage
        ref={stageRef}
        width={sceneViewport.width}
        height={sceneViewport.height}
        x={projection ? 0 : view.panX}
        y={projection ? 0 : view.panY}
        scaleX={projection ? 1 : view.zoom}
        scaleY={projection ? 1 : view.zoom}
        style={projection ? { position: 'absolute', visibility: 'hidden', pointerEvents: 'none' } : undefined}
        listening={false}
      >
        {/* The page sits on its own layer: partial-erase marks cut through the
            marks layer only and must never punch holes in the PDF. */}
        <Layer ref={backgroundLayerRef} listening={false}>
          {paperColor && <Rect x={backgroundBox.left} y={backgroundBox.top} width={backgroundBox.width} height={backgroundBox.height} fill={paperColor} listening={false} />}
          {background && (
            <KonvaImage
              image={background as CanvasImageSource & HTMLImageElement}
              x={backgroundBox.left}
              y={backgroundBox.top}
              width={backgroundBox.width}
              height={backgroundBox.height}
            />
          )}
        </Layer>
        <Layer listening={false}>
          {shapes.filter((entry) => !pendingIds.has(entry.operationId)).map((entry) =>
            entry.operationId === selectedId && movedShape
              ? renderShape(entry.operationId, movedShape, true)
              : renderShape(entry.operationId, entry.shape),
          )}
          {pendingOnPage.map((entry) => renderShape(`pending-${entry.id}`, entry.shape))}
          {draft && renderShape('draft', draft)}
          {visibleRemoteDrafts.map((entry) => renderShape(`live-${entry.id}`, entry.shape))}
        </Layer>
        <Layer listening={false}>
          {selectionBounds && (
            <Rect
              x={toPixels({ x: selectionBounds.minX, y: selectionBounds.minY }, sceneViewport, sceneAspect).x - 6}
              y={toPixels({ x: selectionBounds.minX, y: selectionBounds.minY }, sceneViewport, sceneAspect).y - 6}
              width={(selectionBounds.maxX - selectionBounds.minX) * backgroundBox.width + 12}
              height={(selectionBounds.maxY - selectionBounds.minY) * backgroundBox.height + 12}
              stroke="#0353a4"
              strokeWidth={1.5 / view.zoom}
              dash={[6 / view.zoom, 4 / view.zoom]}
            />
          )}
          {ownLaser && (
            <Circle
              x={toPixels(ownLaser, sceneViewport, sceneAspect).x}
              y={toPixels(ownLaser, sceneViewport, sceneAspect).y}
              radius={7 / view.zoom}
              fill="#d62828"
              opacity={0.85}
            />
          )}
          {lasers.map((laser) => {
            const at = toPixels({ x: laser.x, y: laser.y }, sceneViewport, sceneAspect);
            return <Circle key={laser.id} x={at.x} y={at.y} radius={7 / view.zoom} fill="#d62828" opacity={0.85} />;
          })}
        </Layer>
      </Stage>

      {projectionError && <div className="whiteboard__ink-save-alert" role="alert" data-tablet-no-ink=""
        onPointerDown={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()}>
        <span>Не удалось обработать тетрадь. Повторите загрузку кадра.</span>
        <button type="button" onClick={event => { event.stopPropagation(); setProjectionAttempt(current => current + 1); }}>Повторить</button>
      </div>}

      {pendingOnPage.some((entry) => entry.status === 'failed') && (
        <div className="whiteboard__ink-save-alert" role="alert" data-tablet-no-ink=""
          onPointerDown={(event) => event.stopPropagation()}
          onPointerUp={(event) => event.stopPropagation()}
          onPointerMove={(event) => event.stopPropagation()}>
          <span>Не сохранено / Nicht gespeichert</span>
          <button type="button" onClick={(event) => {
            event.stopPropagation();
            for (const entry of pendingOnPage.filter((item) => item.status === 'failed')) retryInk(entry);
          }}>Повторить / Erneut</button>
        </div>
      )}

      {textEdit && (
        <textarea
          ref={focusTextInput}
          className="whiteboard__text-input"
          style={{ left: textPosition?.x, top: textPosition?.y, color,
            fontFamily: textStyleFor(textFont, textBold).fontFamily,
            fontWeight: textBold ? 700 : 400,
            fontSize: Math.max(12, textFontSize * (textBoxHeight / 800)) }}
          aria-label="Text"
          placeholder="Текст / Text..."
          rows={2}
          maxLength={500}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') commitText(event.currentTarget.value);
            if (event.key === 'Escape') setTextEdit(null);
            event.stopPropagation();
          }}
          onBlur={(event) => commitText(event.currentTarget.value)}
        />
      )}
    </div>
  );
});
