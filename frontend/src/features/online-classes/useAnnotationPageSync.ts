import { useCallback, useEffect, useRef } from 'react';
import { onlineClassesApi, type AnnotationDocument, type AnnotationTargetType } from '../../api/onlineClasses';
import { annotationPageCount, MAX_ANNOTATION_PAGES } from './annotationPages';
import { personalBoardOwner } from './boards';
import { BOARD_PAGES_TOPIC, boardPagesEvent } from './events';
import { useClassEvents } from './useClassEvents';

const POLL_MS = 2000;
const HINT_DELAY_MS = 100;

/** Append-only page discovery; navigation, zoom and ink remain local. Realtime
 * only accelerates an authorized metadata read, so lost or forged hints cannot
 * invent pages. Blank annotation documents are durable before they announce. */
export function useAnnotationPageSync({
  classId, targetType, targetId, actorId, isHost, hostUserId, active, onPageCount,
}: {
  classId: string;
  targetType: AnnotationTargetType;
  targetId: string;
  actorId: string;
  isHost: boolean;
  hostUserId: string | null;
  active: boolean;
  onPageCount: (count: number) => void;
}) {
  const ownerId = personalBoardOwner(targetId);
  const privateAccess = Boolean(ownerId && (actorId === ownerId || (isHost && actorId === hostUserId)));
  const scope = JSON.stringify([classId, targetType, targetId, actorId, isHost, hostUserId, active]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const countCallback = useRef(onPageCount);
  countCallback.current = onPageCount;
  const requestRefresh = useRef<() => void>(() => {});
  const announced = useRef(new Set<string>());
  const { publish } = useClassEvents(classId, BOARD_PAGES_TOPIC, ({ event, senderIdentity }) => {
    if (!privateAccess || !active || event.type !== 'pages' || event.classId !== classId
      || event.targetType !== targetType || event.targetId !== targetId) return;
    const sender = senderIdentity?.split('|')[0];
    if (!sender || (sender !== ownerId && sender !== hostUserId)) return;
    requestRefresh.current();
  }, Boolean(ownerId && privateAccess && active));

  useEffect(() => {
    if (!active || (ownerId && !privateAccess)) return;
    let alive = true;
    let inFlight = false;
    let pending = false;
    let knownCount = 1;
    let refreshTimer: number | undefined;
    const live = () => alive && currentScope.current === scope && document.visibilityState !== 'hidden';
    const schedule = () => {
      if (!live()) return;
      if (inFlight) { pending = true; return; }
      if (refreshTimer !== undefined) return;
      refreshTimer = window.setTimeout(() => { refreshTimer = undefined; void refresh(); }, HINT_DELAY_MS);
    };
    const refresh = async () => {
      if (!live()) return;
      if (inFlight) { pending = true; return; }
      inFlight = true;
      try {
        const documents = await onlineClassesApi.listAnnotationDocuments(classId);
        if (live()) {
          knownCount = annotationPageCount(documents, targetType, targetId, knownCount);
          countCallback.current(knownCount);
        }
      } catch {
        // Keep the last known pages through temporary network failures.
      } finally {
        inFlight = false;
        if (pending && live()) { pending = false; schedule(); }
      }
    };
    requestRefresh.current = schedule;
    void refresh();
    const interval = ownerId ? window.setInterval(() => void refresh(), POLL_MS) : undefined;
    const onVisible = () => { if (document.visibilityState !== 'hidden') void refresh(); };
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      if (requestRefresh.current === schedule) requestRefresh.current = () => {};
      window.clearInterval(interval);
      window.clearTimeout(refreshTimer);
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [active, classId, ownerId, privateAccess, scope, targetId, targetType]);

  const documentReady = useCallback((document: AnnotationDocument) => {
    if (!active || !privateAccess || currentScope.current !== scope
      || (targetType !== 'WHITEBOARD' && targetType !== 'NOTEBOOK_CAMERA')
      || document.targetType !== targetType || document.targetId !== targetId
      || !Number.isInteger(document.pageIndex) || document.pageIndex < 0 || document.pageIndex >= MAX_ANNOTATION_PAGES) return;
    countCallback.current(annotationPageCount([document], targetType, targetId));
    const key = JSON.stringify([classId, targetType, targetId, document.id]);
    if (announced.current.has(key)) return;
    announced.current.add(key);
    // An explicit recipient list must never degrade into a room-wide broadcast.
    void publish(boardPagesEvent(classId, targetType, targetId), true,
      [ownerId, hostUserId].filter((id): id is string => Boolean(id)));
  }, [active, classId, hostUserId, ownerId, privateAccess, publish, scope, targetId, targetType]);

  return { documentReady };
}
