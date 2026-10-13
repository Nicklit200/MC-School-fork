import { useCallback, useEffect, useRef, useState } from 'react';
import { thinPoints } from './annotations';
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
const STALE_AFTER_MS = 3000;
/**
 * After the pen comes up the preview stays until the saved stroke has had time
 * to arrive from the server, so the line never blinks out and back in.
 */
const LINGER_AFTER_END_MS = 1500;
/** Once the saved stroke is announced, the preview only needs a moment more. */
const LINGER_AFTER_SAVE_MS = 500;
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
  if (shape.points) live.points = capPoints(shape.points);
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
}: {
  classId: string;
  targetId: string;
  page: number;
  /** Off for personal boards: nothing about them is broadcast. */
  enabled: boolean;
}) {
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const lastSent = useRef(0);
  const sentActive = useRef(false);

  const { publish } = useClassEvents(classId, STROKE_TOPIC, ({ event, senderIdentity }) => {
    if (!enabled || event.type !== 'stroke' || event.targetId !== targetId || !senderIdentity) return;
    const now = Date.now();
    if (event.active && event.shape) {
      const shape = event.shape;
      setEntries((current) => ({
        ...current,
        [senderIdentity]: { shape, page: event.page, updatedAt: now, removeAt: null },
      }));
    } else {
      setEntries((current) => {
        const existing = current[senderIdentity];
        if (!existing) return current;
        return {
          ...current,
          [senderIdentity]: { ...existing, removeAt: now + LINGER_AFTER_END_MS },
        };
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

  /** The saved stroke of this person was announced: the preview can go soon. */
  const settle = useCallback((userId: string) => {
    const now = Date.now();
    setEntries((current) => {
      let changed = false;
      const next: Record<string, Entry> = {};
      for (const [key, entry] of Object.entries(current)) {
        if (key.startsWith(`${userId}|`) && (entry.removeAt === null || entry.removeAt > now + LINGER_AFTER_SAVE_MS)) {
          next[key] = { ...entry, removeAt: now + LINGER_AFTER_SAVE_MS };
          changed = true;
        } else {
          next[key] = entry;
        }
      }
      return changed ? next : current;
    });
  }, []);

  /** Announces the stroke being drawn (throttled); `null` means the pen came up. */
  const sendDraft = useCallback(
    (shape: LiveShape | null) => {
      if (!enabled) return;
      if (shape === null) {
        if (!sentActive.current) return;
        sentActive.current = false;
        lastSent.current = 0;
        void publish(strokeEvent(classId, targetId, page, false), true);
        return;
      }
      const now = performance.now();
      if (now - lastSent.current < SEND_INTERVAL_MS) return;
      lastSent.current = now;
      sentActive.current = true;
      void publish(strokeEvent(classId, targetId, page, true, shape), false);
    },
    [classId, enabled, page, publish, targetId],
  );

  const drafts: LiveDraft[] = Object.entries(entries)
    .filter(([, entry]) => entry.page === page)
    .map(([id, entry]) => ({ id, shape: entry.shape }));

  return { drafts, sendDraft, settle };
}
