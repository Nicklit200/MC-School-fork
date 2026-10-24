import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoomEvent } from 'livekit-client';
import { ApiRequestError } from '../../api/client';
import { PhoneCameraSession } from './PhoneCameraSession';
import type { NotebookDocumentView, NotebookDocumentViewState } from './cameraModules';

const mocks = vi.hoisted(() => ({ rooms: [] as any[], claim: vi.fn(), phoneConnection: vi.fn(), getUserMedia: vi.fn(), focus: vi.fn(), publishTrack: vi.fn() }));
vi.mock('../../api/notebookCameras', () => ({ notebookCamerasApi: { claim: mocks.claim, phoneConnection: mocks.phoneConnection } }));
vi.mock('./cameraModules', () => ({ loadCameraModule: async () => {
  // Exercise the production geometry validator/defaults, without requesting
  // media devices or instantiating a GPU renderer in jsdom.
  const path = '../../../public/notebook-camera/signal.mjs';
  const geometry = await import(path);
  return {
    ...geometry,
    cameraConstraints: (quality: string) => ({ width: { ideal: quality === 'detail' ? 1920 : 1280 }, height: { ideal: 1080 } }),
    inspectCamera: () => ({ settings: { width: 1920, height: 1080 }, focus: { canAuto: false, modes: [] } }),
    setCameraFocus: mocks.focus,
  };
} }));
vi.mock('livekit-client', () => ({
  Track: { Source: { Camera: 'camera' } },
  RoomEvent: { DataReceived: 'data', ParticipantConnected: 'participant', Reconnecting: 'reconnecting', Reconnected: 'reconnected', Disconnected: 'disconnected' },
  Room: class {
    state = 'connected';
    handlers: Record<string, (...args: any[]) => void> = {};
    sender = { getParameters: vi.fn(() => ({ encodings: [{}] })), setParameters: vi.fn(async () => {}) };
    localParticipant = { publishTrack: vi.fn(async () => {
      await mocks.publishTrack();
      return { videoTrack: { sender: this.sender, publishOptions: {} } };
    }), publishData: vi.fn(async () => {}) };
    connect = vi.fn(async () => {});
    disconnect = vi.fn(async () => {});
    constructor() { mocks.rooms.push(this); }
    on(event: string, callback: (...args: any[]) => void) { this.handlers[event] = callback; return this; }
  },
}));

function trackFixture(initialSettings: MediaTrackSettings = {}) {
  const settings = { width: 1920, height: 1080, deviceId: 'rear', ...initialSettings };
  const track = { stop: vi.fn(), contentHint: '', getSettings: () => settings,
    getConstraints: () => ({}), applyConstraints: vi.fn(async () => {}), addEventListener: vi.fn() };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
  return { track, stream, settings };
}
const connection = { serverUrl: 'wss://media.example', token: 'scoped-jwt', phoneIdentity: 'notebook-phone:camera-1' };
const ownerId = '11111111-1111-4111-8111-111111111111';
const ownerIdentity = `notebook-viewer:camera-1:${ownerId}:a1b2c3d4`;
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
  mocks.claim.mockResolvedValue({ camera: { ownerId, sessionExpiresAt: new Date(Date.now() + 10800000).toISOString() }, sessionToken: 'phone-session', connection });
  mocks.phoneConnection.mockResolvedValue(connection);
  mocks.publishTrack.mockResolvedValue(undefined);
});

const view = (patch: Partial<NotebookDocumentView> = {}): NotebookDocumentView => ({
  type: 'document-view', version: 1, corners: null, ratio: null, turn: 2, sourceAspect: 1920 / 1080, ...patch,
});
const crop = () => view({
  corners: [{ x: .1, y: .1 }, { x: .9, y: .12 }, { x: .85, y: .9 }, { x: .15, y: .85 }], ratio: 210 / 297, turn: 1,
});
const update = (changeId: string, patch: Partial<NotebookDocumentView> = {}) => ({
  type: 'document-view-update', version: 1, cameraId: 'camera-1', changeId, view: view(patch),
});
function receive(room: any, value: unknown, identity = ownerIdentity, dataTopic = 'mindcrafti-notebook-camera') {
  room.handlers[RoomEvent.DataReceived](new TextEncoder().encode(JSON.stringify(value)), { identity }, undefined, dataTopic);
}
function packets(room: any): any[] {
  return room.localParticipant.publishData.mock.calls.map(([bytes]: [Uint8Array]) => JSON.parse(new TextDecoder().decode(bytes)));
}
function latestView(room: any): NotebookDocumentViewState | undefined {
  return packets(room).filter(packet => packet.type === 'document-view-state').pop();
}

