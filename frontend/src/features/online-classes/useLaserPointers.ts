import { useCallback, useEffect, useRef, useState } from 'react';
import { POINTER_TOPIC, pointerEvent } from './events';
import type { RemoteLaser } from './WhiteboardCanvas';
import { useClassEvents } from './useClassEvents';

/** Matches the protocol's ≤ 20 Hz cap for lossy pointer traffic. */
const SEND_INTERVAL_MS = 50;
/** A dot disappears if its owner stops moving the pointer. */
const FADE_AFTER_MS = 1200;

/**
 * Ephemeral laser pointer: broadcast lossily, shown briefly, never stored.
 * The dot of the person pointing is keyed by their identity, so each person
 * has at most one on screen.
 */
export function useLaserPointers(classId: string, targetId: string) {
  const [lasers, setLasers] = useState<(RemoteLaser & { at: number })[]>([]);
  const lastSent = useRef(0);

  const { publish } = useClassEvents(classId, POINTER_TOPIC, ({ event, senderIdentity }) => {
    if (event.type !== 'pointer' || event.targetId !== targetId || !senderIdentity) return;
    const now = Date.now();
    setLasers((current) => [
      ...current.filter((laser) => laser.id !== senderIdentity),
      { id: senderIdentity, x: event.x, y: event.y, at: now },
    ]);
  });

  useEffect(() => {
    if (lasers.length === 0) return;
    const timer = window.setTimeout(() => {
      const cutoff = Date.now() - FADE_AFTER_MS;
      setLasers((current) => current.filter((laser) => laser.at > cutoff));
    }, FADE_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [lasers]);

  const sendLaser = useCallback(
    (point: { x: number; y: number }) => {
      const now = performance.now();
      if (now - lastSent.current < SEND_INTERVAL_MS) return;
      lastSent.current = now;
      void publish(pointerEvent(classId, targetId, point.x, point.y), false);
    },
    [classId, publish, targetId],
  );

  return { lasers: lasers as RemoteLaser[], sendLaser };
}
