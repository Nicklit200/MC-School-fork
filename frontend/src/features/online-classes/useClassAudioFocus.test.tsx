import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RoomEvent, Track } from 'livekit-client';
import { onlineClassesApi } from '../../api/onlineClasses';
import { useClassAudioFocus } from './useClassAudioFocus';

const fixture = vi.hoisted(() => ({ room: null as any }));
vi.mock('@livekit/components-react', () => ({ useRoomContext: () => fixture.room }));
vi.mock('../../api/onlineClasses', () => ({ onlineClassesApi: { setAudioFocus: vi.fn() } }));
const focus = { version: 1, classId: 'class', teacherId: 'teacher', studentId: 'a', announceAll: false };

function publication(kind = Track.Kind.Audio) {
  const value = { kind, isSubscribed: true, setSubscribed: vi.fn((enabled: boolean) => { value.isSubscribed = enabled; }) };
  return value;
}
function room(local = 'teacher') {
  const listeners = new Map<string, Set<() => void>>();
  const participants = ['teacher', 'a', 'b', 'c'].filter(id => id !== local).map(id => [id, {
    identity: id + '|browser', trackPublications: new Map([['mic', publication()], ['camera', publication(Track.Kind.Video)], ['screen-audio', publication()]]),
  }] as const);
  return {
    metadata: JSON.stringify({ mcAudioFocus: focus }), localParticipant: { identity: local + '|browser' },
    remoteParticipants: new Map(participants),
    on: vi.fn((name: string, listener: () => void) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name)!.add(listener); }),
    off: vi.fn((name: string, listener: () => void) => { listeners.get(name)?.delete(listener); }),
    emit: (name: string) => { for (const listener of listeners.get(name) ?? []) listener(); },
  };
}
const mic = (id: string) => fixture.room.remoteParticipants.get(id).trackPublications.get('mic');
describe('live class audio subscriptions', () => {
  beforeEach(() => { vi.clearAllMocks(); fixture.room = room(); vi.mocked(onlineClassesApi.setAudioFocus).mockResolvedValue(focus as any); });
  it('never hides a pupil microphone from the teacher, including reconnect and newly published tracks', () => {
    renderHook(() => useClassAudioFocus('class', 'teacher', true));
    mic('b').isSubscribed = false;
    act(() => fixture.room.emit(RoomEvent.Reconnected));
    expect(mic('b').isSubscribed).toBe(true);
    expect(mic('a').isSubscribed).toBe(true);
    expect(mic('c').isSubscribed).toBe(true);
  });
  it('applies focused audio on initial entry and restores all audio from authoritative Back metadata', () => {
    fixture.room = room('b');
    renderHook(() => useClassAudioFocus('class', 'teacher', false));
    expect(mic('teacher').isSubscribed).toBe(false);
    expect(mic('a').isSubscribed).toBe(false);
    expect(mic('c').isSubscribed).toBe(true);
    for (const peer of fixture.room.remoteParticipants.values()) expect(peer.trackPublications.get('camera')!.setSubscribed).not.toHaveBeenCalled();
    act(() => { fixture.room.metadata = JSON.stringify({ mcAudioFocus: { ...focus, studentId: null } }); fixture.room.emit(RoomEvent.RoomMetadataChanged); });
    expect(mic('teacher').isSubscribed).toBe(true);
    expect(mic('a').isSubscribed).toBe(true);
  });
  it('keeps only teacher audio in the selected pupil and re-applies routing after subscription/reconnect', () => {
    fixture.room = room('a');
    renderHook(() => useClassAudioFocus('class', 'teacher', false));
    expect(mic('teacher').isSubscribed).toBe(true);
    expect(mic('b').isSubscribed).toBe(false);
    mic('b').isSubscribed = true;
    act(() => fixture.room.emit(RoomEvent.TrackSubscribed));
    expect(mic('b').isSubscribed).toBe(false);
    act(() => { fixture.room.remoteParticipants.delete('teacher'); fixture.room.emit(RoomEvent.ParticipantDisconnected); });
    expect(mic('b').isSubscribed).toBe(true);
  });
  it('makes an announcement audible without opening the selected pupil microphone to peers', () => {
    fixture.room = room('b');
    renderHook(() => useClassAudioFocus('class', 'teacher', false));
    act(() => { fixture.room.metadata = JSON.stringify({ mcAudioFocus: { ...focus, announceAll: true } }); fixture.room.emit(RoomEvent.RoomMetadataChanged); });
    expect(mic('teacher').isSubscribed).toBe(true);
    expect(mic('a').isSubscribed).toBe(false);
  });
  it('coalesces rapid switches and serializes an in-flight request before the final Back', async () => {
    let finish!: (value: any) => void;
    vi.mocked(onlineClassesApi.setAudioFocus).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const { result } = renderHook(() => useClassAudioFocus('class', 'teacher', true));
    act(() => result.current.change('a'));
    await waitFor(() => expect(onlineClassesApi.setAudioFocus).toHaveBeenCalledTimes(1));
    act(() => { result.current.change('b'); result.current.change(null); });
    expect(onlineClassesApi.setAudioFocus).toHaveBeenCalledTimes(1);
    await act(async () => finish(focus));
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(vi.mocked(onlineClassesApi.setAudioFocus).mock.calls).toEqual([['class', 'a', false], ['class', null, false]]);
  });
  it('does not discard a host command when the roster resolves its teacher identity', async () => {
    const { result, rerender } = renderHook(({ teacherId }) => useClassAudioFocus('class', teacherId, true),
      { initialProps: { teacherId: null as string | null } });
    act(() => result.current.change('a'));
    rerender({ teacherId: 'teacher' });
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(onlineClassesApi.setAudioFocus).toHaveBeenCalledWith('class', 'a', false);
  });

  it('shows an API failure and allows recovery without closing the call', async () => {
    vi.mocked(onlineClassesApi.setAudioFocus).mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useClassAudioFocus('class', 'teacher', true));
    act(() => result.current.change('a'));
    await waitFor(() => expect(result.current.error).toBe(true));
    expect(result.current.busy).toBe(false);
    act(() => result.current.change(null));
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(result.current.error).toBe(false);
  });
  it('retries failed subscriptions after reconnect and clears the playback error', () => {
    fixture.room = room('a');
    mic('b').setSubscribed.mockImplementationOnce(() => { throw new Error('disconnected'); });
    const { result } = renderHook(() => useClassAudioFocus('class', 'teacher', false));
    expect(result.current.error).toBe(true);
    act(() => fixture.room.emit(RoomEvent.Reconnected));
    expect(mic('b').isSubscribed).toBe(false);
    expect(result.current.error).toBe(false);
  });

  it('does not let a pupil publish a mode or a departed hook send a queued update', async () => {
    const pupil = renderHook(() => useClassAudioFocus('class', 'teacher', false));
    act(() => pupil.result.current.change('a'));
    expect(onlineClassesApi.setAudioFocus).not.toHaveBeenCalled();
    pupil.unmount();
    const host = renderHook(() => useClassAudioFocus('class', 'teacher', true));
    act(() => host.result.current.change('a'));
    host.unmount();
    await act(async () => { await Promise.resolve(); });
    expect(onlineClassesApi.setAudioFocus).not.toHaveBeenCalled();
  });
});
