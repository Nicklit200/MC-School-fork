import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotebookCameraViewer } from './NotebookCameraViewer';

const mocks = vi.hoisted(() => ({ rooms: [] as any[], connection: vi.fn() }));
vi.mock('../../api/notebookCameras', () => ({ notebookCamerasApi: { connection: mocks.connection }, notebookCameraError: (reason: Error) => reason.message }));
vi.mock('livekit-client', () => ({
  Track: { Kind: { Video: 'video', Audio: 'audio' } },
  RoomEvent: { TrackSubscribed: 'track', TrackUnsubscribed: 'untrack', ParticipantDisconnected: 'participantDisconnected',
    TrackMuted: 'muted', TrackUnmuted: 'unmuted', DataReceived: 'data', Reconnecting: 'reconnecting', Reconnected: 'reconnected', Disconnected: 'disconnected' },
  Room: class {
    state = 'connected'; handlers: Record<string, (...args: any[]) => void> = {};
    localParticipant = { publishData: vi.fn(async () => {}) };
    remoteParticipants = new Map();
    connect = vi.fn(async () => {}); disconnect = vi.fn(async () => {});
    constructor() { mocks.rooms.push(this); }
    on(event: string, callback: (...args: any[]) => void) { this.handlers[event] = callback; return this; }
  },
}));
beforeEach(() => {
  vi.clearAllMocks(); mocks.rooms.length = 0;
  mocks.connection.mockResolvedValue({ serverUrl: 'wss://media.example', token: 'viewer-token', phoneIdentity: 'phone-1' });
  vi.stubGlobal('MediaStream', class { constructor(public tracks: MediaStreamTrack[]) {} });
});
afterEach(() => vi.unstubAllGlobals());
function videoTrack(kind = 'video', readyState = 'live') {
  const mediaStreamTrack = new EventTarget();
  Object.defineProperty(mediaStreamTrack, 'readyState', { value: readyState });
  return { kind, isMuted: false, mediaStreamTrack };
}
describe('notebook viewer isolation', () => {
  it('accepts camera state only from this session phone identity', async () => {
    render(<NotebookCameraViewer cameraId="camera-1" />);
    const frame = screen.getByTitle('Тетрадь: выравнивание, фокус и пометки') as HTMLIFrameElement;
    const receive = vi.fn(); Object.assign(frame.contentWindow!, { receiveNotebookData: receive });
    await waitFor(() => expect(mocks.rooms[0].connect).toHaveBeenCalled());
    const state = new TextEncoder().encode(JSON.stringify({ type: 'camera-state', quality: 'detail' }));
    mocks.rooms[0].handlers.data(state, { identity: 'other-phone' }, undefined, 'mindcrafti-notebook-camera');
    expect(receive).not.toHaveBeenCalled();
    mocks.rooms[0].handlers.data(state, { identity: 'phone-1' }, undefined, 'mindcrafti-notebook-camera');
    expect(receive).toHaveBeenCalledWith({ type: 'camera-state', quality: 'detail' });
  });
  it('rejects foreign frame commands and clears displayed media when retrying', async () => {
    render(<NotebookCameraViewer cameraId="camera-1" />);
    const frame = screen.getByTitle('Тетрадь: выравнивание, фокус и пометки') as HTMLIFrameElement;
    const connected = vi.fn(), stream = vi.fn(); Object.assign(frame.contentWindow!, { setNotebookConnected: connected, setNotebookStream: stream });
    await waitFor(() => expect(mocks.rooms[0].connect).toHaveBeenCalled());
    const room = mocks.rooms[0];
    const data = { type: 'mindcrafti-notebook-command', value: { type: 'camera-request' } };
    fireEvent(window, new MessageEvent('message', { origin: 'https://foreign.example', source: frame.contentWindow, data }));
    fireEvent(window, new MessageEvent('message', { origin: window.location.origin, source: window, data }));
    expect(room.localParticipant.publishData).not.toHaveBeenCalled();
    fireEvent(window, new MessageEvent('message', { origin: window.location.origin, source: frame.contentWindow, data }));
    expect(room.localParticipant.publishData).toHaveBeenCalledOnce();
    expect(new TextDecoder().decode(room.localParticipant.publishData.mock.calls[0][0])).toBe(JSON.stringify({ type: 'camera-request' }));
    expect(room.localParticipant.publishData.mock.calls[0][1]).toMatchObject({ destinationIdentities: ['phone-1'] });
    act(() => room.handlers.disconnected());
    await screen.findByRole('button', { name: 'Повторить' });
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(room.disconnect).toHaveBeenCalled());
    expect(connected).toHaveBeenCalledWith(false); expect(stream).toHaveBeenCalledWith(null);
  });
});

