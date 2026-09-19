import { useCallback, useEffect, useState } from 'react';
import { ApiRequestError } from '../../api/client';
import { onlineClassesApi, type ClassFeatureState } from '../../api/onlineClasses';
import { useI18n } from '../../i18n/I18nContext';

/**
 * Recording status for everyone, plus start/stop for the host.
 *
 * <p>The notice is shown to every participant whenever recording is active — not
 * only to whoever started it — and a participant who joins an already-recording
 * class must acknowledge it.
 */
export function RecordingControls({
  classId,
  isHost,
  recordingState,
  onChanged,
}: {
  classId: string;
  isHost: boolean;
  recordingState: ClassFeatureState;
  onChanged?: () => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  const active = recordingState === 'ACTIVE' || recordingState === 'STARTING';

  // Acknowledgment is recorded once per active recording, including for someone
  // who joined after it had already started.
  useEffect(() => {
    if (!active) setAcknowledged(false);
  }, [active]);

  const acknowledge = useCallback(() => {
    setAcknowledged(true);
    void onlineClassesApi.acknowledgeRecording(classId).catch(() => undefined);
  }, [classId]);

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (active) {
        await onlineClassesApi.stopRecording(classId);
      } else {
        await onlineClassesApi.startRecording(classId);
      }
      onChanged?.();
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 409) {
        setUnavailable(true);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="recording">
      {/* Status is announced, not merely coloured, and is visible to everyone. */}
      <div role="status" aria-live="polite">
        {recordingState === 'STARTING' && <span>{t('onlineClass.recording.starting')}</span>}
        {recordingState === 'ACTIVE' && (
          <span className="recording__active">● {t('onlineClass.recording.active')}</span>
        )}
        {recordingState === 'STOPPING' && <span>{t('onlineClass.recording.processing')}</span>}
        {recordingState === 'FAILED' && (
          <span role="alert">{t('onlineClass.recording.failed')}</span>
        )}
      </div>

      {active && !acknowledged && (
        <div className="recording__notice" role="alertdialog" aria-labelledby="recording-notice">
          <p id="recording-notice">{t('onlineClass.recording.notice')}</p>
          <button type="button" onClick={acknowledge}>
            {t('onlineClass.recording.acknowledge')}
          </button>
        </div>
      )}

      {isHost &&
        (unavailable ? (
          <p className="recording__unavailable">{t('onlineClass.recording.unavailable')}</p>
        ) : (
          <button type="button" onClick={() => void toggle()} disabled={busy}>
            {active ? t('onlineClass.recording.stop') : t('onlineClass.recording.start')}
          </button>
        ))}
    </div>
  );
}
