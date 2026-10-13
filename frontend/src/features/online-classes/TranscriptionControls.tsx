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
  available = true,
  onChanged,
}: {
  classId: string;
  isHost: boolean;
  transcriptionState: ClassFeatureState;
  /** False when the server cannot do it at all: the button is then not offered. */
  available?: boolean;
  onChanged?: () => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [errored, setErrored] = useState(false);

  const active = transcriptionState === 'ACTIVE' || transcriptionState === 'STARTING';

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    setErrored(false);
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
      } else {
        // Never fail silently: a click with no visible result looks broken.
        setErrored(true);
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

      {errored && (
        <p role="alert" className="transcription__unavailable">
          {t('onlineClass.transcription.failed')}
        </p>
      )}

      {isHost &&
        (available || active) &&
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
