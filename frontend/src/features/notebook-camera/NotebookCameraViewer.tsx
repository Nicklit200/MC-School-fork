import { useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, Track, type RemoteParticipant, type RemoteTrack } from 'livekit-client';
import { notebookCamerasApi, notebookCameraError } from '../../api/notebookCameras';
import { loadCameraModule, type CameraModule, type DocumentRenderer, type NotebookDocumentView, type NotebookDocumentViewState } from './cameraModules';

interface ViewerWindow extends Window {
  setNotebookCameraId?: (id: string) => void;
  setNotebookStream?: (stream: MediaStream | null) => void;
  receiveNotebookData?: (value: unknown) => void;
  setNotebookConnected?: (connected: boolean) => void;
  setNotebookStatus?: (message: string) => void;
  setNotebookCompact?: (compact: boolean) => void;
  setNotebookDocumentView?: (view: NotebookDocumentView) => boolean;
  getNotebookDocumentView?: () => NotebookDocumentView;
}
const topic = 'mindcrafti-notebook-camera';

/** The board receives the processed canvas, never the phone's raw video. */
export type NotebookCameraVideoSource = {
  video: HTMLCanvasElement; width: number; height: number;
  rawVideo: HTMLVideoElement; rawWidth: number; rawHeight: number;
  view: NotebookDocumentView; renderer: CameraModule;
};

interface NotebookCameraViewerProps {
  cameraId: string;
  ownerId?: string;
  active?: boolean;
  compact?: boolean;
  presentation?: 'processor' | 'board';
  onVideoAvailableChange?: (available: boolean) => void;
  onBoardVideoChange?: (source: NotebookCameraVideoSource | null) => void;
  title?: string;
}

