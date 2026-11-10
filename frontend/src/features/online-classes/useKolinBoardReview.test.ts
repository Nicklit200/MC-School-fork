import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { observedPupilPage, useKolinBoardReview, KolinReviewUnavailable } from './useKolinBoardReview';
import type { ReceivedEvent } from './useClassEvents';
import type { KolinBoardSnapshot } from '../../api/kolin';

const mocks = vi.hoisted(() => ({ target: vi.fn(), capture: vi.fn(), handler: null as ((packet: ReceivedEvent) => void) | null }));
vi.mock('../../api/kolin', () => ({ kolinApi: { reviewTarget: mocks.target } }));
vi.mock('./boardExport', () => ({ captureBoardPage: mocks.capture }));
vi.mock('./useClassEvents', () => ({ useClassEvents: (_id: string, _topic: string, handler: typeof mocks.handler) => { mocks.handler = handler; } }));
const pupil = '11111111-1111-4111-8111-111111111111';
const boardId = `personal-workbook-${pupil}`;
function packet(page = 2, patch: Record<string, unknown> = {}): ReceivedEvent {
  return { senderIdentity: `${pupil}|tablet`, event: { v: 1, classId: 'lesson', id: crypto.randomUUID(), at: Date.now(),
    type: 'view', boardId, page, pageCount: 5, zoom: 1, panX: 0, panY: 0, follow: false, ...patch } as ReceivedEvent['event'] };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.target.mockResolvedValue({ state: 'ready', studentId: pupil, studentName: 'Мелисса', scope: 'current_page' });
  mocks.capture.mockResolvedValue({ studentId: pupil, boardId, pageNumber: 3 } as KolinBoardSnapshot);
});
it('captures the pupil reported page without relying on teacher selection', async () => {
  const { result } = renderHook(() => useKolinBoardReview('lesson', 'teacher', true));
  act(() => mocks.handler!(packet()));
  await result.current('Проверь Мелиссу', { studentId: 'someone-else', currentWorkbookPage: 1 });
  expect(mocks.capture).toHaveBeenCalledWith('lesson', pupil, boardId, 2, expect.any(String), 'current_page');
});
it('rejects spoofed, stale, future, shared-board and other-room reports', () => {
  for (const bad of [{ ...packet(), senderIdentity: 'other|device' }, packet(2, { at: Date.now() - 20000 }),
    packet(2, { at: Date.now() + 10000 }), packet(2, { classId: 'other' }), packet(2, { boardId: 'board-1' })])
    expect(observedPupilPage(bad, 'lesson', Date.now())).toBeNull();
});
it('does not photograph a guessed page when the pupil is offline', async () => {
  const { result } = renderHook(() => useKolinBoardReview('lesson', 'teacher', true));
  await expect(result.current('Проверь Мелиссу', {})).rejects.toBeInstanceOf(KolinReviewUnavailable);
  expect(mocks.capture).not.toHaveBeenCalled();
});
it('invalidates a hidden personal page immediately while preserving another active device', async () => {
  const { result } = renderHook(() => useKolinBoardReview('lesson', 'teacher', true));
  const at = Date.now();
  act(() => mocks.handler!(packet(2, { at })));
  act(() => mocks.handler!({ ...packet(2, { at: at + 1, active: false }), senderIdentity: `${pupil}|other-device` }));
  await result.current('Проверь Мелиссу', {});
  act(() => mocks.handler!(packet(2, { at: at + 2, active: false })));
  await expect(result.current('Проверь Мелиссу', {})).rejects.toBeInstanceOf(KolinReviewUnavailable);
  expect(mocks.capture).toHaveBeenCalledOnce();
});
it('can review the whole saved workbook without pretending the pupil is online', async () => {
  mocks.target.mockResolvedValue({ state: 'ready', studentId: pupil, scope: 'workbook' });
  const { result } = renderHook(() => useKolinBoardReview('lesson', 'teacher', true));
  await result.current('Что неправильно решила Мелисса?', {});
  expect(mocks.capture).toHaveBeenCalledWith('lesson', pupil, '', 0, null, 'workbook');
});
it('does not capture ordinary conversation or ambiguous recipients', async () => {
  const { result } = renderHook(() => useKolinBoardReview('lesson', 'teacher', true));
  for (const state of ['not_requested', 'clarify']) {
    mocks.target.mockResolvedValue({ state });
    expect(await result.current('Question', {})).toBeUndefined();
  }
  expect(mocks.capture).not.toHaveBeenCalled();
});
it('captures the exact numbered assignment page without needing a live pupil view', async () => {
  mocks.target.mockResolvedValue({ state: 'ready', studentId: pupil, studentName: 'Мелисса', scope: 'task_page', pageNumber: 5 });
  const { result } = renderHook(() => useKolinBoardReview('lesson', 'teacher', true));
  await result.current('Проверь задание 7', { targetType: 'group', currentWorkbookPage: 1 });
  expect(mocks.capture).toHaveBeenCalledWith('lesson', pupil, '', 4, null, 'task_page');
});
it('uses the server selected group task page, not the physical number of the exercise', async () => {
  mocks.target.mockResolvedValue({ state: 'ready', studentId: null, scope: 'task_page', pageNumber: 2 });
  const { result } = renderHook(() => useKolinBoardReview('lesson', 'teacher', true));
  await result.current('Проверь задание 7', { targetType: 'group', currentWorkbookPage: 7 });
  expect(mocks.capture).toHaveBeenCalledWith('lesson', null, 'board-1', 1, null, 'task_page');
});
it('rejects an invalid server exercise page number before capturing anything', async () => {
  mocks.target.mockResolvedValue({ state: 'ready', studentId: pupil, scope: 'task_page', pageNumber: 0 });
  const { result } = renderHook(() => useKolinBoardReview('lesson', 'teacher', true));
  await expect(result.current('Проверь задание 7', {})).rejects.toBeInstanceOf(KolinReviewUnavailable);
  expect(mocks.capture).not.toHaveBeenCalled();
});
it('drops a capture when the pupil changes page or the teacher changes lesson', async () => {
  let finish!: (value: KolinBoardSnapshot) => void;
  mocks.capture.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const { result, rerender } = renderHook(({ classId }) => useKolinBoardReview(classId, 'teacher', true), { initialProps: { classId: 'lesson' } });
  act(() => mocks.handler!(packet()));
  const pending = result.current('Проверь Мелиссу', {});
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  act(() => mocks.handler!(packet(3, { at: Date.now() + 1 })));
  finish({} as KolinBoardSnapshot);
  await expect(pending).rejects.toBeInstanceOf(KolinReviewUnavailable);
  const next = result.current('Проверь Мелиссу', {});
  await vi.waitFor(() => expect(mocks.capture).toHaveBeenCalledTimes(2));
  rerender({ classId: 'another' }); finish({} as KolinBoardSnapshot);
  await expect(next).rejects.toBeInstanceOf(KolinReviewUnavailable);
});

