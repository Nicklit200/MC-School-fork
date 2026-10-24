import { useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, Track, type RemoteParticipant, type RemoteTrack } from 'livekit-client';
import { notebookCamerasApi, notebookCameraError } from '../../api/notebookCameras';

interface ViewerWindow extends Window {
  setNotebookCameraId?: (id: string) => void;
  setNotebookStream?: (stream: MediaStream | null) => void;
  receiveNotebookData?: (value: unknown) => void;
  setNotebookConnected?: (connected: boolean) => void;
  setNotebookStatus?: (message: string) => void;
  setNotebookCompact?: (compact: boolean) => void;
}
const topic = 'mindcrafti-notebook-camera';

interface NotebookCameraViewerProps {
  cameraId: string;
  compact?: boolean;
  onVideoAvailableChange?: (available: boolean) => void;
  title?: string;
}

export function NotebookCameraViewer({ cameraId, compact = false, onVideoAvailableChange, title = 'Тетрадь: выравнивание, фокус и пометки' }: NotebookCameraViewerProps) {
  const iframe = useRef<HTMLIFrameElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const latestState = useRef<unknown>(null);
  const roomRef = useRef<Room | null>(null);
  const compactRef = useRef(compact);
  const videoCallback = useRef(onVideoAvailableChange);
  compactRef.current = compact;
  videoCallback.current = onVideoAvailableChange;
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const sync = () => {
    const view = iframe.current?.contentWindow as ViewerWindow | null;
    view?.setNotebookCameraId?.(cameraId);
    view?.setNotebookCompact?.(compactRef.current);
    view?.setNotebookStream?.(stream.current);
    view?.setNotebookConnected?.(roomRef.current?.state === 'connected');
    if (latestState.current) view?.receiveNotebookData?.(latestState.current);
    if (stream.current) view?.setNotebookStatus?.('Телефон подключён. Можно выровнять лист и делать пометки.');
  };
  // Presentation changes must preserve the media room and the iframe's ink.
  useEffect(() => {
    (iframe.current?.contentWindow as ViewerWindow | null)?.setNotebookCompact?.(compact);
  }, [compact]);
  useEffect(() => {
    let active = true;
    videoCallback.current?.(false);
    const view = iframe.current?.contentWindow as ViewerWindow | null;
    view?.setNotebookConnected?.(false);
    view?.setNotebookStream?.(null);
    view?.setNotebookCameraId?.(cameraId);
    const room = new Room({ adaptiveStream: false });
    roomRef.current = room;
    let phoneIdentity = '';
    let pendingCommand = false;
    let attachedTrack: RemoteTrack | null = null;
    let trackEnded: (() => void) | null = null;
    const status = (message: string) => (iframe.current?.contentWindow as ViewerWindow | null)?.setNotebookStatus?.(message);
    const releaseTrack = () => {
      if (attachedTrack && trackEnded) attachedTrack.mediaStreamTrack.removeEventListener('ended', trackEnded);
      attachedTrack = null; trackEnded = null;
    };
    const clearVideo = () => {
      releaseTrack(); stream.current = null; sync(); videoCallback.current?.(false);
    };
    const attach = (track: RemoteTrack, participant: RemoteParticipant) => {
      if (!active || participant.identity !== phoneIdentity || track.kind !== Track.Kind.Video
        || track.mediaStreamTrack.readyState !== 'live' || track.isMuted) return;
      releaseTrack(); attachedTrack = track;
      trackEnded = () => { if (active && attachedTrack === track) clearVideo(); };
      track.mediaStreamTrack.addEventListener('ended', trackEnded);
      stream.current = new MediaStream([track.mediaStreamTrack]); sync();
      videoCallback.current?.(true);
      status('Телефон подключён. Можно выровнять лист и делать пометки.');
      void room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify({ type: 'camera-request' })), { reliable: true, topic, destinationIdentities: [phoneIdentity] }).catch(() => {});
    };
    room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => attach(track, participant));
    room.on(RoomEvent.TrackUnsubscribed, (track, _publication, participant) => {
      if (active && participant.identity === phoneIdentity && track.kind === Track.Kind.Video && (!attachedTrack || attachedTrack === track)) {
        clearVideo(); status('Камера телефона выключена. Включите её на телефоне.');
      }
    });
    room.on(RoomEvent.ParticipantDisconnected, participant => {
      if (active && participant.identity === phoneIdentity) { clearVideo(); status('Телефон отключён. Включите камеру на телефоне.'); }
    });
    room.on(RoomEvent.TrackMuted, (publication, participant) => {
      if (active && participant.identity === phoneIdentity && publication.track === attachedTrack) clearVideo();
    });
    room.on(RoomEvent.TrackUnmuted, (publication, participant) => {
      if (publication.track) attach(publication.track as RemoteTrack, participant as RemoteParticipant);
    });
    room.on(RoomEvent.DataReceived, (payload, participant, _kind, dataTopic) => {
      if (!active || participant?.identity !== phoneIdentity || dataTopic !== topic || payload.byteLength > 16000) return;
      try {
        const value = JSON.parse(new TextDecoder().decode(payload));
        if (value.type === 'camera-state') latestState.current = value;
        (iframe.current?.contentWindow as ViewerWindow | null)?.receiveNotebookData?.(value);
      } catch { /* Ignore malformed participant data. */ }
    });
    room.on(RoomEvent.Reconnecting, () => status('Восстанавливаем подключение…'));
    room.on(RoomEvent.Reconnected, () => { sync(); status('Связь восстановлена.'); });
    room.on(RoomEvent.Disconnected, () => { if (active) { clearVideo(); setError('Соединение завершено. Подключитесь снова или создайте новый QR.'); } });
    const message = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== iframe.current?.contentWindow) return;
      if (event.data?.type === 'mindcrafti-notebook-ready') { sync(); return; }
      if (event.data?.type !== 'mindcrafti-notebook-command' || !phoneIdentity || room.state !== 'connected' || pendingCommand) return;
      const value = event.data.value;
      if (!value || !['camera-request', 'camera-control', 'camera-select'].includes(value.type)) return;
      const bytes = new TextEncoder().encode(JSON.stringify(value));
      if (bytes.byteLength > 16000) return;
      pendingCommand = true;
      void room.localParticipant.publishData(bytes, { reliable: true, topic, destinationIdentities: [phoneIdentity] })
        .catch(() => status('Не удалось отправить настройку. Повторите после восстановления связи.'))
        .finally(() => { pendingCommand = false; });
    };
    window.addEventListener('message', message);
    setError(null);
    void notebookCamerasApi.connection(cameraId).then(async connection => {
      if (!active) return;
      phoneIdentity = connection.phoneIdentity;
      await room.connect(connection.serverUrl, connection.token);
      if (!active) { await room.disconnect(); return; }
      sync(); status('Сканируйте QR телефоном и включите камеру.');
      room.remoteParticipants.forEach(participant => participant.trackPublications.forEach(publication => {
        if (publication.track) attach(publication.track, participant);
      }));
    }).catch(reason => { if (active) { clearVideo(); setError(notebookCameraError(reason)); } });
    return () => {
      active = false; window.removeEventListener('message', message);
      releaseTrack(); videoCallback.current?.(false);
      const oldView = iframe.current?.contentWindow as ViewerWindow | null;
      oldView?.setNotebookConnected?.(false); oldView?.setNotebookStream?.(null);
      stream.current = null; latestState.current = null; roomRef.current = null;
      void room.disconnect();
    };
  }, [cameraId, attempt]);
  return <div className={`notebook-camera-viewer${compact ? ' notebook-camera-viewer--compact' : ''}`}>
    {error && <div role="alert" className="banner banner--error">{error} <button className="btn btn--secondary" onClick={() => setAttempt(value => value + 1)}>Повторить</button></div>}
    <iframe ref={iframe} className="notebook-camera__viewer" title={title} src="/notebook-camera/index.html" onLoad={sync} />
  </div>;
}
