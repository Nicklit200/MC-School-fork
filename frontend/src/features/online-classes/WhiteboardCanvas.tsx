import Konva from 'konva';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Arrow, Ellipse, Layer, Line, Rect, Stage, Text } from 'react-konva';
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
  onCommit: (shape: Shape) => void;
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
  onLaserMove,
  onRequestText,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [draft, setDraft] = useState<Shape | null>(null);
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
      onLaserMove?.(point);
      return;
    }
    if (tool === 'text') {
      const text = onRequestText?.();
      if (text) onCommit({ kind: 'text', x: point.x, y: point.y, text, size: 0.03, color });
      return;
    }

    drawing.current = true;
    if (tool === 'pen' || tool === 'highlighter' || tool === 'erase') {
      setDraft({ kind: tool, color, width: strokeWidth, points: [[point.x, point.y]] });
    } else if (tool === 'line' || tool === 'arrow') {
      setDraft({ kind: tool, color, width: strokeWidth, x1: point.x, y1: point.y, x2: point.x, y2: point.y });
    } else {
      setDraft({ kind: tool, color, width: strokeWidth, x: point.x, y: point.y, w: 0, h: 0 });
    }
  };

  const handleMove = (event: Konva.KonvaEventObject<PointerEvent>) => {
    const stage = event.target.getStage();
    if (!stage) return;

    if (tool === 'laser' && !readOnly) {
      const now = performance.now();
      if (now - lastSample.current < SAMPLE_INTERVAL_MS) return;
      lastSample.current = now;
      const point = pointerToNormalized(stage);
      if (point) onLaserMove?.(point);
      return;
    }

    if (!drawing.current || !draft) return;
    const now = performance.now();
    if (now - lastSample.current < SAMPLE_INTERVAL_MS) return;
    lastSample.current = now;

    const point = pointerToNormalized(stage);
    if (!point) return;

    setDraft((current) => {
      if (!current) return current;
      if (current.points) {
        return { ...current, points: [...current.points, [point.x, point.y]] };
      }
      if (current.x1 !== undefined) {
        return { ...current, x2: point.x, y2: point.y };
      }
      return { ...current, w: point.x - (current.x ?? 0), h: point.y - (current.y ?? 0) };
    });
  };

  const handleUp = () => {
    if (!drawing.current || !draft) return;
    drawing.current = false;
    // Thinning keeps the stroke under the server's point cap without visibly
    // changing the line.
    const finished = draft.points ? { ...draft, points: thinPoints(draft.points) } : draft;
    setDraft(null);
    onCommit(finished);
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
          {draft && renderShape('draft', draft)}
        </Layer>
      </Stage>
    </div>
  );
}
