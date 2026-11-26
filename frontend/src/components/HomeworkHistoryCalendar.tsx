import { Fragment, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import type { Homework } from '../api/types';
import {
  getSchoolDateString,
  homeworkHistoryText,
  resolveHomeworkHistoryStatus,
  type HomeworkHistoryStatus,
} from '../lib/homeworkHistory';
import '../styles/homework-history-calendar.css';

type Props = {
  homeworks: Homework[];
  language: 'DE' | 'RU';
  renderHomework: (homework: Homework) => ReactNode;
  onSelectionChange?: () => void;
};

type StatusCounts = Partial<Record<HomeworkHistoryStatus, number>>;
const statusOrder: HomeworkHistoryStatus[] = ['MISSED', 'LATE', 'TODAY', 'UPCOMING', 'DONE'];
const summaryStatuses: HomeworkHistoryStatus[] = ['DONE', 'MISSED', 'LATE'];
const symbols: Record<HomeworkHistoryStatus, string> = {
  DONE: '✓', MISSED: '!', LATE: '◷', TODAY: '○', UPCOMING: '·',
};
const dateFromKey = (key: string) => new Date(`${key}T00:00:00.000Z`);
const dateKey = (date: Date) => date.toISOString().slice(0, 10);
const monthKey = (key: string) => `${key.slice(0, 7)}-01`;

export function HomeworkHistoryCalendar({ homeworks, language, renderHomework, onSelectionChange }: Props) {
  const [now, setNow] = useState(() => new Date());
  const today = getSchoolDateString(now);
  const [month, setMonth] = useState(() => monthKey(today));
  const [selectedDay, setSelectedDay] = useState(today);
  const titleId = useId();
  const detailsId = useId();
  const locale = language === 'DE' ? 'de-DE' : 'ru-RU';
  const text = language === 'DE'
    ? { calendar: 'Hausaufgaben-Kalender', previous: 'Vorheriger Monat', next: 'Nächster Monat', today: 'Heute', empty: 'Keine Hausaufgaben an diesem Tag.', details: 'Hausaufgaben am', totals: 'Abgaben in diesem Monat', none: 'Keine Hausaufgaben' }
    : { calendar: 'Календарь домашки', previous: 'Предыдущий месяц', next: 'Следующий месяц', today: 'Сегодня', empty: 'На этот день домашнего задания нет.', details: 'Задания на', totals: 'Сдача домашки за месяц', none: 'Нет домашних заданий' };

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
    const byDay = new Map<string, Homework[]>();
    const countsByDay = new Map<string, StatusCounts>();
    for (const homework of homeworks) {
      const key = homework.startDate.slice(0, 10);
      const bucket = byDay.get(key) ?? [];
      bucket.push(homework);
      byDay.set(key, bucket);
      const counts = countsByDay.get(key) ?? {};
      const status = resolveHomeworkHistoryStatus(homework, now);
      counts[status] = (counts[status] ?? 0) + 1;
      countsByDay.set(key, counts);
    }
    return { byDay, countsByDay };
  }, [homeworks, now]);

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
  const monthTitle = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(dateFromKey(month));
  const fullDate = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const accessibleDate = new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
  const selectedHomeworks = byDay.get(selectedDay) ?? [];

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
        {(['TODAY', 'UPCOMING'] as HomeworkHistoryStatus[]).map(status => (
          <span key={status} data-status={status}>
            <span className="homework-calendar__dot" aria-hidden="true" />
            {homeworkHistoryText(status, language)}
          </span>
        ))}
      </div>

      <div className="homework-calendar__weekdays" aria-hidden="true">
        {Array.from({ length: 7 }, (_, index) => <span key={index}>{weekday.format(new Date(Date.UTC(2024, 0, 1 + index)))}</span>)}
      </div>
      <div className="homework-calendar__grid" role="group" aria-labelledby={titleId}>
        {days.map(date => {
          const key = dateKey(date);
          const counts = countsByDay.get(key) ?? {};
          const present = statusOrder.filter(status => counts[status]);
          const outside = !key.startsWith(month.slice(0, 7));
          const labels = present.map(status => `${homeworkHistoryText(status, language)}: ${counts[status]}`);
          const label = [accessibleDate.format(date), key === today ? text.today : '', labels.length ? labels.join(', ') : text.none].filter(Boolean).join(', ');
          return (
            <button key={key} type="button" className="homework-calendar__day"
              data-status={present[0] ?? 'EMPTY'} data-outside={outside || undefined}
              aria-label={label} aria-pressed={selectedDay === key}
              aria-current={key === today ? 'date' : undefined} aria-controls={detailsId}
              onClick={() => selectDay(key)}>
              <span className="homework-calendar__day-number">{date.getUTCDate()}</span>
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
        {selectedHomeworks.length ? (
          <div className="history-list">{selectedHomeworks.map(homework => <Fragment key={homework.id}>{renderHomework(homework)}</Fragment>)}</div>
        ) : <p className="homework-calendar__empty">{text.empty}</p>}
      </section>
    </section>
  );
}
