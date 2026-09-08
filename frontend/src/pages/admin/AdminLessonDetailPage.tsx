import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import { adminLessonsApi } from '../../api/adminLessons';
import type { GroupLesson, LessonPreparation, User } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import { toErrorMessage } from '../../lib/errors';

type MaterialKind = 'workbook' | 'answers';

export function AdminLessonDetailPage() {
  const { teacherId = '', eventId = '' } = useParams();
  const decodedEventId = useMemo(() => decodeURIComponent(eventId), [eventId]);
  const { t } = useI18n();
  const [teacher, setTeacher] = useState<User | null>(null);
  const [lesson, setLesson] = useState<GroupLesson | null>(null);
  const [preparation, setPreparation] = useState<LessonPreparation | null>(null);
  const [homeworkNotes, setHomeworkNotes] = useState('');
  const [difficulties, setDifficulties] = useState('');
  const [lessonPlan, setLessonPlan] = useState('');
  const [workbookUrl, setWorkbookUrl] = useState<string | null>(null);
  const [answersUrl, setAnswersUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<MaterialKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [teachers, lessons, prep] = await Promise.all([
          api.teachers.list(),
          adminLessonsApi.list(teacherId),
          adminLessonsApi.getPreparation(teacherId, decodedEventId),
        ]);
        if (cancelled) return;
        setTeacher(teachers.find((item) => item.id === teacherId) ?? null);
        setLesson(lessons.find((item) => item.eventId === decodedEventId) ?? null);
        setPreparation(prep);
        setHomeworkNotes(prep.homeworkNotes ?? '');
        setDifficulties(prep.difficulties ?? '');
        setLessonPlan(prep.lessonPlan ?? '');

        if (prep.hasWorkbook) {
          try {
            const blob = await adminLessonsApi.workbook(teacherId, decodedEventId);
            if (!cancelled) setWorkbookUrl(URL.createObjectURL(blob));
          } catch { /* page remains usable */ }
        }
        if (prep.hasAnswers) {
          try {
            const blob = await adminLessonsApi.answers(teacherId, decodedEventId);
            if (!cancelled) setAnswersUrl(URL.createObjectURL(blob));
          } catch { /* page remains usable */ }
        }
      } catch (e) {
        if (!cancelled) setError(toErrorMessage(e, t));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [teacherId, decodedEventId, t]);

  useEffect(() => () => { if (workbookUrl) URL.revokeObjectURL(workbookUrl); }, [workbookUrl]);
  useEffect(() => () => { if (answersUrl) URL.revokeObjectURL(answersUrl); }, [answersUrl]);

  async function save() {
    if (saving) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const updated = await adminLessonsApi.updatePreparation(teacherId, decodedEventId, { homeworkNotes, difficulties, lessonPlan });
      setPreparation(updated);
      setMessage('Подготовка сохранена. Учитель увидит эти изменения в своём аккаунте.');
    } catch (e) {
      setError(toErrorMessage(e, t));
    } finally {
      setSaving(false);
    }
  }

  async function upload(kind: MaterialKind, file: File) {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setError('Нужен PDF-файл.');
      return;
    }
    setUploading(kind);
    setError(null);
    setMessage(null);
    try {
      const updated = kind === 'workbook'
        ? await adminLessonsApi.uploadWorkbook(teacherId, decodedEventId, file)
        : await adminLessonsApi.uploadAnswers(teacherId, decodedEventId, file);
      setPreparation(updated);
      const blob = kind === 'workbook'
        ? await adminLessonsApi.workbook(teacherId, decodedEventId)
        : await adminLessonsApi.answers(teacherId, decodedEventId);
      const url = URL.createObjectURL(blob);
      if (kind === 'workbook') setWorkbookUrl(url); else setAnswersUrl(url);
      setMessage(kind === 'workbook' ? 'Рабочая тетрадь обновлена.' : 'Ответы для учителя обновлены.');
    } catch (e) {
      setError(toErrorMessage(e, t));
    } finally {
      setUploading(null);
    }
  }

  if (loading) return <p className="muted">Загрузка…</p>;

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <Link className="muted" to={`/admin/lessons?teacherId=${teacherId}`}>← Все уроки преподавателя</Link>
          <h1 style={{ margin: '10px 0 4px' }}>{lesson?.title ?? 'Урок'}</h1>
          <div className="muted">Преподаватель: <strong>{teacher?.fullName ?? '—'}</strong></div>
          {lesson && <div className="muted" style={{ marginTop: 3 }}>{formatDateTime(lesson.startsAt)} · {formatTime(lesson.startsAt)}–{formatTime(lesson.endsAt)}</div>}
          {(lesson?.groupName || lesson?.studentName) && (
            <div style={{ marginTop: 7, fontWeight: 800, color: '#d94f00' }}>
              {lesson?.groupName ? `Группа: ${lesson.groupName}` : `Ученик: ${lesson?.studentName}`}
            </div>
          )}
        </div>
        {lesson?.calendarUrl && <a className="btn btn--ghost" href={lesson.calendarUrl} target="_blank" rel="noreferrer">Google Calendar</a>}
      </div>

      {error && <div className="banner banner--error" style={{ marginBottom: 14 }}>{error}</div>}
      {message && <div className="banner banner--success" style={{ marginBottom: 14 }}>{message}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14, marginBottom: 16 }}>
        <AdminMaterialCard
          title="Рабочая тетрадь"
          filename={preparation?.workbookFilename}
          url={workbookUrl}
          uploading={uploading === 'workbook'}
          onUpload={(file) => void upload('workbook', file)}
        />
        <AdminMaterialCard
          title="Ответы для учителя"
          filename={preparation?.answersFilename}
          url={answersUrl}
          uploading={uploading === 'answers'}
          onUpload={(file) => void upload('answers', file)}
        />
      </div>

      <div className="stack" style={{ gap: 14 }}>
        <EditorCard title="Что было с домашкой" value={homeworkNotes} onChange={setHomeworkNotes} rows={7} />
        <EditorCard title="Проблемы и сложности" value={difficulties} onChange={setDifficulties} rows={10} />
        <EditorCard title="Рекомендованный план урока" value={lessonPlan} onChange={setLessonPlan} rows={12} />

        <section className="panel" style={{ padding: 16, margin: 0, display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="muted" style={{ fontSize: 13 }}>Сохраняется прямо в подготовку преподавателя — отдельной админской копии нет.</div>
          <button className="btn" type="button" onClick={() => void save()} disabled={saving} style={{ minWidth: 230 }}>
            {saving ? 'Сохраняем…' : 'Сохранить подготовку'}
          </button>
        </section>
      </div>
    </div>
  );
}

