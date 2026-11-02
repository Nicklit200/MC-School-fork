import { Link } from 'react-router-dom';
import type { OnlineClass } from '../../api/onlineClasses';
import { berlinLessonDate, entryText, lessonEntry } from './lessonEntry';

export function LessonEntryAction({ room, startsAt, language, now }: {
  room?: OnlineClass | null; startsAt: string; language: string; now: number;
}) {
  const entry = lessonEntry(room, startsAt, now);
  const scheduledDate = berlinLessonDate(startsAt);
  const date = scheduledDate ? new Date(`${scheduledDate}T12:00:00Z`).toLocaleDateString(
    language === 'DE' ? 'de-DE' : 'ru-RU', { timeZone: 'Europe/Berlin' }) : '';
  return <div className="lesson-entry" data-entry-state={entry.state}>
    <p role="status">{entryText(entry.state, language)}</p>
    {date && <small>{language === 'DE' ? 'Geplant für' : 'По расписанию'}: {date} ({language === 'DE' ? 'Berlin' : 'Берлин'})</small>}
    {entry.canJoin && room && <Link className="btn btn--secondary" to={`/online-classes/${room.id}`}>
      {language === 'DE' ? 'Mindcrafti Online - beitreten' : 'Mindcrafti Online - подключиться'}
    </Link>}
  </div>;
}
