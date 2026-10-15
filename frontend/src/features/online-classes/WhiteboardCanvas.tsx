import Konva from 'konva';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Arrow, Circle, Ellipse, Image as KonvaImage, Layer, Line, Rect, Shape as KonvaShape, Stage, Text } from 'react-konva';
import {
  type RenderableShape,
  type Shape,
  letterbox,
  thinStroke,
  toNormalized,
  toPixels,
} from './annotations';
import {
  DEFAULT_VIEW,
  type PageView,
  type Point,
  panBy,
  screenToBoard,
  zoomAbout,
} from './boardView';
import { GestureController, type Intent } from './gestureController';
import { shapeAt } from './hitTest';
import { type InputMode, isPalmContact, normalizePointerKind } from './inputPolicy';
import { shapeBounds, translateShape } from './shapeTransform';
import { penOutline, tracePenOutline } from './freehand';

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
  | 'laser';

/** Eraser behaviour: wipe the part under the eraser, or delete the whole stroke. */
export type EraserMode = 'partial' | 'stroke';

/** Freehand input fires far faster than the wire needs; sampling caps it. */
const SAMPLE_INTERVAL_MS = 16;

/** Hit tolerance for the eraser and selection, in normalized units. */
const HIT_TOLERANCE = 0.015;

export interface WhiteboardCanvasHandle {
  /** PNG of the board as currently drawn, or null before it has a size. */
  toDataURL: () => string | null;
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
  sourceAspect: number | null;
  readOnly?: boolean;
  eraserMode?: EraserMode;
  inputMode?: InputMode;
  /** Zoom and pan for the visible page. Controlled by the parent. */
  view?: PageView;
  onViewChange?: (view: PageView) => void;
  /** Student under follow mode: the canvas may not be moved by the viewer. */
  navigationLocked?: boolean;
  /** Rendered page content (PDF page) under the marks. */
  background?: CanvasImageSource | null;
  lasers?: RemoteLaser[];
  /** Other people's strokes that are still being drawn (preview only). */
  remoteDrafts?: { id: string; shape: Shape }[];
  /** Whose marks this viewer may delete or move. */
  actorId?: string;
  onCommit: (shape: Shape) => void;
  onEraseShape?: (operationId: string) => void;
  onMoveShape?: (operationId: string, shape: Shape) => void;
  onLaserMove?: (point: { x: number; y: number }) => void;
  /** The stroke being drawn changed; `null` once the pen is up or it was cancelled. */
  onDraftChange?: (shape: Shape | null) => void;
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
    sourceAspect,
    readOnly = false,
    eraserMode = 'partial',
    inputMode = 'finger',
    view = DEFAULT_VIEW,
    onViewChange,
    navigationLocked = false,
    background = null,
    lasers = [],
    remoteDrafts = [],
    actorId,
    onCommit,
    onEraseShape,
    onMoveShape,
    onLaserMove,
    onDraftChange,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<Konva.Stage | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [draft, setDraft] = useState<Shape | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragDelta, setDragDelta] = useState<{ dx: number; dy: number } | null>(null);
  const [textEdit, setTextEdit] = useState<{ px: Point; nx: number; ny: number } | null>(null);
  const draftRef = useRef<Shape | null>(null);
  const [ownLaser, setOwnLaser] = useState<{ x: number; y: number } | null>(null);
  const ownLaserTimer = useRef<number | undefined>(undefined);
  const lastSample = useRef(0);
  const dragStart = useRef<{ point: { x: number; y: number }; id: string } | null>(null);
  const dragDeltaRef = useRef<{ dx: number; dy: number } | null>(null);

  // Latest values for the long-lived gesture controller and its callbacks.
  const live = useRef({ tool, color, strokeWidth, eraserMode, readOnly, view, viewport, sourceAspect, shapes, actorId });
  live.current = { tool, color, strokeWidth, eraserMode, readOnly, view, viewport, sourceAspect, shapes, actorId };

  useImperativeHandle(ref, () => ({
    toDataURL: () => stageRef.current?.toDataURL({ pixelRatio: 1 }) ?? null,
    getSize: () => live.current.viewport,
  }));

  // The surface is responsive; normalized coordinates mean a resize never
  // moves existing strokes relative to the content.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) setViewport({ width: box.width, height: box.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const eraseHits = useRef(new Set<string>());
  const spaceHeld = useRef(false);

  /** Local pixel → normalized page coordinate, through the current zoom/pan. */
  const toPage = useCallback((local: Point) => {
    const { view: currentView, viewport: size, sourceAspect: aspect } = live.current;
    return toNormalized(screenToBoard(local, currentView), size, aspect);
  }, []);

  const aspectOfBoard = () => {
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
              ? { pressures: [Math.max(0, Math.min(1, pressure))] } : {}) }
        : active === 'line' || active === 'arrow'
          ? { kind: active, color: ink, width, x1: point.x, y1: point.y, x2: point.x, y2: point.y }
          : { kind: active, color: ink, width, x: point.x, y: point.y, w: 0, h: 0 };
    draftRef.current = next;
    setDraft(next);
    onDraftChange?.(next);
  };

  const eraseAt = (point: { x: number; y: number }) => {
    const hit = shapeAt(live.current.shapes, point, HIT_TOLERANCE, aspectOfBoard());
    if (!hit || eraseHits.current.has(hit.operationId)) return;
    // Only your own marks can be deleted; the board enforces it too.
    if (live.current.actorId && hit.layerOwnerId !== live.current.actorId) return;
    eraseHits.current.add(hit.operationId);
    onEraseShape?.(hit.operationId);
  };

  const moveStroke = (local: Point, pressure?: number) => {
    const { tool: active, eraserMode: eraser } = live.current;
    const now = performance.now();
    if (now - lastSample.current < SAMPLE_INTERVAL_MS) return;
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
    let next: Shape;
    if (current.points) {
      next = { ...current, points: [...current.points, [point.x, point.y]],
        ...(current.pressures ? { pressures: [...current.pressures,
          pressure !== undefined && Number.isFinite(pressure) ? Math.max(0, Math.min(1, pressure)) : current.pressures[current.pressures.length - 1]] } : {}) };
    } else if (current.x1 !== undefined) {
      next = { ...current, x2: point.x, y2: point.y };
    } else {
      next = { ...current, w: point.x - (current.x ?? 0), h: point.y - (current.y ?? 0) };
    }
    draftRef.current = next;
    setDraft(next);
    onDraftChange?.(next);
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
    draftRef.current = null;
    setDraft(null);
    onDraftChange?.(null);
    if (!finished) return;
    // Thinning keeps the stroke under the server's point cap without visibly
    // changing the line.
    if (finished.points) {
      const sample = thinStroke(finished.points, finished.pressures);
      onCommit({ ...finished, points: sample.points, ...(sample.pressures ? { pressures: sample.pressures } : {}) });
    } else onCommit(finished);
  };

  const cancelStroke = () => {
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

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (textEdit) return;
    const kind = normalizePointerKind(event.pointerType);
    // A resting hand must not change the zoom in stylus mode either.
    const palm = isPalmContact(kind, event.width, event.height);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Capture is a nicety (keeps a drag alive off-surface); not required.
    }
    // Middle button, or space held, moves the page instead of drawing.
    const navigate = kind === 'mouse' && (event.button === 1 || spaceHeld.current);
    if (navigate) event.preventDefault();
    applyIntents(controller.down(event.pointerId, kind, localPoint(event), palm, navigate, kind === 'pen' ? event.pressure : undefined));
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    // A laser follows the pointer even with no button down, like a real one.
    if (live.current.tool === 'laser' && event.buttons === 0) {
      const now = performance.now();
      if (now - lastSample.current >= SAMPLE_INTERVAL_MS) {
        lastSample.current = now;
        pointLaser(toPage(localPoint(event)));
      }
      return;
    }
    applyIntents(controller.move(event.pointerId, localPoint(event), event.pointerType === 'pen' ? event.pressure : undefined));
  };
  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    applyIntents(controller.up(event.pointerId));
  };
  const onPointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    applyIntents(controller.up(event.pointerId, true));
  };

  const onWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (navigationLocked || !onViewChange || controller.isDrawing) return;
    const local = localPoint(event);
    // Ctrl/⌘ + wheel (and trackpad pinch, which arrives the same way) zooms;
    // a plain wheel scrolls the zoomed page.
    if (event.ctrlKey || event.metaKey) {
      onViewChange(zoomAbout(view, view.zoom * Math.exp(-event.deltaY * 0.01), local, viewport));
    } else if (view.zoom > 1) {
      onViewChange(panBy(view, -event.deltaX, -event.deltaY, viewport));
    }
  };

  const onKeyUp = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === ' ') spaceHeld.current = false;
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === ' ') {
      spaceHeld.current = true;
      event.preventDefault();
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId && !readOnly) {
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
    if (!edit || !text || readOnly) return;
    onCommit({ kind: 'text', x: edit.nx, y: edit.ny, text: text.slice(0, 500), size: 0.03, color });
  };

  // The board takes focus back right after the pointer goes down, which would
  // blur a box focused on mount and close it empty. Focusing a frame later wins.
  const focusTextInput = useCallback((element: HTMLInputElement | null) => {
    if (element) window.requestAnimationFrame(() => element.focus());
  }, []);

  const flatten = (points: [number, number][]) =>
    points.flatMap(([x, y]) => {
      const pixel = toPixels({ x, y }, viewport, sourceAspect);
      return [pixel.x, pixel.y];
    });

  const renderShape = (key: string, shape: Shape, dim = false) => {
    const stroke = shape.color ?? '#111111';
    // Stroke width is normalized to the surface, so it scales with the view.
    const width = Math.max(1, (shape.width ?? 0.004) * viewport.width);
    const opacity = (shape.kind === 'highlighter' ? 0.35 : 1) * (dim ? 0.7 : 1);

    switch (shape.kind) {
      case 'pen': {
        const outline = penOutline(shape, viewport, sourceAspect);
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
        const from = toPixels({ x: shape.x1 ?? 0, y: shape.y1 ?? 0 }, viewport, sourceAspect);
        const to = toPixels({ x: shape.x2 ?? 0, y: shape.y2 ?? 0 }, viewport, sourceAspect);
        const points = [from.x, from.y, to.x, to.y];
        return shape.kind === 'arrow' ? (
          <Arrow key={key} points={points} stroke={stroke} fill={stroke} strokeWidth={width} opacity={opacity} />
        ) : (
          <Line key={key} points={points} stroke={stroke} strokeWidth={width} opacity={opacity} />
        );
      }
      case 'rect': {
        const origin = toPixels({ x: shape.x ?? 0, y: shape.y ?? 0 }, viewport, sourceAspect);
        const box = letterbox(viewport, sourceAspect);
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
        const origin = toPixels({ x: shape.x ?? 0, y: shape.y ?? 0 }, viewport, sourceAspect);
        const box = letterbox(viewport, sourceAspect);
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
        const origin = toPixels({ x: shape.x ?? 0, y: shape.y ?? 0 }, viewport, sourceAspect);
        const box = letterbox(viewport, sourceAspect);
        return (
          <Text
            key={key}
            x={origin.x}
            y={origin.y}
            // Konva draws text as canvas glyphs, never as DOM, so markup in a
            // label cannot become an element.
            text={shape.text ?? ''}
            fontSize={Math.max(10, (shape.size ?? 0.03) * box.height)}
            fill={stroke}
            opacity={opacity}
          />
        );
      }
      default:
        return null;
    }
  };

  const selectedShape = selectedId ? shapes.find((entry) => entry.operationId === selectedId) : undefined;
  const movedShape =
    selectedShape && dragDelta ? translateShape(selectedShape.shape, dragDelta.dx, dragDelta.dy) : null;
  const selectionBounds = (movedShape ?? selectedShape?.shape) && shapeBounds(movedShape ?? selectedShape!.shape);

  const backgroundBox = letterbox(viewport, sourceAspect);

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
      style={{ touchAction: 'none' }}
    >
      <Stage
        ref={stageRef}
        width={viewport.width}
        height={viewport.height}
        x={view.panX}
        y={view.panY}
        scaleX={view.zoom}
        scaleY={view.zoom}
        listening={false}
      >
        {/* The page sits on its own layer: partial-erase marks cut through the
            marks layer only and must never punch holes in the PDF. */}
        <Layer listening={false}>
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
          {shapes.map((entry) =>
            entry.operationId === selectedId && movedShape
              ? renderShape(entry.operationId, movedShape, true)
              : renderShape(entry.operationId, entry.shape),
          )}
          {draft && renderShape('draft', draft)}
          {remoteDrafts.map((entry) => renderShape(`live-${entry.id}`, entry.shape))}
        </Layer>
        <Layer listening={false}>
          {selectionBounds && (
            <Rect
              x={toPixels({ x: selectionBounds.minX, y: selectionBounds.minY }, viewport, sourceAspect).x - 6}
              y={toPixels({ x: selectionBounds.minX, y: selectionBounds.minY }, viewport, sourceAspect).y - 6}
              width={(selectionBounds.maxX - selectionBounds.minX) * backgroundBox.width + 12}
              height={(selectionBounds.maxY - selectionBounds.minY) * backgroundBox.height + 12}
              stroke="#0353a4"
              strokeWidth={1.5 / view.zoom}
              dash={[6 / view.zoom, 4 / view.zoom]}
            />
          )}
          {ownLaser && (
            <Circle
              x={toPixels(ownLaser, viewport, sourceAspect).x}
              y={toPixels(ownLaser, viewport, sourceAspect).y}
              radius={7 / view.zoom}
              fill="#d62828"
              opacity={0.85}
            />
          )}
          {lasers.map((laser) => {
            const at = toPixels({ x: laser.x, y: laser.y }, viewport, sourceAspect);
            return <Circle key={laser.id} x={at.x} y={at.y} radius={7 / view.zoom} fill="#d62828" opacity={0.85} />;
          })}
        </Layer>
      </Stage>

      {textEdit && (
        <input
          ref={focusTextInput}
          className="whiteboard__text-input"
          style={{ left: textEdit.px.x, top: textEdit.px.y, color }}
          aria-label="Text"
          maxLength={500}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commitText(event.currentTarget.value);
            if (event.key === 'Escape') setTextEdit(null);
            event.stopPropagation();
          }}
          onBlur={(event) => commitText(event.currentTarget.value)}
        />
      )}
    </div>
  );
});
