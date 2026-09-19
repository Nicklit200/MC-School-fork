import { useState } from 'react';
import { ApiRequestError } from '../../api/client';
import { onlineClassesApi, type ClassFeatureState } from '../../api/onlineClasses';
import { useI18n } from '../../i18n/I18nContext';

/**
 * Transcription status for everyone, plus start/stop for the host.
 *
 * <p>Separate from {@link RecordingControls} because recording and transcription
 * are independent toggles with independent failure states — one can fail while
 * the other keeps running.
 */
export function TranscriptionControls({
  classId,
  isHost,
  transcriptionState,
  onChanged,
}: {
  classId: string;
  isHost: boolean;
  transcriptionState: ClassFeatureState;
  onChanged?: () => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  const active = transcriptionState === 'ACTIVE' || transcriptionState === 'STARTING';

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (active) {
        await onlineClassesApi.stopTranscription(classId);
      } else {
        await onlineClassesApi.startTranscription(classId);
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
    <div className="transcription">
      <div role="status" aria-live="polite">
        {transcriptionState === 'ACTIVE' && <span>{t('onlineClass.transcription.active')}</span>}
        {/* A provider failure is reported without implying the class is over. */}
        {transcriptionState === 'FAILED' && (
          <span role="alert">{t('onlineClass.transcription.failed')}</span>
        )}
      </div>

      {isHost &&
        (unavailable ? (
          <p className="transcription__unavailable">
            {t('onlineClass.transcription.unavailable')}
          </p>
        ) : (
          <button type="button" onClick={() => void toggle()} disabled={busy}>
            {active
              ? t('onlineClass.transcription.stop')
              : t('onlineClass.transcription.start')}
          </button>
        ))}
    </div>
  );
}
