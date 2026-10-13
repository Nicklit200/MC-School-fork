import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n/I18nContext';

export type PrejoinState = 'checking' | 'ready' | 'denied' | 'noDevices' | 'unsupported' | 'deviceError';

export interface PrejoinChoice {
  videoDeviceId: string | null;
  audioDeviceId: string | null;
  cameraEnabled: boolean;
  microphoneEnabled: boolean;
}

/**
 * Checks local devices without making camera permission a prerequisite for
 * participating in a shared classroom. All preview tracks are released when
 * the user enters LiveKit or leaves this screen.
 */
export function PrejoinPanel({
  onJoin,
  joinDisabled = false,
}: {
  onJoin: (choice: PrejoinChoice) => void;
  joinDisabled?: boolean;
}) {
  const { t } = useI18n();
  const [state, setState] = useState<PrejoinState>('checking');
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [videoDeviceId, setVideoDeviceId] = useState<string | null>(null);
  const [audioDeviceId, setAudioDeviceId] = useState<string | null>(null);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [microphoneEnabled, setMicrophoneEnabled] = useState(true);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // React StrictMode and repeated retries can overlap getUserMedia promises.
  // Only the newest attempt may keep a stream or update the screen.
  const attemptRef = useRef(0);

  const stopStream = useCallback(() => {
    if (videoRef.current) videoRef.current.srcObject = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const startPreview = useCallback(async (mode: 'all' | 'audio' = 'all') => {
    const attempt = ++attemptRef.current;
    const media = navigator.mediaDevices;
    if (!media?.getUserMedia) {
      stopStream();
      setCameraEnabled(false);
      setMicrophoneEnabled(false);
      setState('unsupported');
      return;
    }

    setState('checking');
    stopStream();

    try {
      const stream = await media.getUserMedia(
        mode === 'audio' ? { video: false, audio: true } : { video: true, audio: true },
      );
      if (attempt !== attemptRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      let devices: MediaDeviceInfo[] = [];
      try {
        devices = await media.enumerateDevices();
      } catch {
        // Browser privacy settings sometimes deny enumeration after granting
        // audio/video. The acquired stream remains usable without device labels.
      }
      if (attempt !== attemptRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        if (streamRef.current === stream) streamRef.current = null;
        return;
      }

      const cameras = devices.filter((device) => device.kind === 'videoinput');
      const microphones = devices.filter((device) => device.kind === 'audioinput');
      const hasCamera = stream.getVideoTracks().length > 0;
      const hasMicrophone = stream.getAudioTracks().length > 0;
      setVideoDevices(cameras);
      setAudioDevices(microphones);
      setVideoDeviceId((current) => cameras.some((device) => device.deviceId === current)
        ? current : cameras[0]?.deviceId ?? null);
      setAudioDeviceId((current) => microphones.some((device) => device.deviceId === current)
        ? current : microphones[0]?.deviceId ?? null);
      setCameraEnabled(hasCamera);
      setMicrophoneEnabled(hasMicrophone);
      setState(hasCamera || hasMicrophone ? 'ready' : 'noDevices');
    } catch (error) {
      if (attempt !== attemptRef.current) return;
      setCameraEnabled(false);
      setMicrophoneEnabled(false);
      const name = (error as DOMException)?.name;
      if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        setState('noDevices');
      } else if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
        setState('denied');
      } else {
        setState('deviceError');
      }
    }
  }, [stopStream]);

  useEffect(() => {
    void startPreview();
    return () => {
      attemptRef.current += 1;
      stopStream();
    };
  }, [startPreview, stopStream]);

  // The preview element is mounted *after* permission is granted. Attaching
  // srcObject only in getUserMedia's async callback leaves it blank.
  useEffect(() => {
    const stream = streamRef.current;
    if (!stream) return;
    stream.getVideoTracks().forEach((track) => { track.enabled = cameraEnabled; });
    stream.getAudioTracks().forEach((track) => { track.enabled = microphoneEnabled; });
    if (videoRef.current) {
      videoRef.current.srcObject = state === 'ready' && cameraEnabled ? stream : null;
    }
  }, [state, cameraEnabled, microphoneEnabled]);

  const hasMedia = state === 'ready';
  const join = () => onJoin({
    videoDeviceId: hasMedia && cameraEnabled ? videoDeviceId : null,
    audioDeviceId: hasMedia && microphoneEnabled ? audioDeviceId : null,
    cameraEnabled: hasMedia && cameraEnabled,
    microphoneEnabled: hasMedia && microphoneEnabled,
  });

  return (
    <section className="prejoin" aria-labelledby="prejoin-title">
      <div className="prejoin__heading">
        <div className="prejoin__eyebrow">Mindcrafti Online</div>
        <h2 id="prejoin-title">{t('onlineClass.prejoin.title')}</h2>
        <p>{t('onlineClass.prejoin.hint')}</p>
      </div>

      <div className="prejoin__layout">
        <div className="prejoin__preview">
          {cameraEnabled && state === 'ready' ? (
            <video ref={videoRef} autoPlay playsInline muted aria-label={t('onlineClass.prejoin.camera')} />
          ) : (
            <div className="prejoin__placeholder">
              <span className="prejoin__camera-icon" aria-hidden="true">▢</span>
              <span>{state === 'checking'
                ? t('onlineClass.prejoin.checking')
                : t('onlineClass.prejoin.cameraOff')}</span>
            </div>
          )}
          <div className="prejoin__preview-label">{t('onlineClass.prejoin.previewHint')}</div>
        </div>

        <div className="prejoin__settings">
          <div role="status" aria-live="polite">
            {state === 'denied' && (
              <div className="prejoin__error">
                <strong>{t('onlineClass.prejoin.permissionDenied')}</strong>
                <p>{t('onlineClass.prejoin.permissionHelp')}</p>
              </div>
            )}
            {state === 'noDevices' && (
              <div className="prejoin__error">{t('onlineClass.prejoin.noDevices')}</div>
            )}
            {state === 'deviceError' && (
              <div className="prejoin__error">{t('onlineClass.prejoin.deviceError')}</div>
            )}
            {state === 'unsupported' && (
              <div className="prejoin__error">{t('onlineClass.prejoin.unsupported')}</div>
            )}
          </div>

          {state === 'ready' ? (
            <div className="prejoin__devices">
              {videoDevices.length > 0 && (
                <label className="prejoin__select">
                  {t('onlineClass.prejoin.camera')}
                  <select value={videoDeviceId ?? ''}
                    onChange={(event) => setVideoDeviceId(event.target.value)}>
                    {videoDevices.map((device) => (
                      <option key={device.deviceId} value={device.deviceId}>
                        {device.label || t('onlineClass.prejoin.camera')}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {audioDevices.length > 0 && (
                <label className="prejoin__select">
                  {t('onlineClass.prejoin.microphone')}
                  <select value={audioDeviceId ?? ''}
                    onChange={(event) => setAudioDeviceId(event.target.value)}>
                    {audioDevices.map((device) => (
                      <option key={device.deviceId} value={device.deviceId}>
                        {device.label || t('onlineClass.prejoin.microphone')}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {streamRef.current?.getVideoTracks().length ? (
                <label className="prejoin__toggle">
                  <input type="checkbox" checked={cameraEnabled}
                    onChange={(event) => setCameraEnabled(event.target.checked)} />
                  <span>{t('onlineClass.prejoin.camera')}</span>
                </label>
              ) : null}
              {streamRef.current?.getAudioTracks().length ? (
                <label className="prejoin__toggle">
                  <input type="checkbox" checked={microphoneEnabled}
                    onChange={(event) => setMicrophoneEnabled(event.target.checked)} />
                  <span>{t('onlineClass.prejoin.microphone')}</span>
                </label>
              ) : null}
            </div>
          ) : null}

          {(state === 'denied' || state === 'noDevices' || state === 'deviceError') && (
            <div className="prejoin__retry-actions">
              <button type="button" className="prejoin__retry"
                onClick={() => void startPreview()}>
                {t('onlineClass.prejoin.retry')}
              </button>
              <button type="button" className="prejoin__retry"
                onClick={() => void startPreview('audio')}>
                {t('onlineClass.prejoin.audioOnly')}
              </button>
            </div>
          )}

          <div className="prejoin__join-actions">
            <button type="button" className="prejoin__join"
              onClick={join}
              disabled={joinDisabled || state === 'checking'}>
              {hasMedia ? t('onlineClass.prejoin.join') : t('onlineClass.prejoin.joinWithoutDevices')}
            </button>
            <p className="prejoin__note">{t('onlineClass.prejoin.joinNote')}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
