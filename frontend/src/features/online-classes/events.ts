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
/** A pupil's visible document area, sent privately to their teacher. */
export const STUDENT_VIEW_TOPIC = 'mc.class.student-view.v1';
/** In-progress strokes, shown to others while the pen is still down. */
export const STROKE_TOPIC = 'mc.class.stroke.v1';
/** Private notebook previews stay separate from the same pupil's paper board. */
export const NOTEBOOK_STROKE_TOPIC = 'mc.class.notebook-stroke.v1';
/** New workbook pages are available to the class. */
export const DOCUMENT_TOPIC = 'mc.class.document.v1';
/** A durable page was opened; peers re-read their authorized page metadata. */
export const BOARD_PAGES_TOPIC = 'mc.class.pages.v1';

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

export interface DocumentEvent extends BaseEvent {
  type: 'document';
  version: number;
}

/** A private refresh hint, never an instruction to navigate or trust a count. */
export interface BoardPagesEvent extends BaseEvent {
  type: 'pages';
  targetType: 'WHITEBOARD' | 'NOTEBOOK_CAMERA';
  targetId: string;
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

/** Point on `event.page` beneath the clear scroll viewport's centre. */
export interface DocumentViewport {
  zoom: number;
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
  /** Optional whole-document zoom/anchor; absent for legacy paged navigation. */
  documentView?: DocumentViewport;
}

/** The visible rectangle in coordinates of `page`, including space around it. */
export interface StudentViewSnapshot {
  page: number;
  pageCount: number;
  layout: 'paged' | 'continuous';
  viewport: { width: number; height: number };
  region: { x: number; y: number; width: number; height: number };
  /** Continuous page gap divided by the selected page's rendered width. */
  pageGap?: number;
}

/** Independent of "follow the teacher": receiving it never controls a pupil. */
export interface StudentViewEvent extends BaseEvent, StudentViewSnapshot {
  type: 'student-view';
  boardId: string;
  targetType: 'WHITEBOARD' | 'NOTEBOOK_CAMERA';
  /** Changes when the source board remounts; revisions are local to a session. */
  sessionId: string;
  revision: number;
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
  /** Stable operation ID of the stroke: the saved annotation uses this same ID. */
  strokeId?: string;
  /** Increasing packet number: prevents delayed old previews from rewinding a line. */
  revision?: number;
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
  | BoardPagesEvent
  | DocumentEvent
  | HandEvent
  | ReactionEvent
  | ChatEvent
  | PointerEvent_
  | ViewEvent
  | StudentViewEvent
  | AnnotationEvent
  | StrokeEvent;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isDocumentViewport(value: unknown): value is DocumentViewport {
  return isRecord(value) && !Array.isArray(value)
    && isFiniteIn(value.zoom, 1, 5) && isFiniteIn(value.x, -10, 10) && isFiniteIn(value.y, -10, 10);
}

export function isStudentViewSnapshot(value: unknown): value is StudentViewSnapshot {
  if (!isRecord(value) || Array.isArray(value)
      || !isInt(value.page, 0, 9999) || !isInt(value.pageCount, 1, 10_000)
      || (value.page as number) >= (value.pageCount as number)
      || (value.layout !== 'paged' && value.layout !== 'continuous')
      || !isRecord(value.viewport) || Array.isArray(value.viewport)
      || !isRecord(value.region) || Array.isArray(value.region)) return false;
  return isFiniteIn(value.viewport.width, 1, 32768)
    && isFiniteIn(value.viewport.height, 1, 32768)
    && isFiniteIn(value.region.x, -100, 100)
    && isFiniteIn(value.region.y, -100, 100)
    // Local zoom is capped at 5×, so valid regions stay at least 0.2 pages
    // wide/high. Leave ample margin without accepting a pathological crop
    // that would allocate an enormous continuous document on the teacher.
    && isFiniteIn(value.region.width, 0.05, 100)
    && isFiniteIn(value.region.height, 0.05, 100)
    && (value.pageGap === undefined || isFiniteIn(value.pageGap, 0, 10));
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
    case 'pages': {
      const targetId = parsed.targetId;
      const owner = typeof targetId === 'string' && targetId.startsWith('personal-workbook-')
        ? targetId.slice('personal-workbook-'.length)
        : typeof targetId === 'string' && targetId.startsWith('personal-') ? targetId.slice('personal-'.length) : '';
      return (parsed.targetType === 'WHITEBOARD' || parsed.targetType === 'NOTEBOOK_CAMERA')
        && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(owner)
        && isFiniteIn(parsed.at, 0, Number.MAX_SAFE_INTEGER)
        ? (parsed as unknown as BoardPagesEvent) : null;
    }
    case 'document':
      return isInt(parsed.version, 1, Number.MAX_SAFE_INTEGER) ? (parsed as unknown as DocumentEvent) : null;
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
        typeof parsed.follow === 'boolean' &&
        (parsed.documentView === undefined || isDocumentViewport(parsed.documentView))
        ? (parsed as unknown as ViewEvent)
        : null;
    case 'student-view':
      return typeof parsed.boardId === 'string' && /^personal-.{1,128}$/.test(parsed.boardId)
        && (parsed.targetType === 'WHITEBOARD' || parsed.targetType === 'NOTEBOOK_CAMERA')
        && typeof parsed.sessionId === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(parsed.sessionId)
        && isInt(parsed.revision, 0, Number.MAX_SAFE_INTEGER)
        && isFiniteIn(parsed.at, 0, Number.MAX_SAFE_INTEGER)
        && isStudentViewSnapshot(parsed)
        ? (parsed as unknown as StudentViewEvent)
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
      if (parsed.strokeId !== undefined &&
          (typeof parsed.strokeId !== 'string' ||
           !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parsed.strokeId))) {
        return null;
      }
      if (parsed.revision !== undefined && !isInt(parsed.revision, 0, 1_000_000_000)) return null;
      if (!parsed.active) {
        return parsed.shape === undefined || parseLiveShape(parsed.shape)
          ? (parsed as unknown as StrokeEvent) : null;
      }
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

export function documentEvent(classId: string, version: number): DocumentEvent {
  return { v: 1, type: 'document', classId, id: newId(), at: Date.now(), version };
}

export function boardPagesEvent(classId: string, targetType: BoardPagesEvent['targetType'], targetId: string): BoardPagesEvent {
  return { v: 1, type: 'pages', classId, id: newId(), at: Date.now(), targetType, targetId };
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

export function studentViewEvent(
  classId: string,
  view: Omit<StudentViewEvent, 'v' | 'type' | 'classId' | 'id' | 'at'>,
): StudentViewEvent {
  return { v: 1, type: 'student-view', classId, id: newId(), at: Date.now(), ...view };
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
  strokeId?: string,
  revision?: number,
): StrokeEvent {
  return { v: 1, type: 'stroke', classId, id: newId(), at: Date.now(), targetId, page, active, shape, strokeId, revision };
}
