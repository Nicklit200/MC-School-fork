import Konva from 'konva';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Arrow, Circle, Ellipse, Layer, Line, Rect, Stage, Text } from 'react-konva';
import {
  compactStrokePoints,
  type RenderableShape,
  type Shape,
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

/** Laser movement may be sampled; handwriting itself is collected losslessly. */
const LASER_SAMPLE_INTERVAL_MS = 16;

interface Props {
  shapes: RenderableShape[];
  tool: Tool;
  color: string;
  strokeWidth: number;
  sourceAspect: number | null;
  backgroundImageUrl?: string | null;
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
  backgroundImageUrl,
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
  const laserActive = useRef(false);
  const activePointerId = useRef<number | null>(null);
  const activePointerType = useRef<string | null>(null);
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

  const rawPointerToNormalized = useCallback(
    (pointerEvent: PointerEvent, stage: Konva.Stage) => {
      const rect = stage.container().getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      const pixel = {
        x: (pointerEvent.clientX - rect.left) * (stage.width() / rect.width),
        y: (pointerEvent.clientY - rect.top) * (stage.height() / rect.height),
      };
      return toNormalized(pixel, viewport, sourceAspect);
    },
    [sourceAspect, viewport],
  );

  const handleDown = (event: Konva.KonvaEventObject<PointerEvent>) => {
    if (readOnly) return;

    // Tablet rule: fingers/palms never create marks. Apple Pencil / stylus
    // arrives as pointerType="pen"; desktop mouse remains supported.
    if (event.evt.pointerType === 'touch') return;

    // Keep the accepted device type for the lifetime of the stroke. This also
    // makes it explicit that a touch pointer can never take over a pen stroke.
    const pointerType = event.evt.pointerType || 'mouse';

    // Ignore a second simultaneous pointer so a palm or another input cannot
    // interrupt an active stylus stroke.
    if (
      activePointerId.current !== null
      && activePointerId.current !== event.evt.pointerId
    ) {
      return;
    }

    event.evt.preventDefault();
    event.evt.stopPropagation();
    try {
      const target = event.evt.currentTarget as Element | null;
      target?.setPointerCapture?.(event.evt.pointerId);
    } catch {
      // Safari/Konva may manage capture itself; drawing still continues.
    }
    activePointerId.current = event.evt.pointerId;
    activePointerType.current = pointerType;
    lastSample.current = 0;

    const point = pointerToNormalized(event.target.getStage()!);
    if (!point) {
      activePointerId.current = null;
      activePointerType.current = null;
      return;
    }

    if (tool === 'laser') {
      laserActive.current = true;
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
    if (event.evt.pointerType === 'touch') return;
    if (
      activePointerType.current === 'touch'
      || activePointerId.current === null
      || activePointerId.current !== event.evt.pointerId
    ) {
      return;
    }

    event.evt.preventDefault();
    const stage = event.target.getStage();
    if (!stage) return;

    if (tool === 'laser' && !readOnly) {
      if (!laserActive.current) return;
      const now = performance.now();
      if (now - lastSample.current < LASER_SAMPLE_INTERVAL_MS) return;
      lastSample.current = now;
      const point = pointerToNormalized(stage);
      if (point) {
        const at = Date.now();
        setLocalLaserTrail((current) => [...current.filter((p) => at - p.at < 1800), { ...point, at }].slice(-120));
        onLaserMove?.(point);
      }
      return;
    }

    if (!drawing.current || !draftRef.current) return;

    const current = draftRef.current;
    let next: Shape;

    if (current.points) {
      // Browsers may bundle several high-frequency Apple Pencil samples into a
      // single pointermove. Consume the whole bundle; otherwise fast strokes
      // can lose segments or become a one-point (invisible) stroke.
      const coalesced =
        typeof event.evt.getCoalescedEvents === 'function'
          ? event.evt.getCoalescedEvents()
          : [];
      const rawEvents = coalesced.length > 0 ? coalesced : [event.evt];
      const appended: [number, number][] = [];
      const existing = current.points;
      let previous = existing[existing.length - 1];

      for (const rawEvent of rawEvents) {
        const point = rawPointerToNormalized(rawEvent, stage);
        if (!point) continue;
        const candidate: [number, number] = [point.x, point.y];
        // Only remove exact/sub-pixel duplicates, never meaningful handwriting
        // samples. This keeps quick hooks, dots and short number strokes.
        if (
          !previous
          || Math.hypot(candidate[0] - previous[0], candidate[1] - previous[1]) > 0.00005
        ) {
          appended.push(candidate);
          previous = candidate;
        }
      }

      if (appended.length === 0) return;
      next = { ...current, points: [...existing, ...appended] };
    } else {
      const point = rawPointerToNormalized(event.evt, stage) ?? pointerToNormalized(stage);
      if (!point) return;
      if (current.x1 !== undefined) {
        next = { ...current, x2: point.x, y2: point.y };
      } else {
        next = { ...current, w: point.x - (current.x ?? 0), h: point.y - (current.y ?? 0) };
      }
    }

    draftRef.current = next;
    setDraft(next);

    const id = draftIdRef.current;
    if (id) {
      // Keep the same geometry locally and remotely while the Pencil moves.
      // Delta transport already keeps realtime packets small, so there is no
      // need to reshape handwriting mid-stroke.
      onDraftChange?.(id, next);
    }
  };

  const handleUp = (event?: Konva.KonvaEventObject<PointerEvent>) => {
    if (event) {
      if (event.evt.pointerType === 'touch') return;
      if (
        activePointerId.current !== null
        && activePointerId.current !== event.evt.pointerId
      ) {
        return;
      }
      event.evt.preventDefault();
      event.evt.stopPropagation();
      try {
        const target = event.evt.currentTarget as Element | null;
        target?.releasePointerCapture?.(event.evt.pointerId);
      } catch {
        // Ignore capture-release races.
      }
    }

    if (tool === 'laser') {
      laserActive.current = false;
      activePointerId.current = null;
      activePointerType.current = null;
      return;
    }

    let current = draftRef.current;
    if (!drawing.current || !current) {
      activePointerId.current = null;
      activePointerType.current = null;
      return;
    }

    if (event) {
      const stage = event.target.getStage();
      const finalPoint = stage
        ? (rawPointerToNormalized(event.evt, stage) ?? pointerToNormalized(stage))
        : null;

      if (finalPoint) {
        if (current.points) {
          const lastPoint = current.points[current.points.length - 1];
          const finalTuple: [number, number] = [finalPoint.x, finalPoint.y];
          if (
            !lastPoint
            || Math.hypot(finalTuple[0] - lastPoint[0], finalTuple[1] - lastPoint[1]) > 0.00005
          ) {
            current = { ...current, points: [...current.points, finalTuple] };
          } else if (current.points.length === 1) {
            // A tap/tiny stroke still needs two points for Konva to render it.
            current = { ...current, points: [...current.points, finalTuple] };
          }
        } else if (current.x1 !== undefined) {
          current = { ...current, x2: finalPoint.x, y2: finalPoint.y };
        } else {
          current = {
            ...current,
            w: finalPoint.x - (current.x ?? 0),
            h: finalPoint.y - (current.y ?? 0),
          };
        }
      }
    }

    draftRef.current = current;
    drawing.current = false;
    const operationId = draftIdRef.current ?? undefined;
    // Do not re-shape handwriting when the Pencil is lifted. Normal strokes
    // keep every sampled point; only very long uninterrupted strokes are
    // compacted, with sub-pixel coordinate rounding.
    const finished = current.points
      ? { ...current, points: compactStrokePoints(current.points) }
      : current;
    draftRef.current = null;
    draftIdRef.current = null;
    if (operationId) {
      setCommittedDraft({ operationId, shape: finished });
    }
    setDraft(null);
    activePointerId.current = null;
    activePointerType.current = null;
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
      {backgroundImageUrl && (
        <img
          className="whiteboard__background"
          src={backgroundImageUrl}
          alt=""
          aria-hidden="true"
          draggable={false}
        />
      )}
      <Stage
        width={viewport.width}
        height={viewport.height}
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerCancel={handleUp}
        onPointerLeave={(event) => {
          if (event.evt.pointerType === 'touch') return;
          if (
            activePointerId.current !== null
            && activePointerId.current !== event.evt.pointerId
          ) {
            return;
          }
          laserActive.current = false;
          handleUp(event);
        }}
        style={{ touchAction: 'pinch-zoom' }}
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
