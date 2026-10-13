import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../../api/client';
import { onlineClassesApi, type OnlineClass, type OnlineClassConnection } from '../../api/onlineClasses';
import { useClassSession } from './useClassSession';

vi.mock('../../api/onlineClasses', async () => {
  const actual = await vi.importActual<typeof import('../../api/onlineClasses')>(
    '../../api/onlineClasses',
  );
  return {
    ...actual,
    onlineClassesApi: {
      get: vi.fn(),
      connect: vi.fn(),
      knock: vi.fn(),
      leave: vi.fn(),
    },
  };
});

const api = vi.mocked(onlineClassesApi);

const sampleClass: OnlineClass = {
  id: 'class-1',
  eventId: 'event-1',
  bindingKey: 'binding-1',
  title: 'Maths',
  scheduledStartAt: '2026-09-18T10:00:00Z',
  scheduledEndAt: '2026-09-18T11:00:00Z',
  studentId: 'student-1',
  groupId: null,
  status: 'LIVE',
  waitingRoomEnabled: true,
  studentScreenShareEnabled: false,
  recordingState: 'INACTIVE',
  transcriptionState: 'INACTIVE',
  actualStartAt: null,
  actualEndAt: null,
  viewerIsHost: false,
  recordingAvailable: false,
  transcriptionAvailable: false,
  joinWindowOpen: true,
};

const sampleConnection: OnlineClassConnection = {
  serverUrl: 'wss://test.invalid',
  token: 'issued-token',
  identity: 'student-1|tab-1',
  roomName: 'mcs-class-1',
  expiresAt: '2026-09-18T10:10:00Z',
  host: false,
  recordingActive: false,
  transcriptionActive: false,
};

