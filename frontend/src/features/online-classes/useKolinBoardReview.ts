import { useCallback, useRef } from 'react';
import { kolinApi, type KolinBoardSnapshot, type KolinContext } from '../../api/kolin';
import { useClassEvents, type ReceivedEvent } from './useClassEvents';
import { VIEW_TOPIC } from './events';
import { personalBoardOwner } from './boards';

export class KolinReviewUnavailable extends Error {}
export class KolinReviewTooLarge extends Error {}
export interface PupilPage { boardId: string; page: number; at: number; receivedAt: number; senderIdentity: string; active: boolean }
export const REVIEW_PAGE_MAX_AGE = 15_000;

/** Accept only private page reports sent by that pupil's authenticated LiveKit identity. */
export function observedPupilPage({ event, senderIdentity }: ReceivedEvent, classId: string, now: number): PupilPage | null {
  if (event.type !== 'view' || event.classId !== classId || !personalBoardOwner(event.boardId)
    || personalBoardOwner(event.boardId) !== senderIdentity?.split('|')[0]
    || event.at < now - REVIEW_PAGE_MAX_AGE || event.at > now + 5000) return null;
  return { boardId: event.boardId, page: event.page, at: event.at, receivedAt: now, senderIdentity: senderIdentity!, active: event.active !== false };
}

export function useKolinBoardReview(classId: string, teacherId: string, enabled: boolean) {
  const scope = `${classId}:${teacherId}:${enabled}`;
  const pages = useRef<{ scope: string; entries: Map<string, PupilPage> }>({ scope, entries: new Map() });
  if (pages.current.scope !== scope) pages.current = { scope, entries: new Map() };
  useClassEvents(classId, VIEW_TOPIC, received => {
    if (!enabled) return;
    const page = observedPupilPage(received, classId, Date.now());
    if (page) {
      const owner = personalBoardOwner(page.boardId)!;
      const previous = pages.current.entries.get(owner);
      if (!page.active) {
        if (previous?.senderIdentity === page.senderIdentity && page.at >= previous.at) pages.current.entries.delete(owner);
      } else if (!previous || page.at >= previous.at) pages.current.entries.set(owner, page);
    }
  }, enabled);

  return useCallback(async (text: string, context: KolinContext): Promise<KolinBoardSnapshot | undefined> => {
    if (!enabled) return;
    const target = await kolinApi.reviewTarget(classId, text, context);
    if (target.state === 'not_requested' || target.state === 'clarify') return;
    if (target.state !== 'ready') throw new KolinReviewUnavailable();
    const shared = target.studentId == null;
    const current = () => pages.current.scope === scope && target.studentId
      ? pages.current.entries.get(target.studentId) : undefined;
    const observed = current();
    const whole = target.scope === 'workbook';
    const first = target.scope === 'first_page';
    if (!shared && !whole && !first && (!observed || Date.now() - observed.receivedAt > REVIEW_PAGE_MAX_AGE))
      throw new KolinReviewUnavailable();
    try {
      const { captureBoardPage } = await import('./boardExport');
      const boardId = shared ? 'board-1' : observed?.boardId ?? '';
      const index = first ? 0 : shared ? Math.max(0, (context.currentWorkbookPage ?? 1) - 1) : observed?.page ?? 0;
      const snapshot = await captureBoardPage(classId, target.studentId ?? null, boardId, index,
        observed ? new Date(observed.receivedAt).toISOString() : null,
        whole ? 'workbook' : first ? 'first_page' : 'current_page');
      const latest = current();
      if (pages.current.scope !== scope || !shared && !whole && !first
        && (!latest || latest.boardId !== observed!.boardId || latest.page !== observed!.page
          || Date.now() - latest.receivedAt > REVIEW_PAGE_MAX_AGE)) throw new KolinReviewUnavailable();
      return snapshot;
    } catch (error) {
      if (error instanceof Error && error.message === 'REVIEW_TOO_LARGE') throw new KolinReviewTooLarge();
      throw new KolinReviewUnavailable();
    }
  }, [classId, enabled, scope]);
}
