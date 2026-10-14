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
  const [failureKind, setFailureKind] = useState<'generic' | 'credentials' | 'unreachable'>('generic');

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
    setFailureKind('generic');
    let classId: string | null = null;
    try {
      const onlineClass = await onlineClassesApi.materializeFromCalendar(eventId);
      classId = onlineClass.id;
      await onlineClassesApi.start(onlineClass.id);
      navigate(`/online-classes/${onlineClass.id}`);
    } catch (error) {
      // A disabled or misconfigured feature is reported precisely rather than
      // as a generic failure, and never exposes which setting is missing.
      if (error instanceof ApiRequestError && error.status === 404) {
        setUnavailable(true);
      } else {
        // Room-start conflicts often wrap a rejected LiveKit RoomService API
        // request. Query a host-only endpoint for an operator-safe diagnosis
        // rather than displaying the provider response or any secret.
        if (error instanceof ApiRequestError && error.status === 409 && classId) {
          try {
            const diagnosis = await onlineClassesApi.mediaDiagnostics(classId);
            if (diagnosis.diagnosticStatus === 'AUTH_REJECTED') {
              setFailureKind('credentials');
            } else if (diagnosis.diagnosticStatus === 'UNREACHABLE') {
              setFailureKind('unreachable');
            }
          } catch {
            // Older backend or temporary API failure: keep a generic message.
          }
        }
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
          {failureKind === 'credentials'
            ? t('onlineClass.startFailedCredentials')
            : failureKind === 'unreachable'
              ? t('onlineClass.startFailedNetwork')
              : t('onlineClass.startFailed')}
        </span>
      )}
    </>
  );
}