describe('phone document-view authority and replay', () => {
  it('starts with the same 180-degree default as the processor and reports real capture aspect', async () => {
    mocks.getUserMedia.mockResolvedValue(trackFixture({ width: 1080, height: 1920 }).stream);
    const { session } = create(); await session.start();
    expect(latestView(mocks.rooms[0])).toEqual({
      type: 'document-view-state', version: 1, cameraId: 'camera-1', revision: 1,
      view: view({ sourceAspect: 1080 / 1920 }),
    });
  });

  it('reserves default revision 1 when the owner updates while the first track publication is still pending', async () => {
    mocks.getUserMedia.mockResolvedValue(trackFixture().stream);
    const publication = deferred<void>(); mocks.publishTrack.mockReturnValue(publication.promise);
    const { session } = create(); const starting = session.start();
    await vi.waitFor(() => expect(mocks.publishTrack).toHaveBeenCalled());
    const room = mocks.rooms[0];
    expect(latestView(room)).toBeUndefined();
    receive(room, update('early-owner', { turn: 1 }));
    expect(latestView(room)).toEqual({ type: 'document-view-state', version: 1, cameraId: 'camera-1', revision: 2,
      changeId: 'early-owner', view: view({ turn: 1 }) });
    publication.resolve(); await starting;
    expect(latestView(room)).toMatchObject({ revision: 2, changeId: 'early-owner', view: { turn: 1 } });
  });

  it('accepts owner geometry and replays it to late joiners, reconnects, requests and heartbeat', async () => {
    vi.useFakeTimers();
    mocks.getUserMedia.mockResolvedValue(trackFixture().stream);
    const { session } = create(); await session.start();
    const room = mocks.rooms[0], desired = crop();
    receive(room, { ...update('owner-crop'), view: desired });
    const expected = { type: 'document-view-state', version: 1, cameraId: 'camera-1', revision: 2, changeId: 'owner-crop', view: desired };
    expect(latestView(room)).toEqual(expected);
    for (const replay of [
      () => room.handlers[RoomEvent.ParticipantConnected]({ identity: 'teacher-viewer' }),
      () => room.handlers[RoomEvent.Reconnected](),
      () => receive(room, { type: 'camera-request' }, 'teacher-viewer'),
      () => vi.advanceTimersByTimeAsync(3000),
    ]) {
      room.localParticipant.publishData.mockClear();
      await replay();
      await vi.waitFor(() => expect(latestView(room)).toEqual(expected));
    }
    const stateCall = room.localParticipant.publishData.mock.calls.find(([bytes]: [Uint8Array]) => JSON.parse(new TextDecoder().decode(bytes)).type === 'document-view-state');
    expect(stateCall[1]).toEqual({ reliable: true, topic: 'mindcrafti-notebook-camera' });
  });

  it.each([
    `notebook-viewer:camera-1:22222222-2222-4222-8222-222222222222:a1b2c3d4`,
    `notebook-viewer:camera-2:${ownerId}:a1b2c3d4`,
    `notebook-viewer:camera-1:${ownerId}:a1b2c3d4:extra`,
    `notebook-viewer:camera-1:${ownerId}:not-hex!`,
    `notebook-viewer:camera-1:${ownerId}:a1b2c3d`,
    `notebook-viewer:camera-1:${ownerId}:`,
    'teacher-viewer', 'notebook-phone:camera-1',
  ])('refuses document geometry from non-owner or malformed signed identity: %s', async (identity) => {
    mocks.getUserMedia.mockResolvedValue(trackFixture().stream);
    const { session } = create(); await session.start();
    const room = mocks.rooms[0]; room.localParticipant.publishData.mockClear();
    receive(room, update('forged', { turn: 0 }), identity);
    await Promise.resolve();
    expect(room.localParticipant.publishData).not.toHaveBeenCalled();
    receive(room, { type: 'camera-request' }, ownerIdentity);
    await vi.waitFor(() => expect(latestView(room)?.revision).toBe(1));
    expect(latestView(room)?.view.turn).toBe(2);
  });

  it.each([
    { ...update('wrong-camera'), cameraId: 'camera-2' },
    { ...update('wrong-version'), version: 2 },
    update(''), update('x'.repeat(81)),
    { ...update('oversize'), padding: 'x'.repeat(4100) },
    update('bad-turn', { turn: 4 }),
    update('bad-aspect', { sourceAspect: 0 }),
    update('bad-ratio', { ...crop(), ratio: 100 }),
    update('bad-quad', { ...crop(), corners: [{ x: .1, y: .1 }, { x: .9, y: .9 }, { x: .9, y: .1 }, { x: .1, y: .9 }] }),
  ])('refuses malformed, mismatched or oversized document updates %#', async (message) => {
    mocks.getUserMedia.mockResolvedValue(trackFixture().stream);
    const { session } = create(); await session.start();
    const room = mocks.rooms[0]; room.localParticipant.publishData.mockClear();
    receive(room, message);
    receive(room, update('wrong-topic', { turn: 0 }), ownerIdentity, 'other-camera-topic');
    await Promise.resolve();
    expect(room.localParticipant.publishData).not.toHaveBeenCalled();
  });

  it('deduplicates replayed change IDs without rolling back a newer view', async () => {
    mocks.getUserMedia.mockResolvedValue(trackFixture().stream);
    const { session } = create(); await session.start(); const room = mocks.rooms[0];
    receive(room, update('first', { turn: 1 }));
    expect(latestView(room)?.revision).toBe(2);
    receive(room, update('second', { turn: 3 }));
    expect(latestView(room)?.revision).toBe(3);
    receive(room, update('first', { turn: 0 }));
    expect(latestView(room)).toMatchObject({ revision: 3, changeId: 'second', view: { turn: 3 } });
    receive(room, update('second', { turn: 3 }));
    expect(latestView(room)?.revision).toBe(3);
  });

  it('preserves accepted geometry, revision and duplicate protection across Stop and Start', async () => {
    mocks.getUserMedia.mockImplementation(async () => trackFixture().stream);
    const { session } = create(); await session.start();
    const desired = crop(); receive(mocks.rooms[0], { ...update('saved-crop'), view: desired });
    session.stop(); await session.start();
    const room = mocks.rooms[1];
    expect(latestView(room)).toMatchObject({ revision: 2, changeId: 'saved-crop', view: desired });
    receive(room, update('saved-crop', { turn: 0 }));
    expect(latestView(room)).toMatchObject({ revision: 2, changeId: 'saved-crop', view: desired });
    expect(mocks.claim).toHaveBeenCalledOnce();
  });

  it('keeps crop for small aspect changes and resets only crop when capture aspect changes more than six percent', async () => {
    const { stream, settings } = trackFixture(); mocks.getUserMedia.mockResolvedValue(stream);
    const { session } = create(); await session.start(); const room = mocks.rooms[0];
    receive(room, { ...update('crop'), view: crop() });
    settings.width = 2016;
    receive(room, { type: 'camera-request' });
    await vi.waitFor(() => expect(latestView(room)?.view.corners).not.toBeNull());
    expect(latestView(room)?.revision).toBe(2);
    settings.width = 1080; settings.height = 1920;
    receive(room, { type: 'camera-request' });
    await vi.waitFor(() => expect(latestView(room)?.revision).toBe(3));
    expect(latestView(room)).toEqual({ type: 'document-view-state', version: 1, cameraId: 'camera-1', revision: 3, changeId: 'crop',
      view: view({ turn: 1, sourceAspect: 1080 / 1920 }) });
    receive(room, { type: 'camera-request' });
    await vi.waitFor(() => expect(latestView(room)?.revision).toBe(3));
  });

  it('acknowledges an owner restore even when its old-aspect crop must be reset immediately', async () => {
    mocks.getUserMedia.mockResolvedValue(trackFixture({ width: 1080, height: 1920 }).stream);
    const { session } = create(); await session.start(); const room = mocks.rooms[0];
    const pending = { ...update('restored-landscape-crop'), view: crop() };
    receive(room, pending);
    const canonical = latestView(room)!;
    expect(canonical).toEqual({
      type: 'document-view-state', version: 1, cameraId: 'camera-1', revision: 3,
      changeId: pending.changeId, view: view({ turn: 1, sourceAspect: 1080 / 1920 }),
    });
    // Reconnect can resend the same pending update; acknowledge the current
    // canonical reset without reviving its invalid crop or incrementing again.
    receive(room, pending);
    expect(latestView(room)).toEqual(canonical);
  });

  it('ignores old-room updates and reconnect callbacks after a new camera generation starts', async () => {
    mocks.getUserMedia.mockImplementation(async () => trackFixture().stream);
    const { session, onStatus } = create(); await session.start();
    const oldRoom = mocks.rooms[0]; receive(oldRoom, update('current', { turn: 1 }));
    session.stop(); await session.start(); const room = mocks.rooms[1];
    room.localParticipant.publishData.mockClear(); onStatus.mockClear();
    receive(oldRoom, update('stale', { turn: 0 }));
    receive(oldRoom, { type: 'camera-request' });
    oldRoom.handlers[RoomEvent.ParticipantConnected]({ identity: ownerIdentity });
    oldRoom.handlers[RoomEvent.Reconnected]();
    await Promise.resolve();
    expect(room.localParticipant.publishData).not.toHaveBeenCalled(); expect(onStatus).not.toHaveBeenCalled();
    receive(room, { type: 'camera-request' });
    await vi.waitFor(() => expect(latestView(room)).toMatchObject({ revision: 2, changeId: 'current', view: { turn: 1 } }));
  });

  it('does not finish an outstanding old-generation report in the newly connected room', async () => {
    mocks.getUserMedia.mockImplementation(async () => trackFixture().stream);
    const { session } = create(); await session.start(); const oldRoom = mocks.rooms[0];
    const pending = deferred<void>(); oldRoom.localParticipant.publishData.mockImplementationOnce(() => pending.promise);
    oldRoom.handlers[RoomEvent.ParticipantConnected]({ identity: ownerIdentity });
    session.stop(); await session.start(); const room = mocks.rooms[1]; room.localParticipant.publishData.mockClear();
    pending.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(room.localParticipant.publishData).not.toHaveBeenCalled();
  });
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
