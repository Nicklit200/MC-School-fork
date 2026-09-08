import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import { adminLessonsApi } from '../../api/adminLessons';
import type { GroupLesson, User } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import { toErrorMessage } from '../../lib/errors';

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
  const grouped = useMemo(() => groupByDate(lessons), [lessons]);

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h1 style={{ marginBottom: 6 }}>Уроки школы</h1>
          <div className="muted">Выберите преподавателя и подготовьте его реальные уроки. Учитель увидит те же изменения в своём аккаунте.</div>
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

      {loading ? <p className="muted">Загрузка…</p> : grouped.length === 0 ? (
        <div className="panel" style={{ padding: 24 }}>
          <strong>Уроков не найдено.</strong>
          <div className="muted" style={{ marginTop: 5 }}>Проверьте, подключён ли Google Calendar у {selectedTeacher?.fullName ?? 'преподавателя'}.</div>
        </div>
      ) : (
        <div className="stack" style={{ gap: 16 }}>
          {grouped.map((group) => (
            <section key={group.date} className="panel" style={{ padding: 18, margin: 0 }}>
              <h2 style={{ margin: '0 0 12px' }}>{formatDate(group.date)}</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
                {group.lessons.map((lesson) => (
                  <article key={lesson.eventId} style={{ border: '1px solid var(--border)', borderRadius: 14, padding: 14, background: '#fff' }}>
                    <div style={{ fontSize: 19, fontWeight: 900 }}>{formatTime(lesson.startsAt)}</div>
                    <div style={{ fontWeight: 800, marginTop: 4 }}>{lesson.title}</div>
                    <div className="muted" style={{ marginTop: 3, fontSize: 12 }}>{formatTime(lesson.startsAt)}–{formatTime(lesson.endsAt)}</div>
                    {(lesson.groupName || lesson.studentName) && (
                      <div style={{ marginTop: 8, fontSize: 13, color: '#d94f00', fontWeight: 750 }}>
                        {lesson.groupName ? `Группа: ${lesson.groupName}` : `Ученик: ${lesson.studentName}`}
                      </div>
                    )}
                    <Link
                      className="btn"
                      to={`/admin/teachers/${teacherId}/lessons/${encodeURIComponent(lesson.eventId)}`}
                      style={{ width: '100%', textAlign: 'center', marginTop: 12 }}
                    >
                      Открыть урок
                    </Link>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function groupByDate(lessons: GroupLesson[]) {
  const map = new Map<string, GroupLesson[]>();
  [...lessons].sort((a, b) => a.startsAt.localeCompare(b.startsAt)).forEach((lesson) => {
    const date = lesson.startsAt.slice(0, 10);
    const bucket = map.get(date) ?? [];
    bucket.push(lesson);
    map.set(date, bucket);
  });
  return Array.from(map.entries()).map(([date, items]) => ({ date, lessons: items }));
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: '2-digit', month: 'long' }).format(new Date(`${value}T12:00:00`));
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}
