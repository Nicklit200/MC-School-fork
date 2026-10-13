import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onlineClassesApi, type ClassParticipant } from '../../api/onlineClasses';
import { useHostUserId } from './useHostUserId';

vi.mock('../../api/onlineClasses', async () => {
  const actual = await vi.importActual<typeof import('../../api/onlineClasses')>('../../api/onlineClasses');
  return { ...actual, onlineClassesApi: { listParticipants: vi.fn() } };
});

const api = vi.mocked(onlineClassesApi);

const person = (userId: string, classRole: 'HOST' | 'STUDENT'): ClassParticipant => ({
  userId,
  displayName: userId,
  classRole,
  admissionState: 'ADMITTED',
  cameraEnabled: true,
  microphoneEnabled: true,
  screenShareEnabled: false,
  connected: true,
  firstJoinedAt: null,
  lastLeftAt: null,
  totalConnectedSeconds: 0,
});

describe('useHostUserId', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.useRealTimers());

  it('returns the host from the roster', async () => {
    api.listParticipants.mockResolvedValue([person('s1', 'STUDENT'), person('t1', 'HOST')]);
    const { result } = renderHook(() => useHostUserId('class-1'));
    await waitFor(() => expect(result.current).toBe('t1'));
  });

  it('retries until the roster lists a host', async () => {
    vi.useFakeTimers();
    api.listParticipants
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce([person('s1', 'STUDENT')])
      .mockResolvedValue([person('t1', 'HOST')]);
    const { result } = renderHook(() => useHostUserId('class-1'));
    expect(result.current).toBeNull();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5100);
      });
    }
    expect(result.current).toBe('t1');
  });

  it('stops retrying after unmount', async () => {
    vi.useFakeTimers();
    api.listParticipants.mockRejectedValue(new Error('offline'));
    const { unmount } = renderHook(() => useHostUserId('class-1'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    unmount();
    const calls = api.listParticipants.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20000);
    });
    expect(api.listParticipants.mock.calls.length).toBe(calls);
  });
});
