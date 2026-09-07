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
  const [answersUrl, setAnswersUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingWorkbook, setUploadingWorkbook] = useState(false);
  const [uploadingAnswers, setUploadingAnswers] = useState(false);
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
          try { if (!cancelled) setWorkbookUrl(await lessonPreparationApi.workbookUrl(eventId)); } catch { /* page still works */ }
        }
        if (prep.hasAnswers) {
          try { if (!cancelled) setAnswersUrl(await lessonPreparationApi.answersUrl(eventId)); } catch { /* page still works */ }
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
    };
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
      setMessage('Информация для урока сохранена.');
    } catch (e) {
      setError(toErrorMessage(e, t));
    } finally {
      setSaving(false);
    }
  }

  async function uploadPdf(kind: 'workbook' | 'answers', file: File) {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setError('Нужен PDF-файл.');
      return;
    }
    const isWorkbook = kind === 'workbook';
    if (isWorkbook ? uploadingWorkbook : uploadingAnswers) return;
    isWorkbook ? setUploadingWorkbook(true) : setUploadingAnswers(true);
    setError(null);
    setMessage(null);
    try {
      const updated = isWorkbook
        ? await lessonPreparationApi.uploadWorkbook(eventId, file)
        : await lessonPreparationApi.uploadAnswers(eventId, file);
      setPreparation(updated);
      if (isWorkbook) setWorkbookUrl(await lessonPreparationApi.workbookUrl(eventId));
      else setAnswersUrl(await lessonPreparationApi.answersUrl(eventId));
      setMessage(isWorkbook ? 'Рабочая тетрадь обновлена.' : 'Ответы для учителя обновлены.');
    } catch (e) {
      setError(toErrorMessage(e, t));
    } finally {
      isWorkbook ? setUploadingWorkbook(false) : setUploadingAnswers(false);
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

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.55fr) minmax(340px, .95fr)', gap: 18, alignItems: 'start' }}>
        <div className="stack" style={{ gap: 14 }}>
          <MaterialPanel
            title="Рабочая тетрадь"
            filename={preparation?.workbookFilename}
            url={workbookUrl}
            emptyText="Рабочая тетрадь ещё не добавлена"
            uploading={uploadingWorkbook}
            onUpload={(file) => void uploadPdf('workbook', file)}
            defaultOpen
          />
          <MaterialPanel
            title="Ответы для учителя"
            filename={preparation?.answersFilename}
            url={answersUrl}
            emptyText="Ответы ещё не добавлены"
            uploading={uploadingAnswers}
            onUpload={(file) => void uploadPdf('answers', file)}
          />
        </div>

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
              <span className="field__label">Что было с домашкой</span>
              <textarea className="input" rows={4} value={homeworkNotes} onChange={(e) => setHomeworkNotes(e.target.value)} placeholder="Например: Марк сделал 4 из 5 заданий; в дробях были ошибки…" />
            </label>
          </section>

          <section className="panel" style={{ padding: 18, margin: 0 }}>
            <h2 style={{ marginTop: 0 }}>Проблемы и сложности</h2>
            <textarea className="input" rows={6} value={difficulties} onChange={(e) => setDifficulties(e.target.value)} placeholder="У кого какие проблемы были, что не понял, какие пробелы проверить…" />
          </section>

          <section className="panel" style={{ padding: 18, margin: 0 }}>
            <h2 style={{ marginTop: 0 }}>Рекомендованный план урока</h2>
            <textarea className="input" rows={7} value={lessonPlan} onChange={(e) => setLessonPlan(e.target.value)} placeholder="Что повторить, что объяснить и какие задания пройти…" />
            <button className="btn" type="button" onClick={() => void savePreparation()} disabled={saving} style={{ width: '100%', marginTop: 12 }}>
              {saving ? 'Сохраняем…' : 'Сохранить информацию'}
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}

function MaterialPanel({ title, filename, url, emptyText, uploading, onUpload, defaultOpen = false }: {
  title: string;
  filename?: string | null;
  url: string | null;
  emptyText: string;
  uploading: boolean;
  onUpload: (file: File) => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const hasPdf = Boolean(url);
  const uploadLabel = hasPdf ? 'Заменить PDF' : 'Загрузить PDF';

  return (
    <section className="panel" style={{ padding: 18, margin: 0 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          style={{ display: 'flex', alignItems: 'center', gap: 10, border: 0, background: 'transparent', padding: 0, cursor: 'pointer', color: 'inherit' }}
        >
          <span aria-hidden="true" style={{ fontSize: 18, lineHeight: 1 }}>{open ? '▾' : '▸'}</span>
          <h2 style={{ margin: 0 }}>{title}</h2>
          {filename && !open && <span className="muted" style={{ fontSize: 12, fontWeight: 600 }}>{filename}</span>}
        </button>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <GoogleDrivePdfPicker disabled={uploading} onSelect={onUpload} />
          <label className="btn btn--secondary" style={{ cursor: uploading ? 'default' : 'pointer' }}>
            {uploading ? 'Загружаем…' : uploadLabel}
            <input type="file" accept="application/pdf,.pdf" hidden disabled={uploading} onChange={(e) => { const file = e.target.files?.[0]; if (file) onUpload(file); e.currentTarget.value = ''; }} />
          </label>
        </div>
      </div>
      {open && (url ? (
        <div style={{ marginTop: 14 }}>
          {filename && <div style={{ fontWeight: 700, marginBottom: 8 }}>{filename}</div>}
          <iframe title={title} src={url} style={{ width: '100%', height: '60vh', minHeight: 480, border: '1px solid var(--border)', borderRadius: 14, background: '#f8fafc' }} />
        </div>
      ) : (
        <div style={{ marginTop: 14, minHeight: 190, border: '2px dashed #f0c7ad', borderRadius: 16, display: 'grid', placeItems: 'center', textAlign: 'center', padding: 30, background: '#fffaf7' }}>
          <div><div style={{ fontSize: 19, fontWeight: 850 }}>{emptyText}</div><div className="muted" style={{ marginTop: 8 }}>Можно выбрать PDF с компьютера или из Google Drive.</div></div>
        </div>
      ))}
    </section>
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
  const recent = homeworks.filter((item) => item.hasWorksheet).sort((a, b) => b.startDate.localeCompare(a.startDate)).slice(0, 5);
  return { id, name, assigned: recent.length, submitted: recent.filter((item) => item.submitted).length };
}

function combine(students: Array<{ id: string; name: string; assigned: number; submitted: number }>): HomeworkSummary {
  const assigned = students.reduce((sum, item) => sum + item.assigned, 0);
  const submitted = students.reduce((sum, item) => sum + item.submitted, 0);
  return { assigned, submitted, open: Math.max(0, assigned - submitted), students };
}
