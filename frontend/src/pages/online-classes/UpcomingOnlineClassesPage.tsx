import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { onlineClassesApi, type OnlineClass } from '../../api/onlineClasses';
import { useAuth } from '../../auth/AuthContext';
import { useI18n } from '../../i18n/I18nContext';

const IS_STAGING_HOST = typeof window !== 'undefined'
  && window.location.hostname === 'staging-web-production.up.railway.app';

type ScheduleDay = {
  key: string;
  date: Date;
  classes: OnlineClass[];
};

/**
 * Entry point listing the caller's upcoming and live classes. The backend
 * filters by ownership/binding, so a student only ever receives their own.
 */
export function UpcomingOnlineClassesPage() {
  const { t, language } = useI18n();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [classes, setClasses] = useState<OnlineClass[] | null>(null);
  const [history, setHistory] = useState<OnlineClass[]>([]);
  const [failed, setFailed] = useState(false);
  const [creatingTestClass, setCreatingTestClass] = useState(false);
  const [providerMissing, setProviderMissing] = useState(false);

  useEffect(() => {
    let active = true;
    let inFlight = false;

    const refresh = async () => {
      if (!active || inFlight) return;
      inFlight = true;
      try {
        const [loaded, completed] = await Promise.all([
          onlineClassesApi.listUpcoming(),
          user?.role === 'STUDENT' ? onlineClassesApi.history() : Promise.resolve([]),
        ]);
        if (!active) return;
        setClasses(loaded);
        setHistory(completed);
        setFailed(false);
      } catch {
        if (active) setFailed(true);
      } finally {
        inFlight = false;
      }
    };

    void refresh();
    // A teacher may create/start a lesson while the student is already sitting
    // on this page. Refresh continuously so the live lesson appears without a
    // manual reload.
    const timer = window.setInterval(() => void refresh(), 2000);
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);

    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  async function createStagingTestClass() {
    if (creatingTestClass) return;
    setCreatingTestClass(true);
    setFailed(false);
    setProviderMissing(false);
    try {
      const students = await api.students.list();
      const testStudent = students.find((student) =>
        student.username?.toLowerCase() === 'test-student'
        || student.email?.toLowerCase() === 'test-student@mindcrafti.local'
        || student.fullName === 'Test Student'
      );
      if (!testStudent) throw new Error('Test Student not found');
      const onlineClass = await onlineClassesApi.createTestClass(
        testStudent.id,
        undefined,
        'Тестовый онлайн-урок',
      );
      try {
        await onlineClassesApi.start(onlineClass.id);
        navigate(`/online-classes/${onlineClass.id}`);
      } catch {
        // The test class itself was created successfully. A 409 here on staging
        // normally means LiveKit is not configured yet, so keep the class and
        // explain the next setup step instead of claiming creation failed.
        setClasses((current) => current
          ? [onlineClass, ...current.filter((item) => item.id !== onlineClass.id)]
          : [onlineClass]);
        setProviderMissing(true);
      }
    } catch {
      setFailed(true);
    } finally {
      setCreatingTestClass(false);
    }
  }

  const scheduleDays = useMemo<ScheduleDay[]>(() => {
    const start = startOfLocalDay(new Date());
    const endExclusive = addDays(start, 7);
    const weekClasses = (classes ?? [])
      .filter((item) => {
        const startsAt = new Date(item.scheduledStartAt);
        return startsAt >= start && startsAt < endExclusive;
      })
      .sort((a, b) => new Date(a.scheduledStartAt).getTime() - new Date(b.scheduledStartAt).getTime());

    return Array.from({ length: 7 }, (_, offset) => {
      const date = addDays(start, offset);
      const nextDate = addDays(date, 1);
      return {
        key: localDateKey(date),
        date,
        classes: weekClasses.filter((item) => {
          const startsAt = new Date(item.scheduledStartAt);
          return startsAt >= date && startsAt < nextDate;
        }),
      };
    });
  }, [classes]);

  if (failed && !classes) return <p role="alert">{t('onlineClass.unavailable')}</p>;
  if (!classes) return <p>{t('common.loading')}</p>;

  const locale = language === 'DE' ? 'de-DE' : 'ru-RU';
  const statusRank: Record<OnlineClass['status'], number> = {
    LIVE: 0,
    LOBBY_OPEN: 1,
    SCHEDULED: 2,
    ENDED: 3,
    CANCELLED: 4,
  };
  const visibleClasses = [...classes].sort((a, b) => {
    const byStatus = statusRank[a.status] - statusRank[b.status];
    if (byStatus !== 0) return byStatus;
    return new Date(b.scheduledStartAt).getTime() - new Date(a.scheduledStartAt).getTime();
  });

  return (
    <div className="online-classes" style={{ maxWidth: user?.role === 'STUDENT' ? 1660 : undefined, margin: user?.role === 'STUDENT' ? '0 auto' : undefined }}>
      {user?.role === 'STUDENT' ? (
        <div style={{ marginBottom: 18 }}>
          <h1 style={{ marginBottom: 6 }}>{language === 'DE' ? 'Unterricht' : 'Уроки'}</h1>
          <div className="muted">
            {language === 'DE' ? 'Dein Stundenplan für die nächsten 7 Tage.' : 'Расписание на ближайшие 7 дней.'}
          </div>
        </div>
      ) : (
        <h1>{t('onlineClass.upcoming')}</h1>
      )}

      {IS_STAGING_HOST && user?.role === 'TEACHER' && (
        <div className="panel" style={{ marginBottom: 16, padding: 16 }}>
          <strong>Тест онлайн-урока</strong>
          <p className="muted" style={{ marginTop: 5 }}>
            Создаст отдельный тестовый урок между Test Teacher и Test Student.
          </p>
          <button
            type="button"
            className="btn btn--primary"
            disabled={creatingTestClass}
            onClick={() => void createStagingTestClass()}
          >
            {creatingTestClass ? 'Создаём…' : 'Создать тестовый онлайн-урок'}
          </button>
          {providerMissing && (
            <p role="status" className="online-class-error">
              Урок создан. Чтобы запустить видео и звук, подключите LiveKit.
            </p>
          )}
          {failed && <p role="alert" className="online-class-error">Не удалось создать тестовый урок.</p>}
        </div>
      )}

      {user?.role === 'STUDENT' ? (
        <div style={{ overflowX: 'auto', paddingBottom: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(220px, 1fr))', gap: 12, minWidth: 1540 }}>
            {scheduleDays.map((day, index) => (
              <section key={day.key} className="panel" style={{ padding: 14, margin: 0, minHeight: 260 }}>
                <div style={{ paddingBottom: 10, borderBottom: '1px solid var(--border)', marginBottom: 10 }}>
                  <div style={{ fontWeight: 800, fontSize: 16 }}>{formatDayTitle(day.date, index, language)}</div>
                  <div className="muted" style={{ marginTop: 3, fontSize: 12 }}>{formatDayDate(day.date, language)}</div>
                </div>

                {day.classes.length === 0 ? (
                  <div className="muted" style={{ fontSize: 13, padding: '8px 0' }}>
                    {language === 'DE' ? 'Kein Unterricht' : 'Уроков нет'}
                  </div>
                ) : (
                  <div className="stack" style={{ gap: 8 }}>
                    {day.classes.map((item) => (
                      <article key={item.id} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 12, background: '#fff' }}>
                        <div style={{ fontSize: 17, fontWeight: 800 }}>{formatStartTime(item.scheduledStartAt, language)}</div>
                        <div style={{ fontWeight: 750, marginTop: 4 }}>{item.title}</div>
                        <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
                          {formatLessonTime(item.scheduledStartAt, item.scheduledEndAt, language)}
                        </div>

                        {item.status === 'LIVE' && (
                          <div className="banner banner--success" style={{ marginTop: 8, padding: 8, fontSize: 12 }}>
                            {language === 'DE' ? 'Läuft jetzt' : 'Идёт сейчас'}
                          </div>
                        )}
                        {item.status === 'LOBBY_OPEN' && (
                          <div className="banner banner--info" style={{ marginTop: 8, padding: 8, fontSize: 12 }}>
                            {language === 'DE' ? 'Du kannst beitreten' : 'Можно входить'}
                          </div>
                        )}

                        <Link
                          className="btn btn--secondary"
                          to={`/online-classes/${item.id}`}
                          style={{ width: '100%', textAlign: 'center', marginTop: 10 }}
                        >
                          {language === 'DE' ? 'Unterricht öffnen' : 'Открыть урок'}
                        </Link>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            ))}
          </div>
        </div>
      ) : visibleClasses.length === 0 ? (
        <p>{t('onlineClass.none')}</p>
      ) : (
        <ul>
          {visibleClasses.map((item) => (
            <li key={item.id}>
              <Link to={`/online-classes/${item.id}`}>
                {item.title} — {new Date(item.scheduledStartAt).toLocaleString(locale)}
              </Link>
              {item.status === 'LIVE' && <span className="badge">{t('onlineClass.live')}</span>}
            </li>
          ))}
        </ul>
      )}
      {user?.role === 'STUDENT' && history.length > 0 && (
        <section className="panel" style={{ marginTop: 22, padding: 18 }}>
          <h2 style={{ marginTop: 0 }}>История уроков</h2>
          <p className="muted" style={{ marginTop: -4 }}>
            Открой прошлый урок и посмотри рабочую тетрадь, общую доску и свою работу.
          </p>
          <div className="stack" style={{ gap: 8 }}>
            {history.map((item) => (
              <Link
                key={item.id}
                className="btn btn--secondary"
                to={`/student/lessons/${item.id}/history`}
                style={{ textAlign: 'left' }}
              >
                {item.title} · {new Date(item.scheduledStartAt).toLocaleString(locale)}
              </Link>
            ))}
          </div>
        </section>
      )}

    </div>
  );
}

function formatDayTitle(date: Date, index: number, language: 'DE' | 'RU') {
  if (index === 0) return language === 'DE' ? 'Heute' : 'Сегодня';
  if (index === 1) return language === 'DE' ? 'Morgen' : 'Завтра';
  return new Intl.DateTimeFormat(language === 'DE' ? 'de-DE' : 'ru-RU', { weekday: 'short' }).format(date);
}

function formatDayDate(date: Date, language: 'DE' | 'RU') {
  return new Intl.DateTimeFormat(language === 'DE' ? 'de-DE' : 'ru-RU', {
    day: '2-digit',
    month: '2-digit',
  }).format(date);
}

function formatStartTime(value: string, language: 'DE' | 'RU') {
  return new Intl.DateTimeFormat(language === 'DE' ? 'de-DE' : 'ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatLessonTime(start: string, end: string, language: 'DE' | 'RU') {
  const formatter = new Intl.DateTimeFormat(language === 'DE' ? 'de-DE' : 'ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
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
