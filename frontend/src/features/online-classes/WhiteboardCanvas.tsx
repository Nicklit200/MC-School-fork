import Konva from 'konva';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Arrow, Circle, Ellipse, Layer, Line, Rect, Stage, Text } from 'react-konva';
import {
  type RenderableShape,
  type Shape,
  thinPoints,
  toNormalized,
  toPixels,
} from './annotations';

export type Tool =
  | 'pen'
  | 'highlighter'
  | 'line'
  | 'arrow'
  | 'rect'
  | 'ellipse'
  | 'text'
  | 'erase'
  | 'laser';

/** Freehand input fires far faster than the wire needs; sampling caps it. */
const SAMPLE_INTERVAL_MS = 16;

interface Props {
  shapes: RenderableShape[];
  tool: Tool;
  color: string;
  strokeWidth: number;
  sourceAspect: number | null;
  readOnly?: boolean;
  onCommit: (shape: Shape, operationId?: string) => void;
  onDraftChange?: (operationId: string, shape: Shape) => void;
  remoteLaserPointers?: { actorId: string; points: { x: number; y: number; at: number }[] }[];
  onLaserMove?: (point: { x: number; y: number }) => void;
  onRequestText?: () => string | null;
}

/**
 * Konva rendering surface.
 *
 * <p>Deliberately thin: geometry, folding and permissions live in
 * `annotations.ts` and `useAnnotationBoard`, which are unit-tested without a
 * canvas. This component converts pointer events to normalized coordinates and
 * draws what it is given.
 */
