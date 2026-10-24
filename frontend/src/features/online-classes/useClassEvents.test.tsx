import { act, renderHook } from '@testing-library/react';
import { EventEmitter } from 'events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeEvent, handEvent, NOTEBOOK_STROKE_TOPIC, STROKE_TOPIC, strokeEvent, VIEW_TOPIC } from './events';

const room = Object.assign(new EventEmitter(), {
  localParticipant: { publishData: vi.fn().mockResolvedValue(undefined) },
  remoteParticipants: new Map<string, { identity: string }>(),
});

vi.mock('@livekit/components-react', () => ({ useRoomContext: () => room }));

import { useClassEvents } from './useClassEvents';

const bytes = (classId: string) => encodeEvent(handEvent(classId, true));

describe('useClassEvents', () => {
  beforeEach(() => {
    room.removeAllListeners();
    room.localParticipant.publishData.mockClear();
    room.remoteParticipants.clear();
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

  it('keeps the same stroke payload isolated on its paper or notebook topic', () => {
    const paper = vi.fn(), notebook = vi.fn();
    renderHook(() => useClassEvents('c1', STROKE_TOPIC, paper));
    renderHook(() => useClassEvents('c1', NOTEBOOK_STROKE_TOPIC, notebook));
    const packet = encodeEvent(strokeEvent('c1', 'personal-pupil', 0, true,
      { kind: 'pen', color: '#111111', width: 0.004, points: [[0.2, 0.3]] }));
    act(() => room.emit('dataReceived', packet, { identity: 'teacher|laptop' }, undefined, NOTEBOOK_STROKE_TOPIC));
    expect(notebook).toHaveBeenCalledOnce();
    expect(paper).not.toHaveBeenCalled();
    act(() => room.emit('dataReceived', packet, { identity: 'teacher|laptop' }, undefined, STROKE_TOPIC));
    expect(paper).toHaveBeenCalledOnce();
    expect(notebook).toHaveBeenCalledOnce();
  });

  it('targets notebook strokes to connected owner and teacher devices without sending to another pupil', async () => {
    for (const identity of ['pupil|tablet', 'pupil|desktop', 'teacher|laptop', 'other-pupil|tablet']) {
      room.remoteParticipants.set(identity, { identity });
    }
    const { result } = renderHook(() => useClassEvents('c1', NOTEBOOK_STROKE_TOPIC, vi.fn()));
    const packet = strokeEvent('c1', 'personal-pupil', 0, false);
    await act(async () => { await result.current.publish(packet, true, ['pupil', 'teacher']); });
    expect(room.localParticipant.publishData).toHaveBeenCalledExactlyOnceWith(encodeEvent(packet), {
      reliable: true, topic: NOTEBOOK_STROKE_TOPIC,
      destinationIdentities: ['pupil|tablet', 'pupil|desktop', 'teacher|laptop'],
    });
  });

  it('does not fall back to broadcasting when no eligible private recipient is online', async () => {
    room.remoteParticipants.set('other-pupil|tablet', { identity: 'other-pupil|tablet' });
    const { result } = renderHook(() => useClassEvents('c1', NOTEBOOK_STROKE_TOPIC, vi.fn()));
    await act(async () => {
      await result.current.publish(strokeEvent('c1', 'personal-pupil', 0, false), true, ['pupil', 'teacher']);
    });
    expect(room.localParticipant.publishData).not.toHaveBeenCalled();
  });
});
