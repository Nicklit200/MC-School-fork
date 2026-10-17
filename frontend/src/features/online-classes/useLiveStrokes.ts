import { useCallback, useEffect, useRef, useState } from 'react';
import { thinPoints, thinStroke } from './annotations';
import {
  MAX_LIVE_POINTS,
  STROKE_KINDS,
  STROKE_TOPIC,
  type LiveShape,
  type StrokeKind,
  strokeEvent,
} from './events';
import { useClassEvents } from './useClassEvents';

/** Matches the protocol's ≤ 20 Hz cap for lossy traffic. */
const SEND_INTERVAL_MS = 50;
/** A preview with no update for this long is dropped (the sender vanished). */
const STALE_AFTER_MS = 15_000;
/**
 * After the pen comes up the preview stays until the saved stroke has had time
 * to arrive from the server, so the line never blinks out and back in.
 */
const LINGER_AFTER_END_MS = 20_000;
/** Once the saved stroke is announced, the preview only needs a moment more. */
const LINGER_AFTER_SAVE_MS = 0;
const SWEEP_MS = 300;

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
  /** Set once the pen came up (or the save was announced). */
  removeAt: number | null;
}

/** Keeps a long freehand stroke inside the packet cap while keeping its shape. */
export function capPoints(points: [number, number][]): [number, number][] {
  const thinned = thinPoints(points);
  if (thinned.length <= MAX_LIVE_POINTS) return thinned;
  const stride = Math.ceil(thinned.length / MAX_LIVE_POINTS);
  const kept = thinned.filter((_, index) => index % stride === 0);
  const last = thinned[thinned.length - 1];
  if (kept[kept.length - 1] !== last) kept.push(last);
  return kept.slice(-MAX_LIVE_POINTS);
}

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
    const thinned = thinStroke(shape.points, shape.kind === 'pen' ? shape.pressures : undefined);
    if (thinned.points.length <= MAX_LIVE_POINTS) {
      live.points = thinned.points;
      if (thinned.pressures) live.pressures = thinned.pressures;
    } else {
      const stride = Math.ceil(thinned.points.length / MAX_LIVE_POINTS);
      const indexes = thinned.points.map((_, i) => i).filter((i) => i % stride === 0);
      if (indexes[indexes.length - 1] !== thinned.points.length - 1) indexes.push(thinned.points.length - 1);
      const capped = indexes.slice(-MAX_LIVE_POINTS);
      live.points = capped.map((i) => thinned.points[i]);
      if (thinned.pressures) live.pressures = capped.map((i) => thinned.pressures![i]);
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
  page,
  enabled,
  hostUserId,
  personalOwnerId,
}: {
  classId: string;
  targetId: string;
  page: number;
  enabled: boolean;
  /** Used only for privacy-limited personal-board previews. */
  hostUserId?: string | null;
  personalOwnerId?: string | null;
}) {
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const lastSent = useRef(0);
  const sentActive = useRef(false);
  const activeStrokeId = useRef<string | undefined>(undefined);

  const { publish } = useClassEvents(classId, STROKE_TOPIC, ({ event, senderIdentity }) => {
    if (!enabled || event.type !== 'stroke' || event.targetId !== targetId || !senderIdentity) return;
    const now = Date.now();
    // Personal board previews must only originate from its owner or teacher,
    // and must never be visible to other students.
    const senderUser = senderIdentity.split('|')[0];
    if (personalOwnerId && senderUser !== personalOwnerId && senderUser !== hostUserId) return;
    const id = event.strokeId ? senderIdentity + ':' + event.strokeId : senderIdentity;
    if (event.shape) {
      setEntries((current) => {
        const previous = current[id];
        // Ignore stale/reordered datagrams after a final (reliable) packet.
        if (previous?.removeAt !== null && previous?.removeAt !== undefined && event.active) return current;
        return {
          ...current,
          [id]: {
            shape: event.shape!,
            page: event.page,
            strokeId: event.strokeId,
            updatedAt: now,
            removeAt: event.active ? null : now + LINGER_AFTER_END_MS,
          },
        };
      });
    } else if (!event.active) {
      setEntries((current) => {
        const previous = current[id];
        if (!previous) return current;
        return { ...current, [id]: { ...previous, removeAt: now + LINGER_AFTER_END_MS } };
      });
    }
  });

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
   * Remove previews only AFTER their matching saved shape exists in the
   * server-authoritative board. An annotation notification alone is not enough:
   * the REST replay may still be loading and would create an ugly blank gap.
   */
  const acknowledgeRendered = useCallback((operationIds: readonly string[]) => {
    if (operationIds.length === 0) return;
    const visible = new Set(operationIds);
    setEntries((current) => {
      let changed = false;
      const next: Record<string, Entry> = {};
      for (const [key, entry] of Object.entries(current)) {
        if (entry.strokeId && visible.has(entry.strokeId)) {
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
      if (!enabled) return;
      const id = strokeId ?? activeStrokeId.current;
      if (!shape) {
        if (!sentActive.current) return;
        sentActive.current = false;
        activeStrokeId.current = undefined;
        lastSent.current = 0;
        void publish(strokeEvent(classId, targetId, page, false, undefined, id), true);
        return;
      }
      const now = performance.now();
      const isNew = id !== activeStrokeId.current;
      if (!finished && !isNew && now - lastSent.current < SEND_INTERVAL_MS) return;
      lastSent.current = now;
      activeStrokeId.current = id;
      sentActive.current = !finished;
      void publish(strokeEvent(classId, targetId, page, !finished, shape, id), finished);
      if (finished) {
        activeStrokeId.current = undefined;
        lastSent.current = 0;
      }
    },
    [classId, enabled, page, publish, targetId],
  );

  const drafts: LiveDraft[] = Object.entries(entries)
    .filter(([, entry]) => entry.page === page)
    .map(([id, entry]) => ({ id, shape: entry.shape }));

  return { drafts, sendDraft, settle, acknowledgeRendered };
}
