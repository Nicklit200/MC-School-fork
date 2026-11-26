import { Fragment, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  getSchoolDateString,
  homeworkHistoryText,
  resolveHomeworkHistoryStatus,
  type HomeworkHistoryRecord,
  type HomeworkHistoryStatus,
} from '../lib/homeworkHistory';
import {
  calendarLessonStatusText,
  formatCalendarLessonTime,
  resolveCalendarLessonStatus,
  type StudentCalendarLesson,
} from '../lib/studentCalendar';
import '../styles/homework-history-calendar.css';

type CalendarHomework = HomeworkHistoryRecord & { id: string };

type Props<T extends CalendarHomework> = {
  homeworks: T[];
  language: 'DE' | 'RU';
  renderHomework: (homework: T, now: Date) => ReactNode;
  getStatus?: (homework: T, now: Date) => HomeworkHistoryStatus;
  onSelectionChange?: () => void;
  lessons?: StudentCalendarLesson[];
  lessonsLoading?: boolean;
  lessonsError?: string | null;
};

type StatusCounts = Partial<Record<HomeworkHistoryStatus, number>>;
type LessonStatus = ReturnType<typeof resolveCalendarLessonStatus>;
const lessonStatusOrder: LessonStatus[] = ['COMPLETED', 'UPCOMING', 'LIVE', 'PAST', 'CANCELLED'];
const lessonSymbols: Record<LessonStatus, string> = { COMPLETED: '✓', UPCOMING: '◷', LIVE: '●', PAST: '?', CANCELLED: '×' };
const statusOrder: HomeworkHistoryStatus[] = ['MISSED', 'LATE', 'TODAY', 'CARDS_OPEN', 'UPCOMING', 'DONE', 'CARDS_DONE'];
const summaryStatuses: HomeworkHistoryStatus[] = ['DONE', 'MISSED', 'LATE'];
const symbols: Record<HomeworkHistoryStatus, string> = {
  DONE: '✓', MISSED: '!', LATE: '◷', TODAY: '○', UPCOMING: '·',
  CARDS_DONE: '✓', CARDS_OPEN: '○',
};
const dateFromKey = (key: string) => new Date(`${key}T00:00:00.000Z`);
const dateKey = (date: Date) => date.toISOString().slice(0, 10);
const monthKey = (key: string) => `${key.slice(0, 7)}-01`;

