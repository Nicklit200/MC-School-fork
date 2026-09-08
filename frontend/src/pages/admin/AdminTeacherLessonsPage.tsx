import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import { adminLessonsApi } from '../../api/adminLessons';
import type { GroupLesson, User } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import { toErrorMessage } from '../../lib/errors';

type ScheduleDay = {
  key: string;
  date: Date;
  lessons: GroupLesson[];
};

export function AdminTeacherLessonsPage() {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const [teachers, setTeachers] = useState<User[]>([]);
  const [lessons, setLessons] = useState<GroupLesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const teacherId = searchParams.get('teacherId') ?? '';

  useEffect(() => {
    api.teachers.list()
      .then((items) => {
        setTeachers(items);
        if (!teacherId && items.length > 0) setSearchParams({ teacherId: items[0].id }, { replace: true });
      })
      .catch((e) => setError(toErrorMessage(e, t)));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!teacherId) {
      setLessons([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    adminLessonsApi.list(teacherId)
      .then(setLessons)
      .catch((e) => setError(toErrorMessage(e, t)))
      .finally(() => setLoading(false));
  }, [teacherId, t]);

  const selectedTeacher = teachers.find((teacher) => teacher.id === teacherId) ?? null;
  const scheduleDays = useMemo(() => buildSevenDaySchedule(lessons), [lessons]);
  const hasLessons = scheduleDays.some((day) => day.lessons.length > 0);

  return (
    <div style={{ maxWidth: 1660, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h1 style={{ marginBottom: 6 }}>Уроки школы</h1>
          <div className="muted">Следующие 7 дней. Выберите преподавателя и подготовьте его реальные уроки.</div>
        </div>
        <Link className="btn btn--ghost" to="/teachers">← Учителя</Link>
      </div>

      {error && <div className="banner banner--error" style={{ marginBottom: 14 }}>{error}</div>}

      <section className="panel" style={{ padding: 18, marginBottom: 18 }}>
        <label className="field" style={{ marginBottom: 0 }}>
          <span className="field__label">Преподаватель</span>
          <select className="select" value={teacherId} onChange={(e) => setSearchParams({ teacherId: e.target.value })}>
            {teachers.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.fullName}</option>)}
          </select>
        </label>
      </section>

      {loading ? <p className="muted">Загрузка…</p> : !hasLessons ? (
        <div className="panel" style={{ padding: 24 }}>
          <strong>На ближайшие 7 дней уроков не найдено.</strong>
          <div className="muted" style={{ marginTop: 5 }}>Проверьте, подключён ли Google Calendar у {selectedTeacher?.fullName ?? 'преподавателя'}.</div>
        </div>
      ) : (
        <div style={{ overflowX: 'auto', paddingBottom: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(220px, 1fr))', gap: 12, minWidth: 1540 }}>
            {scheduleDays.map((day, index) => (
              <section key={day.key} className="panel" style={{ padding: 14, margin: 0, minHeight: 290 }}>
                <div style={{ paddingBottom: 10, borderBottom: '1px solid var(--border)', marginBottom: 10 }}>
                  <div style={{ fontWeight: 800, fontSize: 16 }}>{formatDayTitle(day.date, index)}</div>
                  <div className="muted" style={{ marginTop: 3, fontSize: 12 }}>{formatDayDate(day.date)}</div>
                </div>

                {day.lessons.length === 0 ? (
                  <div className="muted" style={{ fontSize: 13, padding: '8px 0' }}>Уроков нет</div>
                ) : (
                  <div className="stack" style={{ gap: 8 }}>
                    {day.lessons.map((lesson) => (
                      <article key={lesson.eventId} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 12, background: '#fff' }}>
                        <div style={{ fontSize: 17, fontWeight: 900 }}>{formatTime(lesson.startsAt)}</div>
                        <div style={{ fontWeight: 800, marginTop: 4 }}>{lesson.title}</div>
                        <div className="muted" style={{ marginTop: 3, fontSize: 12 }}>{formatTime(lesson.startsAt)}–{formatTime(lesson.endsAt)}</div>
                        {(lesson.groupName || lesson.studentName) && (
                          <div style={{ marginTop: 8, fontSize: 12, color: '#d94f00', fontWeight: 750 }}>
                            {lesson.groupName ? `Группа: ${lesson.groupName}` : `Ученик: ${lesson.studentName}`}
                          </div>
                        )}
                        <Link
                          className="btn"
                          to={`/admin/teachers/${teacherId}/lessons/${encodeURIComponent(lesson.eventId)}`}
                          style={{ width: '100%', textAlign: 'center', marginTop: 10 }}
                        >
                          Открыть урок
                        </Link>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function buildSevenDaySchedule(lessons: GroupLesson[]): ScheduleDay[] {
  const start = startOfLocalDay(new Date());
  const days: ScheduleDay[] = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return { key: localDateKey(date), date, lessons: [] };
  });
  const byDate = new Map(days.map((day) => [day.key, day]));

  [...lessons]
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
    .forEach((lesson) => {
      const day = byDate.get(localDateKey(new Date(lesson.startsAt)));
      if (day) day.lessons.push(lesson);
    });

  return days;
}

function startOfLocalDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function localDateKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDayTitle(date: Date, index: number) {
  if (index === 0) return 'Сегодня';
  if (index === 1) return 'Завтра';
  return capitalize(new Intl.DateTimeFormat('ru-RU', { weekday: 'long' }).format(date));
}

function formatDayDate(date: Date) {
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'long' }).format(date);
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
