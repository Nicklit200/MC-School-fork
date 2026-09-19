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

/** Server-authored. Clients render these but never send them. */
export interface ControlEvent {
  v: 1;
  type: 'unmute-request';
  classId: string;
  userId: string;
  version: number;
}

export type ClassEvent = HandEvent | ReactionEvent | ChatEvent | PointerEvent_;

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
    default:
      return null;
  }
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
