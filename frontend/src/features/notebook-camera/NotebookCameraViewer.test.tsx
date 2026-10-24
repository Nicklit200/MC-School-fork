import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function videoTrack(kind = 'video', readyState = 'live') {
  const mediaStreamTrack = Object.assign(new EventTarget(), { stop: vi.fn() });
  Object.defineProperty(mediaStreamTrack, 'readyState', { value: readyState });
  return { kind, isMuted: false, mediaStreamTrack };
}
function videoDimensions(video: HTMLVideoElement, width: number, height: number, readyState = 2) {
  Object.defineProperties(video, {
    videoWidth: { configurable: true, value: width }, videoHeight: { configurable: true, value: height },
    readyState: { configurable: true, value: readyState },
  });
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

describe('raw camera source for the classroom board', () => {
  it('publishes only real video dimensions from the correct phone, preserving the raw aspect', async () => {
    const source = vi.fn(), available = vi.fn();
    const { container } = render(<NotebookCameraViewer cameraId="camera-1" presentation="board"
      onBoardVideoChange={source} onVideoAvailableChange={available} />);
    const video = container.querySelector('video')!;
    expect(container.querySelector('iframe')).toBeNull();
    expect(video).toHaveClass('notebook-camera-viewer__source');
    expect(video).toHaveAttribute('autoplay'); expect(video).toHaveAttribute('playsinline');
    expect(video.muted).toBe(true); expect(video).toHaveAttribute('aria-hidden', 'true');
    await waitFor(() => expect(mocks.rooms[0].connect).toHaveBeenCalled());
    const room = mocks.rooms[0];
    videoDimensions(video, 1920, 1080);
    fireEvent.loadedMetadata(video);
    act(() => {
      room.handlers.track(videoTrack(), {}, { identity: 'other-phone' });
      room.handlers.track(videoTrack('audio'), {}, { identity: 'phone-1' });
      room.handlers.track(videoTrack('video', 'ended'), {}, { identity: 'phone-1' });
    });
    fireEvent.playing(video);
    expect(source.mock.calls.every(([value]) => value === null)).toBe(true);
    expect(available).toHaveBeenLastCalledWith(false);
    const track = videoTrack();
    act(() => room.handlers.track(track, {}, { identity: 'phone-1' }));
    expect(video.srcObject).toMatchObject({ tracks: [track.mediaStreamTrack] });
    expect(available).toHaveBeenLastCalledWith(true);
    videoDimensions(video, 1920, 1080, 1);
    fireEvent.loadedMetadata(video);
    expect(source).toHaveBeenLastCalledWith(null);
    videoDimensions(video, 1920, 1080, 2);
    fireEvent.loadedData(video);
    expect(source).toHaveBeenLastCalledWith({ video, width: 1920, height: 1080 });
    const updates = source.mock.calls.length;
    fireEvent.playing(video);
    expect(source).toHaveBeenCalledTimes(updates);
    videoDimensions(video, 1080, 1920);
    fireEvent.resize(video);
    expect(source).toHaveBeenLastCalledWith({ video, width: 1080, height: 1920 });
    expect(video.style.transform).toBe('');
  });

  it('keeps one source element and room through grid/full and uses the latest callbacks', async () => {
    const firstSource = vi.fn(), latestSource = vi.fn(), available = vi.fn(), latestAvailable = vi.fn();
    const { container, rerender, unmount } = render(<NotebookCameraViewer cameraId="camera-1" presentation="board" compact
      onBoardVideoChange={firstSource} onVideoAvailableChange={available} />);
    const video = container.querySelector('video')!;
    await waitFor(() => expect(mocks.rooms[0].connect).toHaveBeenCalled());
    const room = mocks.rooms[0], track = videoTrack();
    act(() => room.handlers.track(track, {}, { identity: 'phone-1' }));
    videoDimensions(video, 1280, 720); fireEvent.playing(video);
    expect(firstSource).toHaveBeenLastCalledWith({ video, width: 1280, height: 720 });
    const sourceCalls = firstSource.mock.calls.length, availableCalls = available.mock.calls.length;
    rerender(<NotebookCameraViewer cameraId="camera-1" presentation="board" compact={false}
      onBoardVideoChange={latestSource} onVideoAvailableChange={latestAvailable} title="Тетрадь Alice" />);
    expect(container.querySelector('video')).toBe(video);
    expect(container.querySelector('iframe')).toBeNull();
    expect(video.parentElement).toHaveClass('notebook-camera-viewer--board');
    videoDimensions(video, 1920, 1080); fireEvent.resize(video);
    expect(latestSource).toHaveBeenLastCalledWith({ video, width: 1920, height: 1080 });
    act(() => room.handlers.muted({ track }, { identity: 'phone-1' }));
    expect(latestSource).toHaveBeenLastCalledWith(null);
    expect(latestAvailable).toHaveBeenLastCalledWith(false);
    expect(firstSource).toHaveBeenCalledTimes(sourceCalls); expect(available).toHaveBeenCalledTimes(availableCalls);
    expect(mocks.rooms).toHaveLength(1); expect(mocks.connection).toHaveBeenCalledOnce();
    unmount();
    expect(latestSource).toHaveBeenLastCalledWith(null);
    expect(video.srcObject).toBeNull(); expect(track.mediaStreamTrack.stop).not.toHaveBeenCalled();
    expect(room.disconnect).toHaveBeenCalledOnce();
  });

  it('clears the board source on phone stop and resumes in the same room without exposing processor controls', async () => {
    const source = vi.fn();
    const { container, unmount } = render(<NotebookCameraViewer cameraId="camera-1" presentation="board" onBoardVideoChange={source} />);
    const video = container.querySelector('video')!;
    await waitFor(() => expect(mocks.rooms[0].connect).toHaveBeenCalled());
    const room = mocks.rooms[0], track = videoTrack();
    act(() => room.handlers.track(track, {}, { identity: 'phone-1' }));
    videoDimensions(video, 1920, 1080); fireEvent.loadedMetadata(video);
    act(() => room.handlers.untrack(track, {}, { identity: 'other-phone' }));
    expect(source).toHaveBeenLastCalledWith({ video, width: 1920, height: 1080 });
    act(() => room.handlers.untrack(track, {}, { identity: 'phone-1' }));
    expect(source).toHaveBeenLastCalledWith(null); expect(video.srcObject).toBeNull();
    fireEvent.playing(video); expect(source).toHaveBeenLastCalledWith(null);
    const restarted = videoTrack();
    act(() => room.handlers.track(restarted, {}, { identity: 'phone-1' }));
    fireEvent.playing(video);
    expect(source).toHaveBeenLastCalledWith({ video, width: 1920, height: 1080 });
    act(() => room.handlers.participantDisconnected({ identity: 'phone-1' }));
    expect(source).toHaveBeenLastCalledWith(null);
    act(() => room.handlers.track(restarted, {}, { identity: 'phone-1' }));
    fireEvent.loadedMetadata(video);
    act(() => room.handlers.disconnected());
    expect(source).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeVisible();
    expect(mocks.rooms).toHaveLength(1);
    unmount(); expect(track.mediaStreamTrack.stop).not.toHaveBeenCalled(); expect(restarted.mediaStreamTrack.stop).not.toHaveBeenCalled();
  });

  it('offers a visible retry if the service video cannot play', async () => {
    const source = vi.fn(), available = vi.fn();
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new Error('Autoplay refused'));
    const { container } = render(<NotebookCameraViewer cameraId="camera-1" presentation="board"
      onBoardVideoChange={source} onVideoAvailableChange={available} />);
    await waitFor(() => expect(mocks.rooms[0].connect).toHaveBeenCalled());
    act(() => mocks.rooms[0].handlers.track(videoTrack(), {}, { identity: 'phone-1' }));
    const retry = await screen.findByRole('button', { name: 'Повторить' });
    expect(screen.getByRole('alert')).toHaveTextContent('Не удалось включить видео');
    expect(source).toHaveBeenLastCalledWith(null); expect(available).toHaveBeenLastCalledWith(false);
    fireEvent.click(retry);
    await waitFor(() => expect(mocks.connection).toHaveBeenCalledTimes(2));
    expect(container.querySelector('iframe')).toBeNull();
  });
});
