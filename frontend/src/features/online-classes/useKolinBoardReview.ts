import { useCallback, useRef } from 'react';
import { kolinApi, type KolinBoardSnapshot, type KolinContext } from '../../api/kolin';
import { useClassEvents, type ReceivedEvent } from './useClassEvents';
import { VIEW_TOPIC } from './events';
import { personalBoardOwner } from './boards';
import { flushClassAnnotations } from './annotationSync';

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
    const taskPage = target.scope === 'task_page';
    // The host's selected personal page is authoritative for a question about
    // the page they are viewing. Do not require that pupil to be online or
    // looking at the same page on their own device.
    const teacherPage = !shared && target.studentId === context.studentId
      && context.targetType === 'student' && Number.isSafeInteger(context.currentWorkbookPage)
      && (context.currentWorkbookPage ?? 0) >= 1 && (context.currentWorkbookPage ?? 0) <= 1000;
    if (taskPage && (typeof target.pageNumber !== 'number'
      || !Number.isSafeInteger(target.pageNumber) || target.pageNumber < 1 || target.pageNumber > 1000))
      throw new KolinReviewUnavailable();
    if (!shared && !whole && !first && !taskPage && !teacherPage
        && (!observed || Date.now() - observed.receivedAt > REVIEW_PAGE_MAX_AGE))
      throw new KolinReviewUnavailable();
    try {
      // The captured JPEG includes the server's saved handwriting. Flush the
      // host's pending ink first, or a just-written answer could be missing.
      await flushClassAnnotations(classId, teacherId, () => pages.current.scope === scope);
      const { captureBoardPage } = await import('./boardExport');
      const boardId = shared ? 'board-1' : taskPage || teacherPage ? '' : observed?.boardId ?? '';
      const index = taskPage ? target.pageNumber! - 1 :
        first ? 0 : shared ? Math.max(0, (context.currentWorkbookPage ?? 1) - 1)
        : teacherPage ? context.currentWorkbookPage! - 1 : observed?.page ?? 0;
      const snapshot = await captureBoardPage(classId, target.studentId ?? null, boardId, index,
        taskPage ? null : teacherPage ? new Date().toISOString()
          : observed ? new Date(observed.receivedAt).toISOString() : null,
        taskPage ? 'task_page' : whole ? 'workbook' : first ? 'first_page' : 'current_page');
      const latest = current();
      if (pages.current.scope !== scope || !shared && !whole && !first && !taskPage && !teacherPage
        && (!latest || latest.boardId !== observed!.boardId || latest.page !== observed!.page
          || Date.now() - latest.receivedAt > REVIEW_PAGE_MAX_AGE)) throw new KolinReviewUnavailable();
      return snapshot;
    } catch (error) {
      if (error instanceof Error && error.message === 'REVIEW_TOO_LARGE') throw new KolinReviewTooLarge();
      throw new KolinReviewUnavailable();
    }
  }, [classId, enabled, scope]);
}
