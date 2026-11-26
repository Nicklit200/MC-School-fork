import { useEffect, useMemo, useState } from 'react';
import { parentApi } from '../../api/parent';
import type { ParentChildStatus, ParentHomeworkStatus } from '../../api/types';
import { HomeworkHistoryCalendar } from '../../components/HomeworkHistoryCalendar';
import { useI18n } from '../../i18n/I18nContext';
import { getSchoolDateString, homeworkHistoryText, resolveHomeworkHistoryStatus, type HomeworkHistoryStatus } from '../../lib/homeworkHistory';
import './parent-dashboard.css';

export function ParentPage() {
  const { language } = useI18n();
  const de = language === 'DE';
  const [children, setChildren] = useState<ParentChildStatus[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    parentApi.children()
      .then((items) => { if (active) setChildren(items); })
      .catch((e) => { if (active) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const child = children.find((item) => item.studentId === selectedId) ?? children[0];
  const today = getSchoolDateString();
  const homeworks = useMemo(() => [...(child?.homeworks ?? [])]
    .sort((a, b) => b.startDate.localeCompare(a.startDate))
    .map(homework => ({ ...homework, id: homework.homeworkId })), [child]);

  return (
    <div className="stack parent-dashboard">
      <header className="parent-dashboard__heading">
        <div>
          <h1>{de ? 'Hausaufgaben' : 'Домашние задания'}</h1>
          <p className="muted">{de ? 'Aufgaben und Lernfortschritt Ihres Kindes im Blick.' : 'Задания ребёнка и результаты выполнения.'}</p>
        </div>
        <span className="parent-dashboard__date">{formatDate(today, language)}</span>
      </header>

      {error && <div className="banner banner--error" role="alert">{error}</div>}
      {loading ? <p className="muted" role="status">{de ? 'Laden…' : 'Загрузка…'}</p> : !error && !child ? (
        <div className="panel parent-dashboard__empty">{de ? 'Diesem Konto ist noch kein Kind zugeordnet.' : 'Ребёнок пока не привязан к этому аккаунту.'}</div>
      ) : child ? <>
        {children.length > 1 && (
          <label className="parent-dashboard__child-picker">
            <span className="muted">{de ? 'Kind auswählen' : 'Выберите ребёнка'}</span>
            <select className="input" value={child.studentId} onChange={(event) => setSelectedId(event.target.value)}>
              {children.map((item) => <option key={item.studentId} value={item.studentId}>{item.studentName}</option>)}
            </select>
          </label>
        )}

        <section className="parent-dashboard__history" aria-labelledby="parent-homework-history">
          <div className="parent-dashboard__section-heading">
            <h2 id="parent-homework-history">{de ? 'Hausaufgaben-Verlauf' : 'История домашки'}</h2>
            <span className="muted">{homeworks.length}</span>
          </div>
          {homeworks.length === 0 && <p className="muted">{de ? 'Noch keine Hausaufgaben.' : 'Домашних заданий пока нет.'}</p>}
          <HomeworkHistoryCalendar compactDays key={child.studentId} homeworks={homeworks} language={language}
            getStatus={parentHomeworkStatus} renderHomework={(homework, now) => {
                const status = parentHomeworkStatus(homework, now);
                return <div className="list-row parent-dashboard__homework" key={homework.homeworkId}>
                  <span className="parent-dashboard__file-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3H5v18h14V8Z M14 3v5h5 M8 12h8 M8 16h5" /></svg>
                  </span>
                  <div className="parent-dashboard__homework-body">
                    <div className="list-row__title">{formatDate(homework.startDate, language)}</div>
                    <div className="parent-dashboard__homework-title">{homeworkTitle(homework, language)}</div>
                    <div className="muted">
                      {homework.hasWorksheet && (homework.submittedAt
                        ? `${de ? 'Abgegeben' : 'Сдано'}: ${formatDateTime(homework.submittedAt, language)}`
                        : `${de ? 'Abgabe bis' : 'Срок сдачи'}: ${formatDateTime(homework.deadlineAt, language)}`)}
                      {homework.hasWorksheet && homework.totalCards > 0 && ' · '}
                      {homework.totalCards > 0 && `${de ? 'Karten gelernt' : 'Карточек изучено'}: ${homework.learnedCards}/${homework.totalCards}`}
                    </div>
                  </div>
                  <span className="pill parent-dashboard__homework-status" data-status={status}>{homeworkHistoryText(status, language)}</span>
                </div>;
              }} />
        </section>

      </> : null}
    </div>
  );
}

function homeworkTitle(homework: ParentHomeworkStatus, language: 'RU' | 'DE') {
  if (!homework.hasWorksheet) return language === 'DE' ? 'Lernkarten' : 'Карточки';
  const title = homework.filename?.replace(/\.pdf$/i, '').trim();
  // Generated filenames contain internal IDs and dates, not a useful task title.
  if (title && title.length <= 80 && !/[a-f\d]{8}-[a-f\d-]{27,}|\d{4}[-_]\d{2}[-_]\d{2}|^(mindcrafti|student|homework|worksheet)[_-]/i.test(title)) return title.replace(/_/g, ' ');
  return language === 'DE' ? 'Arbeitsblatt' : 'Рабочий лист';
}

function parentHomeworkStatus(homework: ParentHomeworkStatus, now: Date): HomeworkHistoryStatus {
  if (homework.hasWorksheet) return resolveHomeworkHistoryStatus(homework, now);
  // Card mastery has no submission timestamp and is not subject to the PDF deadline.
  if (homework.totalCards > 0 && homework.learnedCards >= homework.totalCards) return 'CARDS_DONE';
  return homework.startDate > getSchoolDateString(now) ? 'UPCOMING' : 'CARDS_OPEN';
}

function formatDate(date: string, language: 'RU' | 'DE') {
  return new Intl.DateTimeFormat(language === 'DE' ? 'de-DE' : 'ru-RU', {
    day: 'numeric', month: 'long', year: 'numeric',
  }).format(new Date(`${date}T00:00:00`));
}

function formatDateTime(value: string, language: 'RU' | 'DE') {
  return new Intl.DateTimeFormat(language === 'DE' ? 'de-DE' : 'ru-RU', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin',
  }).format(new Date(value));
}