describe('persistent pupil notebook surface', () => {
  it('restores live media and its status when the frame loads after the phone video', async () => {
    render(<NotebookCameraViewer cameraId="camera-1" />);
    const frame = screen.getByTitle('Тетрадь: выравнивание, фокус и пометки') as HTMLIFrameElement;
    await waitFor(() => expect(mocks.rooms[0].connect).toHaveBeenCalled());
    const room = mocks.rooms[0];
    act(() => room.handlers.track(videoTrack(), {}, { identity: 'phone-1' }));
    const displayedStream = vi.fn(), status = vi.fn();
    Object.assign(frame.contentWindow!, { setNotebookStream: displayedStream, setNotebookStatus: status });
    fireEvent.load(frame);
    expect(displayedStream).toHaveBeenLastCalledWith(expect.any(MediaStream));
    const liveStream = displayedStream.mock.calls.at(-1)![0];
    expect(status).toHaveBeenLastCalledWith('Телефон подключён. Можно выровнять лист и делать пометки.');
    fireEvent.load(frame);
    expect(displayedStream).toHaveBeenLastCalledWith(liveStream);
    act(() => room.handlers.participantDisconnected({ identity: 'phone-1' }));
    const stoppedStatus = status.mock.calls.at(-1)![0];
    fireEvent.load(frame);
    expect(displayedStream).toHaveBeenLastCalledWith(null);
    expect(status).toHaveBeenLastCalledWith(stoppedStatus);
    expect(mocks.rooms).toHaveLength(1); expect(mocks.connection).toHaveBeenCalledOnce();
    expect(room.disconnect).not.toHaveBeenCalled();
  });

  it('reports only this phone’s live video and survives phone stop and restart in one room', async () => {
    const available = vi.fn();
    const { unmount } = render(<NotebookCameraViewer cameraId="camera-1" onVideoAvailableChange={available} />);
    const frame = screen.getByTitle('Тетрадь: выравнивание, фокус и пометки') as HTMLIFrameElement;
    const displayedStream = vi.fn(); Object.assign(frame.contentWindow!, { setNotebookStream: displayedStream });
    await waitFor(() => expect(mocks.rooms[0].connect).toHaveBeenCalled());
    const room = mocks.rooms[0];
    expect(available.mock.calls).toEqual([[false]]);
    act(() => {
      room.handlers.track(videoTrack(), {}, { identity: 'other-phone' });
      room.handlers.track(videoTrack('audio'), {}, { identity: 'phone-1' });
      room.handlers.track(videoTrack('video', 'ended'), {}, { identity: 'phone-1' });
    });
    expect(available.mock.calls).toEqual([[false]]);
    const first = videoTrack();
    act(() => room.handlers.track(first, {}, { identity: 'phone-1' }));
    expect(available).toHaveBeenLastCalledWith(true);
    const updates = available.mock.calls.length;
    act(() => {
      room.handlers.untrack(first, {}, { identity: 'other-phone' });
      room.handlers.untrack(videoTrack('audio'), {}, { identity: 'phone-1' });
      room.handlers.participantDisconnected({ identity: 'other-phone' });
    });
    expect(available).toHaveBeenCalledTimes(updates);
    act(() => room.handlers.untrack(first, {}, { identity: 'phone-1' }));
    expect(available).toHaveBeenLastCalledWith(false);
    expect(displayedStream).toHaveBeenLastCalledWith(null);
    const restarted = videoTrack();
    act(() => room.handlers.track(restarted, {}, { identity: 'phone-1' }));
    expect(available).toHaveBeenLastCalledWith(true);
    act(() => room.handlers.participantDisconnected({ identity: 'phone-1' }));
    expect(available).toHaveBeenLastCalledWith(false);
    act(() => room.handlers.track(videoTrack(), {}, { identity: 'phone-1' }));
    expect(available).toHaveBeenLastCalledWith(true);
    act(() => room.handlers.disconnected());
    expect(available).toHaveBeenLastCalledWith(false);
    expect(mocks.rooms).toHaveLength(1);
    unmount(); expect(available).toHaveBeenLastCalledWith(false);
    expect(room.disconnect).toHaveBeenCalledOnce();
  });

  it('restores an already subscribed phone publication while ignoring other media', async () => {
    const available = vi.fn();
    render(<NotebookCameraViewer cameraId="camera-1" onVideoAvailableChange={available} />);
    const room = mocks.rooms[0];
    room.remoteParticipants.set('other-phone', { identity: 'other-phone', trackPublications: new Map([['video', { track: videoTrack() }]]) });
    room.remoteParticipants.set('phone-1', { identity: 'phone-1', trackPublications: new Map([
      ['audio', { track: videoTrack('audio') }], ['ended', { track: videoTrack('video', 'ended') }], ['video', { track: videoTrack() }],
    ]) });
    await waitFor(() => expect(available).toHaveBeenLastCalledWith(true));
    expect(available.mock.calls).toEqual([[false], [true]]);
  });

  it('changes grid presentation and callback without replacing the iframe or room', async () => {
    const firstCallback = vi.fn(), latestCallback = vi.fn();
    const { rerender, unmount } = render(<NotebookCameraViewer cameraId="camera-1" onVideoAvailableChange={firstCallback} />);
    const frame = screen.getByTitle('Тетрадь: выравнивание, фокус и пометки') as HTMLIFrameElement;
    const compact = vi.fn(); Object.assign(frame.contentWindow!, { setNotebookCompact: compact });
    await waitFor(() => expect(mocks.rooms[0].connect).toHaveBeenCalled());
    const room = mocks.rooms[0], track = videoTrack();
    act(() => room.handlers.track(track, {}, { identity: 'phone-1' }));
    expect(firstCallback).toHaveBeenLastCalledWith(true);
    const firstCalls = firstCallback.mock.calls.length;
    rerender(<NotebookCameraViewer cameraId="camera-1" compact title="Тетрадь ученика Alice" onVideoAvailableChange={latestCallback} />);
    expect(screen.getByTitle('Тетрадь ученика Alice')).toBe(frame);
    expect(frame).toHaveAttribute('src', '/notebook-camera/index.html');
    expect(frame.parentElement).toHaveClass('notebook-camera-viewer--compact');
    expect(compact).toHaveBeenLastCalledWith(true);
    fireEvent.load(frame); expect(compact).toHaveBeenLastCalledWith(true);
    act(() => room.handlers.untrack(track, {}, { identity: 'phone-1' }));
    expect(latestCallback).toHaveBeenLastCalledWith(false);
    expect(firstCallback).toHaveBeenCalledTimes(firstCalls);
    rerender(<NotebookCameraViewer cameraId="camera-1" compact={false} onVideoAvailableChange={latestCallback} />);
    expect(screen.getByTitle('Тетрадь: выравнивание, фокус и пометки')).toBe(frame);
    expect(compact).toHaveBeenLastCalledWith(false);
    expect(mocks.rooms).toHaveLength(1); expect(mocks.connection).toHaveBeenCalledOnce();
    expect(room.disconnect).not.toHaveBeenCalled();
    unmount(); expect(latestCallback).toHaveBeenLastCalledWith(false);
  });

  it('keeps a replacement track when the old publication unsubscribes, and clears ended or muted media', async () => {
    const available = vi.fn();
    render(<NotebookCameraViewer cameraId="camera-1" onVideoAvailableChange={available} />);
    await waitFor(() => expect(mocks.rooms[0].connect).toHaveBeenCalled());
    const room = mocks.rooms[0], first = videoTrack(), replacement = videoTrack();
    act(() => { room.handlers.track(first, {}, { identity: 'phone-1' }); room.handlers.track(replacement, {}, { identity: 'phone-1' }); });
    const updates = available.mock.calls.length;
    act(() => room.handlers.untrack(first, {}, { identity: 'phone-1' }));
    expect(available).toHaveBeenCalledTimes(updates);
    act(() => replacement.mediaStreamTrack.dispatchEvent(new Event('ended')));
    expect(available).toHaveBeenLastCalledWith(false);
    const resumed = videoTrack();
    act(() => room.handlers.track(resumed, {}, { identity: 'phone-1' }));
    act(() => { resumed.isMuted = true; room.handlers.muted({ track: resumed }, { identity: 'phone-1' }); });
    expect(available).toHaveBeenLastCalledWith(false);
    act(() => { resumed.isMuted = false; room.handlers.unmuted({ track: resumed }, { identity: 'phone-1' }); });
    expect(available).toHaveBeenLastCalledWith(true);
  });
});
