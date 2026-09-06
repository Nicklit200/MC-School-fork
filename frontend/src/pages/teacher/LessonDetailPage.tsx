import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import { lessonPreparationApi } from '../../api/lessonPreparation';
import type { GroupLesson, Homework, LessonPreparation } from '../../api/types';
import { toErrorMessage } from '../../lib/errors';
import { useI18n } from '../../i18n/I18nContext';
import { GoogleDrivePdfPicker } from './GoogleDrivePdfPicker';

type HomeworkSummary = {
  assigned: number;
  submitted: number;
  open: number;
  students: Array<{ id: string; name: string; assigned: number; submitted: number }>;
};

export function LessonDetailPage() {
  const { eventId = '' } = useParams();
  const { t } = useI18n();
  const [lesson, setLesson] = useState<GroupLesson | null>(null);
  const [preparation, setPreparation] = useState<LessonPreparation | null>(null);
  const [homeworkNotes, setHomeworkNotes] = useState('');
  const [difficulties, setDifficulties] = useState('');
  const [lessonPlan, setLessonPlan] = useState('');
  const [homeworkSummary, setHomeworkSummary] = useState<HomeworkSummary | null>(null);
  const [workbookUrl, setWorkbookUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [lessons, prep] = await Promise.all([
          api.lessons.groupLessons(),
          lessonPreparationApi.get(eventId),
        ]);
        if (cancelled) return;
        const currentLesson = lessons.find((item) => item.eventId === eventId) ?? null;
        setLesson(currentLesson);
        setPreparation(prep);
        setHomeworkNotes(prep.homeworkNotes ?? '');
        setDifficulties(prep.difficulties ?? '');
        setLessonPlan(prep.lessonPlan ?? '');

        if (prep.hasWorkbook) {
          try {
            const url = await lessonPreparationApi.workbookUrl(eventId);
            if (!cancelled) setWorkbookUrl(url);
          } catch {
            // The page remains usable even if the PDF preview is temporarily unavailable.
          }
        }

        if (currentLesson) {
          const summary = await buildHomeworkSummary(currentLesson);
          if (!cancelled) setHomeworkSummary(summary);
        }
      } catch (e) {
        if (!cancelled) setError(toErrorMessage(e, t));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
      if (workbookUrl) URL.revokeObjectURL(workbookUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, t]);

  const dateText = useMemo(() => {
    if (!lesson) return '';
    return new Intl.DateTimeFormat('ru-RU', {
      weekday: 'long', day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit',
    }).format(new Date(lesson.startsAt));
  }, [lesson]);

  async function savePreparation() {
    if (saving) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const updated = await lessonPreparationApi.update(eventId, { homeworkNotes, difficulties, lessonPlan });
      setPreparation(updated);
      setMessage('Подготовка урока сохранена.');
    } catch (e) {
      setError(toErrorMessage(e, t));
    } finally {
      setSaving(false);
    }
  }

  async function uploadWorkbook(file: File) {
    if (uploading) return;
    if (file.type && file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setError('Рабочая тетрадь должна быть PDF-файлом.');
      return;
    }
    setUploading(true);
    setError(null);
    setMessage(null);
    try {
      const updated = await lessonPreparationApi.uploadWorkbook(eventId, file);
      setPreparation(updated);
      if (workbookUrl) URL.revokeObjectURL(workbookUrl);
      setWorkbookUrl(await lessonPreparationApi.workbookUrl(eventId));
      setMessage('Рабочая тетрадь обновлена.');
    } catch (e) {
      setError(toErrorMessage(e, t));
    } finally {
      setUploading(false);
    }
  }

  if (loading) return <p className="muted">{t('common.loading')}</p>;

  return (
    <div style={{ maxWidth: 1320, margin: '0 auto' }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <Link to="/teacher/lessons" className="muted">← Назад к расписанию</Link>
          <h1 style={{ margin: '10px 0 4px' }}>{lesson?.title ?? 'Урок'}</h1>
          <div className="muted">{dateText || 'Событие Google Calendar'}</div>
          {(lesson?.groupName || lesson?.studentName) && (
            <div style={{ marginTop: 8, fontWeight: 800, color: '#d94f00' }}>
              {lesson?.groupName ? `Группа: ${lesson.groupName}` : `Ученик: ${lesson?.studentName}`}
            </div>
          )}
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {lesson?.calendarUrl && <a className="btn btn--ghost" href={lesson.calendarUrl} target="_blank" rel="noreferrer">Google Calendar</a>}
          {lesson?.meetUrl && <a className="btn" href={lesson.meetUrl} target="_blank" rel="noreferrer">Google Meet</a>}
        </div>
      </div>

      {error && <div className="banner banner--error" style={{ marginBottom: 14 }}>{error}</div>}
      {message && <div className="banner banner--success" style={{ marginBottom: 14 }}>{message}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.6fr) minmax(320px, .9fr)', gap: 18, alignItems: 'start' }}>
        <section className="panel" style={{ padding: 18, margin: 0 }}>
          <div className="row" style={{ justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <div>
              <h2 style={{ margin: 0 }}>Рабочая тетрадь урока</h2>
              <p className="muted" style={{ margin: '5px 0 0' }}>Учитель видит PDF прямо здесь и может заменить его перед уроком.</p>
            </div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <GoogleDrivePdfPicker disabled={uploading} onSelect={(file) => void uploadWorkbook(file)} />
              <label className="btn btn--secondary" style={{ cursor: uploading ? 'default' : 'pointer' }}>
                {uploading ? 'Загружаем…' : 'Заменить PDF'}
                <input type="file" accept="application/pdf,.pdf" hidden disabled={uploading} onChange={(e) => { const file = e.target.files?.[0]; if (file) void uploadWorkbook(file); e.currentTarget.value = ''; }} />
              </label>
            </div>
          </div>

          {preparation?.hasWorkbook && workbookUrl ? (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>{preparation.workbookFilename}</div>
              <iframe title="Рабочая тетрадь урока" src={workbookUrl} style={{ width: '100%', height: '72vh', minHeight: 620, border: '1px solid var(--border)', borderRadius: 14, background: '#f8fafc' }} />
            </div>
          ) : (
            <div style={{ marginTop: 14, minHeight: 360, border: '2px dashed #f0c7ad', borderRadius: 16, display: 'grid', placeItems: 'center', textAlign: 'center', padding: 30, background: '#fffaf7' }}>
              <div>
                <div style={{ fontSize: 20, fontWeight: 850 }}>Рабочая тетрадь ещё не добавлена</div>
                <div className="muted" style={{ marginTop: 8 }}>Выбери PDF с компьютера или из Google Drive. После загрузки он будет постоянно привязан именно к этому уроку.</div>
              </div>
            </div>
          )}
        </section>

        <div className="stack" style={{ gap: 14 }}>
          <section className="panel" style={{ padding: 18, margin: 0 }}>
            <h2 style={{ marginTop: 0 }}>Домашняя работа</h2>
            {homeworkSummary ? (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 12 }}>
                  <Stat value={homeworkSummary.assigned} label="выдано" />
                  <Stat value={homeworkSummary.submitted} label="сдано" />
                  <Stat value={homeworkSummary.open} label="не сдано" />
                </div>
                {homeworkSummary.students.length > 1 && homeworkSummary.students.map((student) => (
                  <div key={student.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '7px 0', borderTop: '1px solid var(--border)', fontSize: 13 }}>
                    <strong>{student.name}</strong><span>{student.submitted} из {student.assigned}</span>
                  </div>
                ))}
              </>
            ) : <div className="muted">Нет привязанного ученика или группы.</div>}
            <label className="field" style={{ marginTop: 14 }}>
              <span className="field__label">Комментарий к домашке перед уроком</span>
              <textarea className="input" rows={4} value={homeworkNotes} onChange={(e) => setHomeworkNotes(e.target.value)} placeholder="Например: сделал 4 из 5 заданий, ошибки в дробях…" />
            </label>
          </section>

          <section className="panel" style={{ padding: 18, margin: 0 }}>
            <h2 style={{ marginTop: 0 }}>Сложности</h2>
            <textarea className="input" rows={6} value={difficulties} onChange={(e) => setDifficulties(e.target.value)} placeholder="Что было сложно на прошлых уроках, какие пробелы проверить…" />
          </section>

          <section className="panel" style={{ padding: 18, margin: 0 }}>
            <h2 style={{ marginTop: 0 }}>План урока</h2>
            <textarea className="input" rows={7} value={lessonPlan} onChange={(e) => setLessonPlan(e.target.value)} placeholder="Что повторить, что объяснить, какие задания пройти…" />
            <button className="btn" type="button" onClick={() => void savePreparation()} disabled={saving} style={{ width: '100%', marginTop: 12 }}>
              {saving ? 'Сохраняем…' : 'Сохранить подготовку'}
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return <div style={{ background: '#fff7ed', borderRadius: 12, padding: '10px 8px', textAlign: 'center' }}><div style={{ fontSize: 22, fontWeight: 900 }}>{value}</div><div className="muted" style={{ fontSize: 11 }}>{label}</div></div>;
}

