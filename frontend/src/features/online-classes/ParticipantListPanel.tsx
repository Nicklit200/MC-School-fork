import { useCallback, useEffect, useState } from 'react';
import { onlineClassesApi, type ClassParticipant } from '../../api/onlineClasses';
import { useI18n } from '../../i18n/I18nContext';

/**
 * Roster with host-only moderation.
 *
 * <p>Students see the list — names, roles, mic/camera and connection state — but
 * never the moderation controls. The server enforces this independently; hiding
 * the buttons is presentation, not security.
 */
export function ParticipantListPanel({
  classId,
  isHost,
  raisedHands,
  pollIntervalMs = 5000,
}: {
  classId: string;
  isHost: boolean;
  raisedHands?: ReadonlySet<string>;
  pollIntervalMs?: number;
}) {
  const { t } = useI18n();
  const [participants, setParticipants] = useState<ClassParticipant[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setParticipants(await onlineClassesApi.listParticipants(classId));
    } catch {
      // Keep the last good roster rather than blanking it.
    }
  }, [classId]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), pollIntervalMs);
    return () => window.clearInterval(timer);
  }, [refresh, pollIntervalMs]);

  const act = async (userId: string, action: () => Promise<unknown>) => {
    if (busyId) return;
    setBusyId(userId);
    try {
      await action();
    } finally {
      setBusyId(null);
      await refresh();
    }
  };

  return (
    <section className="participants" aria-labelledby="participants-title">
      <h3 id="participants-title">{t('onlineClass.participants')}</h3>

      {isHost && (
        <button
          type="button"
          onClick={() => void act('all', () => onlineClassesApi.muteAllStudents(classId))}
          disabled={busyId !== null}
        >
          {t('onlineClass.muteAll')}
        </button>
      )}

      <ul>
        {participants
          .filter((participant) => participant.admissionState !== 'REMOVED')
          .map((participant) => (
            <li key={participant.userId}>
              <span className="participants__name">{participant.displayName}</span>
              <span className="participants__role">
                {participant.classRole === 'HOST'
                  ? t('onlineClass.role.host')
                  : t('onlineClass.role.student')}
              </span>

              {raisedHands?.has(participant.userId) && (
                <span role="img" aria-label={t('onlineClass.handRaised')}>
                  ✋
                </span>
              )}
              {!participant.microphoneEnabled && (
                <span aria-label={t('onlineClass.mute')} title={t('onlineClass.mute')}>
                  🔇
                </span>
              )}
              {!participant.connected && <span className="participants__offline">•</span>}

              {isHost && participant.classRole !== 'HOST' && (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      void act(participant.userId, () =>
                        onlineClassesApi.muteParticipant(classId, participant.userId),
                      )
                    }
                    disabled={busyId !== null}
                    aria-label={`${t('onlineClass.mute')} ${participant.displayName}`}
                  >
                    {t('onlineClass.mute')}
                  </button>

                  {/* A request, not a command: browsers need local consent. */}
                  <button
                    type="button"
                    onClick={() =>
                      void act(participant.userId, () =>
                        onlineClassesApi.requestUnmute(classId, participant.userId),
                      )
                    }
                    disabled={busyId !== null}
                    aria-label={`${t('onlineClass.askUnmute')} ${participant.displayName}`}
                  >
                    {t('onlineClass.askUnmute')}
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      void act(participant.userId, () =>
                        onlineClassesApi.removeParticipant(classId, participant.userId),
                      )
                    }
                    disabled={busyId !== null}
                    aria-label={`${t('onlineClass.removeParticipant')} ${participant.displayName}`}
                  >
                    {t('onlineClass.removeParticipant')}
                  </button>
                </>
              )}
            </li>
          ))}
      </ul>
    </section>
  );
}
