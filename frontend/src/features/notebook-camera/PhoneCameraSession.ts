import { Room, RoomEvent, Track, type LocalVideoTrack } from 'livekit-client';
import { ApiRequestError } from '../../api/client';
import { notebookCamerasApi, type CameraClaim } from '../../api/notebookCameras';
import { loadCameraModule, type CameraModule, type CameraQuality } from './cameraModules';

const topic = 'mindcrafti-notebook-camera';
const encoder = new TextEncoder();
/** Owns every acquired track, including tracks acquired after Stop was pressed. */
export class PhoneCameraSession {
  private generation = 0;
  private room: Room | null = null;
  private stream: MediaStream | null = null;
  private claim: CameraClaim | null = null;
  private module: CameraModule | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private expiry: ReturnType<typeof setTimeout> | undefined;
  private validation: ReturnType<typeof setInterval> | undefined;
  private publishedTrack: LocalVideoTrack | null = null;
  private wakeLock: WakeLockSentinel | null = null;
  private quality: CameraQuality = 'detail';
  private controlBusy = false;
  private devices: MediaDeviceInfo[] = [];

  constructor(private cameraId: string, private pairingToken: string | null,
    private onStream: (stream: MediaStream | null) => void,
    private onStatus: (message: string) => void,
    private onClaimed: () => void = () => {}) {}

