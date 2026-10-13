import { act, renderHook } from '@testing-library/react';
import { EventEmitter } from 'events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeEvent, handEvent, VIEW_TOPIC } from './events';

const room = Object.assign(new EventEmitter(), {
  localParticipant: { publishData: vi.fn().mockResolvedValue(undefined) },
});

vi.mock('@livekit/components-react', () => ({ useRoomContext: () => room }));

import { useClassEvents } from './useClassEvents';

const bytes = (classId: string) => encodeEvent(handEvent(classId, true));

describe('useClassEvents', () => {
  beforeEach(() => {
    room.removeAllListeners();
    room.localParticipant.publishData.mockClear();
  });

  it('delivers valid packets for the topic with the sender identity', () => {
    const received = vi.fn();
    renderHook(() => useClassEvents('c1', VIEW_TOPIC, received));
    act(() => {
      room.emit('dataReceived', bytes('c1'), { identity: 'u1|d' }, undefined, VIEW_TOPIC);
    });
    expect(received).toHaveBeenCalledTimes(1);
    expect(received.mock.calls[0][0].senderIdentity).toBe('u1|d');
  });

  it('ignores other topics, other classes and garbage', () => {
    const received = vi.fn();
    renderHook(() => useClassEvents('c1', VIEW_TOPIC, received));
    act(() => {
      room.emit('dataReceived', bytes('c1'), { identity: 'u1|d' }, undefined, 'other.topic');
      room.emit('dataReceived', bytes('c2'), { identity: 'u1|d' }, undefined, VIEW_TOPIC);
      room.emit('dataReceived', new TextEncoder().encode('nope'), undefined, undefined, VIEW_TOPIC);
    });
    expect(received).not.toHaveBeenCalled();
  });

  it('stops listening on unmount', () => {
    const received = vi.fn();
    const { unmount } = renderHook(() => useClassEvents('c1', VIEW_TOPIC, received));
    unmount();
    expect(room.listenerCount('dataReceived')).toBe(0);
  });

  it('publishes on the topic and swallows transport failures', async () => {
    const { result } = renderHook(() => useClassEvents('c1', VIEW_TOPIC, vi.fn()));
    await act(async () => {
      await result.current.publish(handEvent('c1', true), false);
    });
    expect(room.localParticipant.publishData).toHaveBeenCalledWith(expect.anything(), {
      reliable: false,
      topic: VIEW_TOPIC,
    });

    room.localParticipant.publishData.mockRejectedValueOnce(new Error('down'));
    await expect(
      act(async () => {
        await result.current.publish(handEvent('c1', true));
      }),
    ).resolves.not.toThrow();
  });
});
