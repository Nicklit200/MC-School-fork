import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotebookCameraViewer } from './NotebookCameraViewer';

const mocks = vi.hoisted(() => ({ rooms: [] as any[], connection: vi.fn() }));
vi.mock('../../api/notebookCameras', () => ({ notebookCamerasApi: { connection: mocks.connection }, notebookCameraError: (reason: Error) => reason.message }));
vi.mock('livekit-client', () => ({
  Track: { Kind: { Video: 'video' } },
  RoomEvent: { TrackSubscribed: 'track', TrackUnsubscribed: 'untrack', DataReceived: 'data', Reconnecting: 'reconnecting', Reconnected: 'reconnected', Disconnected: 'disconnected' },
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
});
afterEach(() => vi.unstubAllGlobals());
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