export function WhiteboardCanvas({
  shapes,
  tool,
  color,
  strokeWidth,
  sourceAspect,
  readOnly = false,
  onCommit,
  onDraftChange,
  remoteLaserPointers = [],
  onLaserMove,
  onRequestText,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [draft, setDraft] = useState<Shape | null>(null);
  const [committedDraft, setCommittedDraft] = useState<{ operationId: string; shape: Shape } | null>(null);
  const [localLaserTrail, setLocalLaserTrail] = useState<
    { x: number; y: number; at: number }[]
  >([]);
  const [laserNow, setLaserNow] = useState(() => Date.now());
  const draftRef = useRef<Shape | null>(null);
  const draftIdRef = useRef<string | null>(null);
  const drawing = useRef(false);
  const lastSample = useRef(0);

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

  useEffect(() => {
    if (!committedDraft) return;
    if (shapes.some((entry) => entry.operationId === committedDraft.operationId)) {
      setCommittedDraft(null);
      return;
    }

    // Safety valve for a rejected/failed commit. Normally this never fires:
    // the optimistic board operation appears immediately.
    const timer = window.setTimeout(() => setCommittedDraft(null), 3000);
    return () => window.clearTimeout(timer);
  }, [committedDraft, shapes]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      setLaserNow(now);
      setLocalLaserTrail((current) =>
        current.filter((point) => now - point.at < 1800),
      );
    }, 50);
    return () => window.clearInterval(timer);
  }, []);

  const pointerToNormalized = useCallback(
    (stage: Konva.Stage) => {
      const position = stage.getPointerPosition();
      if (!position) return null;
      return toNormalized(position, viewport, sourceAspect);
    },
    [sourceAspect, viewport],
  );

  const handleDown = (event: Konva.KonvaEventObject<PointerEvent>) => {
    if (readOnly) return;
    const point = pointerToNormalized(event.target.getStage()!);
    if (!point) return;

    if (tool === 'laser') {
      const at = Date.now();
      setLocalLaserTrail((current) => [...current.filter((p) => at - p.at < 1800), { ...point, at }].slice(-120));
      onLaserMove?.(point);
      return;
    }
    if (tool === 'text') {
      const text = onRequestText?.();
      if (text) onCommit({ kind: 'text', x: point.x, y: point.y, text, size: 0.03, color });
      return;
    }

    drawing.current = true;
    draftIdRef.current =
      typeof crypto?.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    let initial: Shape;
    if (tool === 'pen' || tool === 'highlighter' || tool === 'erase') {
      initial = { kind: tool, color, width: strokeWidth, points: [[point.x, point.y]] };
    } else if (tool === 'line' || tool === 'arrow') {
      initial = { kind: tool, color, width: strokeWidth, x1: point.x, y1: point.y, x2: point.x, y2: point.y };
    } else {
      initial = { kind: tool, color, width: strokeWidth, x: point.x, y: point.y, w: 0, h: 0 };
    }
    draftRef.current = initial;
    setDraft(initial);
    if (draftIdRef.current) onDraftChange?.(draftIdRef.current, initial);
  };

  const handleMove = (event: Konva.KonvaEventObject<PointerEvent>) => {
    const stage = event.target.getStage();
    if (!stage) return;

    if (tool === 'laser' && !readOnly) {
      const now = performance.now();
      if (now - lastSample.current < SAMPLE_INTERVAL_MS) return;
      lastSample.current = now;
      const point = pointerToNormalized(stage);
      if (point) {
        const at = Date.now();
        setLocalLaserTrail((current) => [...current.filter((p) => at - p.at < 1800), { ...point, at }].slice(-120));
        onLaserMove?.(point);
      }
      return;
    }

    if (!drawing.current || !draft) return;
    const now = performance.now();
    if (now - lastSample.current < SAMPLE_INTERVAL_MS) return;
    lastSample.current = now;

    const point = pointerToNormalized(stage);
    if (!point) return;

    const current = draftRef.current;
    if (!current) return;

    let next: Shape;
    if (current.points) {
      next = { ...current, points: [...current.points, [point.x, point.y]] };
    } else if (current.x1 !== undefined) {
      next = { ...current, x2: point.x, y2: point.y };
    } else {
      next = { ...current, w: point.x - (current.x ?? 0), h: point.y - (current.y ?? 0) };
    }

    draftRef.current = next;
    setDraft(next);

    const id = draftIdRef.current;
    if (id) {
      const preview =
        next.points && next.points.length > 2
          ? { ...next, points: thinPoints(next.points) }
          : next;
      onDraftChange?.(id, preview);
    }
  };

  const handleUp = () => {
    const current = draftRef.current;
    if (!drawing.current || !current) return;
    drawing.current = false;
    const operationId = draftIdRef.current ?? undefined;
    // Thinning keeps the stroke under the server's point cap without visibly
    // changing the line.
    const finished = current.points ? { ...current, points: thinPoints(current.points) } : current;
    draftRef.current = null;
    draftIdRef.current = null;
    if (operationId) {
      setCommittedDraft({ operationId, shape: finished });
    }
    setDraft(null);
    onCommit(finished, operationId);
  };

  const flatten = (points: [number, number][]) =>
    points.flatMap(([x, y]) => {
      const pixel = toPixels({ x, y }, viewport, sourceAspect);
      return [pixel.x, pixel.y];
    });

  const renderShape = (key: string, shape: Shape) => {
    const stroke = shape.color ?? '#111111';
    // Stroke width is normalized to the surface, so it scales with the view.
    const width = Math.max(1, (shape.width ?? 0.004) * viewport.width);
    const opacity = shape.kind === 'highlighter' ? 0.35 : 1;

    switch (shape.kind) {
      case 'pen':
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
          <Arrow key={key} points={points} stroke={stroke} fill={stroke} strokeWidth={width} />
        ) : (
          <Line key={key} points={points} stroke={stroke} strokeWidth={width} />
        );
      }
      case 'rect': {
        const origin = toPixels({ x: shape.x ?? 0, y: shape.y ?? 0 }, viewport, sourceAspect);
        return (
          <Rect
            key={key}
            x={origin.x}
            y={origin.y}
            width={(shape.w ?? 0) * viewport.width}
            height={(shape.h ?? 0) * viewport.height}
            stroke={stroke}
            strokeWidth={width}
          />
        );
      }
      case 'ellipse': {
        const origin = toPixels({ x: shape.x ?? 0, y: shape.y ?? 0 }, viewport, sourceAspect);
        return (
          <Ellipse
            key={key}
            x={origin.x + ((shape.w ?? 0) * viewport.width) / 2}
            y={origin.y + ((shape.h ?? 0) * viewport.height) / 2}
            radiusX={Math.abs(((shape.w ?? 0) * viewport.width) / 2)}
            radiusY={Math.abs(((shape.h ?? 0) * viewport.height) / 2)}
            stroke={stroke}
            strokeWidth={width}
          />
        );
      }
      case 'text': {
        const origin = toPixels({ x: shape.x ?? 0, y: shape.y ?? 0 }, viewport, sourceAspect);
        return (
          <Text
            key={key}
            x={origin.x}
            y={origin.y}
            // Konva draws text as canvas glyphs, never as DOM, so markup in a
            // label cannot become an element.
            text={shape.text ?? ''}
            fontSize={Math.max(10, (shape.size ?? 0.03) * viewport.height)}
            fill={stroke}
          />
        );
      }
      default:
        return null;
    }
  };

  const renderLaserTrail = (
    key: string,
    points: { x: number; y: number; at: number }[],
    local: boolean,
  ) => {
    if (points.length === 0) return null;

    const visible = points.filter((point) => laserNow - point.at < 1800);
    if (visible.length === 0) return null;

    const segments = visible.slice(1).map((point, index) => {
      const previous = visible[index];
      const from = toPixels(previous, viewport, sourceAspect);
      const to = toPixels(point, viewport, sourceAspect);
      const age = Math.max(0, laserNow - point.at);
      const opacity = Math.max(0, 1 - age / 1800);

      return (
        <Line
          key={`${key}-segment-${index}`}
          points={[from.x, from.y, to.x, to.y]}
          stroke={local ? '#ff6b00' : '#dc2626'}
          strokeWidth={local ? 5 : 4.5}
          opacity={opacity}
          lineCap="round"
          lineJoin="round"
          listening={false}
        />
      );
    });

    const head = visible[visible.length - 1];
    const headPixel = toPixels(head, viewport, sourceAspect);
    const headOpacity = Math.max(0, 1 - Math.max(0, laserNow - head.at) / 1800);

    return (
      <>
        {segments}
        <Circle
          key={`${key}-halo`}
          x={headPixel.x}
          y={headPixel.y}
          radius={local ? 11 : 10}
          fill={local ? '#ff8a00' : '#ef4444'}
          opacity={0.18 * headOpacity}
          listening={false}
        />
        <Circle
          key={`${key}-dot`}
          x={headPixel.x}
          y={headPixel.y}
          radius={local ? 4.5 : 4}
          fill={local ? '#ff6b00' : '#dc2626'}
          stroke="#ffffff"
          strokeWidth={1.5}
          opacity={headOpacity}
          shadowBlur={4}
          shadowOpacity={0.3 * headOpacity}
          listening={false}
        />
      </>
    );
  };

  return (
    <div ref={containerRef} className="whiteboard__surface">
      <Stage
        width={viewport.width}
        height={viewport.height}
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerLeave={handleUp}
        style={{ touchAction: 'none' }}
      >
        <Layer listening={false}>
          {shapes.map((entry) => renderShape(entry.operationId, entry.shape))}
          {committedDraft &&
            !shapes.some((entry) => entry.operationId === committedDraft.operationId) &&
            renderShape(`committed-${committedDraft.operationId}`, committedDraft.shape)}
          {draft && renderShape('draft', draft)}
          {remoteLaserPointers.map((pointer) =>
            renderLaserTrail(`remote-laser-${pointer.actorId}`, pointer.points, false),
          )}
          {renderLaserTrail('local-laser', localLaserTrail, true)}
        </Layer>
      </Stage>
    </div>
  );
}