async function buildHomeworkSummary(lesson: GroupLesson): Promise<HomeworkSummary | null> {
  if (lesson.groupId) {
    const group = await api.groups.get(lesson.groupId);
    const rows = await Promise.all(group.students.map(async (student) => {
      const homeworks = await api.homeworks.listForStudent(student.id);
      return studentHomeworkRow(student.id, student.fullName, homeworks);
    }));
    return combine(rows);
  }
  if (lesson.studentId) {
    const student = await api.students.get(lesson.studentId);
    const homeworks = await api.homeworks.listForStudent(lesson.studentId);
    return combine([studentHomeworkRow(student.id, student.fullName, homeworks)]);
  }
  return null;
}

function studentHomeworkRow(id: string, name: string, homeworks: Homework[]) {
  const recent = homeworks
    .filter((item) => item.hasWorksheet)
    .sort((a, b) => b.startDate.localeCompare(a.startDate))
    .slice(0, 5);
  return { id, name, assigned: recent.length, submitted: recent.filter((item) => item.submitted).length };
}

function combine(students: Array<{ id: string; name: string; assigned: number; submitted: number }>): HomeworkSummary {
  const assigned = students.reduce((sum, item) => sum + item.assigned, 0);
  const submitted = students.reduce((sum, item) => sum + item.submitted, 0);
  return { assigned, submitted, open: Math.max(0, assigned - submitted), students };
}
