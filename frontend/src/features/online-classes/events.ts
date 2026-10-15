/**
 * Realtime class events. Mirrors docs/online-classes/01-realtime-event-protocol.md.
 *
 * Parsing is deliberately strict: a packet arrives from another participant's
 * browser and is untrusted input. Anything malformed, oversized, or from a
 * different class is dropped rather than partially applied.
 */

export const CHAT_TOPIC = 'mc.class.chat.v1';
export const REACTION_TOPIC = 'mc.class.reaction.v1';
export const HAND_TOPIC = 'mc.class.hand.v1';
export const POINTER_TOPIC = 'mc.class.pointer.v1';
export const ANNOTATION_TOPIC = 'mc.class.annotation.v1';
export const CONTROL_TOPIC = 'mc.class.control.v1';
/** Teacher's shared-board view (page, zoom, pan) for "follow the teacher". */
export const VIEW_TOPIC = 'mc.class.view.v1';
/** In-progress strokes, shown to others while the pen is still down. */
export const STROKE_TOPIC = 'mc.class.stroke.v1';

/** Hard cap per packet; annotation batches are chunked below this. */
export const MAX_PACKET_BYTES = 8192;

/** Fixed set, so arbitrary strings never reach the render path. */
export const REACTIONS = ['clap', 'thumbsUp', 'smile', 'confused', 'party'] as const;
export type ReactionEmoji = (typeof REACTIONS)[number];

interface BaseEvent {
  v: 1;
  classId: string;
  id: string;
  at: number;
}

export interface HandEvent extends BaseEvent {
  type: 'hand';
  raised: boolean;
}

export interface ReactionEvent extends BaseEvent {
  type: 'reaction';
  emoji: ReactionEmoji;
}

export interface ChatEvent extends BaseEvent {
  type: 'chat';
  clientMessageId: string;
  body: string;
}

export interface PointerEvent_ extends BaseEvent {
  type: 'pointer';
  targetId: string;
  x: number;
  y: number;
}

/**
 * The teacher's view of the shared board. Pan is a fraction of the board size,
 * not pixels, so a tablet and a laptop land on the same part of the page.
 */
export interface ViewEvent extends BaseEvent {
  type: 'view';
  boardId: string;
  page: number;
  pageCount: number;
  zoom: number;
  panX: number;
  panY: number;
  /** Whether students are currently locked to this view. */
  follow: boolean;
}

/**
 * A durable annotation operation was saved. A hint only: any participant can
 * publish data, so receivers never apply anything from the packet and instead
 * replay from their last known sequence over REST.
 */
export interface AnnotationEvent extends BaseEvent {
  type: 'annotation';
  documentId: string;
  operationId: string;
  sequence: number;
  op: string;
  layerOwnerId: string;
}

export const STROKE_KINDS = ['pen', 'highlighter', 'line', 'arrow', 'rect', 'ellipse'] as const;
export type StrokeKind = (typeof STROKE_KINDS)[number];

/** Most points a live preview may carry; the saved stroke is never capped by this. */
export const MAX_LIVE_POINTS = 240;

/** The geometry of a stroke being drawn. Purely visual, never stored. */
export interface LiveShape {
  kind: StrokeKind;
  color: string;
  width: number;
  points?: [number, number][];
  pressures?: number[];
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
}

/**
 * A stroke that is still being drawn. Lossy and ephemeral: it only exists so
 * others see the line grow, and the saved stroke (fetched from the server)
 * replaces it. `active: false` means the pen came up, so the preview can go.
 */
export interface StrokeEvent extends BaseEvent {
  type: 'stroke';
  targetId: string;
  page: number;
  active: boolean;
  shape?: LiveShape;
}

/** Server-authored. Clients render these but never send them. */
export interface ControlEvent {
  v: 1;
  type: 'unmute-request';
  classId: string;
  userId: string;
  version: number;
}

export type ClassEvent =
  | HandEvent
  | ReactionEvent
  | ChatEvent
  | PointerEvent_
  | ViewEvent
  | AnnotationEvent
  | StrokeEvent;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasBase(value: Record<string, unknown>, classId: string): boolean {
  return (
    value.v === 1 &&
    typeof value.id === 'string' &&
    typeof value.at === 'number' &&
    // A packet for another class is dropped: room membership is not a licence
    // to inject events into a different class's state.
    value.classId === classId
  );
}

/**
 * Parses an incoming packet, returning null when it is not a valid event for
 * this class. Never throws: one bad packet must not break the room.
 */
