import { useCallback, useEffect, useRef, useState } from 'react';
import type { AnnotationTargetType } from '../../api/onlineClasses';
import {
  MAX_LIVE_POINTS,
  NOTEBOOK_STROKE_TOPIC,
  STROKE_KINDS,
  STROKE_TOPIC,
  type LiveShape,
  type StrokeKind,
  strokeEvent,
} from './events';
import { useClassEvents } from './useClassEvents';
import { personalBoardId } from './boards';

/** Matches the protocol's ≤ 20 Hz cap for lossy traffic. */
const SEND_INTERVAL_MS = 50;
/** A preview with no update for this long is dropped (the sender vanished). */
const STALE_AFTER_MS = 15_000;
/**
 * After the pen comes up the preview stays until the saved stroke has had time
 * to arrive from the server, so the line never blinks out and back in.
 */
const LINGER_AFTER_END_MS = 20_000;
const SWEEP_MS = 300;
const MAX_CONFIRMED_STROKES = 512;

export interface LiveDraft {
  /** Sender identity: each person has at most one stroke in progress. */
  id: string;
  shape: LiveShape;
}

interface Entry {
  shape: LiveShape;
  page: number;
  updatedAt: number;
  strokeId?: string;
  revision?: number;
  /** Set once the pen came up (or the save was announced). */
  removeAt: number | null;
}

/**
 * Preview geometry uses the same canonical points as the local and saved
 * stroke. Never simplify short handwriting: dropping intermediate samples at
 * pen-up was making equations visibly morph on students' screens.
 *
 * Only unusually long strokes exceed the transport's 240-point packet cap.
 * Those are evenly sampled for realtime, while the saved version stays exact.
 */
function sampleIndexes(count: number): number[] {
  if (count <= MAX_LIVE_POINTS) return Array.from({ length: count }, (_, i) => i);
  return Array.from({ length: MAX_LIVE_POINTS }, (_, i) =>
    Math.round(i * (count - 1) / (MAX_LIVE_POINTS - 1)));
}

export function capPoints(points: [number, number][]): [number, number][] {
  return sampleIndexes(points.length).map((index) => points[index]);
}

/** Keep wire size bounded without changing the contour at a visible scale. */
const roundCoordinate = (value: number) => Math.round(value * 10000) / 10000;
const roundPressure = (value: number) => Math.round(value * 100) / 100;

/** Only these shapes can be previewed live; the eraser and text are not. */
export function toLiveShape(shape: {
  kind: string;
  color?: string;
  width?: number;
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
}): LiveShape | null {
  if (!STROKE_KINDS.includes(shape.kind as StrokeKind)) return null;
  if (typeof shape.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(shape.color)) return null;
  const live: LiveShape = {
    kind: shape.kind as StrokeKind,
    color: shape.color,
    width: shape.width ?? 0.004,
  };
  if (shape.points) {
    const indexes = sampleIndexes(shape.points.length);
    live.points = indexes.map((i) => {
      const point = shape.points![i];
      return [roundCoordinate(point[0]), roundCoordinate(point[1])] as [number, number];
    });
    // Keep pressure and coordinates aligned; never re-run a simplifier after
    // the line has already been displayed to students.
    const pressure = shape.kind === 'pen' ? shape.pressures : undefined;
    if (pressure && pressure.length === shape.points.length) {
      live.pressures = indexes.map((i) => roundPressure(pressure[i]));
    }
  }
  for (const key of ['x', 'y', 'w', 'h', 'x1', 'y1', 'x2', 'y2'] as const) {
    if (shape[key] !== undefined) live[key] = shape[key];
  }
  return live;
}

/**
 * Live strokes: others watch a line grow while it is being drawn.
 *
 * <p>Purely a preview. Packets are lossy and any participant can publish, so a
 * preview is only drawn (never stored, never counted as a mark), is tied to the
 * sender's LiveKit identity rather than anything in the payload, and expires on
 * its own. The saved stroke arrives from the server as before and replaces it.
 */
