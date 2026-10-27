import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { GroupLesson, StudentLessonHistoryItem, StudentListItem } from '../../api/types';

type LessonRow = {
  eventId: string;
  title: string;
  groupName: string | null;
  startsAt: string;
  endsAt: string;
  sourceTeacherId: string | null;
  sourceTeacherName: string | null;
  historical: boolean;
};

export function StudentLessonsPage() {
  const { studentId = '' } = useParams();
  const [student, setStudent] = useState<StudentListItem | null>(null);
  const [lessons, setLessons] = useState<GroupLesson[]>([]);
  const [historyLessons, setHistoryLessons] = useState<StudentLessonHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.students.get(studentId),
      api.lessons.groupLessons(),
      api.students.lessonHistory(studentId),
    ])
      .then(([studentPayload, allLessons, oldLessons]) => {
        if (cancelled) return;
        setStudent(studentPayload);
        setLessons(allLessons);
        setHistoryLessons(oldLessons);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [studentId]);

  const studentLessons = useMemo(() => {
    const current: LessonRow[] = lessons
      .filter((lesson) => lesson.studentId === studentId || (lesson.participantStudentIds ?? []).includes(studentId))
      .map((lesson) => ({
        eventId: lesson.eventId,
        title: lesson.title,
        groupName: lesson.groupName,
        startsAt: lesson.startsAt,
        endsAt: lesson.endsAt,
        sourceTeacherId: null,
        sourceTeacherName: null,
        historical: false,
      }));

    const currentScheduleKeys = new Set(current.map(scheduleKey));
    const previous: LessonRow[] = historyLessons
      .map((lesson) => ({
        eventId: lesson.eventId,
        title: lesson.title,
        groupName: lesson.groupName,
        startsAt: lesson.startsAt,
        endsAt: lesson.endsAt,
        sourceTeacherId: lesson.sourceTeacherId,
        sourceTeacherName: lesson.sourceTeacherName,
        historical: true,
      }))
      .filter((lesson) => new Date(lesson.startsAt).getTime() <= Date.now() || !currentScheduleKeys.has(scheduleKey(lesson)));

    return [...current, ...previous].sort((a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime());
  }, [lessons, historyLessons, studentId]);

  if (loading) return <p className="muted">Загружаем историю уроков…</p>;

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      <Link to="/students" className="muted">← Назад к ученикам</Link>
      <div style={{ margin: '12px 0 22px' }}>
        <h1 style={{ marginBottom: 6 }}>{student?.fullName ?? 'Ученик'} · уроки</h1>
        <p className="muted" style={{ margin: 0 }}>
          История занятий, в том числе у предыдущих преподавателей. Прошлые уроки доступны только для просмотра.
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
                key={`${lesson.sourceTeacherId ?? 'current'}:${lesson.eventId}`}
                to={lesson.historical
                  ? `/teacher/students/${encodeURIComponent(studentId)}/lesson-history/${encodeURIComponent(lesson.sourceTeacherId ?? '')}/${encodeURIComponent(lesson.eventId)}`
                  : `/teacher/lessons/${encodeURIComponent(lesson.eventId)}`}
                style={{
                  textDecoration: 'none',
                  color: 'inherit',
                  border: '1px solid var(--border)',
                  borderRadius: 16,
                  padding: '15px 17px',
                  background: 'var(--teacher-surface, #fff)',
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
                    {lesson.historical && lesson.sourceTeacherName && <span> · Преподаватель: {lesson.sourceTeacherName}</span>}
                  </div>
                </div>
                <span className={`pill ${isFuture ? 'pill--pending' : 'pill--learned'}`}>
                  {lesson.historical ? (isFuture ? 'не перенесён' : 'история прежнего учителя') : (isFuture ? 'запланирован' : 'проведён')}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function scheduleKey(lesson: Pick<LessonRow, 'title' | 'groupName' | 'startsAt' | 'endsAt'>) {
  return [lesson.title, lesson.groupName ?? '', lesson.startsAt, lesson.endsAt].join('|');
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