function AdminMaterialCard({ title, filename, url, uploading, onUpload }: {
  title: string;
  filename?: string | null;
  url: string | null;
  uploading: boolean;
  onUpload: (file: File) => void;
}) {
  return (
    <section className="panel" style={{ padding: 18, margin: 0 }}>
      <h2 style={{ margin: 0, fontSize: 20 }}>{title}</h2>
      {url ? (
        <div style={{ marginTop: 14, border: '1px solid var(--border)', borderRadius: 12, padding: 13, background: '#fff' }}>
          <div style={{ fontWeight: 800, overflowWrap: 'anywhere' }}>{filename || 'PDF-файл'}</div>
          <a className="btn" href={url} target="_blank" rel="noopener noreferrer" style={{ marginTop: 10 }}>Открыть PDF ↗</a>
        </div>
      ) : (
        <div className="muted" style={{ marginTop: 14 }}>Файл ещё не добавлен.</div>
      )}
      <label className="btn btn--ghost" style={{ marginTop: 12, cursor: uploading ? 'default' : 'pointer' }}>
        {uploading ? 'Загружаем…' : url ? 'Заменить PDF' : 'Загрузить PDF'}
        <input type="file" accept="application/pdf,.pdf" hidden disabled={uploading} onChange={(e) => { const file = e.target.files?.[0]; if (file) onUpload(file); e.currentTarget.value = ''; }} />
      </label>
    </section>
  );
}

function EditorCard({ title, value, onChange, rows }: { title: string; value: string; onChange: (value: string) => void; rows: number }) {
  return (
    <section className="panel" style={{ padding: 18, margin: 0 }}>
      <h2 style={{ margin: '0 0 12px' }}>{title}</h2>
      <textarea className="input" rows={rows} value={value} onChange={(e) => onChange(e.target.value)} />
    </section>
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: '2-digit', month: 'long' }).format(new Date(value));
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}