export function useLiveStrokes({
  classId,
  targetId,
  targetType = 'WHITEBOARD',
  page,
  enabled,
  hostUserId,
  personalOwnerId,
  currentUserId,
}: {
  classId: string;
  targetId: string;
  targetType?: AnnotationTargetType;
  page: number;
  enabled: boolean;
  /** Privacy-limited personal-board and notebook previews. */
  hostUserId?: string | null;
  personalOwnerId?: string | null;
  currentUserId?: string | null;
}) {
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const lastSent = useRef(0);
  const sentActive = useRef(false);
  const activeStrokeId = useRef<string | undefined>(undefined);
  const activeRevision = useRef(0);
  // A final reliable packet closes the lossy stream, but may itself carry a
  // newer final shape until the authoritative saved operation arrives.
  const finalizedStrokes = useRef(new Map<string, number>());
  // Durable ACKs have operation IDs even when no preview has arrived yet.
  // Remember these separately so neither a late active nor final packet can
  // resurrect an already saved (and potentially undone) operation.
  const confirmedStrokes = useRef(new Set<string>());
  const notebook = targetType === 'NOTEBOOK_CAMERA';
  const topic = notebook ? NOTEBOOK_STROKE_TOPIC : STROKE_TOPIC;
  const canAccess = (!notebook || Boolean(personalOwnerId && targetId === personalBoardId(personalOwnerId))) && (!personalOwnerId || Boolean(currentUserId &&
    (currentUserId === personalOwnerId || currentUserId === hostUserId)));
  const receiving = enabled && canAccess;

  useEffect(() => {
    setEntries({});
    lastSent.current = 0;
    sentActive.current = false;
    activeStrokeId.current = undefined;
    activeRevision.current = 0;
    finalizedStrokes.current.clear();
    confirmedStrokes.current.clear();
  }, [classId, targetId, targetType]);

  useEffect(() => {
    // A page kept mounted while scrolling must never revive stale unfinished
    // handwriting when it becomes visible again.
    if (!receiving) setEntries((current) => Object.keys(current).length ? {} : current);
  }, [receiving]);

  const { publish } = useClassEvents(classId, topic, ({ event, senderIdentity }) => {
    if (!receiving || event.type !== 'stroke' || event.targetId !== targetId || event.page !== page || !senderIdentity) return;
    const now = Date.now();
    // Personal board previews must only originate from its owner or teacher,
    // and must never be visible to other students.
    const senderUser = senderIdentity.split('|')[0];
    if (personalOwnerId && senderUser !== personalOwnerId && senderUser !== hostUserId) return;
    if (event.strokeId && confirmedStrokes.current.has(event.strokeId)) return;
    const id = event.strokeId ? senderIdentity + ':' + event.strokeId : senderIdentity;
    if (event.strokeId && event.active && finalizedStrokes.current.has(id)) return;
    if (!event.active && event.strokeId) {
      finalizedStrokes.current.set(id, now);
      if (finalizedStrokes.current.size > 512) {
        const oldest = finalizedStrokes.current.keys().next().value;
        if (oldest) finalizedStrokes.current.delete(oldest);
      }
    }
    if (event.shape) {
      setEntries((current) => {
        const previous = current[id];
        // A lossy update can arrive after a newer packet; never make a pupil's
        // writing jump backwards because of network reordering.
        if (event.revision !== undefined && previous?.revision !== undefined &&
            event.revision <= previous.revision) return current;
        if (previous?.removeAt !== null && previous?.removeAt !== undefined && event.active) return current;
        return {
          ...current,
          [id]: {
            shape: event.shape!,
            page: event.page,
            strokeId: event.strokeId,
            revision: event.revision,
            updatedAt: now,
            removeAt: event.active ? null : now + LINGER_AFTER_END_MS,
          },
        };
      });
    } else if (!event.active) {
      setEntries((current) => {
        const previous = current[id];
        if (!previous) return current;
        if (event.revision !== undefined && previous.revision !== undefined &&
            event.revision <= previous.revision) return current;
        return { ...current, [id]: { ...previous, revision: event.revision,
          removeAt: now + LINGER_AFTER_END_MS } };
      });
    }
  }, receiving);

  // Drop previews that finished or went quiet.
  useEffect(() => {
    if (Object.keys(entries).length === 0) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      setEntries((current) => {
        const next: Record<string, Entry> = {};
        let changed = false;
        for (const [key, entry] of Object.entries(current)) {
          const expired =
            (entry.removeAt !== null && entry.removeAt <= now) ||
            now - entry.updatedAt > STALE_AFTER_MS + (entry.removeAt === null ? 0 : LINGER_AFTER_END_MS);
          if (expired) changed = true;
          else next[key] = entry;
        }
        return changed ? next : current;
      });
    }, SWEEP_MS);
    return () => window.clearInterval(timer);
  }, [entries]);

  /**
   * Remove previews only AFTER their matching saved ADD is confirmed by the
   * server-authoritative replay, including ADDs subsequently undone. A hint
   * alone is not enough: REST may still be loading and create a blank gap.
   */
  const acknowledgeRendered = useCallback((operationIds: readonly string[]) => {
    if (operationIds.length === 0) return;
    const acknowledged = new Set(operationIds);
    for (const id of operationIds) {
      confirmedStrokes.current.delete(id);
      confirmedStrokes.current.add(id);
      if (confirmedStrokes.current.size > MAX_CONFIRMED_STROKES) {
        const oldest = confirmedStrokes.current.values().next().value;
        if (oldest !== undefined) confirmedStrokes.current.delete(oldest);
      }
    }
    setEntries((current) => {
      let changed = false;
      const next: Record<string, Entry> = {};
      for (const [key, entry] of Object.entries(current)) {
        if (entry.strokeId && acknowledged.has(entry.strokeId)) {
          changed = true;
        } else {
          next[key] = entry;
        }
      }
      return changed ? next : current;
    });
  }, []);

  // Compatible with older callers. A hint must not remove unconfirmed ink.
  const settle = useCallback((_userId: string) => undefined, []);

  /**
   * First point goes immediately; interim updates are capped to 20Hz.
   * Pen-up sends the WHOLE last shape in a reliable packet with the same ID.
   * Every stroke has its own ID, so fast consecutive math symbols coexist.
   */
  const sendDraft = useCallback(
    (shape: LiveShape | null, strokeId?: string, finished = false) => {
      if (!receiving) return;
      // Personal boards are private, including interim pencil coordinates.
      const destinations = personalOwnerId
        ? [personalOwnerId, hostUserId].filter((id): id is string => Boolean(id))
        : undefined;
      const id = strokeId ?? activeStrokeId.current;
      if (!shape) {
        if (!sentActive.current) return;
        sentActive.current = false;
        activeStrokeId.current = undefined;
        lastSent.current = 0;
        activeRevision.current += 1;
        void publish(strokeEvent(classId, targetId, page, false, undefined, id,
          activeRevision.current), true, destinations);
        return;
      }
      const now = performance.now();
      const isNew = id !== activeStrokeId.current;
      if (!finished && !isNew && now - lastSent.current < SEND_INTERVAL_MS) return;
      if (isNew) activeRevision.current = 0;
      activeRevision.current += 1;
      lastSent.current = now;
      activeStrokeId.current = id;
      sentActive.current = !finished;
      void publish(strokeEvent(classId, targetId, page, !finished, shape, id,
        activeRevision.current), finished, destinations);
      if (finished) {
        activeStrokeId.current = undefined;
        lastSent.current = 0;
      }
    },
    [receiving, classId, hostUserId, page, personalOwnerId, publish, targetId],
  );

  const drafts: LiveDraft[] = Object.entries(entries)
    .filter(([, entry]) => receiving && entry.page === page)
    .map(([id, entry]) => ({ id, shape: entry.shape }));

  return { drafts, sendDraft, settle, acknowledgeRendered };
}
