import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { lessonPreparationApi } from '../../api/lessonPreparation';
import { adminLessonsApi } from '../../api/adminLessons';

type Material = 'workbook' | 'answers';

/**
 * The push target is role-neutral. An administrator may read the teacher's
 * material via the admin API; the teacher reads the same lesson via their
 * personal API. No PDF token or public download URL is put in the push.
 */
export function OwnerWorkbookNotificationPreviewPage() {
  const { teacherId = '', eventId = '' } = useParams();
  const { user } = useAuth();
  const [kind, setKind] = useState<Material>('workbook');
  const [workbook, setWorkbook] = useState<string | null>(null);
  const [answers, setAnswers] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isAdmin = user?.role === 'ADMIN';
  const owner = Boolean(teacherId && teacherId === user?.id);
  const allowed = isAdmin || owner;
  const lessonPath = isAdmin
    ? `/admin/teachers/${encodeURIComponent(teacherId)}/lessons/${encodeURIComponent(eventId)}`
    : `/teacher/lessons/${encodeURIComponent(eventId)}`;

  useEffect(() => {
    if (!allowed || !eventId) { setLoading(false); return; }
    let cancelled = false;
    const urls: string[] = [];
    setLoading(true);
    setError(null);
    setWorkbook(null);
    setAnswers(null);

    const makeUrl = async (material: Material): Promise<string> => {
      if (isAdmin) {
        const file = material === 'workbook'
          ? await adminLessonsApi.workbook(teacherId, eventId)
          : await adminLessonsApi.answers(teacherId, eventId);
        return URL.createObjectURL(file);
      }
      return material === 'workbook'
        ? lessonPreparationApi.workbookUrl(eventId)
        : lessonPreparationApi.answersUrl(eventId);
    };

    async function load() {
      try {
        // Render the student's workbook immediately. Solutions are fetched
        // separately so a missing answers PDF does not block first preview.
        const url = await makeUrl('workbook');
        urls.push(url);
        if (cancelled) return;
        setWorkbook(url);
        setLoading(false);
        try {
          const answerUrl = await makeUrl('answers');
          urls.push(answerUrl);
          if (!cancelled) setAnswers(answerUrl);
        } catch { /* An absent answers PDF must not hide the workbook. */ }
      } catch {
        if (!cancelled) {
          setError('Рабочая тетрадь ещё не готова или PDF не удалось открыть.');
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [teacherId, eventId, allowed, isAdmin]);

  if (!allowed) return (
    <div className="panel" role="alert" style={{ padding: 24 }}>
      Эта тетрадь доступна только администратору или преподавателю урока.
    </div>
  );

  const current = kind === 'workbook' ? workbook : answers;
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 3000, display: 'flex', flexDirection: 'column', background: '#fff', color: '#1d2939', paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <header style={{ padding: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, borderBottom: '1px solid #ddd' }}>
        <div>
          <div style={{ fontSize: 13, color: '#667085' }}>Mindcrafti School</div>
          <strong>{kind === 'workbook' ? 'Рабочая тетрадь' : 'Ответы для учителя'}</strong>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          {answers && <button className="btn btn--secondary" type="button" onClick={() => setKind(kind === 'workbook' ? 'answers' : 'workbook')}>
            {kind === 'workbook' ? 'Ответы для учителя' : 'Рабочая тетрадь'}
          </button>}
          {current && <a className="btn btn--secondary" href={current}
            download={kind === 'workbook' ? 'Arbeitsblatt.pdf' : 'Lehrerloesungen.pdf'}>Скачать PDF</a>}
          <Link className="btn" to={lessonPath}>Вернуться к уроку</Link>
        </div>
      </header>
      {loading ? <div role="status" style={{ padding: 24 }}>Загружаем рабочую тетрадь…</div>
        : error ? <div role="alert" style={{ padding: 24 }}>{error} <Link to={lessonPath}>Открыть урок</Link></div>
        : current ? <iframe title={kind === 'workbook' ? 'Рабочая тетрадь PDF' : 'Ответы для учителя PDF'}
            src={current} style={{ flex: 1, width: '100%', border: 'none', minHeight: 0 }}/>
        : <div role="status" style={{ padding: 24 }}>Ответы ещё не прикреплены к уроку.</div>}
    </div>
  );
}
