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
  const { t, language } = useI18n();
  const [state, setState] = useState<PrejoinState>('checking');
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [videoDeviceId, setVideoDeviceId] = useState<string | null>(null);
  const [audioDeviceId, setAudioDeviceId] = useState<string | null>(null);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [microphoneEnabled, setMicrophoneEnabled] = useState(true);
  const [micLevel, setMicLevel] = useState(0);
  const [heardSound, setHeardSound] = useState(false);
  const [partialFailure, setPartialFailure] = useState('');
  const audioContextRef = useRef<AudioContext | null>(null);

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

  const startPreview = useCallback(async (mode: 'all' | 'audio' = 'all', preferredMicrophoneId?: string | null, preferredCameraId?: string | null) => {
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
    setPartialFailure('');
    setMicLevel(0);
    setHeardSound(false);
    stopStream();

    try {
      const audio: boolean | MediaTrackConstraints = preferredMicrophoneId
        ? { deviceId: { exact: preferredMicrophoneId } } : true;
      const video: boolean | MediaTrackConstraints = preferredCameraId
        ? { deviceId: { exact: preferredCameraId } } : true;
      let stream: MediaStream;
      try {
        stream = await media.getUserMedia(mode === 'audio' ? { video: false, audio } : { video, audio });
      } catch (combinedError) {
        if (mode === 'audio' || attempt !== attemptRef.current) throw combinedError;
        // If one device is blocked or busy, still verify the other device.
        const tracks: MediaStreamTrack[] = [];
        for (const constraints of [{ video: false, audio }, { video, audio: false }]) {
          if (attempt !== attemptRef.current) break;
          try {
            const partial = await media.getUserMedia(constraints);
            tracks.push(...partial.getTracks());
          } catch { /* report the missing device below */ }
        }
        if (attempt !== attemptRef.current) { tracks.forEach(track => track.stop()); return; }
        if (!tracks.length) throw combinedError;
        stream = new MediaStream(tracks);
      }
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
      const hasCamera = stream.getVideoTracks().some((track) => track.readyState !== 'ended');
      const liveMicrophone = stream.getAudioTracks().find((track) => track.readyState !== 'ended');
      const hasMicrophone = Boolean(liveMicrophone);
      // Use the device actually verified by the browser. Previously we used
      // microphones[0], potentially switching to a different mic in LiveKit.
      const capturedMicrophoneId = liveMicrophone?.getSettings?.().deviceId;
      setVideoDevices(cameras);
      setAudioDevices(microphones);
      const capturedCameraId = stream.getVideoTracks().find(track => track.readyState !== 'ended')?.getSettings?.().deviceId;
      setVideoDeviceId(capturedCameraId || preferredCameraId || cameras[0]?.deviceId || null);
      if (mode === 'all' && (!hasCamera || !hasMicrophone)) {
        setPartialFailure(!hasCamera ? 'camera' : 'microphone');
      }
      setAudioDeviceId((current) => capturedMicrophoneId
        || (microphones.some((device) => device.deviceId === current) ? current : null)
        || microphones[0]?.deviceId || null);
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

  // The meter analyses only local audio. No preview audio is recorded or sent.
  useEffect(() => {
    setMicLevel(0);
    setHeardSound(false);
    const stream = streamRef.current;
    if (state !== 'ready' || !microphoneEnabled || !stream?.getAudioTracks().length) return;
    const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return;
    let context: AudioContext | undefined;
    let frame = 0;
    let source: MediaStreamAudioSourceNode | undefined;
    try {
      context = new Context();
      audioContextRef.current = context;
      source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      let last = 0;
      const tick = (now: number) => {
        if (now - last > 80) {
          last = now;
          analyser.getByteTimeDomainData(samples);
          let sum = 0;
          for (const sample of samples) sum += ((sample - 128) / 128) ** 2;
          const rms = Math.sqrt(sum / samples.length);
          setMicLevel(Math.min(100, Math.round(rms * 450)));
          if (rms > 0.015) setHeardSound(true);
        }
        frame = window.requestAnimationFrame(tick);
      };
      void context.resume().catch(() => undefined);
      frame = window.requestAnimationFrame(tick);
    } catch { /* local preview can remain usable when Web Audio is unavailable */ }
    return () => {
      window.cancelAnimationFrame(frame);
      source?.disconnect();
      if (audioContextRef.current === context) audioContextRef.current = null;
      if (context) void context.close().catch(() => undefined);
    };
  }, [state, microphoneEnabled, audioDeviceId]);

  const hasMedia = state === 'ready';
  const join = () => {
    const choice: PrejoinChoice = {
      videoDeviceId: hasMedia && cameraEnabled ? videoDeviceId : null,
      audioDeviceId: hasMedia && microphoneEnabled ? audioDeviceId : null,
      cameraEnabled: hasMedia && cameraEnabled,
      microphoneEnabled: hasMedia && microphoneEnabled,
    };
    // Release preview capture before LiveKit acquires the real lesson tracks.
    // Previously those two getUserMedia calls could overlap on iPad/Android.
    attemptRef.current += 1;
    stopStream();
    onJoin(choice);
  };

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
                    onChange={(event) => {
                      setVideoDeviceId(event.target.value);
                      void startPreview('all', audioDeviceId, event.target.value);
                    }}>
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
                    onChange={(event) => {
                      setAudioDeviceId(event.target.value);
                      void startPreview(streamRef.current?.getVideoTracks().length ? 'all' : 'audio', event.target.value, videoDeviceId);
                    }}>
                    {audioDevices.map((device) => (
                      <option key={device.deviceId} value={device.deviceId}>
                        {device.label || t('onlineClass.prejoin.microphone')}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {partialFailure && (
                <p role="alert" className="prejoin__error">
                  {partialFailure === 'camera'
                    ? (language === 'DE' ? 'Kamera nicht verfügbar. Berechtigungen und andere Apps prüfen.' : 'Камера недоступна. Проверь разрешения браузера и другие приложения.')
                    : (language === 'DE' ? 'Mikrofon nicht verfügbar. Berechtigungen und andere Apps prüfen.' : 'Микрофон недоступен. Проверь разрешения браузера и другие приложения.')}
                </p>
              )}
              {microphoneEnabled && streamRef.current?.getAudioTracks().length ? (
                <div style={{ display: 'grid', gap: 6 }}>
                  <span>{language === 'DE' ? 'Sprich ein paar Worte.' : 'Произнеси несколько слов.'}</span>
                  <meter min={0} max={100} value={micLevel} aria-label={language === 'DE' ? 'Mikrofonpegel' : 'Уровень микрофона'} style={{ width: '100%', height: 20 }} />
                  <span>{heardSound
                    ? (language === 'DE' ? '✓ Tonsignal erkannt' : '✓ Звук обнаружен')
                    : (language === 'DE' ? 'Noch kein Tonsignal erkannt' : 'Пока звук не обнаружен')}</span>
                  <button type="button" className="prejoin__retry" onClick={() => {
                    void audioContextRef.current?.resume().catch(() => undefined);
                  }}>{language === 'DE' ? 'Pegelanzeige aktivieren' : 'Активировать проверку звука'}</button>
                </div>
              ) : null}
              {state === 'ready' && !streamRef.current?.getAudioTracks().some((track) => track.readyState !== 'ended') && (
                <p role="alert" className="prejoin__error">
                  {language === 'DE' ? 'Das Mikrofon ist nicht verfügbar. Prüfen Sie es erneut, bevor Sie beitreten.'
                    : 'Микрофон недоступен. Проверьте его перед входом в урок.'}
                </p>
              )}
              <button type="button" className="prejoin__retry"
                onClick={() => void startPreview('all', audioDeviceId, videoDeviceId)}>
                {language === 'DE' ? 'Geräte erneut prüfen' : 'Проверить устройства снова'}
              </button>
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
