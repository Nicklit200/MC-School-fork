import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onlineClassesApi, type AnnotationDocument } from '../../api/onlineClasses';
import { boardPagesEvent } from './events';
import type { ReceivedEvent } from './useClassEvents';
import { useAnnotationPageSync } from './useAnnotationPageSync';

const realtime = vi.hoisted(() => ({ handler: null as ((event: ReceivedEvent) => void) | null, publish: vi.fn(async () => {}) }));
vi.mock('./useClassEvents', () => ({ useClassEvents: (_classId: string, _topic: string, handler: (event: ReceivedEvent) => void, listen = true) => {
  realtime.handler = listen ? handler : null;
  return { publish: realtime.publish };
} }));
vi.mock('../../api/onlineClasses', () => ({ onlineClassesApi: { listAnnotationDocuments: vi.fn() } }));

const list = vi.mocked(onlineClassesApi.listAnnotationDocuments);
const target = 'personal-workbook-alice';
const document = (pageIndex: number, targetId = target): AnnotationDocument => ({
  id: `${targetId}-${pageIndex}`, targetType: 'WHITEBOARD', targetId, pageIndex, revision: 0,
  sourceWidth: null, sourceHeight: null, snapshotSavedAt: null,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const defaults = { classId: 'class-1', targetType: 'WHITEBOARD' as const, targetId: target,
  actorId: 'alice', isHost: false, hostUserId: 'teacher', active: true };
const emit = (sender = 'teacher', patch: Partial<ReturnType<typeof boardPagesEvent>> = {}) => realtime.handler?.({
  senderIdentity: `${sender}|tab`, event: { ...boardPagesEvent('class-1', 'WHITEBOARD', target), ...patch },
});
const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  list.mockReset().mockResolvedValue([]);
  realtime.handler = null;
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('private board durable page discovery', () => {
  it('discovers blank pages on entry and after a lost hint through polling', async () => {
    list.mockResolvedValueOnce([document(1)]).mockResolvedValue([document(3), document(90, 'personal-workbook-bob')]);
    const onPageCount = vi.fn();
    renderHook(() => useAnnotationPageSync({ ...defaults, onPageCount }));
    await settle();
    expect(onPageCount).toHaveBeenLastCalledWith(2);
    expect(realtime.publish).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(onPageCount).toHaveBeenLastCalledWith(4);
  });

  it('uses a scoped trusted hint only to re-read durable metadata, coalescing bursts', async () => {
    const onPageCount = vi.fn();
    renderHook(() => useAnnotationPageSync({ ...defaults, onPageCount }));
    await settle();
    act(() => { emit('bob'); emit('teacher', { targetId: 'personal-workbook-bob' }); emit('teacher', { classId: 'other-class' }); emit('teacher', { targetType: 'NOTEBOOK_CAMERA' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(list).toHaveBeenCalledTimes(1);
    list.mockResolvedValue([document(2)]);
    act(() => { for (let index = 0; index < 20; index++) emit(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(list).toHaveBeenCalledTimes(2);
    expect(onPageCount).toHaveBeenLastCalledWith(3);
  });

  it('does not lose a hint that arrives while the initial metadata read is pending', async () => {
    const pending = deferred<AnnotationDocument[]>();
    list.mockReturnValueOnce(pending.promise).mockResolvedValue([document(4)]);
    const onPageCount = vi.fn();
    renderHook(() => useAnnotationPageSync({ ...defaults, onPageCount }));
    act(() => { emit(); emit(); });
    await act(async () => { pending.resolve([]); });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(list).toHaveBeenCalledTimes(2);
    expect(onPageCount).toHaveBeenLastCalledWith(5);
  });

  it('keeps known pages through failed or temporarily incomplete metadata reads', async () => {
    list.mockResolvedValueOnce([document(2)]).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([]).mockResolvedValue([document(4)]);
    const onPageCount = vi.fn();
    renderHook(() => useAnnotationPageSync({ ...defaults, onPageCount }));
    await settle();
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(onPageCount).toHaveBeenLastCalledWith(3);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(onPageCount).toHaveBeenLastCalledWith(5);
  });

  it('pauses hidden boards and refreshes immediately when they become active again', async () => {
    const onPageCount = vi.fn();
    const { rerender } = renderHook(({ active }) => useAnnotationPageSync({ ...defaults, active, onPageCount }), { initialProps: { active: false } });
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(list).not.toHaveBeenCalled(); expect(realtime.handler).toBeNull();
    list.mockResolvedValue([document(2)]);
    rerender({ active: true }); await settle();
    expect(onPageCount).toHaveBeenLastCalledWith(3);
    rerender({ active: false });
    const calls = list.mock.calls.length;
    await act(async () => { window.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(6000); });
    expect(list).toHaveBeenCalledTimes(calls);
  });

  it('ignores an old scope’s response after switching pupil and classroom', async () => {
    const pending = deferred<AnnotationDocument[]>();
    list.mockReturnValueOnce(pending.promise).mockResolvedValue([document(3, 'personal-workbook-bob')]);
    const onPageCount = vi.fn();
    const { rerender } = renderHook(({ classId, targetId, actorId }) => useAnnotationPageSync({ ...defaults, classId, targetId, actorId, onPageCount }), {
      initialProps: { classId: 'class-1', targetId: target, actorId: 'alice' },
    });
    rerender({ classId: 'class-2', targetId: 'personal-workbook-bob', actorId: 'bob' });
    await settle();
    await act(async () => { pending.resolve([document(9)]); });
    expect(onPageCount).toHaveBeenCalledExactlyOnceWith(4);
  });

  it.each([false, true])('announces a persisted blank page privately for owner and teacher (host=%s)', async isHost => {
    const onPageCount = vi.fn();
    const { result } = renderHook(() => useAnnotationPageSync({ ...defaults, actorId: isHost ? 'teacher' : 'alice', isHost, onPageCount }));
    await settle();
    act(() => { result.current.documentReady(document(2)); result.current.documentReady(document(2)); });
    expect(realtime.publish).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: 'pages', classId: 'class-1', targetType: 'WHITEBOARD', targetId: target }), true, ['alice', 'teacher']);
    expect(onPageCount).toHaveBeenLastCalledWith(3);
  });

  it('never fetches or announces another pupil’s private board', async () => {
    const { result } = renderHook(() => useAnnotationPageSync({ ...defaults, actorId: 'bob', onPageCount: vi.fn() }));
    act(() => result.current.documentReady(document(2)));
    await settle();
    expect(list).not.toHaveBeenCalled(); expect(realtime.publish).not.toHaveBeenCalled(); expect(realtime.handler).toBeNull();
  });
});
