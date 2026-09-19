import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiRequestError } from '../../api/client';
import { onlineClassesApi, type OnlineClass, type OnlineClassConnection } from '../../api/onlineClasses';

/**
 * Phase of acquiring a connection, distinct from the LiveKit room's own
 * connection state. Kept separate so this is testable without a media stack.
 */
export type SessionPhase =
  | 'loading'
  | 'ready'
  | 'requesting'
  | 'connected'
  | 'waiting'
  | 'unavailable'
  | 'notOpen'
  | 'denied'
  | 'failed';

export interface ClassSession {
  phase: SessionPhase;
  onlineClass: OnlineClass | null;
  connection: OnlineClassConnection | null;
  errorMessage: string | null;
  requestConnection: () => Promise<void>;
  release: () => void;
  reload: () => Promise<void>;
}

/**
 * Maps a backend failure onto a phase the UI can explain.
 *
 * <p>A 404 is deliberately shown as "denied" rather than "not found": the server
 * reports forbidden and missing classes identically, and the UI must not invent
 * a distinction that would leak whether a class exists.
 */
function phaseForError(error: unknown): { phase: SessionPhase; message: string | null } {
  if (!(error instanceof ApiRequestError)) {
    return { phase: 'failed', message: null };
  }
  if (error.status === 404) {
    return { phase: 'denied', message: null };
  }
  if (error.status === 403) {
    return { phase: 'denied', message: null };
  }
  if (error.status === 409) {
    const message = error.message ?? '';
    if (/admit/i.test(message)) return { phase: 'waiting', message };
    if (/not available|not configured/i.test(message)) return { phase: 'unavailable', message };
    return { phase: 'notOpen', message };
  }
  return { phase: 'failed', message: error.message ?? null };
}

/**
 * Loads a class and, on demand, acquires a short-lived connection token.
 *
 * <p>The token is held in memory only — never in localStorage — and is dropped
 * on release so it cannot outlive the session.
 */
export function useClassSession(classId: string | undefined): ClassSession {
  const [phase, setPhase] = useState<SessionPhase>('loading');
  const [onlineClass, setOnlineClass] = useState<OnlineClass | null>(null);
  const [connection, setConnection] = useState<OnlineClassConnection | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Guards against a duplicate in-flight connection request (double-clicked
  // join button) and against setting state after unmount.
  const requestInFlight = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    if (!classId) return;
    try {
      const loaded = await onlineClassesApi.get(classId);
      if (!mounted.current) return;
      setOnlineClass(loaded);
      setPhase((current) => (current === 'loading' ? 'ready' : current));
    } catch (error) {
      if (!mounted.current) return;
      const mapped = phaseForError(error);
      setPhase(mapped.phase);
      setErrorMessage(mapped.message);
    }
  }, [classId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const requestConnection = useCallback(async () => {
    const effectiveClassId = onlineClass?.id ?? classId;
    if (!effectiveClassId || requestInFlight.current) return;
    requestInFlight.current = true;
    setPhase('requesting');
    setErrorMessage(null);
    try {
      // Students must create a waiting-room request before asking for a media
      // token. Teachers are already admitted and connect directly.
      if (onlineClass && !onlineClass.viewerIsHost) {
        await onlineClassesApi.knock(effectiveClassId);
      }

      const issued = await onlineClassesApi.connect(effectiveClassId);
      if (!mounted.current) return;
      setConnection(issued);
      setPhase('connected');
    } catch (error) {
      if (!mounted.current) return;
      const mapped = phaseForError(error);
      setPhase(mapped.phase);
      setErrorMessage(mapped.message);
    } finally {
      requestInFlight.current = false;
    }
  }, [classId, onlineClass]);

  // While a student is waiting, retry the token request automatically. As soon
  // as the teacher approves the waiting-room request, the next attempt enters
  // the room without making the student click Join again.
  useEffect(() => {
    const effectiveClassId = onlineClass?.id ?? classId;
    if (!effectiveClassId || phase !== 'waiting') return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      if (cancelled || requestInFlight.current) return;
      requestInFlight.current = true;
      onlineClassesApi.connect(effectiveClassId)
        .then((issued) => {
          if (!mounted.current || cancelled) return;
          setConnection(issued);
          setPhase('connected');
          setErrorMessage(null);
        })
        .catch((error) => {
          if (!mounted.current || cancelled) return;
          const mapped = phaseForError(error);
          if (mapped.phase !== 'waiting') {
            setPhase(mapped.phase);
            setErrorMessage(mapped.message);
          }
        })
        .finally(() => {
          requestInFlight.current = false;
        });
    }, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [classId, onlineClass, phase]);

  const release = useCallback(() => {
    setConnection(null);
    setPhase('ready');
    const effectiveClassId = onlineClass?.id ?? classId;
    if (effectiveClassId) {
      // Best effort: attendance is also reconciled server-side from provider
      // events, so a failed leave call is not fatal.
      void onlineClassesApi.leave(effectiveClassId).catch(() => undefined);
    }
  }, [classId, onlineClass]);

  return { phase, onlineClass, connection, errorMessage, requestConnection, release, reload };
}