it('reads the first saved page of a named pupil without a live page announcement', async () => {
  mocks.target.mockResolvedValue({ state: 'ready', studentId: pupil, scope: 'first_page' });
  const { result } = renderHook(() => useKolinBoardReview('lesson', 'teacher', true));
  await result.current('Объясни первое и второе задание у Мелиссы', { studentId: pupil });
  expect(mocks.capture).toHaveBeenCalledWith('lesson', pupil, '', 0, null, 'first_page');
});

it('reads a shared group page without inventing a pupil identity', async () => {
  mocks.target.mockResolvedValue({ state: 'ready', studentId: null, studentName: 'Общая доска', scope: 'first_page' });
  const { result } = renderHook(() => useKolinBoardReview('lesson', 'teacher', true));
  await result.current('Посмотри первую страницу на общей доске', { targetType: 'group' });
  expect(mocks.capture).toHaveBeenCalledWith('lesson', null, 'board-1', 0, null, 'first_page');
});
it('takes the teacher-selected page in a group rather than a guessed private page', async () => {
  mocks.target.mockResolvedValue({ state: 'ready', studentId: null, scope: 'current_page' });
  const { result } = renderHook(() => useKolinBoardReview('lesson', 'teacher', true));
  await result.current('Посмотри текущую страницу', { targetType: 'group', currentWorkbookPage: 3 });
  expect(mocks.capture).toHaveBeenCalledWith('lesson', null, 'board-1', 2, null, 'current_page');
});
