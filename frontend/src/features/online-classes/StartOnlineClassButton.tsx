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
  const [showSonioxReminder, setShowSonioxReminder] = useState(false);

  if (unavailable) {
    return (
      <p className="online-class-unavailable" role="status">
        {t('onlineClass.unavailable')}
      </p>
    );
  }

  const startAfterSoniox = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const onlineClass = await onlineClassesApi.materializeFromCalendar(eventId);
      await onlineClassesApi.start(onlineClass.id);

      localStorage.setItem('mindcrafti.startedGroupLesson', eventId);
      localStorage.setItem('mindcrafti.startedGroupLessonOpenedAt', String(Date.now()));
      localStorage.removeItem(`mindcrafti.sonioxStopNotification.${eventId}`);

      setShowSonioxReminder(false);
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
      <button
        type="button"
        className="btn btn--primary"
        data-mindcrafti-lesson-id={eventId}
        onClick={() => setShowSonioxReminder(true)}
        disabled={busy}
      >
        {t('onlineClass.start')}
      </button>

      {showSonioxReminder && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(15,23,42,.55)', display: 'grid', placeItems: 'center', padding: 20 }}>
          <div className="panel" style={{ width: 'min(560px, 100%)', padding: 28, textAlign: 'center', boxShadow: '0 24px 70px rgba(15,23,42,.28)' }}>
            <div style={{ fontSize: 28, fontWeight: 900, marginBottom: 10 }}>Включи Soniox</div>
            <div style={{ fontSize: 17, lineHeight: 1.5, marginBottom: 20 }}>
              Сначала запусти запись Soniox. После этого откроется урок Mindcrafti с нашей доской.
            </div>
            <div className="stack" style={{ gap: 10 }}>
              <button
                className="btn"
                type="button"
                style={{ width: '100%', minHeight: 52, fontSize: 16 }}
                onClick={() => void startAfterSoniox()}
                disabled={busy}
              >
                {busy ? 'Открываем урок…' : 'Soniox включён — открыть урок'}
              </button>
              <button
                className="btn btn--ghost"
                type="button"
                style={{ width: '100%' }}
                onClick={() => setShowSonioxReminder(false)}
                disabled={busy}
              >
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}

      {failed && (
        <span role="alert" className="online-class-error">
          {t('error.generic')}
        </span>
      )}
    </>
  );
}
