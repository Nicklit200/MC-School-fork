import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiRequestError } from '../../api/client';
import { onlineClassesApi } from '../../api/onlineClasses';
import { useI18n } from '../../i18n/I18nContext';

/**
 * Teacher entry point on the lesson detail page.
 *
 * <p>Materializes the durable class for this calendar occurrence, starts it, and
 * opens the room. Extracted into its own component so `LessonDetailPage` gains
 * one element rather than a block of online-class logic.
 *
 * <p>Renders nothing when the feature is unavailable, so the existing Google
 * Meet action stays the only option during rollout.
 */
export function StartOnlineClassButton({ eventId }: { eventId: string }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [failed, setFailed] = useState(false);

  if (unavailable) {
    return (
      <p className="online-class-unavailable" role="status">
        {t('onlineClass.unavailable')}
      </p>
    );
  }

  const start = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const onlineClass = await onlineClassesApi.materializeFromCalendar(eventId);
      await onlineClassesApi.start(onlineClass.id);
      navigate(`/online-classes/${onlineClass.id}`);
    } catch (error) {
      // A disabled or misconfigured feature is reported precisely rather than
      // as a generic failure, and never exposes which setting is missing.
      if (error instanceof ApiRequestError && (error.status === 404 || error.status === 409)) {
        setUnavailable(true);
      } else {
        setFailed(true);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" className="btn btn--primary" onClick={() => void start()} disabled={busy}>
        {t('onlineClass.start')}
      </button>
      {failed && (
        <span role="alert" className="online-class-error">
          {t('error.generic')}
        </span>
      )}
    </>
  );
}
