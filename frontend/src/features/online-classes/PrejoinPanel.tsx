import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n/I18nContext';

export type PrejoinState = 'checking' | 'ready' | 'denied' | 'noDevices' | 'unsupported';

export interface PrejoinChoice {
  videoDeviceId: string | null;
  audioDeviceId: string | null;
  cameraEnabled: boolean;
  microphoneEnabled: boolean;
}

/**
 * Camera/microphone preview and device selection shown before joining.
 *
 * <p>Acquires a local preview stream and always stops its tracks on unmount, so
 * the camera light never stays on after leaving this screen.
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

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const startPreview = useCallback(async () => {
    const media = navigator.mediaDevices;
    if (!media?.getUserMedia) {
      setState('unsupported');
      return;
    }
    setState('checking');
    stopStream();
    try {
      const stream = await media.getUserMedia({ video: true, audio: true });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      // Labels are only populated after permission is granted, which is why
      // enumeration happens here rather than on mount.
      const devices = await media.enumerateDevices();
      const cameras = devices.filter((device) => device.kind === 'videoinput');
      const microphones = devices.filter((device) => device.kind === 'audioinput');
      setVideoDevices(cameras);
      setAudioDevices(microphones);
      setVideoDeviceId((current) => current ?? cameras[0]?.deviceId ?? null);
      setAudioDeviceId((current) => current ?? microphones[0]?.deviceId ?? null);
      setState(cameras.length === 0 && microphones.length === 0 ? 'noDevices' : 'ready');
    } catch (error) {
      const name = (error as DOMException)?.name;
      // NotFoundError means no hardware; anything else is treated as a denial,
      // which is the state the user can actually act on.
      setState(name === 'NotFoundError' || name === 'DevicesNotFoundError' ? 'noDevices' : 'denied');
    }
  }, [stopStream]);

  useEffect(() => {
    void startPreview();
    return stopStream;
  }, [startPreview, stopStream]);

  const join = () =>
    onJoin({ videoDeviceId, audioDeviceId, cameraEnabled, microphoneEnabled });

  return (
    <section className="prejoin" aria-labelledby="prejoin-title">
      <h2 id="prejoin-title">{t('onlineClass.prejoin.title')}</h2>

      <div className="prejoin__preview">
        {cameraEnabled && state === 'ready' ? (
          <video ref={videoRef} autoPlay playsInline muted aria-label={t('onlineClass.prejoin.camera')} />
        ) : (
          <p className="prejoin__placeholder">{t('onlineClass.prejoin.cameraOff')}</p>
        )}
      </div>

      {/* Important state changes are announced rather than only shown. */}
      <div role="status" aria-live="polite">
        {state === 'denied' && <p className="prejoin__error">{t('onlineClass.prejoin.permissionDenied')}</p>}
        {state === 'noDevices' && <p className="prejoin__error">{t('onlineClass.prejoin.noDevices')}</p>}
        {state === 'unsupported' && <p className="prejoin__error">{t('onlineClass.prejoin.unsupported')}</p>}
      </div>

      {(state === 'denied' || state === 'noDevices') && (
        <button type="button" onClick={() => void startPreview()}>
          {t('onlineClass.prejoin.retry')}
        </button>
      )}

      {state === 'ready' && (
        <div className="prejoin__devices">
          <label>
            {t('onlineClass.prejoin.camera')}
            <select
              value={videoDeviceId ?? ''}
              onChange={(event) => setVideoDeviceId(event.target.value)}
            >
              {videoDevices.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || t('onlineClass.prejoin.camera')}
                </option>
              ))}
            </select>
          </label>

          <label>
            {t('onlineClass.prejoin.microphone')}
            <select
              value={audioDeviceId ?? ''}
              onChange={(event) => setAudioDeviceId(event.target.value)}
            >
              {audioDevices.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || t('onlineClass.prejoin.microphone')}
                </option>
              ))}
            </select>
          </label>

          <label>
            <input
              type="checkbox"
              checked={cameraEnabled}
              onChange={(event) => setCameraEnabled(event.target.checked)}
            />
            {t('onlineClass.prejoin.camera')}
          </label>

          <label>
            <input
              type="checkbox"
              checked={microphoneEnabled}
              onChange={(event) => setMicrophoneEnabled(event.target.checked)}
            />
            {t('onlineClass.prejoin.microphone')}
          </label>
        </div>
      )}

      <button
        type="button"
        onClick={join}
        disabled={joinDisabled || state === 'checking' || state === 'unsupported'}
      >
        {t('onlineClass.prejoin.join')}
      </button>
    </section>
  );
}