  async start(deviceId?: string): Promise<void> {
    this.stop(false);
    const generation = this.generation;
    let candidate: MediaStream | null = null;
    let room: Room | null = null;
    try {
      if (!/^[a-zA-Z0-9-]{1,128}$/.test(this.cameraId) || (!this.claim && !this.pairingToken)) throw new Error('Откройте страницу по новому QR-коду из урока.');
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('Откройте камеру по HTTPS-ссылке сайта Mindcrafti.');
      this.module = await loadCameraModule();
      if (generation !== this.generation) return;
      candidate = await navigator.mediaDevices.getUserMedia({ audio: false, video: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' } }),
        ...this.module.cameraConstraints(this.quality),
      } });
      if (generation !== this.generation || document.hidden) { candidate.getTracks().forEach(track => track.stop()); return; }
      // Own the stream before any network await so Stop releases the camera immediately.
      this.stream = candidate;
      let connection;
      if (!this.claim) {
        if (!this.pairingToken) throw new Error('Откройте страницу по новому QR-коду из урока.');
        this.claim = await notebookCamerasApi.claim(this.cameraId, this.pairingToken);
        this.pairingToken = null;
        this.onClaimed();
        connection = this.claim.connection;
      } else connection = await notebookCamerasApi.phoneConnection(this.cameraId, this.claim.sessionToken);
      if (generation !== this.generation || document.hidden) { candidate.getTracks().forEach(track => track.stop()); return; }
      room = new Room({ adaptiveStream: false, dynacast: false });
      this.room = room;
      const currentRoom = room;
      room.on(RoomEvent.DataReceived, (payload, participant, _kind, dataTopic) => {
        if (dataTopic !== topic || !participant || participant.identity === connection.phoneIdentity || payload.byteLength > 16000) return;
        try { void this.receive(JSON.parse(new TextDecoder().decode(payload)), generation).catch(error => this.onStatus(error instanceof Error ? error.message : 'Не удалось изменить камеру.')); } catch { /* Ignore malformed data. */ }
      });
      room.on(RoomEvent.ParticipantConnected, () => void this.report());
      room.on(RoomEvent.Reconnecting, () => this.onStatus('Связь прервалась. Восстанавливаем подключение…'));
      room.on(RoomEvent.Reconnected, () => { this.onStatus('Камера включена. Оставьте эту страницу открытой.'); void this.report(); });
      room.on(RoomEvent.Disconnected, () => {
        if (this.room === currentRoom) { this.stop(false); this.onStatus('Подключение завершено. Повторите или откройте новый QR из урока.'); }
      });
      await room.connect(connection.serverUrl, connection.token);
      if (generation !== this.generation || document.hidden) { candidate.getTracks().forEach(track => track.stop()); await room.disconnect(); return; }
      this.stream = candidate;
      const track = candidate.getVideoTracks()[0];
      try { track.contentHint = 'detail'; } catch { /* Optional on older mobile browsers. */ }
      if (this.module.inspectCamera(track).focus.canAuto) { try { await this.module.setCameraFocus(track, 'auto'); } catch { /* Browser retains its own focus. */ } }
      if (generation !== this.generation) { candidate.getTracks().forEach(item => item.stop()); return; }
      const profile = this.module.QUALITY_PROFILES[this.quality];
      const publication = await room.localParticipant.publishTrack(track, { source: Track.Source.Camera, name: 'notebook', simulcast: false,
        videoEncoding: { maxBitrate: profile.bitrate, maxFramerate: profile.fps }, degradationPreference: 'maintain-resolution' });
      if (generation !== this.generation || document.hidden) { candidate.getTracks().forEach(item => item.stop()); await room.disconnect(); return; }
      this.publishedTrack = publication.videoTrack ?? null;
      track.addEventListener('ended', () => { if (this.stream === candidate) this.stop(); }, { once: true });
      this.onStream(candidate);
      try { this.devices = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'videoinput'); }
      catch { this.devices = []; }
      if (generation !== this.generation) return;
      await this.report();
      this.timer = setInterval(() => void this.report(), 3000);
      this.validation = setInterval(() => {
        if (!this.claim) return;
        void notebookCamerasApi.phoneConnection(this.cameraId, this.claim.sessionToken).catch(reason => {
          if (generation === this.generation && reason instanceof ApiRequestError && [401, 403, 404, 409, 410].includes(reason.status)) {
            this.stop(false); this.onStatus('Подключение отозвано или урок завершён. Откройте новый QR из урока.');
          }
        });
      }, 60000);
      const remaining = Date.parse(this.claim.camera.sessionExpiresAt) - Date.now();
      this.expiry = setTimeout(() => { this.stop(false); this.onStatus('Время подключения истекло. Создайте новый QR в уроке.'); }, Math.max(0, remaining));
      try {
        const lock = await navigator.wakeLock?.request('screen');
        if (generation !== this.generation) await lock?.release(); else this.wakeLock = lock ?? null;
      } catch { /* Keeping the page visible is sufficient without wake lock. */ }
      if (generation === this.generation) this.onStatus('Камера включена. Оставьте эту страницу открытой.');
    } catch (error) {
      candidate?.getTracks().forEach(track => track.stop());
      if (room && room !== this.room) void room.disconnect();
      if (generation === this.generation) this.stop(false);
      throw error;
    }
  }

  stop(announce = true): void {
    this.generation++;
    clearInterval(this.timer); clearInterval(this.validation); clearTimeout(this.expiry);
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null;
    this.publishedTrack = null;
    const room = this.room; this.room = null;
    void room?.disconnect();
    void this.wakeLock?.release(); this.wakeLock = null;
    this.onStream(null);
    if (announce) this.onStatus('Камера выключена. Можно включить снова.');
  }

  private async send(value: unknown) {
    if (!this.room || this.room.state !== 'connected') return;
    try { await this.room.localParticipant.publishData(encoder.encode(JSON.stringify(value)), { reliable: true, topic }); } catch { /* Reconnection retries state. */ }
  }
  private async report() {
    const track = this.stream?.getVideoTracks()[0];
    if (!track || !this.module) return;
    await this.send({ type: 'camera-state', version: 1, quality: this.quality, ...this.module.inspectCamera(track) });
    await this.send({ type: 'camera-list', selected: track.getSettings().deviceId,
      devices: this.devices.slice(0, 8).map((device, index) => ({ id: device.deviceId, label: (device.label || `Камера ${index + 1}`).slice(0, 80) })) });
  }
  private async receive(message: Record<string, unknown>, generation: number) {
    if (generation !== this.generation) return;
    if (message?.type === 'camera-request') { await this.report(); return; }
    if (message?.type === 'camera-select' && typeof message.deviceId === 'string' && !this.controlBusy
      && this.devices.some(device => device.deviceId === message.deviceId)) { await this.start(message.deviceId); return; }
    if (message?.type !== 'camera-control' || typeof message.requestId !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(message.requestId)) return;
    const reply = (ok: boolean, error?: string) => this.send({ type: 'camera-result', requestId: message.requestId, ok, error });
    const track = this.stream?.getVideoTracks()[0];
    if (this.controlBusy || !track || !this.module) { await reply(false, 'BUSY'); return; }
    this.controlBusy = true;
    try {
      if (message.action === 'quality' && (message.value === 'detail' || message.value === 'balanced')) {
        const settings = track.getSettings();
        await track.applyConstraints({ ...track.getConstraints(), ...this.module.cameraConstraints(message.value, (settings.height ?? 0) > (settings.width ?? 0)) });
        if (generation !== this.generation) return;
        const profile = this.module.QUALITY_PROFILES[message.value];
        const sender = this.publishedTrack?.sender;
        if (!sender) throw new Error('CAMERA_REJECTED');
        const parameters = sender.getParameters();
        if (!parameters.encodings?.length) throw new Error('CAMERA_REJECTED');
        parameters.encodings.forEach(encoding => { encoding.maxBitrate = profile.bitrate; encoding.maxFramerate = profile.fps; });
        parameters.degradationPreference = 'maintain-resolution';
        try { await sender.setParameters(parameters); }
        catch {
          // Safari can reject optional framerate/degradation fields. Retry from fresh parameters.
          const fallback = sender.getParameters();
          fallback.encodings?.forEach(encoding => { encoding.maxBitrate = profile.bitrate; });
          await sender.setParameters(fallback);
        }
        if (this.publishedTrack?.publishOptions) this.publishedTrack.publishOptions.videoEncoding = { maxBitrate: profile.bitrate, maxFramerate: profile.fps };
        this.quality = message.value;
      } else if (typeof message.action === 'string' && ['auto', 'lock', 'distance'].includes(message.action)) {
        await this.module.setCameraFocus(track, message.action, message.value);
      } else throw new Error('INVALID_COMMAND');
      if (generation !== this.generation) return;
      await this.report(); await reply(true);
    } catch (error) { await reply(false, error instanceof Error ? error.message : 'CAMERA_REJECTED'); }
    finally { this.controlBusy = false; }
  }
}
