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

/** How often a waiting student re-checks whether the teacher let them in. */
const WAIT_POLL_MS = 2000;

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
    // A declined student must not wait forever for an answer that has been given.
    if (/declined/i.test(message)) return { phase: 'denied', message };
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
  const waitTimer = useRef<number | undefined>(undefined);

  const stopWaiting = useCallback(() => {
    window.clearTimeout(waitTimer.current);
    waitTimer.current = undefined;
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      window.clearTimeout(waitTimer.current);
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

  /**
   * One attempt to get a token. A student who is not admitted yet knocks once,
   * so the teacher's waiting room lists them, then keeps asking until the
   * teacher lets them in (or the page goes away).
   */
  const attempt = useCallback(
    async (firstTry: boolean): Promise<void> => {
      if (!classId) return;
      try {
        const issued = await onlineClassesApi.connect(classId);
        if (!mounted.current) return;
        stopWaiting();
        setConnection(issued);
        setPhase('connected');
      } catch (error) {
        if (!mounted.current) return;
        const mapped = phaseForError(error);
        setPhase(mapped.phase);
        setErrorMessage(mapped.message);
        if (mapped.phase === 'waiting') {
          // Idempotent on the server; a failed knock is retried by the next
          // attempt's connect, which answers "waiting" again.
          if (firstTry) void onlineClassesApi.knock(classId).catch(() => undefined);
          stopWaiting();
          waitTimer.current = window.setTimeout(() => void attempt(false), WAIT_POLL_MS);
        } else {
          stopWaiting();
        }
      }
    },
    [classId, stopWaiting],
  );

  const requestConnection = useCallback(async () => {
    if (!classId || requestInFlight.current) return;
    requestInFlight.current = true;
    stopWaiting();
    setPhase('requesting');
    setErrorMessage(null);
    try {
      await attempt(true);
    } finally {
      requestInFlight.current = false;
    }
  }, [attempt, classId, stopWaiting]);

  const release = useCallback(() => {
    stopWaiting();
    setConnection(null);
    setPhase('ready');
    if (classId) {
      // Best effort: attendance is also reconciled server-side from provider
      // events, so a failed leave call is not fatal.
      void onlineClassesApi.leave(classId).catch(() => undefined);
    }
  }, [classId, stopWaiting]);

  return { phase, onlineClass, connection, errorMessage, requestConnection, release, reload };
}
