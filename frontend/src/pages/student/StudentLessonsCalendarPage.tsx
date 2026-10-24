import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { onlineClassesApi, type OnlineClass } from '../../api/onlineClasses';
import { api, ApiRequestError } from '../../api/client';
import type { StudentLesson } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import { toErrorMessage } from '../../lib/errors';

type ScheduleDay = {
  key: string;
  date: Date;
  lessons: StudentLesson[];
};

type ViewMode = 'week' | 'month';

export function StudentLessonsCalendarPage() {
  const { language, t } = useI18n();
  const [lessons, setLessons] = useState<StudentLesson[]>([]);
  const [liveOnlineClasses, setLiveOnlineClasses] = useState<OnlineClass[]>([]);
  const [onlineClassesAvailable, setOnlineClassesAvailable] = useState(false);
  const [onlineError, setOnlineError] = useState(false);
  const [onlineRefresh, setOnlineRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [openingDocumentId, setOpeningDocumentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('week');
  const [selectedWeekDayKey, setSelectedWeekDayKey] = useState(() => berlinDateKey(new Date().toISOString()));
  const [monthCursor, setMonthCursor] = useState(() => startOfMonth(dateFromKey(berlinDateKey(new Date().toISOString()))));
  const [selectedMonthDayKey, setSelectedMonthDayKey] = useState<string | null>(null);
  const todayKey = berlinDateKey(new Date().toISOString());

  useEffect(() => {
    let cancelled = false;
    api.studentLessons.list()
      .then((payload) => {
        if (!cancelled) setLessons(payload);
      })
      .catch((e) => {
        if (!cancelled) setError(toErrorMessage(e, t));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [t]);

  // A room may open after the pupil has already opened the calendar. Ask the
  // server, which owns pilot eligibility, and refresh without a page reload.
  useEffect(() => {
    let cancelled = false;
    let pending = false;
    let unavailable = false;
    async function refresh() {
      if (pending || unavailable || cancelled || document.visibilityState === 'hidden') return;
      pending = true;
      try {
        const classes = await onlineClassesApi.listUpcoming();
        if (!cancelled) {
          setOnlineClassesAvailable(true);
          setOnlineError(false);
          setLiveOnlineClasses(classes.filter(item => item.joinWindowOpen &&
            (item.status === 'LIVE' || item.status === 'LOBBY_OPEN')));
        }
      } catch (e) {
        if (!cancelled) {
          setLiveOnlineClasses([]);
          unavailable = e instanceof ApiRequestError && (e.status === 403 || e.status === 404);
          setOnlineClassesAvailable(!unavailable);
          setOnlineError(!unavailable);
        }
      } finally {
        pending = false;
      }
    }
    void refresh();
    const interval = window.setInterval(() => void refresh(), 10_000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [onlineRefresh]);

  function liveRoomFor(eventId: string): OnlineClass | undefined {
    return liveOnlineClasses.find(item => item.eventId === eventId);
  }

  const scheduleDays = useMemo<ScheduleDay[]>(() => {
    const start = dateFromKey(todayKey);
    const endExclusive = localDateKey(addDays(start, 7));
    const visible = lessons
      .filter((lesson) => {
        const key = berlinDateKey(lesson.startsAt);
        return key >= todayKey && key < endExclusive;
      })
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());

    return Array.from({ length: 7 }, (_, offset) => {
      const date = addDays(start, offset);
      return {
        key: localDateKey(date),
        date,
        lessons: visible.filter(lesson => berlinDateKey(lesson.startsAt) === localDateKey(date)),
      };
    });
  }, [lessons, todayKey]);

  const lessonsByDay = useMemo(() => {
    const map = new Map<string, StudentLesson[]>();
    for (const lesson of lessons) {
      const key = berlinDateKey(lesson.startsAt);
      const bucket = map.get(key) ?? [];
      bucket.push(lesson);
      map.set(key, bucket);
    }
    for (const bucket of map.values()) {
      bucket.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
    }
    return map;
  }, [lessons]);

  const monthGridDays = useMemo(() => {
    const first = startOfMonth(monthCursor);
    const gridStart = startOfWeekMonday(first);
    return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
  }, [monthCursor]);

  useEffect(() => {
    if (viewMode !== 'month') return;
    const monthPrefix = monthKey(monthCursor);
    const selectedStillInMonth = selectedMonthDayKey?.startsWith(monthPrefix);
    if (selectedStillInMonth) return;

    if (todayKey.startsWith(monthPrefix) && (lessonsByDay.get(todayKey)?.length ?? 0) > 0) {
      setSelectedMonthDayKey(todayKey);
      return;
    }

    const firstLessonDay = monthGridDays
      .map(localDateKey)
      .find((key) => key.startsWith(monthPrefix) && (lessonsByDay.get(key)?.length ?? 0) > 0);
    setSelectedMonthDayKey(firstLessonDay ?? null);
  }, [viewMode, monthCursor, monthGridDays, lessonsByDay, selectedMonthDayKey, todayKey]);

  const selectedMonthLessons = selectedMonthDayKey ? (lessonsByDay.get(selectedMonthDayKey) ?? []) : [];

  async function openSharedDocument(lesson: StudentLesson) {
    if (!lesson.hasSharedDocument || openingDocumentId) return;
    const tab = window.open('about:blank', '_blank');
    if (tab) tab.opener = null;
    setOpeningDocumentId(lesson.eventId);
    setError(null);

    try {
      const blob = await api.studentLessons.sharedDocument(lesson.eventId);
      const url = URL.createObjectURL(blob);
      if (tab) {
        tab.location.href = url;
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } else {
        window.location.href = url;
      }
    } catch (e) {
      if (tab) tab.close();
      setError(toErrorMessage(e, t));
    } finally {
      setOpeningDocumentId(null);
    }
  }

  function renderLessonCard(lesson: StudentLesson) {
    const started = new Date(lesson.startsAt).getTime() <= Date.now();
    const ended = new Date(lesson.endsAt).getTime() < Date.now();
    const room = liveRoomFor(lesson.eventId);
    return <article className="panel student-lesson" key={lesson.eventId}>
      <div className="student-lesson__time"><strong>{lesson.eventId.startsWith('local-') ? nativeLessonDuration(lesson, language) : formatStartTime(lesson.startsAt, language)}</strong><small>{lesson.eventId.startsWith('local-') ? (language === 'DE' ? 'Dauer' : 'Длительность') : formatLessonTime(lesson.startsAt, lesson.endsAt, language)}</small></div>
      <div className="student-lesson__body"><h3>{lesson.title}</h3>
        {lesson.groupName && <p>{language === 'DE' ? 'Gruppe' : 'Группа'}: {lesson.groupName}</p>}
      </div>
      <div className="student-lesson__actions">
        <button type="button" className="btn btn--secondary" disabled={!lesson.hasSharedDocument || openingDocumentId === lesson.eventId} onClick={() => void openSharedDocument(lesson)}>
          {openingDocumentId === lesson.eventId ? (language === 'DE' ? 'Dokument wird geöffnet…' : 'Открываем документ…')
            : lesson.hasSharedDocument ? (language === 'DE' ? 'Gemeinsames Dokument' : 'Общий документ')
              : (language === 'DE' ? 'Dokument noch nicht bereit' : 'Документ ещё не готов')}
        </button>
        {room && <Link className="btn btn--secondary" to={`/online-classes/${room.id}`}>{language === 'DE' ? 'Mindcrafti Online – beitreten' : 'Mindcrafti Online — подключиться'}</Link>}
        <Link className="btn btn--secondary" to={`/lesson-notebook/${encodeURIComponent(lesson.eventId)}`}>{language === 'DE' ? 'Heftkamera' : 'Камера тетради'}</Link>
        {lesson.meetUrl ? <a className="btn" href={lesson.meetUrl} target="_blank" rel="noreferrer">
          {ended ? (language === 'DE' ? 'Meet-Link öffnen' : 'Открыть ссылку урока')
            : started ? (language === 'DE' ? 'Jetzt beitreten' : 'Подключиться сейчас')
              : (language === 'DE' ? 'Zum Unterricht' : 'Подключиться к уроку')}
        </a> : <button className="btn" type="button" disabled>{language === 'DE' ? 'Meet-Link noch nicht bereit' : 'Ссылка на урок ещё не готова'}</button>}
      </div>
    </article>;
  }

  const selectedWeekDay = scheduleDays.find(day => day.key === selectedWeekDayKey) ?? scheduleDays[0];

  if (loading) return <p className="muted">{t('common.loading')}</p>;

  return <div className="student-calendar">
    <div className="student-calendar__heading"><div>
      <h1>{language === 'DE' ? 'Mein Unterricht' : 'Мои уроки'}</h1>
      <p>{viewMode === 'week' ? (language === 'DE' ? 'Wähle einen Tag in den nächsten 7 Tagen.' : 'Выбери день на ближайшей неделе.') : (language === 'DE' ? 'Monatsübersicht: Unterrichtstage sind orange markiert.' : 'Календарь на месяц: дни с уроками отмечены оранжевым.')}</p>
    </div><div className="student-calendar__toggle" role="group" aria-label={language === 'DE' ? 'Kalenderansicht' : 'Вид расписания'}>
      <button type="button" onClick={() => setViewMode('week')} aria-pressed={viewMode === 'week'}>{language === 'DE' ? 'Woche' : 'Неделя'}</button>
      <button type="button" onClick={() => setViewMode('month')} aria-pressed={viewMode === 'month'}>{language === 'DE' ? 'Monat' : 'Месяц'}</button>
    </div></div>
    {error && <div className="banner banner--error">{error}</div>}
      {onlineError && <div className="banner banner--error" role="alert" style={{ marginBottom: 14 }}>
        {language === 'DE' ? 'Online-Unterricht konnte nicht aktualisiert werden.' : 'Не удалось проверить открытые онлайн-уроки.'}{' '}
        <button type="button" className="btn btn--secondary" onClick={() => setOnlineRefresh(value => value + 1)}>
          {language === 'DE' ? 'Erneut versuchen' : 'Проверить ещё раз'}
        </button>
      </div>}

      {liveOnlineClasses.length > 0 && <section className="panel" aria-label={language === 'DE' ? 'Offener Online-Unterricht' : 'Открытые онлайн-уроки'} style={{ marginBottom: 18 }}>
        <h2>{language === 'DE' ? 'Jetzt beitreten' : 'Сейчас можно подключиться'}</h2>
        <div className="stack">
          {liveOnlineClasses.map(room => <div key={room.id} style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <strong>{room.title}</strong>
            <Link className="btn" to={`/online-classes/${room.id}`}>
              {language === 'DE' ? 'Mindcrafti Online – beitreten' : 'Mindcrafti Online — подключиться'}
            </Link>
          </div>)}
        </div>
      </section>}
      {onlineClassesAvailable && !onlineError && liveOnlineClasses.length === 0 && <p className="muted" role="status">
        {language === 'DE' ? 'Mindcrafti Online: Sobald deine Lehrkraft den Unterricht öffnet, erscheint hier die Schaltfläche zum Beitreten automatisch.' : 'Mindcrafti Online: когда преподаватель откроет урок, кнопка подключения появится здесь автоматически.'}
      </p>}

    {viewMode === 'week' ? <>
      <div className="student-calendar__week-title">{formatMonthTitle(scheduleDays[0].date, language)} <span className="muted" style={{ display: 'block', fontSize: 11, marginTop: 5 }}>{formatDayDate(scheduleDays[0].date, language)} — {formatDayDate(scheduleDays[6].date, language)}</span></div>
      <div className="student-calendar__week" role="group" aria-label={language === 'DE' ? 'Wochentag wählen' : 'Выбери день недели'}>
        {scheduleDays.map((day, index) => <button key={day.key} type="button" className={`student-calendar__day${day.lessons.length ? ' has-lessons' : ''}`}
          title={formatDayTitle(day.date, index, language)} aria-label={formatSelectedDayTitle(day.key, language)} aria-pressed={selectedWeekDay.key === day.key}
          onClick={() => setSelectedWeekDayKey(day.key)}>
          <span>{weekdayLabels(language)[(day.date.getDay() + 6) % 7]}</span><strong>{day.date.getDate()}</strong><i aria-hidden="true" />
        </button>)}
      </div>
      <div className="student-calendar__agenda-title"><h2>{formatSelectedDayTitle(selectedWeekDay.key, language)}</h2><span>{selectedWeekDay.lessons.length} {language === 'DE' ? 'Unterricht' : 'занятий'}</span></div>
      <div className="student-calendar__lessons" aria-live="polite">{selectedWeekDay.lessons.length ? selectedWeekDay.lessons.map(renderLessonCard) : <div className="student-calendar__empty">{language === 'DE' ? 'Kein Unterricht' : 'В этот день уроков нет'}</div>}</div>
    </> : <div className="student-calendar__month">
      <aside className="panel student-calendar__selected"><div className="student-calendar__selected-label">{language === 'DE' ? 'Unterricht an diesem Tag' : 'Уроки в этот день'}</div>
        <h2>{selectedMonthDayKey ? formatSelectedDayTitle(selectedMonthDayKey, language) : (language === 'DE' ? 'Wähle einen Tag' : 'Выбери день')}</h2>
        {!selectedMonthDayKey ? <p className="muted">{language === 'DE' ? 'Wähle einen Tag im Kalender.' : 'Выбери день в календаре.'}</p>
          : selectedMonthLessons.length ? <div className="student-calendar__lessons">{selectedMonthLessons.map(renderLessonCard)}</div> : <p className="muted">{language === 'DE' ? 'Kein Unterricht' : 'В этот день уроков нет'}</p>}
      </aside>
      <section className="panel"><div className="student-calendar__month-heading">
        <button type="button" aria-label={language === 'DE' ? 'Vorheriger Monat' : 'Предыдущий месяц'} onClick={() => { setMonthCursor(value => addMonths(value, -1)); setSelectedMonthDayKey(null); }}>‹</button>
        <h2>{formatMonthTitle(monthCursor, language)}</h2>
        <button type="button" aria-label={language === 'DE' ? 'Nächster Monat' : 'Следующий месяц'} onClick={() => { setMonthCursor(value => addMonths(value, 1)); setSelectedMonthDayKey(null); }}>›</button>
      </div><div className="student-calendar__weekdays" aria-hidden="true">{weekdayLabels(language).map(label => <div key={label}>{label}</div>)}</div>
      <div className="student-calendar__cells" role="group" aria-label={language === 'DE' ? 'Tag wählen' : 'Выбери день'}>{monthGridDays.map(date => {
        const key = localDateKey(date), dayLessons = lessonsByDay.get(key) ?? [];
        const inMonth = date.getMonth() === monthCursor.getMonth() && date.getFullYear() === monthCursor.getFullYear();
        const today = key === todayKey;
        return <button key={key} type="button" className={`student-calendar__cell${inMonth ? '' : ' is-outside'}${today ? ' is-today' : ''}${dayLessons.length && inMonth ? ' has-lessons' : ''}`}
          onClick={() => setSelectedMonthDayKey(key)} aria-label={formatSelectedDayTitle(key, language)} aria-pressed={selectedMonthDayKey === key} aria-current={today ? 'date' : undefined}>
          <span>{date.getDate()}</span><i aria-hidden="true" />
        </button>;
      })}</div></section>
    </div>}
    <p className="student-calendar__note">{language === 'DE' ? 'Du siehst nur Unterricht, der dir persönlich oder deiner Gruppe zugeordnet ist. Zeit: Berlin.' : 'Здесь показываются только занятия, назначенные лично тебе или твоей группе. Время — Берлин.'}</p>
  </div>;
}

function formatDayTitle(date: Date, index: number, language: 'DE' | 'RU') {
  if (index === 0) return language === 'DE' ? 'Heute' : 'Сегодня';
  if (index === 1) return language === 'DE' ? 'Morgen' : 'Завтра';
  return new Intl.DateTimeFormat(language === 'DE' ? 'de-DE' : 'ru-RU', { weekday: 'short' }).format(date);
}

function formatDayDate(date: Date, language: 'DE' | 'RU') {
  return new Intl.DateTimeFormat(language === 'DE' ? 'de-DE' : 'ru-RU', { day: '2-digit', month: '2-digit' }).format(date);
}

function formatMonthTitle(date: Date, language: 'DE' | 'RU') {
  const value = new Intl.DateTimeFormat(language === 'DE' ? 'de-DE' : 'ru-RU', {
    month: 'long',
    year: 'numeric',
  }).format(date);
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatSelectedDayTitle(key: string, language: 'DE' | 'RU') {
  const [year, month, day] = key.split('-').map(Number);
  return new Intl.DateTimeFormat(language === 'DE' ? 'de-DE' : 'ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(year, month - 1, day));
}

function weekdayLabels(language: 'DE' | 'RU') {
  return language === 'DE'
    ? ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
    : ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
}

function formatStartTime(value: string, language: 'DE' | 'RU') {
  return new Intl.DateTimeFormat(language === 'DE' ? 'de-DE' : 'ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Berlin',
  }).format(new Date(value));
}

function formatLessonTime(start: string, end: string, language: 'DE' | 'RU') {
  const formatter = new Intl.DateTimeFormat(language === 'DE' ? 'de-DE' : 'ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Berlin',
  });
  return formatter.format(new Date(start)) + '–' + formatter.format(new Date(end));
}

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function dateFromKey(key: string) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function nativeLessonDuration(lesson: StudentLesson, language: 'DE' | 'RU') {
  const minutes = Math.round((new Date(lesson.endsAt).getTime() - new Date(lesson.startsAt).getTime()) / 60_000);
  return `${minutes} ${language === 'DE' ? 'Min.' : 'мин'}`;
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function startOfWeekMonday(date: Date) {
  const day = date.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  return addDays(startOfLocalDay(date), offset);
}

function addDays(date: Date, days: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function addMonths(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return year + '-' + month + '-' + day;
}

function monthKey(date: Date) {
  return localDateKey(startOfMonth(date)).slice(0, 7);
}

function berlinDateKey(value: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));
  const year = parts.find((part) => part.type === 'year')?.value ?? '';
  const month = parts.find((part) => part.type === 'month')?.value ?? '';
  const day = parts.find((part) => part.type === 'day')?.value ?? '';
  return year + '-' + month + '-' + day;
}
