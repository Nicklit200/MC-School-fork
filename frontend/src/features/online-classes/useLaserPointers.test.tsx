import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ClassEvent, pointerEvent } from './events';
import { useLaserPointers } from './useLaserPointers';

const publish = vi.fn().mockResolvedValue(undefined);
let handler: (received: { event: ClassEvent; senderIdentity: string | undefined }) => void = () => {};

vi.mock('./useClassEvents', () => ({
  useClassEvents: (_c: string, _t: string, onEvent: typeof handler) => {
    handler = onEvent;
    return { publish };
  },
}));

describe('useLaserPointers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    publish.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it('shows one dot per sender, at their latest position', () => {
    const { result } = renderHook(() => useLaserPointers('c1', 'board-1'));
    act(() => handler({ event: pointerEvent('c1', 'board-1', 0.1, 0.1), senderIdentity: 'a|1' }));
    act(() => handler({ event: pointerEvent('c1', 'board-1', 0.2, 0.3), senderIdentity: 'a|1' }));
    act(() => handler({ event: pointerEvent('c1', 'board-1', 0.5, 0.5), senderIdentity: 'b|1' }));
    expect(result.current.lasers).toHaveLength(2);
    expect(result.current.lasers.find((l) => l.id === 'a|1')).toMatchObject({ x: 0.2, y: 0.3 });
  });

  it('ignores another surface and anonymous senders', () => {
    const { result } = renderHook(() => useLaserPointers('c1', 'board-1'));
    act(() => handler({ event: pointerEvent('c1', 'other', 0.1, 0.1), senderIdentity: 'a|1' }));
    act(() => handler({ event: pointerEvent('c1', 'board-1', 0.1, 0.1), senderIdentity: undefined }));
    expect(result.current.lasers).toHaveLength(0);
  });

  it('fades a dot when its owner stops moving', () => {
    const { result } = renderHook(() => useLaserPointers('c1', 'board-1'));
    act(() => handler({ event: pointerEvent('c1', 'board-1', 0.1, 0.1), senderIdentity: 'a|1' }));
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(result.current.lasers).toHaveLength(0);
  });

  it('throttles outgoing pointer packets and sends them lossily', () => {
    const { result } = renderHook(() => useLaserPointers('c1', 'board-1'));
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    act(() => result.current.sendLaser({ x: 0.1, y: 0.1 }));
    act(() => result.current.sendLaser({ x: 0.2, y: 0.2 }));
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'pointer' }), false);
    vi.spyOn(performance, 'now').mockReturnValue(1100);
    act(() => result.current.sendLaser({ x: 0.3, y: 0.3 }));
    expect(publish).toHaveBeenCalledTimes(2);
  });
});
