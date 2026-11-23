import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { GroupLesson, StudentListItem } from '../../api/types';

/** Change one scheduled occurrence, never permanent group membership. */
export function LessonParticipantsPanel({ lesson, lessons, students, onChanged }: {
  lesson: GroupLesson;
  lessons: GroupLesson[];
  students: StudentListItem[];
  onChanged: () => Promise<void>;
}) {
  const [roster, setRoster] = useState<Array<{studentId: string; studentName: string}>>([]);
  const [ready, setReady] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [newStudent, setNewStudent] = useState('');
  const [moveStudent, setMoveStudent] = useState('');
  const [destination, setDestination] = useState('');
  const editable = Date.parse(lesson.startsAt) > Date.now();

  async function reload() {
    setRoster(await api.lessons.participants(lesson.eventId));
  }

  useEffect(() => {
    let active = true;
    setReady(false);
    setError('');
    api.lessons.participants(lesson.eventId).then(items => {
      if (active) { setRoster(items); setReady(true); }
    }).catch(() => {
      if (active) setError('Не удалось загрузить участников.');
    });
    return () => { active = false; };
  }, [lesson.eventId]);

  async function change(operation: () => Promise<unknown>) {
    setWorking(true);
    setError('');
    try {
      await operation();
      await reload();
      await onChanged();
      setNewStudent('');
      setMoveStudent('');
      setDestination('');
    } catch {
      setError('Не удалось изменить участников. Возможно, занятие уже началось.');
    } finally {
      setWorking(false);
    }
  }

  const current = new Set(roster.map(item => item.studentId));
  const available = students.filter(student => !current.has(student.id));
  const targets = lessons.filter(other => other.eventId !== lesson.eventId
    && Date.parse(other.startsAt) > Date.now());

  return <section className="panel" style={{ padding: 20, marginBottom: 18 }}>
    <h2 style={{ margin: '0 0 8px' }}>Участники этого урока</h2>
    <p className="muted">Добавление, удаление и перенос действуют только для одного занятия. Основная группа не меняется.</p>
    {error && <div className="banner banner--error" role="alert">{error}</div>}
    {!ready && !error && <p role="status">Загружаем…</p>}
    {ready && <div style={{ display: 'grid', gap: 12 }}>
      {roster.length === 0 && <p>В этом уроке пока нет учеников.</p>}
      {roster.map(student => <div key={student.studentId}
        style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
        <strong>{student.studentName}</strong>
        {editable && <button className="btn btn--ghost" type="button" disabled={working}
          onClick={() => void change(() => api.lessons.removeParticipant(lesson.eventId, student.studentId))}>
          Удалить только из урока
        </button>}
      </div>)}
      {editable && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <select className="input" aria-label="Добавить ученика" value={newStudent}
          onChange={event => setNewStudent(event.target.value)} disabled={working}>
          <option value="">Выберите ученика…</option>
          {available.map(student => <option key={student.id} value={student.id}>{student.fullName}</option>)}
        </select>
        <button type="button" className="btn" disabled={working || !newStudent}
          onClick={() => void change(() => api.lessons.addParticipant(lesson.eventId, newStudent))}>
          Добавить на один урок
        </button>
      </div>}
      {editable && roster.length > 0 && targets.length > 0 && <div
        style={{ display: 'flex', gap: 8, flexWrap: 'wrap', borderTop: '1px solid var(--border)', paddingTop: 12 }}>
        <select className="input" aria-label="Кого перенести" value={moveStudent}
          onChange={event => setMoveStudent(event.target.value)} disabled={working}>
          <option value="">Кого перенести…</option>
          {roster.map(student => <option key={student.studentId} value={student.studentId}>{student.studentName}</option>)}
        </select>
        <select className="input" aria-label="В какой урок" value={destination}
          onChange={event => setDestination(event.target.value)} disabled={working}>
          <option value="">В какой урок…</option>
          {targets.map(target => <option key={target.eventId} value={target.eventId}>
            {new Date(target.startsAt).toLocaleString('ru-RU', {
              timeZone: 'Europe/Berlin', dateStyle: 'short', timeStyle: 'short',
            })} · {target.title}
          </option>)}
        </select>
        <button type="button" className="btn btn--secondary" disabled={working || !moveStudent || !destination}
          onClick={() => void change(() => api.lessons.transferParticipant(lesson.eventId, destination, moveStudent))}>
          Перенести на один урок
        </button>
      </div>}
      {!editable && <p className="muted">Состав завершённого урока менять нельзя.</p>}
    </div>}
  </section>;
}
