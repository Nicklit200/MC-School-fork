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

export function StudentLessonsCalendarPage() {
  const { language, t } = useI18n();
  const [lessons, setLessons] = useState<StudentLesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [openingDocumentId, setOpeningDocumentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  if (loading) return <p className="muted">{t('common.loading')}</p>;

  return (
    <div style={{ maxWidth: 1600, margin: '0 auto' }}>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ marginBottom: 6 }}>{language === 'DE' ? 'Mein Unterricht' : 'Мои уроки'}</h1>
        <p className="muted" style={{ margin: 0 }}>
          {language === 'DE'
            ? 'Dein Stundenplan für die nächsten 7 Tage. Öffne das gemeinsame Dokument oder tritt dem Unterricht bei.'
            : 'Твоё расписание на ближайшие 7 дней. Здесь можно открыть общий документ урока и подключиться к занятию.'}
        </p>
      </div>

      {error && <div className="banner banner--error" style={{ marginBottom: 14 }}>{error}</div>}

      <div style={{ overflowX: 'auto', paddingBottom: 10 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(220px, 1fr))', gap: 12, minWidth: 1540 }}>
          {scheduleDays.map((day, index) => (
            <section key={day.key} className="panel" style={{ padding: 14, margin: 0, minHeight: 280 }}>
              <div style={{ paddingBottom: 10, borderBottom: '1px solid var(--border)', marginBottom: 10 }}>
                <div style={{ fontWeight: 800, fontSize: 16 }}>{formatDayTitle(day.date, index, language)}</div>
                <div className="muted" style={{ marginTop: 3, fontSize: 12 }}>{formatDayDate(day.date, language)}</div>
              </div>

              {day.lessons.length === 0 ? (
                <div className="muted" style={{ fontSize: 13, padding: '8px 0' }}>
                  {language === 'DE' ? 'Kein Unterricht' : 'Уроков нет'}
                </div>
              ) : (
                <div className="stack" style={{ gap: 8 }}>
                  {day.lessons.map((lesson) => {
                    const started = new Date(lesson.startsAt).getTime() <= Date.now();
                    const ended = new Date(lesson.endsAt).getTime() < Date.now();
                    return (
                      <div
                        key={lesson.eventId}
                        style={{
                          border: '1px solid var(--border)',
                          borderRadius: 12,
                          padding: 12,
                          background: '#fff',
                          boxShadow: '0 6px 18px rgba(30, 45, 70, .05)',
                        }}
                      >
                        <div style={{ fontSize: 18, fontWeight: 900 }}>{formatStartTime(lesson.startsAt, language)}</div>
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
                  })}
                </div>
              )}
            </section>
          ))}
        </div>
      </div>

      <div className="banner banner--info" style={{ marginTop: 12 }}>
        {language === 'DE'
          ? 'Du siehst nur Unterricht, der dir persönlich oder deiner Gruppe zugeordnet ist.'
          : 'Здесь показываются только занятия, назначенные лично тебе или твоей группе.'}
      </div>
    </div>
  );
}

function formatDayTitle(date: Date, index: number, language: 'DE' | 'RU') {
  if (index === 0) return language === 'DE' ? 'Heute' : 'Сегодня';
  if (index === 1) return language === 'DE' ? 'Morgen' : 'Завтра';
  return new Intl.DateTimeFormat(language === 'DE' ? 'de-DE' : 'ru-RU', { weekday: 'short' }).format(date);
}

function formatDayDate(date: Date, language: 'DE' | 'RU') {
  return new Intl.DateTimeFormat(language === 'DE' ? 'de-DE' : 'ru-RU', { day: '2-digit', month: '2-digit' }).format(date);
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
  return `${formatter.format(new Date(start))}–${formatter.format(new Date(end))}`;
}

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
