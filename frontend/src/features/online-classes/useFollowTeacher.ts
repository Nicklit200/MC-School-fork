import { type Dispatch, type SetStateAction, useCallback, useEffect, useRef, useState } from 'react';
import { type BoardPages, ensurePageCount, type PageView, viewOf } from './boardView';
import { VIEW_TOPIC, isDocumentViewport, viewEvent, type DocumentViewport, type ViewEvent } from './events';
import { type BoardSize, applyHostView, describeView, isFromHost } from './followTeacher';
import { useClassEvents } from './useClassEvents';

/** The teacher repeats the view this often so a late joiner catches up quickly. */
export const HEARTBEAT_MS = 2000;
/** A student unlocks if the teacher has been silent this long (left, crashed). */
export const STALE_AFTER_MS = 6000;
/** Trailing throttle for continuous pan/zoom. */
const SEND_DELAY_MS = 100;

/**
 * "Follow the teacher" for the shared board.
 *
 * Teacher: while enabled, publishes page, zoom and pan, and keeps announcing
 * the page count even when it is off so students can reach new pages.
 * Student: mirrors the teacher while the teacher says follow is on, and the
 * caller locks their own navigation for as long as `following` is true.
 */
export function useFollowTeacher({
  classId,
  boardId,
  isHost,
  hostUserId,
  pages,
  setPages,
  getBoardSize,
  enabled = true,
  active = true,
  documentView,
  onDocumentView,
}: {
  classId: string;
  boardId: string;
  isHost: boolean;
  hostUserId: string | null;
  pages: BoardPages;
  setPages: Dispatch<SetStateAction<BoardPages>>;
  getBoardSize: (pageIndex?: number) => BoardSize;
  /** Off for personal boards: follow mode only ever applies to the shared board. */
  enabled?: boolean;
  /** Hidden boards retain their view without sending or applying navigation packets. */
  active?: boolean;
  documentView?: DocumentViewport;
  onDocumentView?: (value: DocumentViewport, page: number) => void;
}) {
  const [followEnabled, setFollowEnabled] = useState(false);
  const [following, setFollowing] = useState(false);
  const [followLayout, setFollowLayout] = useState<'continuous' | 'paged'>('paged');
  const lastHostEvent = useRef(0);
  const lastSentCount = useRef(0);
  const lastSentFollow = useRef(false);
  const pendingView = useRef<{ event: ViewEvent; hostUserId: string | null } | null>(null);

  const { publish } = useClassEvents(classId, VIEW_TOPIC, ({ event, senderIdentity }) => {
    if (!enabled || !active || isHost || event.type !== 'view' || event.classId !== classId || event.boardId !== boardId) return;
    // Any participant can publish data, so only the host's packets count.
    if (!isFromHost(senderIdentity, hostUserId)) return;
    lastHostEvent.current = Date.now();
    setFollowing(event.follow);
    if (event.follow) {
      const continuous = isDocumentViewport(event.documentView);
      setFollowLayout(continuous ? 'continuous' : 'paged');
      const size = getBoardSize(event.page);
      pendingView.current = size.width > 0 && size.height > 0 ? null : { event, hostUserId };
      setPages((current) => applyHostView(current, event, size));
      if (continuous) onDocumentView?.({ ...event.documentView! }, event.page);
    } else {
      pendingView.current = null;
      setPages((current) => ensurePageCount(current, event.pageCount));
    }
  });

  // A remote page may only mount after its packet selects it. Apply the last
  // trusted view once that page has geometry, without waiting for a heartbeat.
  useEffect(() => {
    const pending = pendingView.current;
    if (!pending) return;
    if (!enabled || !active || isHost || !following || pending.hostUserId !== hostUserId
      || pending.event.boardId !== boardId || pending.event.classId !== classId) {
      pendingView.current = null;
      return;
    }
    const size = getBoardSize(pending.event.page);
    if (!(size.width > 0 && size.height > 0)) return;
    pendingView.current = null;
    setPages((current) => applyHostView(current, pending.event, size));
  });

  const latest = useRef({ pages, followEnabled, documentView, getBoardSize, publish });
  latest.current = { pages, followEnabled, documentView, getBoardSize, publish };
  const viewNow: PageView = viewOf(pages);
  const sendScope = JSON.stringify([classId, boardId, isHost, hostUserId, enabled, active]);
  const currentScope = useRef(sendScope);
  currentScope.current = sendScope;
  const pendingSend = useRef<number | null>(null);
  const cancelSend = useCallback(() => {
    if (pendingSend.current !== null) window.clearTimeout(pendingSend.current);
    pendingSend.current = null;
  }, []);

  const send = useCallback(() => {
    // A timer from an earlier render must not publish another board's latest
    // view, even if it fires before that render's passive cleanup.
    if (currentScope.current !== sendScope || !isHost || !enabled || !active) return;
    const { pages: current, followEnabled: follow, documentView: document,
      getBoardSize: sizeNow, publish: publishNow } = latest.current;
    // A hidden board (a screen share is showing) has no size, so a view sent now
    // would be a bogus pan of zero. Students keep the last real one.
    const size = sizeNow();
    if (follow && size.width <= 0) return;
    lastSentCount.current = current.count;
    lastSentFollow.current = follow;
    void publishNow(
      viewEvent(classId, {
        ...describeView(current, viewOf(current), size, boardId, follow),
        ...(isDocumentViewport(document) ? { documentView: { ...document } } : {}),
      }),
    );
  }, [active, boardId, classId, enabled, isHost, sendScope]);

  const scheduleSend = useCallback(() => {
    if (currentScope.current !== sendScope || !isHost || !enabled || !active || pendingSend.current !== null) return;
    // Keep the first deadline. Continuous wheel/pinch updates replace only
    // latest.current, so pupils receive the moving view before the gesture ends.
    pendingSend.current = window.setTimeout(() => {
      pendingSend.current = null;
      send();
    }, SEND_DELAY_MS);
  }, [active, enabled, isHost, send, sendScope]);

  useEffect(() => {
    cancelSend();
    lastSentCount.current = 0;
    lastSentFollow.current = false;
    return cancelSend;
  }, [sendScope, cancelSend]);

  // Teacher: announce changes (throttled), and always a new page count.
  useEffect(() => {
    if (!isHost || !enabled || !active) return;
    const countChanged = pages.count !== lastSentCount.current;
    // Turning follow off must be announced too, or students stay locked.
    const followChanged = followEnabled !== lastSentFollow.current;
    if (!followEnabled && !countChanged && !followChanged && lastSentCount.current !== 0) return;
    scheduleSend();
  }, [isHost, enabled, active, followEnabled, pages, viewNow, documentView?.zoom, documentView?.x, documentView?.y, scheduleSend]);

  // Teacher: heartbeat while following.
  useEffect(() => {
    if (!isHost || !enabled || !active || !followEnabled) return;
    const timer = window.setInterval(scheduleSend, HEARTBEAT_MS);
    return () => window.clearInterval(timer);
  }, [isHost, enabled, active, followEnabled, scheduleSend]);

  // Student: release the lock if the teacher stops talking.
  useEffect(() => {
    if (isHost || !following) return;
    const timer = window.setInterval(() => {
      if (Date.now() - lastHostEvent.current > STALE_AFTER_MS) setFollowing(false);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isHost, following]);

  return {
    followEnabled,
    setFollowEnabled,
    /** True only for a student currently mirrored to the teacher. */
    following: enabled && active && !isHost && following,
    /** A temporary host layout; the caller keeps its own saved preference. */
    followLayout: enabled && active && !isHost && following ? followLayout : null,
  };
}
