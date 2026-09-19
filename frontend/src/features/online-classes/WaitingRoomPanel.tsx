import { useCallback, useEffect, useState } from 'react';
import { onlineClassesApi, type JoinRequest } from '../../api/onlineClasses';
import { useI18n } from '../../i18n/I18nContext';

/**
 * Teacher-only waiting room.
 *
 * <p>Polls rather than relying on the data channel: admission is durable state,
 * and a teacher who reloads must still see everyone waiting. The server rejects
 * the call for anyone who is not the host, so this never renders for a student.
 */
export function WaitingRoomPanel({
  classId,
  pollIntervalMs = 5000,
}: {
  classId: string;
  pollIntervalMs?: number;
}) {
  const { t } = useI18n();
  const [pending, setPending] = useState<JoinRequest[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setPending(await onlineClassesApi.listJoinRequests(classId));
    } catch {
      // A transient failure must not blank the list the teacher is acting on.
    }
  }, [classId]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), pollIntervalMs);
    return () => window.clearInterval(timer);
  }, [refresh, pollIntervalMs]);

  const decide = async (request: JoinRequest, approve: boolean) => {
    if (busyId) return;
    setBusyId(request.id);
    try {
      if (approve) {
        await onlineClassesApi.approveJoinRequest(classId, request.id);
      } else {
        await onlineClassesApi.rejectJoinRequest(classId, request.id);
      }
      // Drop it locally straight away so a second click cannot re-decide it.
      setPending((current) => current.filter((item) => item.id !== request.id));
    } catch {
      await refresh();
    } finally {
      setBusyId(null);
    }
  };

  const admitAll = async () => {
    setBusyId('all');
    try {
      await onlineClassesApi.approveAllJoinRequests(classId);
      setPending([]);
    } catch {
      await refresh();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="waiting-room" aria-labelledby="waiting-room-title">
      <h3 id="waiting-room-title">{t('onlineClass.waitingRoom')}</h3>

      {/* Arrivals are announced so a teacher mid-explanation notices them. */}
      <div role="status" aria-live="polite">
        {pending.length === 0 && <p>{t('onlineClass.waitingRoom.empty')}</p>}
      </div>

      {pending.length > 0 && (
        <>
          <button type="button" onClick={() => void admitAll()} disabled={busyId !== null}>
            {t('onlineClass.admitAll')}
          </button>
          <ul>
            {pending.map((request) => (
              <li key={request.id}>
                <span>{request.displayName}</span>
                <button
                  type="button"
                  onClick={() => void decide(request, true)}
                  disabled={busyId !== null}
                  aria-label={`${t('onlineClass.admit')} ${request.displayName}`}
                >
                  {t('onlineClass.admit')}
                </button>
                <button
                  type="button"
                  onClick={() => void decide(request, false)}
                  disabled={busyId !== null}
                  aria-label={`${t('onlineClass.rejectEntry')} ${request.displayName}`}
                >
                  {t('onlineClass.rejectEntry')}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
