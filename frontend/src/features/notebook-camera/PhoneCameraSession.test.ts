import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoomEvent } from 'livekit-client';
import { ApiRequestError } from '../../api/client';
import { PhoneCameraSession } from './PhoneCameraSession';

const mocks = vi.hoisted(() => ({ rooms: [] as any[], claim: vi.fn(), phoneConnection: vi.fn(), getUserMedia: vi.fn(), focus: vi.fn() }));
vi.mock('../../api/notebookCameras', () => ({ notebookCamerasApi: { claim: mocks.claim, phoneConnection: mocks.phoneConnection } }));
vi.mock('./cameraModules', () => ({ loadCameraModule: async () => ({
  cameraConstraints: (quality: string) => ({ width: { ideal: quality === 'detail' ? 1920 : 1280 }, height: { ideal: 1080 } }),
  inspectCamera: () => ({ settings: { width: 1920, height: 1080 }, focus: { canAuto: false, modes: [] } }),
  setCameraFocus: mocks.focus,
  QUALITY_PROFILES: { detail: { bitrate: 8000000, fps: 24 }, balanced: { bitrate: 3000000, fps: 20 } },
}) }));
vi.mock('livekit-client', () => ({
  Track: { Source: { Camera: 'camera' } },
  RoomEvent: { DataReceived: 'data', ParticipantConnected: 'participant', Reconnecting: 'reconnecting', Reconnected: 'reconnected', Disconnected: 'disconnected' },
  Room: class {
    state = 'connected';
    handlers: Record<string, (...args: any[]) => void> = {};
    sender = { getParameters: vi.fn(() => ({ encodings: [{}] })), setParameters: vi.fn(async () => {}) };
    localParticipant = { publishTrack: vi.fn(async () => ({ videoTrack: { sender: this.sender, publishOptions: {} } })), publishData: vi.fn(async () => {}) };
    connect = vi.fn(async () => {});
    disconnect = vi.fn(async () => {});
    constructor() { mocks.rooms.push(this); }
    on(event: string, callback: (...args: any[]) => void) { this.handlers[event] = callback; return this; }
  },
}));

