import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client';
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
  const [loading, setLoading] = useState(true);
  const [openingDocumentId, setOpeningDocumentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('week');
  const [monthCursor, setMonthCursor] = useState(() => startOfMonth(new Date()));
  const [selectedMonthDayKey, setSelectedMonthDayKey] = useState<string | null>(null);

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

  const scheduleDays = useMemo<ScheduleDay[]>(() => {
    const start = startOfLocalDay(new Date());
    const endExclusive = addDays(start, 7);
    const visible = lessons
      .filter((lesson) => {
        const startsAt = new Date(lesson.startsAt);
        return startsAt >= start && startsAt < endExclusive;
      })
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());

    return Array.from({ length: 7 }, (_, offset) => {
      const date = addDays(start, offset);
      const next = addDays(date, 1);
      return {
        key: localDateKey(date),
        date,
        lessons: visible.filter((lesson) => {
          const startsAt = new Date(lesson.startsAt);
          return startsAt >= date && startsAt < next;
        }),
      };
    });
  }, [lessons]);

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

    const todayKey = localDateKey(new Date());
    if (todayKey.startsWith(monthPrefix) && (lessonsByDay.get(todayKey)?.length ?? 0) > 0) {
      setSelectedMonthDayKey(todayKey);
      return;
    }

    const firstLessonDay = monthGridDays
      .map(localDateKey)
      .find((key) => key.startsWith(monthPrefix) && (lessonsByDay.get(key)?.length ?? 0) > 0);
    setSelectedMonthDayKey(firstLessonDay ?? null);
  }, [viewMode, monthCursor, monthGridDays, lessonsByDay, selectedMonthDayKey]);

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

    return (
      <div
        key={lesson.eventId}
        style={{
          border: '1px solid var(--border)',
          borderRadius: 14,
          padding: 16,
          background: '#fff',
          boxShadow: '0 6px 18px rgba(30, 45, 70, .05)',
        }}
      >
        <div style={{ fontSize: 21, fontWeight: 900 }}>{formatStartTime(lesson.startsAt, language)}</div>
        <div style={{ marginTop: 5, fontWeight: 800, lineHeight: 1.3 }}>{lesson.title}</div>
        <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
          {formatLessonTime(lesson.startsAt, lesson.endsAt, language)}
        </div>
        {lesson.groupName && (
          <div className="muted" style={{ marginTop: 5, fontSize: 12 }}>
            {language === 'DE' ? 'Gruppe' : 'Группа'}: {lesson.groupName}
          </div>
        )}

        <div style={{ display: 'grid', gap: 7, marginTop: 12 }}>
          <button
            type="button"
            className="btn btn--secondary"
            disabled={!lesson.hasSharedDocument || openingDocumentId === lesson.eventId}
            onClick={() => void openSharedDocument(lesson)}
            style={{ width: '100%' }}
          >
            {openingDocumentId === lesson.eventId
              ? (language === 'DE' ? 'Dokument wird geöffnet…' : 'Открываем документ…')
              : lesson.hasSharedDocument
                ? (language === 'DE' ? 'Gemeinsames Dokument' : 'Общий документ')
                : (language === 'DE' ? 'Dokument noch nicht bereit' : 'Документ ещё не готов')}
          </button>

          {lesson.meetUrl ? (
            <a
              className="btn"
              href={lesson.meetUrl}
              target="_blank"
              rel="noreferrer"
              style={{ width: '100%', textAlign: 'center' }}
            >
              {ended
                ? (language === 'DE' ? 'Meet-Link öffnen' : 'Открыть ссылку урока')
                : started
                  ? (language === 'DE' ? 'Jetzt beitreten' : 'Подключиться сейчас')
                  : (language === 'DE' ? 'Zum Unterricht' : 'Подключиться к уроку')}
            </a>
          ) : (
            <button className="btn" type="button" disabled style={{ width: '100%' }}>
              {language === 'DE' ? 'Meet-Link noch nicht bereit' : 'Ссылка на урок ещё не готова'}
            </button>
          )}
        </div>
      </div>
    );
  }

  if (loading) return <p className="muted">{t('common.loading')}</p>;

  return (
    <div
      style={{
        width: 'calc(100vw - 32px)',
        maxWidth: 'none',
        marginLeft: '50%',
        transform: 'translateX(-50%)',
        paddingBottom: 16,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 18, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 22 }}>
        <div>
          <h1 style={{ marginBottom: 8, fontSize: 30 }}>{language === 'DE' ? 'Mein Unterricht' : 'Мои уроки'}</h1>
          <p className="muted" style={{ margin: 0 }}>
            {viewMode === 'week'
              ? (language === 'DE'
                  ? 'Dein Stundenplan für die nächsten 7 Tage. Öffne das gemeinsame Dokument oder tritt dem Unterricht bei.'
                  : 'Твоё расписание на ближайшие 7 дней. Здесь можно открыть общий документ урока и подключиться к занятию.')
              : (language === 'DE'
                  ? 'Monatsübersicht: Unterrichtstage sind orange markiert.'
                  : 'Календарь на месяц: дни, в которые есть уроки, отмечены оранжевым кругом.')}
          </p>
        </div>

        <div
          style={{
            display: 'inline-flex',
            padding: 4,
            borderRadius: 12,
            background: '#eef1f5',
            border: '1px solid #e1e5ea',
          }}
        >
          <button
            type="button"
            onClick={() => setViewMode('week')}
            style={viewToggleStyle(viewMode === 'week')}
          >
            {language === 'DE' ? 'Woche' : 'Неделя'}
          </button>
          <button
            type="button"
            onClick={() => setViewMode('month')}
            style={viewToggleStyle(viewMode === 'month')}
          >
            {language === 'DE' ? 'Monat' : 'Месяц'}
          </button>
        </div>
      </div>

      {error && <div className="banner banner--error" style={{ marginBottom: 14 }}>{error}</div>}

      {viewMode === 'week' ? (
        <div style={{ overflowX: 'auto', paddingBottom: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(210px, 1fr))', gap: 16, minWidth: 1470 }}>
            {scheduleDays.map((day, index) => (
              <section key={day.key} className="panel" style={{ padding: 18, margin: 0, minHeight: 360 }}>
                <div style={{ paddingBottom: 12, borderBottom: '1px solid var(--border)', marginBottom: 12 }}>
                  <div style={{ fontWeight: 850, fontSize: 18 }}>{formatDayTitle(day.date, index, language)}</div>
                  <div className="muted" style={{ marginTop: 4, fontSize: 13 }}>{formatDayDate(day.date, language)}</div>
                </div>

                {day.lessons.length === 0 ? (
                  <div className="muted" style={{ fontSize: 13, padding: '8px 0' }}>
                    {language === 'DE' ? 'Kein Unterricht' : 'Уроков нет'}
                  </div>
                ) : (
                  <div className="stack" style={{ gap: 8 }}>
                    {day.lessons.map(renderLessonCard)}
                  </div>
                )}
              </section>
            ))}
          </div>
        </div>
      ) : (
        <>
          <section className="panel" style={{ padding: 20, margin: 0, overflowX: 'auto' }}>
            <div style={{ minWidth: 980 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '64px 1fr 64px', alignItems: 'center', marginBottom: 18 }}>
                <button
                  type="button"
                  aria-label={language === 'DE' ? 'Vorheriger Monat' : 'Предыдущий месяц'}
                  onClick={() => {
                    setMonthCursor((value) => addMonths(value, -1));
                    setSelectedMonthDayKey(null);
                  }}
                  style={monthNavButtonStyle}
                >
                  ‹
                </button>
                <div style={{ textAlign: 'center', fontSize: 28, fontWeight: 850, color: '#1f2933' }}>
                  {formatMonthTitle(monthCursor, language)}
                </div>
                <button
                  type="button"
                  aria-label={language === 'DE' ? 'Nächster Monat' : 'Следующий месяц'}
                  onClick={() => {
                    setMonthCursor((value) => addMonths(value, 1));
                    setSelectedMonthDayKey(null);
                  }}
                  style={{ ...monthNavButtonStyle, justifySelf: 'end' }}
                >
                  ›
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid #e8e9ec' }}>
                {weekdayLabels(language).map((label) => (
                  <div key={label} style={{ textAlign: 'center', padding: '8px 6px 12px', fontSize: 13, fontWeight: 800, color: '#7b8493' }}>
                    {label}
                  </div>
                ))}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
                {monthGridDays.map((date) => {
                  const key = localDateKey(date);
                  const dayLessons = lessonsByDay.get(key) ?? [];
                  const hasLessons = dayLessons.length > 0;
                  const inMonth = date.getMonth() === monthCursor.getMonth() && date.getFullYear() === monthCursor.getFullYear();
                  const selected = selectedMonthDayKey === key;
                  const today = key === localDateKey(new Date());

                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setSelectedMonthDayKey(key)}
                      style={{
                        appearance: 'none',
                        border: 'none',
                        borderRight: '1px solid #eceef1',
                        borderBottom: '1px solid #eceef1',
                        background: selected ? '#fff7f1' : hasLessons && inMonth ? '#fffaf6' : '#fff',
                        minHeight: 132,
                        padding: 12,
                        textAlign: 'left',
                        cursor: 'pointer',
                        opacity: inMonth ? 1 : 0.34,
                        outline: selected ? '2px solid #ffb27a' : 'none',
                        outlineOffset: -2,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 9 }}>
                        <div
                          style={{
                            width: 38,
                            height: 38,
                            borderRadius: '50%',
                            display: 'grid',
                            placeItems: 'center',
                            fontSize: 17,
                            fontWeight: 850,
                            background: hasLessons && inMonth ? '#ff6a00' : '#fff',
                            color: hasLessons && inMonth ? '#fff' : inMonth ? '#1f2933' : '#8f98a6',
                            border: !hasLessons && today && inMonth ? '2px solid #ff6a00' : '2px solid transparent',
                            boxShadow: hasLessons && inMonth ? '0 5px 12px rgba(255, 106, 0, .22)' : 'none',
                          }}
                        >
                          {date.getDate()}
                        </div>
                      </div>

                      {inMonth && dayLessons.slice(0, 2).map((lesson) => (
                        <div
                          key={lesson.eventId}
                          style={{
                            marginTop: 5,
                            padding: '5px 7px',
                            borderRadius: 8,
                            background: '#fff0e5',
                            color: '#9f4100',
                            fontSize: 11,
                            fontWeight: 750,
                            lineHeight: 1.25,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {formatStartTime(lesson.startsAt, language)} · {lesson.title}
                        </div>
                      ))}
                      {inMonth && dayLessons.length > 2 && (
                        <div style={{ marginTop: 5, fontSize: 11, color: '#c14d00', fontWeight: 750 }}>
                          +{dayLessons.length - 2} {language === 'DE' ? 'weitere' : 'ещё'}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          <section style={{ marginTop: 18 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
              <h2 style={{ margin: 0, fontSize: 21 }}>
                {selectedMonthDayKey
                  ? formatSelectedDayTitle(selectedMonthDayKey, language)
                  : (language === 'DE' ? 'Wähle einen Unterrichtstag' : 'Выбери день с уроком')}
              </h2>
              {selectedMonthLessons.length > 0 && (
                <span className="muted" style={{ fontSize: 13 }}>
                  {selectedMonthLessons.length} {language === 'DE' ? 'Unterricht(e)' : 'урок(а)'}
                </span>
              )}
            </div>

            {selectedMonthDayKey && selectedMonthLessons.length === 0 ? (
              <div className="panel" style={{ margin: 0 }}>
                <span className="muted">{language === 'DE' ? 'An diesem Tag gibt es keinen Unterricht.' : 'В этот день уроков нет.'}</span>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))', gap: 14 }}>
                {selectedMonthLessons.map(renderLessonCard)}
              </div>
            )}
          </section>
        </>
      )}

      <div className="banner banner--info" style={{ marginTop: 18 }}>
        {language === 'DE'
          ? 'Du siehst nur Unterricht, der dir persönlich oder deiner Gruppe zugeordnet ist.'
          : 'Здесь показываются только занятия, назначенные лично тебе или твоей группе.'}
      </div>
    </div>
  );
}

function viewToggleStyle(active: boolean) {
  return {
    appearance: 'none' as const,
    border: 'none',
    borderRadius: 9,
    padding: '9px 18px',
    fontSize: 14,
    fontWeight: 800,
    cursor: 'pointer',
    background: active ? '#fff' : 'transparent',
    color: active ? '#1f2933' : '#6b7280',
    boxShadow: active ? '0 2px 8px rgba(31, 41, 51, .10)' : 'none',
  };
}

const monthNavButtonStyle = {
  appearance: 'none' as const,
  width: 44,
  height: 44,
  borderRadius: 12,
  border: '1px solid #e1e4e8',
  background: '#fff',
  color: '#26313f',
  fontSize: 30,
  lineHeight: 1,
  cursor: 'pointer',
  display: 'grid',
  placeItems: 'center',
};

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
