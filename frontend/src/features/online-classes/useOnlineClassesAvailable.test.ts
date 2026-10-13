import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../../api/client';
import { onlineClassesApi } from '../../api/onlineClasses';
import { resetOnlineClassesAvailability, useOnlineClassesAvailable } from './useOnlineClassesAvailable';

vi.mock('../../api/onlineClasses', async () => {
  const actual = await vi.importActual<typeof import('../../api/onlineClasses')>('../../api/onlineClasses');
  return { ...actual, onlineClassesApi: { listUpcoming: vi.fn() } };
});

const api = vi.mocked(onlineClassesApi);

describe('useOnlineClassesAvailable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetOnlineClassesAvailability();
  });

  it('is available when the class list works', async () => {
    api.listUpcoming.mockResolvedValue([]);
    const { result } = renderHook(() => useOnlineClassesAvailable('u1', true));
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('is not available when the feature is switched off on the server', async () => {
    api.listUpcoming.mockRejectedValue(new ApiRequestError(404, 'NOT_FOUND', 'Online classes are not enabled'));
    const { result } = renderHook(() => useOnlineClassesAvailable('u1', true));
    await waitFor(() => expect(api.listUpcoming).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });

  it('asks once per user, however often the layout remounts', async () => {
    api.listUpcoming.mockResolvedValue([]);
    const first = renderHook(() => useOnlineClassesAvailable('u1', true));
    await waitFor(() => expect(first.result.current).toBe(true));
    first.unmount();

    const second = renderHook(() => useOnlineClassesAvailable('u1', true));
    expect(second.result.current).toBe(true);
    expect(api.listUpcoming).toHaveBeenCalledTimes(1);
  });

  it('does not remember a "no" for a different user', async () => {
    api.listUpcoming.mockRejectedValueOnce(new ApiRequestError(404, 'NOT_FOUND', 'off'));
    const a = renderHook(() => useOnlineClassesAvailable('u1', true));
    await waitFor(() => expect(api.listUpcoming).toHaveBeenCalledTimes(1));
    a.unmount();

    api.listUpcoming.mockResolvedValue([]);
    const b = renderHook(() => useOnlineClassesAvailable('u2', true));
    await waitFor(() => expect(b.result.current).toBe(true));
  });

  it('retries after a network failure instead of hiding the link for good', async () => {
    api.listUpcoming.mockRejectedValueOnce(new Error('network'));
    const first = renderHook(() => useOnlineClassesAvailable('u1', true));
    await waitFor(() => expect(api.listUpcoming).toHaveBeenCalledTimes(1));
    expect(first.result.current).toBe(false);
    first.unmount();

    api.listUpcoming.mockResolvedValue([]);
    const second = renderHook(() => useOnlineClassesAvailable('u1', true));
    await waitFor(() => expect(second.result.current).toBe(true));
  });

  it('does not ask for roles that cannot use classes', () => {
    const { result } = renderHook(() => useOnlineClassesAvailable('u1', false));
    expect(result.current).toBe(false);
    expect(api.listUpcoming).not.toHaveBeenCalled();
  });
});
