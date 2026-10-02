import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { GroupLesson, StudentListItem } from '../../api/types';

export function StudentLessonsPage() {
  const { studentId = '' } = useParams();
  const [student, setStudent] = useState<StudentListItem | null>(null);
  const [lessons, setLessons] = useState<GroupLesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.students.get(studentId), api.lessons.groupLessons()])
      .then(([studentPayload, allLessons]) => {
        if (cancelled) return;
        setStudent(studentPayload);
        setLessons(allLessons);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [studentId]);

  const studentLessons = useMemo(
    () => lessons
      .filter((lesson) => lesson.studentId === studentId || (lesson.participantStudentIds ?? []).includes(studentId))
      .sort((a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime()),
    [lessons, studentId],
  );

  if (loading) return <p className="muted">Загружаем историю уроков…</p>;

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      <Link to="/students" className="muted">← Назад к ученикам</Link>
      <div style={{ margin: '12px 0 22px' }}>
        <h1 style={{ marginBottom: 6 }}>{student?.fullName ?? 'Ученик'} · уроки</h1>
        <p className="muted" style={{ margin: 0 }}>
          Вся история индивидуальных и групповых занятий. Откройте урок, чтобы увидеть рабочий лист, ответы, домашку, заметки и транскрипцию.
        </p>
      </div>

      {error && <div className="banner banner--error">{error}</div>}

      {studentLessons.length === 0 ? (
        <div className="teacher-empty-state">Уроков пока нет.</div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {studentLessons.map((lesson) => {
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
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    {lesson.groupName ? `Группа: ${lesson.groupName}` : 'Индивидуальное занятие'}
                  </div>
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