describe('useClassSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.get.mockResolvedValue(sampleClass);
    api.connect.mockResolvedValue(sampleConnection);
    api.leave.mockResolvedValue(undefined);
    api.knock.mockResolvedValue({} as never);
  });

  it('loads the class and becomes ready', async () => {
    const { result } = renderHook(() => useClassSession('class-1'));

    await waitFor(() => expect(result.current.phase).toBe('ready'));
    expect(result.current.onlineClass?.title).toBe('Maths');
    expect(result.current.connection).toBeNull();
  });

  it('acquires a connection on request', async () => {
    const { result } = renderHook(() => useClassSession('class-1'));
    await waitFor(() => expect(result.current.phase).toBe('ready'));

    await act(async () => {
      await result.current.requestConnection();
    });

    expect(result.current.phase).toBe('connected');
    expect(result.current.connection?.token).toBe('issued-token');
  });

  it('keeps the calendar lesson available after LiveKit drops the connection', async () => {
    const { result } = renderHook(() => useClassSession('class-1'));
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    await act(async () => {
      await result.current.requestConnection();
    });
    expect(result.current.connection).not.toBeNull();

    act(() => result.current.transportDisconnected());

    expect(result.current.phase).toBe('disconnected');
    expect(result.current.connection).toBeNull();
    // An involuntary network drop is not a deliberate leave.
    expect(api.leave).not.toHaveBeenCalled();
    expect(result.current.onlineClass?.id).toBe('class-1');

    await act(async () => {
      await result.current.requestConnection();
    });
    expect(result.current.phase).toBe('connected');
    expect(api.connect).toHaveBeenCalledTimes(2);
  });

  it('does not fire a duplicate connection request', async () => {
    const { result } = renderHook(() => useClassSession('class-1'));
    await waitFor(() => expect(result.current.phase).toBe('ready'));

    await act(async () => {
      // A double-clicked join button must still mint only one token.
      await Promise.all([result.current.requestConnection(), result.current.requestConnection()]);
    });

    expect(api.connect).toHaveBeenCalledTimes(1);
  });

  it('shows the waiting state when the teacher has not admitted yet', async () => {
    api.connect.mockRejectedValue(
      new ApiRequestError(409, 'CONFLICT', 'Waiting for the teacher to admit you'),
    );
    const { result } = renderHook(() => useClassSession('class-1'));
    await waitFor(() => expect(result.current.phase).toBe('ready'));

    await act(async () => {
      await result.current.requestConnection();
    });

    expect(result.current.phase).toBe('waiting');
  });

  describe('waiting room', () => {
    const waiting = () => new ApiRequestError(409, 'CONFLICT', 'Waiting for the teacher to admit you');

    afterEach(() => vi.useRealTimers());

    it('knocks once, so the teacher sees the student, and keeps asking until admitted', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      api.connect.mockRejectedValueOnce(waiting()).mockRejectedValueOnce(waiting());
      const { result } = renderHook(() => useClassSession('class-1'));
      await waitFor(() => expect(result.current.phase).toBe('ready'));

      await act(async () => {
        await result.current.requestConnection();
      });
      expect(result.current.phase).toBe('waiting');
      expect(api.knock).toHaveBeenCalledTimes(1);

      // Still not admitted: asks again, but does not knock again.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2100);
      });
      expect(api.connect).toHaveBeenCalledTimes(2);
      expect(result.current.phase).toBe('waiting');
      expect(api.knock).toHaveBeenCalledTimes(1);

      // The teacher admits: the next check gets the token and the room opens.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2100);
      });
      expect(result.current.phase).toBe('connected');
      expect(result.current.connection?.token).toBe('issued-token');
    });

    it('stops asking once the student leaves', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      api.connect.mockRejectedValue(waiting());
      const { result } = renderHook(() => useClassSession('class-1'));
      await waitFor(() => expect(result.current.phase).toBe('ready'));
      await act(async () => {
        await result.current.requestConnection();
      });
      act(() => result.current.release());
      const calls = api.connect.mock.calls.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(6000);
      });
      expect(api.connect).toHaveBeenCalledTimes(calls);
    });

    it('stops asking when the page goes away', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      api.connect.mockRejectedValue(waiting());
      const { result, unmount } = renderHook(() => useClassSession('class-1'));
      await waitFor(() => expect(result.current.phase).toBe('ready'));
      await act(async () => {
        await result.current.requestConnection();
      });
      unmount();
      const calls = api.connect.mock.calls.length;
      await vi.advanceTimersByTimeAsync(6000);
      expect(api.connect).toHaveBeenCalledTimes(calls);
    });

    it('stops waiting when the teacher declines', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      api.connect
        .mockRejectedValueOnce(waiting())
        .mockRejectedValue(new ApiRequestError(409, 'CONFLICT', 'The teacher declined your request to join'));
      const { result } = renderHook(() => useClassSession('class-1'));
      await waitFor(() => expect(result.current.phase).toBe('ready'));
      await act(async () => {
        await result.current.requestConnection();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2100);
      });
      expect(result.current.phase).toBe('denied');
      const calls = api.connect.mock.calls.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(6000);
      });
      expect(api.connect).toHaveBeenCalledTimes(calls);
    });

    it('does not knock for a student who is simply refused for another reason', async () => {
      api.connect.mockRejectedValue(new ApiRequestError(409, 'CONFLICT', 'This class is not open'));
      const { result } = renderHook(() => useClassSession('class-1'));
      await waitFor(() => expect(result.current.phase).toBe('ready'));
      await act(async () => {
        await result.current.requestConnection();
      });
      expect(api.knock).not.toHaveBeenCalled();
    });
  });

  it('shows the unavailable state when the server is not configured', async () => {
    api.connect.mockRejectedValue(
      new ApiRequestError(409, 'CONFLICT', 'Online classes are not available on this server'),
    );
    const { result } = renderHook(() => useClassSession('class-1'));
    await waitFor(() => expect(result.current.phase).toBe('ready'));

    await act(async () => {
      await result.current.requestConnection();
    });

    expect(result.current.phase).toBe('unavailable');
  });

  it('shows notOpen when the class has not started', async () => {
    api.connect.mockRejectedValue(new ApiRequestError(409, 'CONFLICT', 'This class is not open'));
    const { result } = renderHook(() => useClassSession('class-1'));
    await waitFor(() => expect(result.current.phase).toBe('ready'));

    await act(async () => {
      await result.current.requestConnection();
    });

    expect(result.current.phase).toBe('notOpen');
  });

  it('treats a 404 as denied without revealing whether the class exists', async () => {
    api.get.mockRejectedValue(new ApiRequestError(404, 'NOT_FOUND', 'Online class not found'));
    const { result } = renderHook(() => useClassSession('class-1'));

    await waitFor(() => expect(result.current.phase).toBe('denied'));
    // The message is dropped so the UI cannot leak the server's wording.
    expect(result.current.errorMessage).toBeNull();
  });

  it('releases the token and notifies the backend on leave', async () => {
    const { result } = renderHook(() => useClassSession('class-1'));
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    await act(async () => {
      await result.current.requestConnection();
    });

    act(() => {
      result.current.release();
    });

    expect(result.current.connection).toBeNull();
    expect(result.current.phase).toBe('ready');
    expect(api.leave).toHaveBeenCalledWith('class-1');
  });

  it('survives a failed leave call', async () => {
    api.leave.mockRejectedValue(new ApiRequestError(500, 'UNKNOWN', 'boom'));
    const { result } = renderHook(() => useClassSession('class-1'));
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    await act(async () => {
      await result.current.requestConnection();
    });

    act(() => {
      result.current.release();
    });

    expect(result.current.connection).toBeNull();
  });
});
