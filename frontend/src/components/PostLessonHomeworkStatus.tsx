import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { onlineClassesApi, type PostLessonHomeworkJob } from '../api/onlineClasses';

export function PostLessonHomeworkStatus({ eventId, de }: { eventId: string; de: boolean }) {
  const { user } = useAuth();
  const isPilot = user?.id === '14e3c7c1-1fc8-41bd-858a-6c20efdd957a' && user.role === 'TEACHER';
  const [id, setId] = useState<string | null>(null);
  const [job, setJob] = useState<PostLessonHomeworkJob | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setId(null); setJob(null); setError('');
    if (!isPilot) return () => { active = false; };
    void onlineClassesApi.findByEvent(eventId).then(rooms => {
      if (!active) return;
      const ended = rooms.find(room => room.status === 'ENDED');
      if (ended) setId(ended.id);
    }).catch(() => {});
    return () => { active = false; };
  }, [eventId, isPilot]);
  useEffect(() => {
    if (!id || !isPilot) return;
    let active = true;
    const load = () => void onlineClassesApi.postLessonHomeworkStatus(id).then(response => {
      if (active) setJob(response);
    }).catch(() => {
      if (active) setError(de ? 'Status nicht verfügbar' : 'Не удалось загрузить статус');
    });
    load();
    const timer = window.setInterval(load, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [id, de, isPilot]);
  if (!isPilot || !job || job.state === 'NONE') return null;
  const label = job.state === 'PUBLISHED'
    ? (de ? 'Hausaufgaben verteilt' : 'Домашка назначена')
    : job.state === 'FAILED'
      ? (de ? 'Erstellung fehlgeschlagen' : 'Ошибка генерации')
      : job.state === 'QUEUED'
        ? (de ? 'In Warteschlange' : 'В очереди')
        : (de ? 'PDFs werden erstellt' : 'Создаются PDF');
  return (
    <div className="post-homework-job-status" role="status" aria-live="polite"
      style={{ border: '1px solid var(--border-color, #7775)', borderRadius: 12, padding: 12, marginTop: 12 }}>
      <strong>{label}</strong>
      {job.expectedFiles ? <p style={{ margin: '6px 0' }}>{job.generatedFiles ?? 0} / {job.expectedFiles} PDF</p> : null}
      {job.state === 'FAILED' && <p>{job.failureCode || (de ? 'Unbekannter Fehler' : 'Неизвестная ошибка')}</p>}
      {error && <p>{error}</p>}
      {job.state === 'FAILED' && id && <button type="button" className="btn btn--secondary" disabled={retrying}
        onClick={() => {
          setRetrying(true);
          void onlineClassesApi.retryPostLessonHomework(id).then(setJob)
            .catch(() => setError(de ? 'Neustart nicht möglich' : 'Не удалось повторить запуск'))
            .finally(() => setRetrying(false));
        }}>{de ? 'Erneut versuchen' : 'Повторить'}</button>}
    </div>
  );
}
