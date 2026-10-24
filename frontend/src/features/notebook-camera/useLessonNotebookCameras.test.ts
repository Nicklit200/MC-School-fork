import { act, renderHook } from '@testing-library/react';
import { StrictMode, createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../../api/client';
import { notebookCamerasApi, type NotebookCamera } from '../../api/notebookCameras';
import { useLessonNotebookCameras } from './useLessonNotebookCameras';

vi.mock('../../api/notebookCameras', async () => {
  const actual = await vi.importActual<typeof import('../../api/notebookCameras')>('../../api/notebookCameras');
  return { ...actual, notebookCamerasApi: { list: vi.fn() } };
});
const api = vi.mocked(notebookCamerasApi);
const options = { eventId: 'lesson-1', classId: 'class-1', enabled: true };
const camera = (overrides: Partial<NotebookCamera> = {}): NotebookCamera => ({
  cameraId: 'camera-1', eventId: 'lesson-1', classId: 'class-1', ownerId: 'student-1', ownerName: 'Ученик', status: 'CONNECTED',
  pairingExpiresAt: '2026-10-24T09:05:00Z', sessionExpiresAt: '2026-10-24T12:00:00Z', ...overrides,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
async function poll() { await act(async () => { await vi.advanceTimersByTimeAsync(5000); }); }
async function settle() { await act(async () => {}); }

describe('useLessonNotebookCameras', () => {
  beforeEach(() => {
    api.list.mockReset(); api.list.mockResolvedValue([]);
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime('2026-10-24T09:00:00Z');
  });
  afterEach(() => { vi.useRealTimers(); });

  it('returns only connected unexpired cameras from this exact event and class, with one deterministic camera per owner', async () => {
    const newest = camera({ cameraId: 'newest', sessionExpiresAt: '2026-10-24T13:00:00Z' });
    const tied = camera({ cameraId: 'z-camera', ownerId: 'student-2' });
    api.list.mockResolvedValue([
      camera({ cameraId: 'old' }), newest,
      tied, camera({ cameraId: 'a-camera', ownerId: 'student-2' }),
      camera({ cameraId: 'other-class', classId: 'class-2', ownerId: 'student-3' }),
      camera({ cameraId: 'standalone', classId: null, ownerId: 'student-4' }),
      camera({ cameraId: 'other-event', eventId: 'lesson-2', ownerId: 'student-5' }),
      camera({ cameraId: 'expired', ownerId: 'student-6', sessionExpiresAt: '2026-10-24T08:59:59Z' }),
      camera({ cameraId: 'invalid-expiry', ownerId: 'student-7', sessionExpiresAt: 'invalid' }),
      ...(['PAIRING', 'REVOKED', 'EXPIRED'] as const).map(status => camera({ cameraId: status, ownerId: status, status })),
    ]);
    const { result } = renderHook(() => useLessonNotebookCameras(options));
    await settle(); expect(result.current.cameras).toEqual([newest, tied]);
    expect(result.current.camerasByOwner.get('student-1')).toBe(newest);
    expect(result.current.camerasByOwner.get('student-2')).toBe(tied);
    expect(result.current.error).toBeNull(); expect(api.list).toHaveBeenCalledWith('lesson-1');
  });

  it('preserves array and map identity across clock ticks and unchanged polling responses', async () => {
    api.list.mockResolvedValue([camera()]);
    const { result } = renderHook(() => useLessonNotebookCameras(options));
    await settle(); expect(result.current.cameras).toHaveLength(1);
    const cameras = result.current.cameras, byOwner = result.current.camerasByOwner;
    api.list.mockResolvedValue([camera()]); await poll(); await poll();
    expect(result.current.cameras).toBe(cameras); expect(result.current.camerasByOwner).toBe(byOwner);
  });

  it('ignores an older list result that arrives after a newer poll', async () => {
    const initial = deferred<NotebookCamera[]>(); api.list.mockReturnValueOnce(initial.promise);
    const { result } = renderHook(() => useLessonNotebookCameras(options));
    const replacement = camera({ cameraId: 'replacement' }); api.list.mockResolvedValue([replacement]);
    await poll(); const cameras = result.current.cameras;
    expect(cameras).toEqual([replacement]);
    await act(async () => { initial.resolve([]); });
    expect(result.current.cameras).toBe(cameras); expect(result.current.error).toBeNull();
  });

  it('ignores errors from an older request after the current list succeeds', async () => {
    const initial = deferred<NotebookCamera[]>(); api.list.mockReturnValueOnce(initial.promise);
    const { result } = renderHook(() => useLessonNotebookCameras(options));
    api.list.mockResolvedValue([camera()]); await poll();
    await act(async () => { initial.reject(new ApiRequestError(403, 'FORBIDDEN', 'forbidden')); });
    expect(result.current.cameras).toHaveLength(1); expect(result.current.error).toBeNull();
    await poll(); expect(api.list).toHaveBeenCalledTimes(3);
  });

  it('keeps cameras on a transient failure, expires them locally, then recovers from the next response', async () => {
    api.list.mockResolvedValue([camera({ sessionExpiresAt: '2026-10-24T09:00:08Z' })]);
    const { result } = renderHook(() => useLessonNotebookCameras(options));
    await settle(); expect(result.current.cameras).toHaveLength(1);
    const cameras = result.current.cameras;
    api.list.mockRejectedValue(new Error('offline')); await poll();
    expect(result.current.cameras).toBe(cameras); expect(result.current.error).toBe('offline');
    await poll(); expect(result.current.cameras).toEqual([]);
    api.list.mockResolvedValue([camera({ cameraId: 'reconnected' })]); await poll();
    expect(result.current.cameras[0].cameraId).toBe('reconnected'); expect(result.current.error).toBeNull();
  });

  it('removes a revoked camera and clears the last camera on an empty response', async () => {
    api.list.mockResolvedValue([camera(), camera({ cameraId: 'camera-2', ownerId: 'student-2' })]);
    const { result } = renderHook(() => useLessonNotebookCameras(options));
    await settle(); expect(result.current.cameras).toHaveLength(2);
    api.list.mockResolvedValue([camera({ status: 'REVOKED' }), camera({ cameraId: 'camera-2', ownerId: 'student-2' })]);
    await poll(); expect(result.current.cameras.map(item => item.cameraId)).toEqual(['camera-2']);
    api.list.mockResolvedValue([]); await poll(); expect(result.current.cameras).toEqual([]); expect(result.current.camerasByOwner.size).toBe(0);
  });

  it.each([403, 404])('clears cameras and stops polling on %s until the context changes', async status => {
    api.list.mockResolvedValue([camera()]);
    const { result, rerender } = renderHook(props => useLessonNotebookCameras(props), { initialProps: options });
    await settle(); expect(result.current.cameras).toHaveLength(1);
    api.list.mockRejectedValue(new ApiRequestError(status, 'DENIED', 'denied')); await poll();
    expect(result.current.cameras).toEqual([]); expect(result.current.error).not.toBeNull();
    const calls = api.list.mock.calls.length; await poll(); await poll(); expect(api.list).toHaveBeenCalledTimes(calls);
    api.list.mockResolvedValue([camera({ cameraId: 'new-context', classId: 'class-2' })]);
    rerender({ ...options, classId: 'class-2' });
    expect(result.current.cameras).toEqual([]);
    await settle(); expect(result.current.cameras[0]?.cameraId).toBe('new-context');
    expect(result.current.error).toBeNull();
  });

  it('does not request cameras while disabled or without an event, and stops on disable', async () => {
    const { result, rerender } = renderHook(props => useLessonNotebookCameras(props), { initialProps: { ...options, enabled: false } });
    await poll(); expect(api.list).not.toHaveBeenCalled(); expect(result.current.cameras).toEqual([]);
    api.list.mockResolvedValue([camera()]); rerender(options);
    await settle(); expect(result.current.cameras).toHaveLength(1);
    rerender({ ...options, enabled: false }); expect(result.current.cameras).toEqual([]);
    const calls = api.list.mock.calls.length; await poll(); expect(api.list).toHaveBeenCalledTimes(calls);
    rerender({ ...options, eventId: '', enabled: true }); await poll(); expect(api.list).toHaveBeenCalledTimes(calls);
  });

  it('resets the scope immediately and rejects late results from the old lesson/class', async () => {
    const oldClass = deferred<NotebookCamera[]>(); api.list.mockReturnValueOnce(oldClass.promise);
    const { result, rerender } = renderHook(props => useLessonNotebookCameras(props), { initialProps: options });
    const newList = deferred<NotebookCamera[]>(); api.list.mockReturnValueOnce(newList.promise);
    rerender({ ...options, eventId: 'lesson-2', classId: 'class-2' });
    expect(result.current.cameras).toEqual([]);
    await act(async () => { oldClass.resolve([camera()]); }); expect(result.current.cameras).toEqual([]);
    await act(async () => { newList.resolve([camera({ cameraId: 'new-scope', eventId: 'lesson-2', classId: 'class-2' })]); });
    expect(result.current.cameras[0].cameraId).toBe('new-scope');
  });

  it('cleans up polling and ignores a pending response after StrictMode unmount', async () => {
    const pending = deferred<NotebookCamera[]>(); api.list.mockReturnValue(pending.promise);
    const wrapper = ({ children }: { children: ReactNode }) => createElement(StrictMode, null, children);
    const { result, unmount } = renderHook(() => useLessonNotebookCameras(options), { wrapper });
    unmount(); const calls = api.list.mock.calls.length;
    await act(async () => { pending.resolve([camera()]); }); await poll();
    expect(api.list).toHaveBeenCalledTimes(calls); expect(result.current.cameras).toEqual([]);
  });
});
