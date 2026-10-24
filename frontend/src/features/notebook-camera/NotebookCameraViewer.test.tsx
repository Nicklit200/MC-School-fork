import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotebookCameraViewer } from './NotebookCameraViewer';

const mocks = vi.hoisted(() => ({ rooms: [] as any[], renderers: [] as any[], failFrame: false, connection: vi.fn(), loadCameraModule: vi.fn() }));
vi.mock('../../api/notebookCameras', () => ({ notebookCamerasApi: { connection: mocks.connection }, notebookCameraError: (reason: Error) => reason.message }));
vi.mock('./cameraModules', () => ({ loadCameraModule: mocks.loadCameraModule }));
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
type DocumentView = { type: 'document-view'; version: 1; corners: { x: number; y: number }[] | null; ratio: number | null; turn: number; sourceAspect: number };
function documentView(overrides: Partial<DocumentView> = {}): DocumentView {
  return { type: 'document-view', version: 1, corners: null, ratio: null, turn: 2, sourceAspect: 16 / 9, ...overrides };
}
function cameraModule() {
  const validateDocumentView = (value: any): DocumentView | null => {
    if (value?.type !== 'document-view' || value.version !== 1 || !Number.isInteger(value.turn) || value.turn < 0 || value.turn > 3
      || !Number.isFinite(value.sourceAspect) || value.sourceAspect < 0.1 || value.sourceAspect > 10
      || (value.corners !== null && (!Array.isArray(value.corners) || value.corners.length !== 4
        || value.corners.some((point: any) => !Number.isFinite(point?.x) || !Number.isFinite(point?.y) || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1)
        || !Number.isFinite(value.ratio) || value.ratio < 0.25 || value.ratio > 4))) return null;
    return structuredClone(value);
  };
  return {
    defaultDocumentView: (aspect = 1) => documentView({ sourceAspect: aspect }), validateDocumentView,
    QUALITY_PROFILES: { detail: { bitrate: 8_000_000, fps: 30, render: 1920 }, balanced: { bitrate: 4_000_000, fps: 24, render: 1280 } },
    LiveDocumentRenderer: class {
      video: HTMLVideoElement; canvas: HTMLCanvasElement; options: any; view = documentView(); maxDimension: number; running = false; failed = false;
      constructor(video: HTMLVideoElement, canvas: HTMLCanvasElement, options: any = {}) {
        this.video = video; this.canvas = canvas; this.options = options; this.maxDimension = options.maxDimension ?? 1920; mocks.renderers.push(this);
      }
      configure() {
        if (!this.video.videoWidth || !this.video.videoHeight) return;
        const baseAspect = this.view.corners ? this.view.ratio! : this.video.videoWidth / this.video.videoHeight;
        const aspect = this.view.turn % 2 ? 1 / baseAspect : baseAspect;
        const max = Math.min(this.maxDimension, Math.max(this.video.videoWidth, this.video.videoHeight));
        this.canvas.width = aspect >= 1 ? max : Math.max(2, Math.round(max * aspect));
        this.canvas.height = aspect >= 1 ? Math.max(2, Math.round(max / aspect)) : max;
      }
      setView = vi.fn((view: DocumentView) => { this.view = structuredClone(view); this.configure(); if (this.video.readyState >= 2) this.render(); });
      setMaxDimension = vi.fn((value: number) => { this.maxDimension = value; this.configure(); });
      render = vi.fn(() => {
        if (this.failed) return;
        this.configure();
        if (mocks.failFrame) { this.failed = true; this.options.onError?.('Synthetic frame failure'); return; }
        this.options.onFrame?.(this.canvas);
      });
      start = vi.fn(() => { this.running = true; this.configure(); });
      stop = vi.fn(() => { this.running = false; });
      replaceCanvas() {
        const next = this.canvas.cloneNode(false) as HTMLCanvasElement;
        this.canvas.replaceWith(next); this.canvas = next; this.options.onCanvasReplace?.(next); return next;
      }
    },
  };
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.rooms.length = 0; mocks.renderers.length = 0; mocks.failFrame = false;
  sessionStorage.clear();
  mocks.connection.mockResolvedValue({ serverUrl: 'wss://media.example', token: 'viewer-token', phoneIdentity: 'phone-1' });
  mocks.loadCameraModule.mockResolvedValue(cameraModule());
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
function phoneState(room: any, view: DocumentView, revision = 0, envelope: Record<string, unknown> = {}, identity = 'phone-1', dataTopic = 'mindcrafti-notebook-camera') {
  const payload = new TextEncoder().encode(JSON.stringify({ type: 'document-view-state', version: 1, cameraId: 'camera-1', revision, view, ...envelope }));
  act(() => room.handlers.data(payload, { identity }, undefined, dataTopic));
}
function sentData(room: any) {
  return room.localParticipant.publishData.mock.calls.map(([payload]: [Uint8Array]) => JSON.parse(new TextDecoder().decode(payload)));
}
async function expectCanvasSource(callback: ReturnType<typeof vi.fn>, width: number, height: number) {
  await waitFor(() => expect(callback).toHaveBeenLastCalledWith(expect.objectContaining({ video: expect.any(HTMLCanvasElement), width, height,
    rawVideo: expect.any(HTMLVideoElement), rawWidth: expect.any(Number), rawHeight: expect.any(Number),
    view: expect.objectContaining({ type: 'document-view', version: 1 }), renderer: expect.objectContaining({ LiveDocumentRenderer: expect.any(Function) }),
  })));
  const source = callback.mock.calls.at(-1)![0];
  const renderer = mocks.renderers.at(-1);
  expect(source.video).toBe(renderer.canvas);
  expect(source.video.width).toBe(width); expect(source.video.height).toBe(height);
  expect(source.rawVideo).toBe(renderer.video);
  expect(source.rawWidth).toBe(renderer.video.videoWidth); expect(source.rawHeight).toBe(renderer.video.videoHeight);
  expect(source.view).toEqual(renderer.view);
  return source.video as HTMLCanvasElement;
}
describe('owner notebook on the ordinary lesson board', () => {
  const ownerConnection = { serverUrl: 'wss://media.example', token: 'viewer-token', phoneIdentity: 'phone-1', identity: 'notebook-viewer:camera-1:student-1:a1b2c3d4' };

  it('keeps one room, raw source and processor iframe through settings close/open without reapplying corner geometry', async () => {
    mocks.connection.mockResolvedValue(ownerConnection);
    const source = vi.fn(), setView = vi.fn(), setStream = vi.fn(), setSettingsOpen = vi.fn();
    const base = { cameraId: 'camera-1', ownerId: 'student-1', presentation: 'lesson' as const, active: false, onBoardVideoChange: source };
    const { container, rerender, unmount } = render(<NotebookCameraViewer {...base} />);
    const frame = container.querySelector('iframe')!, video = container.querySelector('video')!;
    expect(frame).toHaveAttribute('src', '/notebook-camera/index.html?mode=settings&v=lesson-notebook-1');
    expect(frame).toHaveAttribute('hidden');
    Object.assign(frame.contentWindow!, { setNotebookSettingsOpen: setSettingsOpen, setNotebookDocumentView: setView, setNotebookStream: setStream });
    await waitFor(() => expect(mocks.rooms[0].connect).toHaveBeenCalled());
    fireEvent.load(frame);
    const room = mocks.rooms[0], track = videoTrack();
    act(() => room.handlers.track(track, {}, { identity: 'phone-1' }));
    videoDimensions(video, 1920, 1080); fireEvent.loadedData(video);
    const canvas = await expectCanvasSource(source, 1920, 1080);
    phoneState(room, documentView(), 1);
    setStream.mockClear(); setView.mockClear(); source.mockClear();
    rerender(<NotebookCameraViewer {...base} settingsOpen />);
    expect(frame).not.toHaveAttribute('hidden'); expect(setSettingsOpen).toHaveBeenLastCalledWith(true);
    rerender(<NotebookCameraViewer {...base} settingsOpen={false} compact />);
    expect(frame).toHaveAttribute('hidden'); expect(setSettingsOpen).toHaveBeenLastCalledWith(false);
    expect(container.querySelector('iframe')).toBe(frame); expect(container.querySelector('video')).toBe(video);
    expect(mocks.rooms).toHaveLength(1); expect(mocks.connection).toHaveBeenCalledOnce();
    expect(room.disconnect).not.toHaveBeenCalled(); expect(setStream).not.toHaveBeenCalled(); expect(setView).not.toHaveBeenCalled();
    expect(source).not.toHaveBeenCalled(); expect(mocks.renderers).toHaveLength(1);
    expect(mocks.renderers[0].canvas).toBe(canvas); expect(mocks.renderers[0].running).toBe(false);
    unmount(); expect(source).toHaveBeenLastCalledWith(null); expect(room.disconnect).toHaveBeenCalledOnce();
    expect(track.mediaStreamTrack.stop).not.toHaveBeenCalled();
  });

  it('projects owner crop immediately, preserves its pending update through drawer toggles and accepts the phone canonical ACK', async () => {
    mocks.connection.mockResolvedValue(ownerConnection);
    const source = vi.fn(), setView = vi.fn(() => true);
    const base = { cameraId: 'camera-1', ownerId: 'student-1', presentation: 'lesson' as const, active: false, onBoardVideoChange: source };
    const { container, rerender } = render(<NotebookCameraViewer {...base} settingsOpen />);
    const frame = container.querySelector('iframe')!, video = container.querySelector('video')!;
    Object.assign(frame.contentWindow!, { setNotebookDocumentView: setView });
    await waitFor(() => expect(mocks.rooms[0].connect).toHaveBeenCalled());
    const room = mocks.rooms[0], track = videoTrack();
    act(() => room.handlers.track(track, {}, { identity: 'phone-1' }));
    videoDimensions(video, 1920, 1080); fireEvent.loadedData(video);
    phoneState(room, documentView(), 1);
    const cropped = documentView({ turn: 1, ratio: .5, corners: [{ x: .2, y: .1 }, { x: .8, y: .1 }, { x: .8, y: .9 }, { x: .2, y: .9 }] });
    fireEvent(window, new MessageEvent('message', { origin: window.location.origin, source: frame.contentWindow,
      data: { type: 'mindcrafti-notebook-view', value: cropped } }));
    await expectCanvasSource(source, 1920, 960);
    expect(source.mock.calls.at(-1)?.[0].view).toEqual(cropped);
    const update = sentData(room).find((value: any) => value.type === 'document-view-update');
    expect(update).toMatchObject({ view: cropped, changeId: expect.any(String) });
    rerender(<NotebookCameraViewer {...base} settingsOpen={false} />);
    rerender(<NotebookCameraViewer {...base} settingsOpen />);
    phoneState(room, documentView({ turn: 0 }), 2);
    expect(source.mock.calls.at(-1)?.[0].view).toEqual(cropped);
    const canonical = documentView({ turn: 1 });
    phoneState(room, canonical, 3, { changeId: update.changeId });
    await expectCanvasSource(source, 1080, 1920);
    expect(source.mock.calls.at(-1)?.[0]).toMatchObject({ rawVideo: video, rawWidth: 1920, rawHeight: 1080, view: canonical });
    expect(setView).toHaveBeenLastCalledWith(canonical);
    expect(sentData(room).filter((value: any) => value.type === 'document-view-update')).toHaveLength(1);
    act(() => room.handlers.untrack(track, {}, { identity: 'phone-1' }));
    expect(source).toHaveBeenLastCalledWith(null);
    act(() => room.handlers.track(track, {}, { identity: 'phone-1' })); fireEvent.playing(video);
    await expectCanvasSource(source, 1080, 1920);
    expect(mocks.rooms).toHaveLength(1); expect(mocks.connection).toHaveBeenCalledOnce();
  });

  it('accepts bounded settings size and Escape close only from its own same-origin iframe, using the latest callback', async () => {
    const close = vi.fn(), latestClose = vi.fn();
    const base = { cameraId: 'camera-1', presentation: 'lesson' as const, settingsOpen: true };
    const { container, rerender } = render(<NotebookCameraViewer {...base} onSettingsClose={close} />);
    const frame = container.querySelector('iframe')!;
    await waitFor(() => expect(mocks.rooms[0].connect).toHaveBeenCalled());
    const message = (data: unknown, origin = window.location.origin, source: MessageEventSource | null = frame.contentWindow) =>
      fireEvent(window, new MessageEvent('message', { origin, source, data }));
    message({ type: 'mindcrafti-notebook-settings-size', height: 1600 }, 'https://foreign.example');
    message({ type: 'mindcrafti-notebook-settings-size', height: 1600 }, window.location.origin, window);
    for (const height of [-1, 239, 8001, '1600', null, NaN]) message({ type: 'mindcrafti-notebook-settings-size', height });
    expect(frame.style.height).toBe('');
    message({ type: 'mindcrafti-notebook-settings-size', height: 1600.2 }); expect(frame.style.height).toBe('1601px');
    message({ type: 'mindcrafti-notebook-close-settings' }, 'https://foreign.example');
    message({ type: 'mindcrafti-notebook-close-settings' }, window.location.origin, window);
    expect(close).not.toHaveBeenCalled();
    rerender(<NotebookCameraViewer {...base} onSettingsClose={latestClose} />);
    message({ type: 'mindcrafti-notebook-close-settings' }); expect(latestClose).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
    rerender(<NotebookCameraViewer {...base} settingsOpen={false} onSettingsClose={latestClose} />);
    message({ type: 'mindcrafti-notebook-close-settings' }); expect(latestClose).toHaveBeenCalledOnce();
    expect(container.querySelector('iframe')).toBe(frame); expect(frame.style.height).toBe('1601px'); expect(mocks.rooms).toHaveLength(1);
  });
});

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

  it('sends a validated own-frame view even while a camera control is pending', async () => {
    render(<NotebookCameraViewer cameraId="camera-1" />);
    const frame = screen.getByTitle('Тетрадь: выравнивание, фокус и пометки') as HTMLIFrameElement;
    await waitFor(() => expect(mocks.rooms[0].connect).toHaveBeenCalled());
    const room = mocks.rooms[0];
    let finishControl!: () => void;
    room.localParticipant.publishData.mockImplementation((payload: Uint8Array) => {
      const value = JSON.parse(new TextDecoder().decode(payload));
      return value.type === 'camera-control' ? new Promise<void>(resolve => { finishControl = resolve; }) : Promise.resolve();
    });
    fireEvent(window, new MessageEvent('message', { origin: window.location.origin, source: frame.contentWindow,
      data: { type: 'mindcrafti-notebook-command', value: { type: 'camera-control', action: 'quality', value: 'balanced' } } }));
    const view = documentView({ turn: 1 }), data = { type: 'mindcrafti-notebook-view', value: view };
    fireEvent(window, new MessageEvent('message', { origin: 'https://foreign.example', source: frame.contentWindow, data }));
    fireEvent(window, new MessageEvent('message', { origin: window.location.origin, source: window, data }));
    fireEvent(window, new MessageEvent('message', { origin: window.location.origin, source: frame.contentWindow,
      data: { ...data, value: { ...view, turn: 99 } } }));
    expect(sentData(room).filter((value: any) => value.type === 'document-view-update')).toEqual([]);
    fireEvent(window, new MessageEvent('message', { origin: window.location.origin, source: frame.contentWindow, data }));
    await waitFor(() => expect(sentData(room).filter((value: any) => value.type === 'document-view-update')).toHaveLength(1));
    const index = sentData(room).findIndex((value: any) => value.type === 'document-view-update');
    expect(sentData(room)[index]).toEqual({ type: 'document-view-update', version: 1, cameraId: 'camera-1', changeId: expect.any(String), view });
    expect(sentData(room)[index].changeId).not.toBe('');
    expect(room.localParticipant.publishData.mock.calls[index][1]).toMatchObject({ reliable: true, topic: 'mindcrafti-notebook-camera', destinationIdentities: ['phone-1'] });
    await act(async () => finishControl());
  });

  it('retries a transient view publication failure on a trusted phone heartbeat using the same changeId', async () => {
    render(<NotebookCameraViewer cameraId="camera-1" />);
    const frame = screen.getByTitle('Тетрадь: выравнивание, фокус и пометки') as HTMLIFrameElement;
    await waitFor(() => expect(mocks.rooms[0].connect).toHaveBeenCalled());
    const room = mocks.rooms[0], view = documentView({ turn: 1 });
    room.localParticipant.publishData.mockRejectedValueOnce(new Error('Temporary signaling interruption'));
    fireEvent(window, new MessageEvent('message', { origin: window.location.origin, source: frame.contentWindow,
      data: { type: 'mindcrafti-notebook-view', value: view } }));
    await act(async () => {});
    const first = sentData(room).find((value: any) => value.type === 'document-view-update');
    expect(first).toMatchObject({ view, changeId: expect.any(String) });
    const heartbeat = new TextEncoder().encode(JSON.stringify({ type: 'camera-state', quality: 'detail' }));
    act(() => room.handlers.data(heartbeat, { identity: 'other-phone' }, undefined, 'mindcrafti-notebook-camera'));
    expect(sentData(room).filter((value: any) => value.type === 'document-view-update')).toHaveLength(1);
    act(() => room.handlers.data(heartbeat, { identity: 'phone-1' }, undefined, 'mindcrafti-notebook-camera'));
    await waitFor(() => expect(sentData(room).filter((value: any) => value.type === 'document-view-update')).toHaveLength(2));
    expect(sentData(room).filter((value: any) => value.type === 'document-view-update')[1]).toEqual(first);
    phoneState(room, view, 2, { changeId: first.changeId });
    act(() => room.handlers.data(heartbeat, { identity: 'phone-1' }, undefined, 'mindcrafti-notebook-camera'));
    expect(sentData(room).filter((value: any) => value.type === 'document-view-update')).toHaveLength(2);
  });

  it('keeps the latest local crop when an older phone echo arrives before its acknowledgement', async () => {
    const source = vi.fn();
    const { container, rerender } = render(<NotebookCameraViewer cameraId="camera-1" onBoardVideoChange={source} />);
    const frame = screen.getByTitle('Тетрадь: выравнивание, фокус и пометки') as HTMLIFrameElement;
    await waitFor(() => expect(mocks.rooms[0].connect).toHaveBeenCalled());
    const room = mocks.rooms[0], earlier = documentView({ turn: 0 });
    const latest = documentView({ turn: 1, ratio: 0.5, corners: [{ x: 0.2, y: 0.1 }, { x: 0.8, y: 0.1 }, { x: 0.8, y: 0.9 }, { x: 0.2, y: 0.9 }] });
    const sendView = (view: DocumentView) => fireEvent(window, new MessageEvent('message', { origin: window.location.origin,
      source: frame.contentWindow, data: { type: 'mindcrafti-notebook-view', value: view } }));
    sendView(earlier);
    await waitFor(() => expect(sentData(room).filter((value: any) => value.type === 'document-view-update')).toHaveLength(1));
    sendView(latest);
    await waitFor(() => expect(sentData(room).filter((value: any) => value.type === 'document-view-update')).toHaveLength(2));
    const updates = sentData(room).filter((value: any) => value.type === 'document-view-update');
    expect(updates[0].changeId).not.toBe(updates[1].changeId);
    phoneState(room, earlier, 8, { changeId: updates[0].changeId });
    act(() => room.handlers.track(videoTrack(), {}, { identity: 'phone-1' }));
    rerender(<NotebookCameraViewer cameraId="camera-1" presentation="board" onBoardVideoChange={source} />);
    const video = container.querySelector('video')!;
    videoDimensions(video, 1920, 1080); fireEvent.loadedData(video);
    await expectCanvasSource(source, 1920, 960);
    expect(mocks.renderers.at(-1).view).toEqual(latest);
    phoneState(room, latest, 9, { changeId: updates[1].changeId });
    phoneState(room, documentView({ turn: 3 }), 10);
    await expectCanvasSource(source, 1080, 1920);
    expect(mocks.renderers.at(-1).view).toMatchObject({ turn: 3, corners: null });
    expect(mocks.rooms).toHaveLength(1); expect(mocks.connection).toHaveBeenCalledOnce();
  });

  it.each(['module', 'connection'] as const)('migrates the owner’s old saved crop when the %s resolves after the phone default snapshot', async late => {
    const saved = documentView({ turn: 1, ratio: 0.5, corners: [{ x: 0.2, y: 0.1 }, { x: 0.8, y: 0.1 }, { x: 0.8, y: 0.9 }, { x: 0.2, y: 0.9 }] });
    const storageKey = 'camera-document-camera-1';
    sessionStorage.setItem(storageKey, JSON.stringify({ view: saved, format: 'a4' }));
    const ownerConnection = { serverUrl: 'wss://media.example', token: 'viewer-token', phoneIdentity: 'phone-1', identity: 'notebook-viewer:camera-1:student-1:session-1' };
    let resolveModule!: (value: ReturnType<typeof cameraModule>) => void;
    let resolveConnection!: (value: typeof ownerConnection) => void;
    if (late === 'module') {
      mocks.loadCameraModule.mockReturnValueOnce(new Promise(resolve => { resolveModule = resolve; }));
      mocks.connection.mockResolvedValue(ownerConnection);
    } else mocks.connection.mockReturnValueOnce(new Promise(resolve => { resolveConnection = resolve; }));
    render(<NotebookCameraViewer cameraId="camera-1" ownerId="student-1" />);
    const frame = screen.getByTitle('Тетрадь: выравнивание, фокус и пометки') as HTMLIFrameElement;
    const setView = vi.fn((view: DocumentView) => {
      // The real processor persists every accepted external view, including a default snapshot.
      sessionStorage.setItem(storageKey, JSON.stringify({ view, format: 'a4' })); return true;
    });
    Object.assign(frame.contentWindow!, { setNotebookDocumentView: setView });
    const room = mocks.rooms[0];
    if (late === 'module') {
      await waitFor(() => expect(room.connect).toHaveBeenCalled());
      phoneState(room, documentView(), 1);
      await act(async () => resolveModule(cameraModule()));
    } else {
      await act(async () => {});
      room.state = 'connecting';
      room.connect.mockImplementation(async () => {
        room.state = 'connected'; phoneState(room, documentView(), 1);
      });
      await act(async () => resolveConnection(ownerConnection));
    }
    await waitFor(() => expect(sentData(room).filter((value: any) => value.type === 'document-view-update')).toHaveLength(1));
    const migration = sentData(room).find((value: any) => value.type === 'document-view-update');
    expect(migration).toMatchObject({ version: 1, cameraId: 'camera-1', view: saved, changeId: expect.any(String) });
    expect(setView).toHaveBeenLastCalledWith(saved);
    expect(JSON.parse(sessionStorage.getItem(storageKey)!).view).toEqual(saved);
    phoneState(room, saved, 2, { changeId: migration.changeId });
    const next = documentView({ turn: 3 }); phoneState(room, next, 3);
    expect(setView).toHaveBeenLastCalledWith(next);
    fireEvent.load(frame);
    expect(sentData(room).filter((value: any) => value.type === 'document-view-update')).toHaveLength(1);
  });

  it('accepts a higher revision reset with the pending changeId and then accepts later phone changes', async () => {
    const source = vi.fn();
    const { container, rerender } = render(<NotebookCameraViewer cameraId="camera-1" onBoardVideoChange={source} />);
    const frame = screen.getByTitle('Тетрадь: выравнивание, фокус и пометки') as HTMLIFrameElement;
    const setView = vi.fn(() => true); Object.assign(frame.contentWindow!, { setNotebookDocumentView: setView });
    await waitFor(() => expect(mocks.rooms[0].connect).toHaveBeenCalled());
    const room = mocks.rooms[0], cropped = documentView({ turn: 1, ratio: 0.5, corners: [{ x: 0.2, y: 0.1 }, { x: 0.8, y: 0.1 }, { x: 0.8, y: 0.9 }, { x: 0.2, y: 0.9 }] });
    fireEvent(window, new MessageEvent('message', { origin: window.location.origin, source: frame.contentWindow,
      data: { type: 'mindcrafti-notebook-view', value: cropped } }));
    const update = sentData(room).find((value: any) => value.type === 'document-view-update');
    expect(update).toMatchObject({ view: cropped, changeId: expect.any(String) });
    const reset = documentView({ turn: 1, sourceAspect: 3 / 4 });
    phoneState(room, reset, 4, { changeId: update.changeId });
    expect(setView).toHaveBeenLastCalledWith(reset);
    const later = documentView({ turn: 0, sourceAspect: 3 / 4 });
    phoneState(room, later, 5);
    expect(setView).toHaveBeenLastCalledWith(later);
    act(() => room.handlers.track(videoTrack(), {}, { identity: 'phone-1' }));
    rerender(<NotebookCameraViewer cameraId="camera-1" presentation="board" onBoardVideoChange={source} />);
    const video = container.querySelector('video')!;
    videoDimensions(video, 1080, 1440); fireEvent.loadedData(video);
    await expectCanvasSource(source, 1080, 1440);
    expect(mocks.renderers.at(-1).view).toEqual(later);
  });

  it.each([false, true])('keeps an existing phone revision over an old saved crop (late module: %s)', async lateModule => {
    const old = documentView({ turn: 1, ratio: 0.5, corners: [{ x: 0.2, y: 0.1 }, { x: 0.8, y: 0.1 }, { x: 0.8, y: 0.9 }, { x: 0.2, y: 0.9 }] });
    const storageKey = 'camera-document-camera-1'; sessionStorage.setItem(storageKey, JSON.stringify({ view: old, format: 'a4' }));
    mocks.connection.mockResolvedValue({ serverUrl: 'wss://media.example', token: 'viewer-token', phoneIdentity: 'phone-1', identity: 'notebook-viewer:camera-1:student-1:session-1' });
    let resolveModule!: (value: ReturnType<typeof cameraModule>) => void;
    if (lateModule) mocks.loadCameraModule.mockReturnValueOnce(new Promise(resolve => { resolveModule = resolve; }));
    const source = vi.fn();
    const { container, rerender } = render(<NotebookCameraViewer cameraId="camera-1" ownerId="student-1" onBoardVideoChange={source} />);
    const frame = screen.getByTitle('Тетрадь: выравнивание, фокус и пометки') as HTMLIFrameElement;
    const setView = vi.fn((view: DocumentView) => { sessionStorage.setItem(storageKey, JSON.stringify({ view, format: 'auto' })); return true; });
    Object.assign(frame.contentWindow!, { setNotebookDocumentView: setView });
    await waitFor(() => expect(mocks.rooms[0].connect).toHaveBeenCalled());
    const room = mocks.rooms[0];
    expect(sentData(room).filter((value: any) => value.type === 'document-view-update')).toEqual([]);
    const current = documentView({ turn: 3 }); phoneState(room, current, 10);
    if (lateModule) await act(async () => resolveModule(cameraModule()));
    expect(setView).toHaveBeenLastCalledWith(current);
    expect(JSON.parse(sessionStorage.getItem(storageKey)!).view).toEqual(current);
    fireEvent.load(frame);
    expect(sentData(room).filter((value: any) => value.type === 'document-view-update')).toEqual([]);
    act(() => room.handlers.track(videoTrack(), {}, { identity: 'phone-1' }));
    rerender(<NotebookCameraViewer cameraId="camera-1" ownerId="student-1" presentation="board" onBoardVideoChange={source} />);
    const video = container.querySelector('video')!; videoDimensions(video, 1920, 1080); fireEvent.loadedData(video);
    await expectCanvasSource(source, 1080, 1920);
    expect(mocks.renderers.at(-1).view).toEqual(current);
  });

  it.each([
    ['owner', 'notebook-viewer:camera-1:student-1:session-1', 1],
    ['teacher', 'notebook-viewer:camera-1:teacher-1:session-1', 0],
    ['another pupil', 'notebook-viewer:camera-1:student-2:session-1', 0],
    ['another camera', 'notebook-viewer:camera-2:student-1:session-1', 0],
    ['missing identity', undefined, 0],
  ])('permits a %s document change only when its signed connection identifies the camera owner', async (_role, identity, expected) => {
    mocks.connection.mockResolvedValue({ serverUrl: 'wss://media.example', token: 'viewer-token', phoneIdentity: 'phone-1', identity });
    render(<NotebookCameraViewer cameraId="camera-1" ownerId="student-1" />);
    const frame = screen.getByTitle('Тетрадь: выравнивание, фокус и пометки') as HTMLIFrameElement;
    await waitFor(() => expect(mocks.rooms[0].connect).toHaveBeenCalled());
    fireEvent(window, new MessageEvent('message', { origin: window.location.origin, source: frame.contentWindow,
      data: { type: 'mindcrafti-notebook-view', value: documentView({ turn: 1 }) } }));
    expect(sentData(mocks.rooms[0]).filter((value: any) => value.type === 'document-view-update')).toHaveLength(expected as number);
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
    expect(frame).toHaveAttribute('src', '/notebook-camera/index.html?v=lesson-notebook-1');
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

describe('processed camera source for the classroom board', () => {
  it('processes only this phone’s decoded video with the default 180-degree view', async () => {
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
    const canvas = await expectCanvasSource(source, 1920, 1080);
    expect(canvas).not.toBe(video);
    expect(mocks.renderers.at(-1).view).toMatchObject({ turn: 2, corners: null });
    expect(mocks.renderers.at(-1).start).toHaveBeenCalled();
    const updates = source.mock.calls.length;
    fireEvent.playing(video);
    expect(source).toHaveBeenCalledTimes(updates);
    videoDimensions(video, 1080, 1920);
    fireEvent.resize(video);
    await expectCanvasSource(source, 1080, 1920);
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
    const canvas = await expectCanvasSource(firstSource, 1280, 720);
    const renderer = mocks.renderers.at(-1);
    const sourceCalls = firstSource.mock.calls.length, availableCalls = available.mock.calls.length;
    rerender(<NotebookCameraViewer cameraId="camera-1" presentation="board" compact={false}
      onBoardVideoChange={latestSource} onVideoAvailableChange={latestAvailable} title="Тетрадь Alice" />);
    expect(container.querySelector('video')).toBe(video);
    expect(container.querySelector('iframe')).toBeNull();
    expect(video.parentElement).toHaveClass('notebook-camera-viewer--board');
    videoDimensions(video, 1920, 1080); fireEvent.resize(video);
    expect(await expectCanvasSource(latestSource, 1920, 1080)).toBe(canvas);
    act(() => room.handlers.muted({ track }, { identity: 'phone-1' }));
    expect(latestSource).toHaveBeenLastCalledWith(null);
    expect(latestAvailable).toHaveBeenLastCalledWith(false);
    expect(firstSource).toHaveBeenCalledTimes(sourceCalls); expect(available).toHaveBeenCalledTimes(availableCalls);
    expect(mocks.rooms).toHaveLength(1); expect(mocks.connection).toHaveBeenCalledOnce(); expect(mocks.renderers).toHaveLength(1);
    unmount();
    expect(latestSource).toHaveBeenLastCalledWith(null);
    expect(video.srcObject).toBeNull(); expect(track.mediaStreamTrack.stop).not.toHaveBeenCalled();
    expect(room.disconnect).toHaveBeenCalledOnce(); expect(renderer.stop).toHaveBeenCalled(); expect(renderer.running).toBe(false);
  });

  it('clears the board source on phone stop and resumes in the same room without exposing processor controls', async () => {
    const source = vi.fn();
    const { container, unmount } = render(<NotebookCameraViewer cameraId="camera-1" presentation="board" onBoardVideoChange={source} />);
    const video = container.querySelector('video')!;
    await waitFor(() => expect(mocks.rooms[0].connect).toHaveBeenCalled());
    const room = mocks.rooms[0], track = videoTrack();
    act(() => room.handlers.track(track, {}, { identity: 'phone-1' }));
    videoDimensions(video, 1920, 1080); fireEvent.loadedMetadata(video);
    const canvas = await expectCanvasSource(source, 1920, 1080);
    const renderer = mocks.renderers.at(-1);
    act(() => room.handlers.untrack(track, {}, { identity: 'other-phone' }));
    expect(source).toHaveBeenLastCalledWith(expect.objectContaining({ video: canvas, width: 1920, height: 1080 }));
    act(() => room.handlers.untrack(track, {}, { identity: 'phone-1' }));
    expect(source).toHaveBeenLastCalledWith(null); expect(video.srcObject).toBeNull();
    fireEvent.playing(video); expect(source).toHaveBeenLastCalledWith(null);
    const restarted = videoTrack();
    act(() => room.handlers.track(restarted, {}, { identity: 'phone-1' }));
    fireEvent.playing(video);
    expect(await expectCanvasSource(source, 1920, 1080)).toBe(canvas);
    expect(mocks.renderers).toHaveLength(1);
    act(() => room.handlers.participantDisconnected({ identity: 'phone-1' }));
    expect(source).toHaveBeenLastCalledWith(null);
    act(() => room.handlers.track(restarted, {}, { identity: 'phone-1' }));
    fireEvent.loadedMetadata(video);
    act(() => room.handlers.disconnected());
    expect(source).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeVisible();
    expect(mocks.rooms).toHaveLength(1);
    unmount(); expect(track.mediaStreamTrack.stop).not.toHaveBeenCalled(); expect(restarted.mediaStreamTrack.stop).not.toHaveBeenCalled();
    expect(renderer.running).toBe(false);
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

  it('exports the rendered canvas dimensions after a phone rotation and perspective crop', async () => {
    const source = vi.fn();
    const { container } = render(<NotebookCameraViewer cameraId="camera-1" presentation="board" onBoardVideoChange={source} />);
    await waitFor(() => expect(mocks.rooms[0].connect).toHaveBeenCalled());
    const video = container.querySelector('video')!, room = mocks.rooms[0];
    act(() => room.handlers.track(videoTrack(), {}, { identity: 'phone-1' }));
    videoDimensions(video, 1920, 1080); fireEvent.loadedData(video);
    const canvas = await expectCanvasSource(source, 1920, 1080);
    phoneState(room, documentView({ turn: 1 }), 1);
    expect(await expectCanvasSource(source, 1080, 1920)).toBe(canvas);
    const cropped = documentView({ turn: 1, ratio: 0.5, corners: [{ x: 0.2, y: 0.1 }, { x: 0.8, y: 0.15 }, { x: 0.75, y: 0.9 }, { x: 0.25, y: 0.85 }] });
    phoneState(room, cropped, 2);
    expect(await expectCanvasSource(source, 1920, 960)).toBe(canvas);
    expect(mocks.renderers.at(-1).view).toEqual(cropped);
    expect(video.style.transform).toBe('');
  });

  it('retains a phone view received before the video and renderer module become ready', async () => {
    let resolveModule!: (value: ReturnType<typeof cameraModule>) => void;
    mocks.loadCameraModule.mockReturnValueOnce(new Promise(resolve => { resolveModule = resolve; }));
    const source = vi.fn();
    const { container } = render(<NotebookCameraViewer cameraId="camera-1" presentation="board" onBoardVideoChange={source} />);
    await waitFor(() => expect(mocks.rooms[0].connect).toHaveBeenCalled());
    const room = mocks.rooms[0], video = container.querySelector('video')!;
    const saved = documentView({ turn: 3, ratio: 0.5, corners: [{ x: 0.2, y: 0.1 }, { x: 0.8, y: 0.1 }, { x: 0.8, y: 0.9 }, { x: 0.2, y: 0.9 }] });
    phoneState(room, saved, 4);
    act(() => room.handlers.track(videoTrack(), {}, { identity: 'phone-1' }));
    videoDimensions(video, 1920, 1080); fireEvent.loadedData(video);
    expect(source.mock.calls.every(([value]) => value === null)).toBe(true);
    await act(async () => resolveModule(cameraModule()));
    await expectCanvasSource(source, 1920, 960);
    expect(mocks.renderers.at(-1).view).toEqual(saved);
  });

  it('keeps the newest phone revision while the renderer module is still loading', async () => {
    let resolveModule!: (value: ReturnType<typeof cameraModule>) => void;
    mocks.loadCameraModule.mockReturnValueOnce(new Promise(resolve => { resolveModule = resolve; }));
    const source = vi.fn();
    const { container } = render(<NotebookCameraViewer cameraId="camera-1" presentation="board" onBoardVideoChange={source} />);
    await waitFor(() => expect(mocks.rooms[0].connect).toHaveBeenCalled());
    const room = mocks.rooms[0], video = container.querySelector('video')!, newest = documentView({ turn: 1 });
    phoneState(room, newest, 5); phoneState(room, documentView({ turn: 0 }), 3);
    act(() => room.handlers.track(videoTrack(), {}, { identity: 'phone-1' }));
    videoDimensions(video, 1920, 1080); fireEvent.loadedData(video);
    await act(async () => resolveModule(cameraModule()));
    await expectCanvasSource(source, 1080, 1920);
    expect(mocks.renderers.at(-1).view).toEqual(newest);
  });

  it('pauses processing for a hidden tile and resumes its existing canvas and room', async () => {
    const source = vi.fn();
    const { container, rerender } = render(<NotebookCameraViewer cameraId="camera-1" presentation="board" onBoardVideoChange={source} />);
    await waitFor(() => expect(mocks.rooms[0].connect).toHaveBeenCalled());
    const room = mocks.rooms[0], video = container.querySelector('video')!;
    act(() => room.handlers.track(videoTrack(), {}, { identity: 'phone-1' }));
    videoDimensions(video, 1920, 1080); fireEvent.loadedData(video);
    const canvas = await expectCanvasSource(source, 1920, 1080), renderer = mocks.renderers.at(-1);
    expect(renderer.running).toBe(true);
    rerender(<NotebookCameraViewer cameraId="camera-1" presentation="board" active={false} onBoardVideoChange={source} />);
    expect(renderer.running).toBe(false); expect(renderer.stop).toHaveBeenCalled();
    rerender(<NotebookCameraViewer cameraId="camera-1" presentation="board" active onBoardVideoChange={source} />);
    expect(renderer.running).toBe(true); expect(await expectCanvasSource(source, 1920, 1080)).toBe(canvas);
    expect(container.querySelector('video')).toBe(video); expect(mocks.renderers).toHaveLength(1);
    expect(mocks.rooms).toHaveLength(1); expect(room.disconnect).not.toHaveBeenCalled();
  });

  it('ignores forged, malformed, wrong-camera and stale document state', async () => {
    const source = vi.fn();
    const { container } = render(<NotebookCameraViewer cameraId="camera-1" presentation="board" onBoardVideoChange={source} />);
    await waitFor(() => expect(mocks.rooms[0].connect).toHaveBeenCalled());
    const room = mocks.rooms[0], video = container.querySelector('video')!;
    act(() => room.handlers.track(videoTrack(), {}, { identity: 'phone-1' }));
    videoDimensions(video, 1920, 1080); fireEvent.loadedData(video);
    await expectCanvasSource(source, 1920, 1080);
    const accepted = documentView({ turn: 1 }); phoneState(room, accepted, 7);
    await expectCanvasSource(source, 1080, 1920);
    const renderer = mocks.renderers.at(-1), viewCalls = renderer.setView.mock.calls.length, sourceCalls = source.mock.calls.length;
    const unwanted = documentView({ turn: 0 });
    phoneState(room, unwanted, 8, {}, 'other-phone');
    phoneState(room, unwanted, 8, {}, 'phone-1', 'other-topic');
    phoneState(room, unwanted, 8, { cameraId: 'camera-2' });
    phoneState(room, unwanted, 8, { version: 2 });
    phoneState(room, unwanted, -1); phoneState(room, unwanted, 1.5);
    phoneState(room, unwanted, 8, { revision: null });
    phoneState(room, unwanted, 6); phoneState(room, unwanted, 7);
    phoneState(room, documentView({ turn: 8 }), 8);
    phoneState(room, documentView({ sourceAspect: 0 }), 8);
    phoneState(room, documentView({ corners: [{ x: -1, y: 0 }], ratio: 0.5 }), 8);
    act(() => room.handlers.data(new TextEncoder().encode('{bad json'), { identity: 'phone-1' }, undefined, 'mindcrafti-notebook-camera'));
    expect(renderer.view).toEqual(accepted); expect(renderer.setView).toHaveBeenCalledTimes(viewCalls);
    expect(source).toHaveBeenCalledTimes(sourceCalls);
  });

  it('updates the board reference when the renderer replaces a failed WebGL canvas', async () => {
    const source = vi.fn();
    const { container, unmount } = render(<NotebookCameraViewer cameraId="camera-1" presentation="board" onBoardVideoChange={source} />);
    await waitFor(() => expect(mocks.rooms[0].connect).toHaveBeenCalled());
    const room = mocks.rooms[0], video = container.querySelector('video')!, track = videoTrack();
    act(() => room.handlers.track(track, {}, { identity: 'phone-1' }));
    videoDimensions(video, 1920, 1080); fireEvent.loadedData(video);
    const previous = await expectCanvasSource(source, 1920, 1080), renderer = mocks.renderers.at(-1);
    let replacement!: HTMLCanvasElement;
    const callsBeforeReplacement = source.mock.calls.length;
    act(() => { replacement = renderer.replaceCanvas(); });
    expect(source).toHaveBeenCalledTimes(callsBeforeReplacement);
    expect(source).toHaveBeenLastCalledWith(expect.objectContaining({ video: previous }));
    act(() => renderer.render());
    expect(await expectCanvasSource(source, 1920, 1080)).toBe(replacement);
    expect(replacement).not.toBe(previous); expect(renderer.running).toBe(true);
    unmount();
    expect(source).toHaveBeenLastCalledWith(null); expect(renderer.stop).toHaveBeenCalled();
    expect(track.mediaStreamTrack.stop).not.toHaveBeenCalled();
  });

  it('never exposes a canvas whose first frame failed to render', async () => {
    mocks.failFrame = true;
    const source = vi.fn();
    const { container } = render(<NotebookCameraViewer cameraId="camera-1" presentation="board" onBoardVideoChange={source} />);
    await waitFor(() => expect(mocks.rooms[0].connect).toHaveBeenCalled());
    const room = mocks.rooms[0], video = container.querySelector('video')!;
    act(() => room.handlers.track(videoTrack(), {}, { identity: 'phone-1' }));
    videoDimensions(video, 1920, 1080); fireEvent.loadedData(video);
    await screen.findByRole('alert');
    expect(screen.getByRole('alert')).toHaveTextContent('Не удалось обработать видео тетради');
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeVisible();
    expect(mocks.renderers).toHaveLength(1);
    expect(source.mock.calls.every(([value]) => value === null)).toBe(true);
    act(() => mocks.renderers[0].render()); fireEvent.resize(video); fireEvent.playing(video);
    expect(source.mock.calls.every(([value]) => value === null)).toBe(true);
  });

  it('does not initialize a late renderer or expose its source after unmount', async () => {
    let resolveModule!: (value: ReturnType<typeof cameraModule>) => void;
    mocks.loadCameraModule.mockReturnValueOnce(new Promise(resolve => { resolveModule = resolve; }));
    const source = vi.fn();
    const { container, unmount } = render(<NotebookCameraViewer cameraId="camera-1" presentation="board" onBoardVideoChange={source} />);
    await waitFor(() => expect(mocks.rooms[0].connect).toHaveBeenCalled());
    const video = container.querySelector('video')!, room = mocks.rooms[0], track = videoTrack();
    act(() => room.handlers.track(track, {}, { identity: 'phone-1' }));
    videoDimensions(video, 1920, 1080); fireEvent.loadedData(video);
    unmount(); const calls = source.mock.calls.length;
    await act(async () => resolveModule(cameraModule()));
    expect(mocks.renderers).toHaveLength(0); expect(source).toHaveBeenCalledTimes(calls);
    expect(source).toHaveBeenLastCalledWith(null); expect(video.srcObject).toBeNull();
    expect(room.disconnect).toHaveBeenCalledOnce(); expect(track.mediaStreamTrack.stop).not.toHaveBeenCalled();
  });
});