export function HomeworkHistoryCalendar<T extends CalendarHomework>({ homeworks, language, renderHomework, getStatus = resolveHomeworkHistoryStatus, onSelectionChange, lessons, lessonsLoading = false, lessonsError = null }: Props<T>) {
  const [now, setNow] = useState(() => new Date());
  const today = getSchoolDateString(now);
  const [month, setMonth] = useState(() => monthKey(today));
  const [selectedDay, setSelectedDay] = useState(today);
  const titleId = useId();
  const detailsId = useId();
  const locale = language === 'DE' ? 'de-DE' : 'ru-RU';
  const showLessons = lessons !== undefined || lessonsLoading || Boolean(lessonsError);
  const text = language === 'DE'
    ? { calendar: showLessons ? 'Unterricht und Hausaufgaben' : 'Hausaufgaben-Kalender', previous: 'Vorheriger Monat', next: 'Nächster Monat', today: 'Heute', empty: showLessons ? 'Kein Unterricht und keine Hausaufgaben an diesem Tag.' : 'Keine Hausaufgaben an diesem Tag.', emptyHomework: 'Keine Hausaufgaben an diesem Tag.', details: showLessons ? 'Tagesübersicht am' : 'Hausaufgaben am', totals: 'Abgaben in diesem Monat', none: showLessons ? 'Kein Unterricht und keine Hausaufgaben' : 'Keine Hausaufgaben', lessons: 'Unterricht', homework: 'Hausaufgaben', lesson: 'Unterricht', lessonTotals: 'Unterricht in diesem Monat', loading: 'Unterricht wird geladen…', live: 'Live' }
    : { calendar: showLessons ? 'Уроки и домашка' : 'Календарь домашки', previous: 'Предыдущий месяц', next: 'Следующий месяц', today: 'Сегодня', empty: showLessons ? 'На этот день уроков и домашнего задания нет.' : 'На этот день домашнего задания нет.', emptyHomework: 'На этот день домашнего задания нет.', details: showLessons ? 'План на' : 'Задания на', totals: 'Сдача домашки за месяц', none: showLessons ? 'Нет уроков и домашних заданий' : 'Нет домашних заданий', lessons: 'Уроки', homework: 'Домашнее задание', lesson: 'Урок', lessonTotals: 'Уроки за месяц', loading: 'Загружаем уроки…', live: 'Идёт' };

  useEffect(() => {
    const refresh = () => setNow(new Date());
    const interval = window.setInterval(refresh, 60_000);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  const { byDay, countsByDay } = useMemo(() => {
    const byDay = new Map<string, T[]>();
    const countsByDay = new Map<string, StatusCounts>();
    for (const homework of homeworks) {
      const key = homework.startDate.slice(0, 10);
      const bucket = byDay.get(key) ?? [];
      bucket.push(homework);
      byDay.set(key, bucket);
      const counts = countsByDay.get(key) ?? {};
      const status = getStatus(homework, now);
      counts[status] = (counts[status] ?? 0) + 1;
      countsByDay.set(key, counts);
    }
    return { byDay, countsByDay };
  }, [homeworks, now, getStatus]);

  const lessonsByDay = useMemo(() => {
    const map = new Map<string, StudentCalendarLesson[]>();
    for (const lesson of lessons ?? []) {
      const start = new Date(lesson.startsAt);
      if (!Number.isFinite(start.getTime())) continue;
      const key = getSchoolDateString(start);
      const bucket = map.get(key) ?? [];
      bucket.push(lesson);
      map.set(key, bucket);
    }
    for (const bucket of map.values()) bucket.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
    return map;
  }, [lessons]);

  const days = useMemo(() => {
    const first = dateFromKey(month);
    const offset = (first.getUTCDay() + 6) % 7;
    const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
    const count = Math.ceil((offset + last.getUTCDate()) / 7) * 7;
    return Array.from({ length: count }, (_, index) => {
      const date = new Date(first);
      date.setUTCDate(1 - offset + index);
      return date;
    });
  }, [month]);

  const monthCounts: StatusCounts = {};
  for (const [key, counts] of countsByDay) {
    if (!key.startsWith(month.slice(0, 7))) continue;
    for (const status of statusOrder) monthCounts[status] = (monthCounts[status] ?? 0) + (counts[status] ?? 0);
  }
  const monthLessonCounts: Partial<Record<LessonStatus, number>> = {};
  for (const [key, dayLessons] of lessonsByDay) {
    if (!key.startsWith(month.slice(0, 7))) continue;
    for (const lesson of dayLessons) {
      const status = resolveCalendarLessonStatus(lesson, now);
      monthLessonCounts[status] = (monthLessonCounts[status] ?? 0) + 1;
    }
  }
  const monthTitle = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(dateFromKey(month));
  const fullDate = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const accessibleDate = new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
  const selectedHomeworks = byDay.get(selectedDay) ?? [];
  const selectedLessons = lessonsByDay.get(selectedDay) ?? [];
  const legendStatuses: HomeworkHistoryStatus[] = ['TODAY', 'UPCOMING'];
  for (const status of ['CARDS_DONE', 'CARDS_OPEN'] as const) {
    if (monthCounts[status]) legendStatuses.push(status);
  }

  function selectDay(key: string) {
    setSelectedDay(key);
    setMonth(monthKey(key));
    onSelectionChange?.();
  }

  function changeMonth(offset: number) {
    const next = dateFromKey(month);
    next.setUTCMonth(next.getUTCMonth() + offset);
    const key = dateKey(next);
    selectDay(key.slice(0, 7) === today.slice(0, 7) ? today : key);
  }

  return (
    <section className="panel homework-calendar" aria-label={text.calendar}>
      <div className="homework-calendar__toolbar">
        <h3 id={titleId} className="homework-calendar__title" aria-live="polite">{monthTitle}</h3>
        <div className="homework-calendar__navigation">
          <button type="button" className="homework-calendar__today" onClick={() => selectDay(today)}>{text.today}</button>
          <button type="button" aria-label={text.previous} onClick={() => changeMonth(-1)}><span aria-hidden="true">‹</span></button>
          <button type="button" aria-label={text.next} onClick={() => changeMonth(1)}><span aria-hidden="true">›</span></button>
        </div>
      </div>

      <div className="homework-calendar__summary" aria-label={text.totals}>
        {summaryStatuses.map(status => (
          <div key={status} className="homework-calendar__summary-item" data-status={status}>
            <span className="homework-calendar__symbol" aria-hidden="true">{symbols[status]}</span>
            <span>{homeworkHistoryText(status, language)}</span>
            <strong>{monthCounts[status] ?? 0}</strong>
          </div>
        ))}
      </div>

      <div className="homework-calendar__pending-legend">
        {legendStatuses.map(status => (
          <span key={status} data-status={status}>
            <span className="homework-calendar__dot" aria-hidden="true" />
            {homeworkHistoryText(status, language)}
          </span>
        ))}
      </div>

      {showLessons && <div className="homework-calendar__lesson-legend" aria-label={text.lessonTotals}>
        <strong>{text.lessons}</strong>
        {lessonStatusOrder.filter(status => status === 'COMPLETED' || status === 'UPCOMING' || monthLessonCounts[status]).map(status => (
          <span key={status}>
            <span className="homework-calendar__lesson-swatch" data-lesson-status={status} aria-hidden="true" />
            {calendarLessonStatusText(status, language)}{!lessonsLoading && !lessonsError && `: ${monthLessonCounts[status] ?? 0}`}
          </span>
        ))}
      </div>}
      {lessonsLoading && <p className="homework-calendar__notice" role="status">{text.loading}</p>}
      {lessonsError && <p className="homework-calendar__notice homework-calendar__notice--error" role="alert">{lessonsError}</p>}

      <div className="homework-calendar__weekdays" aria-hidden="true">
        {Array.from({ length: 7 }, (_, index) => <span key={index}>{weekday.format(new Date(Date.UTC(2024, 0, 1 + index)))}</span>)}
      </div>
      <div className="homework-calendar__grid" role="group" aria-labelledby={titleId}>
        {days.map(date => {
          const key = dateKey(date);
          const counts = countsByDay.get(key) ?? {};
          const present = statusOrder.filter(status => counts[status]);
          const dayLessons = lessonsByDay.get(key) ?? [];
          const hasCompletedLesson = dayLessons.some(lesson => resolveCalendarLessonStatus(lesson, now) === 'COMPLETED');
          const outside = !key.startsWith(month.slice(0, 7));
          const labels = present.map(status => `${homeworkHistoryText(status, language)}: ${counts[status]}`);
          labels.push(...dayLessons.map(lesson => `${text.lesson} ${formatCalendarLessonTime(lesson.startsAt, language)} - ${formatCalendarLessonTime(lesson.endsAt, language)}, ${calendarLessonStatusText(resolveCalendarLessonStatus(lesson, now), language)}`));
          const emptyLabel = lessonsLoading || lessonsError ? text.emptyHomework : text.none;
          const label = [accessibleDate.format(date), key === today ? text.today : '', labels.length ? labels.join(', ') : emptyLabel].filter(Boolean).join(', ');
          return (
            <button key={key} type="button" className="homework-calendar__day"
              data-status={present[0] ?? 'EMPTY'} data-outside={outside || undefined}
              data-completed-lesson={hasCompletedLesson || undefined}
              aria-label={label} aria-pressed={selectedDay === key}
              aria-current={key === today ? 'date' : undefined} aria-controls={detailsId}
              onClick={() => selectDay(key)}>
              <span className="homework-calendar__day-number">{date.getUTCDate()}</span>
              {dayLessons.length > 0 && <span className="homework-calendar__lesson-tiles" aria-hidden="true">
                {dayLessons.map(lesson => {
                  const status = resolveCalendarLessonStatus(lesson, now);
                  return <span key={lesson.key} className="homework-calendar__lesson-tile" data-lesson-status={status}>
                    <span className="homework-calendar__lesson-symbol">{status === 'LIVE' ? text.live : lessonSymbols[status]}</span>
                    <time dateTime={lesson.startsAt}>{formatCalendarLessonTime(lesson.startsAt, language)}</time>
                  </span>;
                })}
              </span>}
              <span className="homework-calendar__marks" aria-hidden="true">
                {present.map(status => (
                  <span key={status} className="homework-calendar__mark" data-status={status}>
                    <span className="homework-calendar__symbol">{symbols[status]}</span>
                    <span className="homework-calendar__status-text">{homeworkHistoryText(status, language)}</span>
                    <strong className="homework-calendar__count">{counts[status]}</strong>
                  </span>
                ))}
              </span>
            </button>
          );
        })}
      </div>

      <section className="homework-calendar__details" id={detailsId} aria-label={`${text.details} ${fullDate.format(dateFromKey(selectedDay))}`}>
        <h4 className="homework-calendar__details-title" aria-live="polite">{text.details} {fullDate.format(dateFromKey(selectedDay))}</h4>
        {selectedLessons.length > 0 && <div className="homework-calendar__lesson-details">
          <h5 className="homework-calendar__section-title">{text.lessons}</h5>
          {selectedLessons.map(lesson => {
            const status = resolveCalendarLessonStatus(lesson, now);
            return <Link key={lesson.key} to={lesson.href} className="homework-calendar__lesson-card" data-lesson-status={status}>
              <span className="homework-calendar__lesson-tile" data-lesson-status={status} aria-hidden="true">
                <span className="homework-calendar__lesson-symbol">{status === 'LIVE' ? text.live : lessonSymbols[status]}</span>
                <time dateTime={lesson.startsAt}>{formatCalendarLessonTime(lesson.startsAt, language)}</time>
              </span>
              <span className="homework-calendar__lesson-content">
                <strong>{lesson.title || text.lesson}</strong>
                <span>{formatCalendarLessonTime(lesson.startsAt, language)} - {formatCalendarLessonTime(lesson.endsAt, language)} · {[lesson.groupName, lesson.sourceTeacherName].filter(Boolean).join(' · ') || text.lesson}</span>
              </span>
              <span className="homework-calendar__lesson-state">{calendarLessonStatusText(status, language)}</span>
            </Link>;
          })}
        </div>}
        {selectedHomeworks.length ? (
          <div className="history-list">
            {showLessons && <h5 className="homework-calendar__section-title">{text.homework}</h5>}
            {selectedHomeworks.map(homework => <Fragment key={homework.id}>{renderHomework(homework, now)}</Fragment>)}
          </div>
        ) : <p className="homework-calendar__empty">{selectedLessons.length || lessonsLoading || lessonsError ? text.emptyHomework : text.empty}</p>}
      </section>
    </section>
  );
}