export function parseClassEvent(raw: Uint8Array, classId: string): ClassEvent | null {
  if (raw.byteLength > MAX_PACKET_BYTES) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !hasBase(parsed, classId)) return null;

  switch (parsed.type) {
    case 'hand':
      return typeof parsed.raised === 'boolean' ? (parsed as unknown as HandEvent) : null;
    case 'reaction':
      return REACTIONS.includes(parsed.emoji as ReactionEmoji)
        ? (parsed as unknown as ReactionEvent)
        : null;
    case 'chat':
      return typeof parsed.body === 'string' &&
        parsed.body.length > 0 &&
        parsed.body.length <= 2000 &&
        typeof parsed.clientMessageId === 'string'
        ? (parsed as unknown as ChatEvent)
        : null;
    case 'pointer':
      return typeof parsed.targetId === 'string' &&
        typeof parsed.x === 'number' &&
        typeof parsed.y === 'number' &&
        // Coordinates are normalized to the surface, so anything outside 0..1
        // is malformed rather than merely off-screen.
        parsed.x >= 0 &&
        parsed.x <= 1 &&
        parsed.y >= 0 &&
        parsed.y <= 1
        ? (parsed as unknown as PointerEvent_)
        : null;
    case 'view':
      return typeof parsed.boardId === 'string' &&
        isInt(parsed.page, 0, 10_000) &&
        isInt(parsed.pageCount, 1, 10_000) &&
        isFiniteIn(parsed.zoom, 1, 5) &&
        isFiniteIn(parsed.panX, -5, 0) &&
        isFiniteIn(parsed.panY, -5, 0) &&
        typeof parsed.follow === 'boolean'
        ? (parsed as unknown as ViewEvent)
        : null;
    case 'annotation':
      return typeof parsed.documentId === 'string' &&
        typeof parsed.operationId === 'string' &&
        typeof parsed.op === 'string' &&
        typeof parsed.layerOwnerId === 'string' &&
        isInt(parsed.sequence, 0, Number.MAX_SAFE_INTEGER)
        ? (parsed as unknown as AnnotationEvent)
        : null;
    case 'stroke': {
      if (typeof parsed.targetId !== 'string' || !isInt(parsed.page, 0, 10_000)) return null;
      if (typeof parsed.active !== 'boolean') return null;
      if (!parsed.active) return parsed as unknown as StrokeEvent;
      return parseLiveShape(parsed.shape) ? (parsed as unknown as StrokeEvent) : null;
    }
    default:
      return null;
  }
}

/** Fixed colour format, so arbitrary strings never reach the canvas style. */
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function parseLiveShape(value: unknown): value is LiveShape {
  if (!isRecord(value)) return false;
  if (!STROKE_KINDS.includes(value.kind as StrokeKind)) return false;
  if (typeof value.color !== 'string' || !HEX_COLOR.test(value.color)) return false;
  if (!isFiniteIn(value.width, 0, 0.2)) return false;
  for (const key of ['x', 'y', 'w', 'h', 'x1', 'y1', 'x2', 'y2']) {
    const field = value[key];
    if (field !== undefined && !isFiniteIn(field, -2, 2)) return false;
  }
  if (value.points !== undefined) {
    if (!Array.isArray(value.points) || value.points.length > MAX_LIVE_POINTS) return false;
    for (const point of value.points) {
      if (!Array.isArray(point) || point.length !== 2) return false;
      if (!isFiniteIn(point[0], -2, 2) || !isFiniteIn(point[1], -2, 2)) return false;
    }
  }
  if (value.pressures !== undefined) {
    if (!Array.isArray(value.points) || !Array.isArray(value.pressures)) return false;
    if (value.pressures.length !== value.points.length) return false;
    if (!value.pressures.every((p: unknown) => isFiniteIn(p, 0, 1))) return false;
  }
  return true;
}

function isInt(value: unknown, min: number, max: number): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function isFiniteIn(value: unknown, min: number, max: number): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

export function parseControlEvent(raw: Uint8Array, classId: string): ControlEvent | null {
  if (raw.byteLength > MAX_PACKET_BYTES) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed.v !== 1 || parsed.classId !== classId) return null;
  if (parsed.type !== 'unmute-request' || typeof parsed.userId !== 'string') return null;
  return parsed as unknown as ControlEvent;
}

function newId(): string {
  return typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function encodeEvent(event: ClassEvent): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(event));
}

export function handEvent(classId: string, raised: boolean): HandEvent {
  return { v: 1, type: 'hand', classId, id: newId(), at: Date.now(), raised };
}

export function reactionEvent(classId: string, emoji: ReactionEmoji): ReactionEvent {
  return { v: 1, type: 'reaction', classId, id: newId(), at: Date.now(), emoji };
}

export function chatEvent(classId: string, clientMessageId: string, body: string): ChatEvent {
  return { v: 1, type: 'chat', classId, id: newId(), at: Date.now(), clientMessageId, body };
}

export function viewEvent(
  classId: string,
  view: Omit<ViewEvent, 'v' | 'type' | 'classId' | 'id' | 'at'>,
): ViewEvent {
  return { v: 1, type: 'view', classId, id: newId(), at: Date.now(), ...view };
}

export function annotationEvent(
  classId: string,
  operation: Omit<AnnotationEvent, 'v' | 'type' | 'classId' | 'id' | 'at'>,
): AnnotationEvent {
  return { v: 1, type: 'annotation', classId, id: newId(), at: Date.now(), ...operation };
}

export function pointerEvent(classId: string, targetId: string, x: number, y: number): PointerEvent_ {
  return { v: 1, type: 'pointer', classId, id: newId(), at: Date.now(), targetId, x, y };
}

export function strokeEvent(
  classId: string,
  targetId: string,
  page: number,
  active: boolean,
  shape?: LiveShape,
): StrokeEvent {
  return { v: 1, type: 'stroke', classId, id: newId(), at: Date.now(), targetId, page, active, shape };
}