function trackFixture() {
  const track = { stop: vi.fn(), contentHint: '', getSettings: () => ({ width: 1920, height: 1080, deviceId: 'rear' }),
    getConstraints: () => ({}), applyConstraints: vi.fn(async () => {}), addEventListener: vi.fn() };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
  return { track, stream };
}
const connection = { serverUrl: 'wss://media.example', token: 'scoped-jwt', phoneIdentity: 'notebook-phone:camera-1' };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
let sessions: PhoneCameraSession[];
beforeEach(() => {
  vi.clearAllMocks(); mocks.rooms.length = 0; sessions = [];
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
  Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: mocks.getUserMedia, enumerateDevices: vi.fn(async () => []) }, configurable: true });
  mocks.claim.mockResolvedValue({ camera: { sessionExpiresAt: new Date(Date.now() + 10800000).toISOString() }, sessionToken: 'phone-session', connection });
  mocks.phoneConnection.mockResolvedValue(connection);
});
afterEach(() => { sessions.forEach(session => session.stop(false)); vi.useRealTimers(); });
function create(token: string | null = 'single-use-secret') {
  const onStream = vi.fn(), onStatus = vi.fn(), onClaimed = vi.fn();
  const session = new PhoneCameraSession('camera-1', token, onStream, onStatus, onClaimed); sessions.push(session);
  return { session, onStream, onStatus, onClaimed };
}
describe('phone camera lifecycle', () => {
  it('requests only the rear camera and publishes a detail video track', async () => {
    const { track, stream } = trackFixture(); mocks.getUserMedia.mockResolvedValue(stream);
    const { session, onClaimed } = create(); await session.start();
    expect(mocks.getUserMedia).toHaveBeenCalledWith({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } });
    expect(mocks.rooms[0].localParticipant.publishTrack).toHaveBeenCalledWith(track, expect.objectContaining({ simulcast: false, videoEncoding: { maxBitrate: 8000000, maxFramerate: 24 } }));
    expect(onClaimed).toHaveBeenCalledOnce();
    session.stop(); expect(track.stop).toHaveBeenCalled(); expect(mocks.rooms[0].disconnect).toHaveBeenCalled();
  });
  it('stops tracks returned after Stop without claiming a token or opening a room', async () => {
    const pending = deferred<MediaStream>(); mocks.getUserMedia.mockReturnValue(pending.promise);
    const { session } = create(); const starting = session.start();
    await vi.waitFor(() => expect(mocks.getUserMedia).toHaveBeenCalled());
    session.stop(); const { track, stream } = trackFixture(); pending.resolve(stream); await starting;
    expect(track.stop).toHaveBeenCalled(); expect(mocks.claim).not.toHaveBeenCalled(); expect(mocks.rooms).toHaveLength(0);
  });
  it('stops tracks when claim fails and never publishes', async () => {
    const { track, stream } = trackFixture(); mocks.getUserMedia.mockResolvedValue(stream); mocks.claim.mockRejectedValue(new Error('QR expired'));
    const { session } = create(); await expect(session.start()).rejects.toThrow('QR expired');
    expect(track.stop).toHaveBeenCalled(); expect(mocks.rooms).toHaveLength(0);
  });
  it('releases the camera immediately when Stop is pressed during an outstanding claim', async () => {
    const { track, stream } = trackFixture(); mocks.getUserMedia.mockResolvedValue(stream);
    const pending = deferred<any>(); mocks.claim.mockReturnValue(pending.promise);
    const { session } = create(); const starting = session.start();
    await vi.waitFor(() => expect(mocks.claim).toHaveBeenCalled());
    session.stop(); expect(track.stop).toHaveBeenCalled();
    pending.resolve({ camera: { sessionExpiresAt: new Date(Date.now() + 10800000).toISOString() }, sessionToken: 'phone-session', connection });
    await starting; expect(mocks.rooms).toHaveLength(0);
  });
  it('refuses missing credentials before asking for camera permission', async () => {
    const { session } = create(null); await expect(session.start()).rejects.toThrow('QR');
    expect(mocks.getUserMedia).not.toHaveBeenCalled();
  });
  it('reuses only the claimed session when camera is stopped and restarted', async () => {
    mocks.getUserMedia.mockImplementation(async () => trackFixture().stream);
    const { session } = create(); await session.start(); session.stop(); await session.start();
    expect(mocks.claim).toHaveBeenCalledOnce(); expect(mocks.phoneConnection).toHaveBeenCalledWith('camera-1', 'phone-session');
  });
  it('updates capture and sender bitrate/fps for economical quality', async () => {
    const { track, stream } = trackFixture(); mocks.getUserMedia.mockResolvedValue(stream);
    const { session } = create(); await session.start(); const room = mocks.rooms[0];
    room.handlers[RoomEvent.DataReceived](new TextEncoder().encode(JSON.stringify({ type: 'camera-control', requestId: 'request-1', action: 'quality', value: 'balanced' })), { identity: 'teacher-viewer' }, undefined, 'mindcrafti-notebook-camera');
    await vi.waitFor(() => expect(room.sender.setParameters).toHaveBeenCalledWith({ encodings: [{ maxBitrate: 3000000, maxFramerate: 20 }], degradationPreference: 'maintain-resolution' }));
    expect(track.applyConstraints).toHaveBeenCalledWith(expect.objectContaining({ width: { ideal: 1280 } }));
  });
  it('turns the camera off after the server revokes its session', async () => {
    vi.useFakeTimers(); const { track, stream } = trackFixture(); mocks.getUserMedia.mockResolvedValue(stream);
    const { session, onStatus } = create(); await session.start();
    mocks.phoneConnection.mockRejectedValue(new ApiRequestError(403, 'REVOKED', 'revoked'));
    await vi.advanceTimersByTimeAsync(60000);
    expect(track.stop).toHaveBeenCalled(); expect(onStatus).toHaveBeenLastCalledWith(expect.stringContaining('отозвано'));
  });
});
