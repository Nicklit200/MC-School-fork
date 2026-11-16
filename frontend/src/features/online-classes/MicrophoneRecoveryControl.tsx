import { useConnectionState, useRoomContext } from '@livekit/components-react';
import { ConnectionState, Track } from 'livekit-client';
import { useState } from 'react';
import { useI18n } from '../../i18n/I18nContext';

/**
 * A student-triggered mic recovery, without leaving the lesson or replacing
 * the board connection. Never automatically unmute a student.
 */
export function MicrophoneRecoveryControl() {
  const { language } = useI18n();
  const room = useRoomContext();
  const connectionState = useConnectionState();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<'ready' | 'failed' | null>(null);

  const restore = async () => {
    if (busy || connectionState !== ConnectionState.Connected) return;
    setBusy(true);
    setResult(null);
    try {
      const participant = room.localParticipant;
      const previous = participant.getTrackPublication(Track.Source.Microphone);
      if (previous?.track) {
        try {
          // A stale capture can remain "unmuted" even when Safari/Android
          // no longer supplies samples. Reacquire the underlying device.
          await previous.track.restartTrack();
          if (previous.isMuted) await previous.unmute();
        } catch {
          // Recover with the browser's default microphone when the previous
          // device has disappeared or become unavailable.
          await participant.unpublishTrack(previous.track);
          await participant.setMicrophoneEnabled(true);
        }
      } else {
        await participant.setMicrophoneEnabled(true);
      }

      const current = participant.getTrackPublication(Track.Source.Microphone);
      if (!current?.track || current.isMuted || current.track.mediaStreamTrack.readyState !== 'live') {
        throw new Error('Microphone track could not be republished');
      }
      setResult('ready');
    } catch {
      setResult('failed');
    } finally {
      setBusy(false);
    }
  };

  return <div className="online-class-room__mic-recovery">
    <button type="button" disabled={busy || connectionState !== ConnectionState.Connected}
      onClick={() => void restore()}>
      {busy ? (language === 'DE' ? 'Mikrofon wird geprüft…' : 'Проверяем микрофон…')
        : (language === 'DE' ? 'Mikrofon neu verbinden' : 'Восстановить микрофон')}
    </button>
    {result === 'ready' && <span role="status">
      {language === 'DE' ? 'Mikrofonspur verbunden. Prüfen Sie den Ton mit der Lehrkraft.'
        : 'Микрофон подключён. Проверьте звук с преподавателем.'}
    </span>}
    {result === 'failed' && <span role="alert">
      {language === 'DE' ? 'Mikrofon konnte nicht verbunden werden. Prüfen Sie die Browser-Berechtigung und wählen Sie ein Mikrofon.'
        : 'Микрофон не подключился. Проверьте разрешение браузера и выбор устройства.'}
    </span>}
  </div>;
}
