import { useEffect, useState } from 'react';
import {
  onlineClassesApi,
  type ClassParticipant,
  type OnlineClass,
  type Recording,
} from '../../api/onlineClasses';
import { useI18n } from '../../i18n/I18nContext';

/**
 * Post-class artifacts for a lesson: attendance, recordings and transcript.
 *
 * <p>Read-only and non-creating — opening a lesson page must never bring a class
 * into existence as a side effect, so this uses the by-event lookup rather than
 * materialize.
 *
 * <p>Renders nothing when no class was ever held, so a teacher who has not used
 * online classes sees no change to the page.
 */
export function LessonClassArtifacts({ eventId }: { eventId: string }) {
  const { t, language } = useI18n();
  const [classes, setClasses] = useState<OnlineClass[] | null>(null);
  const [attendance, setAttendance] = useState<ClassParticipant[]>([]);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [hasTranscript, setHasTranscript] = useState(false);

  useEffect(() => {
    let active = true;
    onlineClassesApi
      .findByEvent(eventId)
      .then(async (found) => {
        if (!active) return;
        setClasses(found);
        const latest = found[0];
        if (!latest) return;

        // Each artifact is fetched independently: one missing or unconfigured
        // integration must not blank the others.
        const [attendanceResult, recordingsResult, transcriptResult] = await Promise.allSettled([
          onlineClassesApi.attendance(latest.id),
          onlineClassesApi.listRecordings(latest.id),
          onlineClassesApi.transcript(latest.id),
        ]);
        if (!active) return;
        if (attendanceResult.status === 'fulfilled') setAttendance(attendanceResult.value);
        if (recordingsResult.status === 'fulfilled') setRecordings(recordingsResult.value);
        if (transcriptResult.status === 'fulfilled') {
          setHasTranscript(transcriptResult.value.length > 0);
        }
      })
      .catch(() => {
        // Feature disabled, or nothing held: render nothing rather than an error.
        if (active) setClasses([]);
      });
    return () => {
      active = false;
    };
  }, [eventId]);

  if (!classes || classes.length === 0) return null;

  const latest = classes[0];
  const locale = language === 'DE' ? 'de-DE' : 'ru-RU';
  const minutes = (seconds: number) => Math.round(seconds / 60);
  const apiBase = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080/api/v1';

  return (
    <section className="lesson-class-artifacts" aria-labelledby="lesson-class-artifacts-title">
      <h3 id="lesson-class-artifacts-title">{t('onlineClass.artifacts.title')}</h3>
      <p>{new Date(latest.scheduledStartAt).toLocaleString(locale)}</p>

      {attendance.length > 0 && (
        <>
          <h4>{t('onlineClass.artifacts.attendance')}</h4>
          <ul>
            {attendance.map((participant) => (
              <li key={participant.userId}>
                {participant.displayName} — {minutes(participant.totalConnectedSeconds)}{' '}
                {t('onlineClass.artifacts.minutes')}
              </li>
            ))}
          </ul>
        </>
      )}

      {recordings.length > 0 && (
        <>
          <h4>{t('onlineClass.artifacts.recordings')}</h4>
          <ul>
            {recordings.map((recording) => (
              <li key={recording.id}>
                {recording.status === 'READY' && recording.downloadUrl ? (
                  // Signed and short-lived: opened, never stored.
                  <a href={recording.downloadUrl} target="_blank" rel="noreferrer">
                    {t('onlineClass.recording.download')}
                  </a>
                ) : (
                  <span>
                    {recording.status === 'FAILED'
                      ? t('onlineClass.recording.failed')
                      : t('onlineClass.artifacts.processing')}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {hasTranscript && (
        <>
          <h4>{t('onlineClass.artifacts.transcript')}</h4>
          <a href={`${apiBase}/online-classes/${latest.id}/transcript.txt`}>
            {t('onlineClass.transcript.downloadTxt')}
          </a>{' '}
          <a href={`${apiBase}/online-classes/${latest.id}/transcript.vtt`}>
            {t('onlineClass.transcript.downloadVtt')}
          </a>
        </>
      )}
    </section>
  );
}
