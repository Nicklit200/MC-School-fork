import { type Dispatch, type SetStateAction, useCallback, useEffect, useRef, useState } from 'react';
import { type BoardPages, ensurePageCount, type PageView, viewOf } from './boardView';
import { VIEW_TOPIC, viewEvent } from './events';
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
}: {
  classId: string;
  boardId: string;
  isHost: boolean;
  hostUserId: string | null;
  pages: BoardPages;
  setPages: Dispatch<SetStateAction<BoardPages>>;
  getBoardSize: () => BoardSize;
  /** Off for personal boards: follow mode only ever applies to the shared board. */
  enabled?: boolean;
}) {
  const [followEnabled, setFollowEnabled] = useState(false);
  const [following, setFollowing] = useState(false);
  const lastHostEvent = useRef(0);
  const lastSentCount = useRef(0);
  const lastSentFollow = useRef(false);

  const { publish } = useClassEvents(classId, VIEW_TOPIC, ({ event, senderIdentity }) => {
    if (!enabled || isHost || event.type !== 'view' || event.boardId !== boardId) return;
    // Any participant can publish data, so only the host's packets count.
    if (!isFromHost(senderIdentity, hostUserId)) return;
    lastHostEvent.current = Date.now();
    setFollowing(event.follow);
    setPages((current) =>
      event.follow
        ? applyHostView(current, event, getBoardSize())
        : ensurePageCount(current, event.pageCount),
    );
  });

  const latest = useRef({ pages, followEnabled });
  latest.current = { pages, followEnabled };
  const viewNow: PageView = viewOf(pages);
  const viewRef = useRef(viewNow);
  viewRef.current = viewNow;

  const send = useCallback(() => {
    const { pages: current, followEnabled: follow } = latest.current;
    // A hidden board (a screen share is showing) has no size, so a view sent now
    // would be a bogus pan of zero. Students keep the last real one.
    if (follow && getBoardSize().width <= 0) return;
    lastSentCount.current = current.count;
    lastSentFollow.current = follow;
    void publish(
      viewEvent(classId, describeView(current, viewRef.current, getBoardSize(), boardId, follow)),
    );
  }, [boardId, classId, getBoardSize, publish]);

  // Teacher: announce changes (throttled), and always a new page count.
  useEffect(() => {
    if (!isHost || !enabled) return;
    const countChanged = pages.count !== lastSentCount.current;
    // Turning follow off must be announced too, or students stay locked.
    const followChanged = followEnabled !== lastSentFollow.current;
    if (!followEnabled && !countChanged && !followChanged && lastSentCount.current !== 0) return;
    const timer = window.setTimeout(send, SEND_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [isHost, enabled, followEnabled, pages, viewNow, send]);

  // Teacher: heartbeat while following.
  useEffect(() => {
    if (!isHost || !enabled || !followEnabled) return;
    const timer = window.setInterval(send, HEARTBEAT_MS);
    return () => window.clearInterval(timer);
  }, [isHost, enabled, followEnabled, send]);

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
    following: enabled && !isHost && following,
  };
}
