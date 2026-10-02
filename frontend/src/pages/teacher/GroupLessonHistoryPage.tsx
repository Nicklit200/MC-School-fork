import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { GroupLesson, StudentGroup } from '../../api/types';

export function GroupLessonHistoryPage() {
  const { groupId = '' } = useParams();
  const [group, setGroup] = useState<StudentGroup | null>(null);
  const [lessons, setLessons] = useState<GroupLesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.groups.get(groupId), api.lessons.groupLessons()])
      .then(([groupPayload, allLessons]) => {
        if (cancelled) return;
        setGroup(groupPayload);
        setLessons(allLessons);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [groupId]);

  const groupLessons = useMemo(
    () => lessons
      .filter((lesson) => lesson.groupId === groupId)
      .sort((a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime()),
    [lessons, groupId],
  );

  if (loading) return <p className="muted">Загружаем историю уроков…</p>;

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      <Link to={`/groups/${groupId}`} className="muted">← Назад к группе</Link>
      <div style={{ margin: '12px 0 22px' }}>
        <h1 style={{ marginBottom: 6 }}>{group?.name ?? 'Группа'} · уроки</h1>
        <p className="muted" style={{ margin: 0 }}>
          Архив всех занятий группы. Внутри урока хранятся рабочий лист, ответы, домашние задания, заметки и транскрипция.
        </p>
      </div>

      {error && <div className="banner banner--error">{error}</div>}

      {groupLessons.length === 0 ? (
        <div className="teacher-empty-state">Уроков группы пока нет.</div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {groupLessons.map((lesson) => {
            const isFuture = new Date(lesson.startsAt).getTime() > Date.now();
            return (
              <Link
                key={lesson.eventId}
                to={`/teacher/lessons/${encodeURIComponent(lesson.eventId)}`}
                style={{
                  textDecoration: 'none',
                  color: 'inherit',
                  border: '1px solid var(--border)',
                  borderRadius: 16,
                  padding: '15px 17px',
                  background: '#fff',
                  display: 'grid',
                  gridTemplateColumns: 'minmax(170px, 220px) 1fr auto',
                  gap: 16,
                  alignItems: 'center',
                }}
              >
                <div>
                  <strong>{formatLessonDate(lesson.startsAt)}</strong>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{formatLessonTime(lesson.startsAt, lesson.endsAt)}</div>
                </div>
                <div>
                  <div style={{ fontWeight: 800 }}>{lesson.title}</div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{group?.students.length ?? 0} учеников в группе</div>
                </div>
                <span className={`pill ${isFuture ? 'pill--pending' : 'pill--learned'}`}>{isFuture ? 'запланирован' : 'проведён'}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function formatLessonDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    weekday: 'short',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Berlin',
  }).format(new Date(value));
}

function formatLessonTime(start: string, end: string) {
  const format = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' });
  return `${format.format(new Date(start))}–${format.format(new Date(end))}`;
}
