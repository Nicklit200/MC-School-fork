import type { ViewEvent } from './events';
import { clampPage, clampView, type BoardPages, type PageView } from './boardView';

/**
 * "Follow the teacher" rules for the shared board.
 *
 * Pure, so the trust and mapping rules can be tested without LiveKit.
 */

/** Identities are `<userUuid>|<device>`; see ParticipantIdentity on the server. */
export function userIdOfIdentity(identity: string | undefined): string | null {
  if (!identity) return null;
  const separator = identity.indexOf('|');
  return separator < 0 ? identity : identity.slice(0, separator);
}

/**
 * A view packet is advisory (any participant can publish data), so it is only
 * honoured when it came from the host's identity.
 */
export function isFromHost(senderIdentity: string | undefined, hostUserId: string | null): boolean {
  if (!hostUserId) return false;
  return userIdOfIdentity(senderIdentity) === hostUserId;
}

export interface BoardSize {
  width: number;
  height: number;
}

/** Teacher side: current pages/view → packet body (pan as a board fraction). */
export function describeView(
  pages: BoardPages,
  view: PageView,
  board: BoardSize,
  boardId: string,
  follow: boolean,
): Omit<ViewEvent, 'v' | 'type' | 'classId' | 'id' | 'at'> {
  return {
    boardId,
    page: pages.current,
    pageCount: pages.count,
    zoom: view.zoom,
    panX: board.width > 0 ? view.panX / board.width : 0,
    panY: board.height > 0 ? view.panY / board.height : 0,
    follow,
  };
}

/**
 * Student side: a host packet → the pages and view to show locally. The page
 * count only ever grows, and the view is clamped to this screen's board so a
 * bad packet cannot park the page off-screen.
 */
export function applyHostView(
  pages: BoardPages,
  event: Pick<ViewEvent, 'page' | 'pageCount' | 'zoom' | 'panX' | 'panY'>,
  board: BoardSize,
): BoardPages {
  const count = Math.max(pages.count, event.pageCount);
  const current = clampPage(event.page, count);
  // A hidden board has no size to place a pan in; take the page and keep the
  // view, rather than flattening the pan to zero.
  if (board.width <= 0 || board.height <= 0) return { ...pages, count, current };
  const view = clampView(
    { zoom: event.zoom, panX: event.panX * board.width, panY: event.panY * board.height },
    board,
  );
  return { ...pages, count, current, views: { ...pages.views, [current]: view } };
}

/** Navigation by the viewer is blocked only for a student under follow mode. */
export function navigationLocked(isHost: boolean, following: boolean): boolean {
  return !isHost && following;
}