export function NotebookCameraViewer({ cameraId, ownerId, active: visible = true, compact = false, presentation = 'processor', onVideoAvailableChange, onBoardVideoChange, title = 'Тетрадь: выравнивание, фокус и пометки' }: NotebookCameraViewerProps) {
  const iframe = useRef<HTMLIFrameElement>(null);
  const boardVideo = useRef<HTMLVideoElement>(null);
  const retainedBoardVideo = useRef<HTMLVideoElement | null>(null);
  const boardSource = useRef<NotebookCameraVideoSource | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const latestState = useRef<unknown>(null);
  const roomRef = useRef<Room | null>(null);
  const moduleRef = useRef<CameraModule | null>(null);
  const rendererRef = useRef<DocumentRenderer | null>(null);
  const rendererFailed = useRef(false);
  const rendererConfig = useRef('');
  const renderedView = useRef<NotebookDocumentView | null>(null);
  const paintedCanvas = useRef<HTMLCanvasElement | null>(null);
  const documentView = useRef<NotebookDocumentView | null>(null);
  const documentRevision = useRef(-1);
  const latestDocumentPacket = useRef<NotebookDocumentViewState | null>(null);
  const pendingView = useRef<{ changeId: string; view: NotebookDocumentView } | null>(null);
  const sentChange = useRef<string | null>(null);
  const changeSequence = useRef(0);
  const changePrefix = useRef(Math.random().toString(36).slice(2));
  const restoreCaptured = useRef(false);
  const restoredCandidate = useRef<NotebookDocumentView | null>(null);
  const restoreResolved = useRef(false);
  const canConfigure = useRef(false);
  const phoneIdentityRef = useRef('');
  const visibleRef = useRef(visible);
  const compactRef = useRef(compact);
  const presentationRef = useRef(presentation);
  const videoCallback = useRef(onVideoAvailableChange);
  const boardVideoCallback = useRef(onBoardVideoChange);
  compactRef.current = compact;
  presentationRef.current = presentation;
  visibleRef.current = visible;
  videoCallback.current = onVideoAvailableChange;
  boardVideoCallback.current = onBoardVideoChange;
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const clearBoardSource = () => {
    boardSource.current = null;
    boardVideoCallback.current?.(null);
  };
  const reportProcessedCanvas = () => {
    const canvas = rendererRef.current?.canvas;
    const rawVideo = boardVideo.current, view = renderedView.current, renderer = moduleRef.current;
    if (rendererFailed.current || !canvas || paintedCanvas.current !== canvas || !rawVideo || !view || !renderer || !stream.current || canvas.width <= 0 || canvas.height <= 0) return;
    const previous = boardSource.current;
    if (previous?.video === canvas && previous.width === canvas.width && previous.height === canvas.height
      && previous.rawWidth === rawVideo.videoWidth && previous.rawHeight === rawVideo.videoHeight && previous.view === view) return;
    const next = { video: canvas, width: canvas.width, height: canvas.height, rawVideo,
      rawWidth: rawVideo.videoWidth, rawHeight: rawVideo.videoHeight, view, renderer };
    boardSource.current = next;
    boardVideoCallback.current?.(next);
  };
  const reportBoardSource = () => {
    const video = boardVideo.current;
    const module = moduleRef.current;
    if (presentationRef.current !== 'board' || !module || !video || !stream.current || video.srcObject !== stream.current
      || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth <= 0 || video.videoHeight <= 0) return;
    try {
      if (!rendererRef.current) {
        rendererFailed.current = false;
        rendererRef.current = new module.LiveDocumentRenderer(video, document.createElement('canvas'), {
          maxDimension: module.QUALITY_PROFILES.detail.render,
          onCanvasReplace: () => { rendererConfig.current = ''; paintedCanvas.current = null; },
          onFrame: canvas => { paintedCanvas.current = canvas; reportProcessedCanvas(); },
          onError: () => { rendererFailed.current = true; clearBoardSource(); setError('Не удалось обработать видео тетради. Нажмите «Повторить».'); },
        });
      }
      const renderer = rendererRef.current;
      const aspect = video.videoWidth / video.videoHeight;
      let view = documentView.current ?? module.defaultDocumentView(aspect);
      // Metadata can precede the phone's new snapshot when its camera changes.
      if (view.corners && Math.abs(aspect / view.sourceAspect - 1) > .06) view = { ...module.defaultDocumentView(aspect), turn: view.turn };
      const quality = (latestState.current as { quality?: string } | null)?.quality === 'balanced' ? 'balanced' : 'detail';
      const dimension = module.QUALITY_PROFILES[quality].render;
      const key = JSON.stringify([video.videoWidth, video.videoHeight, dimension, view]);
      if (rendererConfig.current !== key) {
        renderedView.current = view;
        renderer.setMaxDimension(dimension);
        renderer.setView(view);
        rendererConfig.current = key;
      }
      if (visibleRef.current) renderer.start(); else renderer.stop();
      reportProcessedCanvas();
    } catch {
      clearBoardSource(); setError('Не удалось обработать видео тетради. Нажмите «Повторить».');
    }
  };
  const releaseBoardVideo = () => {
    rendererRef.current?.stop(); rendererRef.current = null; rendererConfig.current = ''; paintedCanvas.current = null; renderedView.current = null;
    const video = retainedBoardVideo.current;
    if (video) { video.pause(); video.srcObject = null; }
    retainedBoardVideo.current = null;
    clearBoardSource();
  };
  const flushDocumentView = () => {
    const pending = pendingView.current, room = roomRef.current;
    if (!pending || !canConfigure.current || !room || room.state !== 'connected' || !phoneIdentityRef.current || sentChange.current === pending.changeId) return;
    const value = { type: 'document-view-update', version: 1, cameraId, ...pending };
    sentChange.current = pending.changeId;
    void room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(value)), {
      reliable: true, topic, destinationIdentities: [phoneIdentityRef.current],
    }).catch(() => { if (sentChange.current === pending.changeId) sentChange.current = null; });
  };
  const publishDocumentView = (value: unknown) => {
    const view = moduleRef.current?.validateDocumentView(value);
    if (!view || !canConfigure.current || presentationRef.current !== 'processor') return;
    documentView.current = view;
    pendingView.current = { changeId: `${changePrefix.current}-${++changeSequence.current}`, view };
    flushDocumentView();
  };
  const captureRestoredView = () => {
    if (restoreCaptured.current || !moduleRef.current || !canConfigure.current || presentationRef.current !== 'processor') return;
    restoreCaptured.current = true;
    try {
      const saved = JSON.parse(sessionStorage.getItem(`camera-document-${cameraId}`) ?? 'null');
      restoredCandidate.current = moduleRef.current.validateDocumentView(saved?.view);
    } catch { /* Storage can be unavailable on a shared tablet. */ }
  };
  const receiveDocumentView = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    const state = value as NotebookDocumentViewState;
    if (state.type !== 'document-view-state' || state.version !== 1 || state.cameraId !== cameraId
      || !Number.isSafeInteger(state.revision) || state.revision < 0 || state.revision <= documentRevision.current
      || (state.changeId !== undefined && (typeof state.changeId !== 'string' || state.changeId.length > 80))) return;
    const module = moduleRef.current;
    if (!module) {
      if (!latestDocumentPacket.current || state.revision > latestDocumentPacket.current.revision) latestDocumentPacket.current = state;
      return;
    }
    const view = module.validateDocumentView(state.view);
    if (!view) return;
    captureRestoredView();
    documentRevision.current = state.revision;
    latestDocumentPacket.current = { ...state, view };
    if (canConfigure.current && presentationRef.current === 'processor' && !restoreResolved.current) {
      restoreResolved.current = true;
      const restored = restoredCandidate.current;
      // Migrate the old local-only alignment only into a fresh phone session.
      // A running phone is authoritative when another pupil tab opens.
      if (!pendingView.current && state.revision <= 1 && !state.changeId && restored && JSON.stringify(restored) !== JSON.stringify(view)) {
        publishDocumentView(restored);
        (iframe.current?.contentWindow as ViewerWindow | null)?.setNotebookDocumentView?.(restored);
        return;
      }
    }
    if (pendingView.current && state.changeId !== pendingView.current.changeId) return;
    pendingView.current = null;
    documentView.current = view;
    if (presentationRef.current === 'processor') (iframe.current?.contentWindow as ViewerWindow | null)?.setNotebookDocumentView?.(view);
    reportBoardSource();
  };
  const sync = () => {
    const video = boardVideo.current;
    if (video) {
      retainedBoardVideo.current = video;
      if (video.srcObject !== stream.current) {
        clearBoardSource();
        video.srcObject = stream.current;
        if (stream.current) {
          const source = stream.current;
          void video.play().catch(reason => {
            if (boardVideo.current !== video || stream.current !== source || reason?.name === 'AbortError') return;
            clearBoardSource(); videoCallback.current?.(false);
            setError('Не удалось включить видео. Нажмите «Повторить».');
          });
        } else video.pause();
      } else reportBoardSource();
    }
    const view = iframe.current?.contentWindow as ViewerWindow | null;
    view?.setNotebookCameraId?.(cameraId);
    captureRestoredView();
    if (documentView.current) view?.setNotebookDocumentView?.(documentView.current);
    view?.setNotebookCompact?.(compactRef.current);
    view?.setNotebookStream?.(stream.current);
    view?.setNotebookConnected?.(roomRef.current?.state === 'connected');
    if (latestState.current) view?.receiveNotebookData?.(latestState.current);
    if (stream.current) view?.setNotebookStatus?.('Телефон подключён. Можно выровнять лист и делать пометки.');
    flushDocumentView();
  };
  // Presentation changes must preserve the media room and the iframe's ink.
  useEffect(() => {
    (iframe.current?.contentWindow as ViewerWindow | null)?.setNotebookCompact?.(compact);
  }, [compact]);
  useEffect(() => {
    if (presentation !== 'board') releaseBoardVideo();
    sync();
  }, [presentation, visible]);
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
      releaseTrack(); rendererRef.current?.stop(); stream.current = null; clearBoardSource(); sync(); videoCallback.current?.(false);
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
        flushDocumentView();
        if (value.type === 'document-view-state') { receiveDocumentView(value); return; }
        if (value.type === 'camera-state') latestState.current = value;
        (iframe.current?.contentWindow as ViewerWindow | null)?.receiveNotebookData?.(value);
        reportBoardSource();
      } catch { /* Ignore malformed participant data. */ }
    });
    room.on(RoomEvent.Reconnecting, () => status('Восстанавливаем подключение…'));
    room.on(RoomEvent.Reconnected, () => { sentChange.current = null; sync(); status('Связь восстановлена.'); });
    room.on(RoomEvent.Disconnected, () => { if (active) { clearVideo(); setError('Соединение завершено. Подключитесь снова или создайте новый QR.'); } });
    const message = (event: MessageEvent) => {
      if (presentationRef.current !== 'processor' || !iframe.current
        || event.origin !== window.location.origin || event.source !== iframe.current.contentWindow) return;
      if (event.data?.type === 'mindcrafti-notebook-ready') { sync(); return; }
      if (event.data?.type === 'mindcrafti-notebook-view') { publishDocumentView(event.data.value); return; }
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
    void loadCameraModule().then(module => {
      if (!active) return;
      moduleRef.current = module;
      const pending = latestDocumentPacket.current;
      if (presentationRef.current === 'processor') sync();
      if (pending) receiveDocumentView(pending);
      sync(); reportBoardSource();
    }).catch(() => { if (active) setError('Не удалось загрузить обработку тетради. Нажмите «Повторить».'); });
    void notebookCamerasApi.connection(cameraId).then(async connection => {
      if (!active) return;
      phoneIdentity = connection.phoneIdentity;
      phoneIdentityRef.current = phoneIdentity;
      canConfigure.current = !ownerId || connection.identity?.startsWith(`notebook-viewer:${cameraId}:${ownerId}:`) === true;
      sync();
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
      releaseBoardVideo();
      const oldView = iframe.current?.contentWindow as ViewerWindow | null;
      oldView?.setNotebookConnected?.(false); oldView?.setNotebookStream?.(null);
      stream.current = null; latestState.current = null; roomRef.current = null;
      moduleRef.current = null; documentView.current = null; documentRevision.current = -1;
      latestDocumentPacket.current = null; pendingView.current = null; sentChange.current = null;
      restoreCaptured.current = false; restoredCandidate.current = null; restoreResolved.current = false;
      canConfigure.current = false; phoneIdentityRef.current = '';
      void room.disconnect();
    };
  }, [cameraId, ownerId, attempt]);
  return <div className={`notebook-camera-viewer${compact ? ' notebook-camera-viewer--compact' : ''}${presentation === 'board' ? ' notebook-camera-viewer--board' : ''}`}>
    {error && <div role="alert" className="banner banner--error">{error} <button className="btn btn--secondary" onClick={() => setAttempt(value => value + 1)}>Повторить</button></div>}
    {presentation === 'board'
      ? <video ref={boardVideo} className="notebook-camera-viewer__source" autoPlay muted playsInline aria-hidden="true" tabIndex={-1}
        onLoadedMetadata={reportBoardSource} onLoadedData={reportBoardSource} onPlaying={reportBoardSource} onResize={reportBoardSource} />
      : <iframe ref={iframe} className="notebook-camera__viewer" title={title} src="/notebook-camera/index.html?v=shared-notebook-1" onLoad={sync} />}
  </div>;
}
