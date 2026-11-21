import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { Link } from 'react-router-dom';
import { onlineClassesApi, type OnlineClass, type PostLessonHomeworkJob } from '../api/onlineClasses';
import { postLessonHomeworkFailureMessage, postLessonHomeworkStageMessage } from '../features/online-classes/postLessonHomeworkMessages';

function endedAt(room: OnlineClass): number {
  const actual = room.actualEndAt ? Date.parse(room.actualEndAt) : NaN;
  return Number.isFinite(actual) ? actual : Date.parse(room.scheduledEndAt) || 0;
}

export function PostLessonHomeworkStatus({ eventId, de }: { eventId: string; de: boolean }) {
  const { user } = useAuth();
  const isPilot = user?.role === 'TEACHER';
  const [resolved, setResolved] = useState<{ eventId: string; id: string } | null>(null);
  const id = resolved?.eventId === eventId ? resolved.id : null;
  const [job, setJob] = useState<PostLessonHomeworkJob | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const requestVersion = useRef(0);
  const retryInFlight = useRef(false);

  useEffect(() => {
    let active = true;
    requestVersion.current += 1;
    retryInFlight.current = false;
    setResolved(null); setJob(null); setError(''); setRetrying(false);
    if (!isPilot) return () => { active = false; };
    void onlineClassesApi.findByEvent(eventId).then(rooms => {
      if (!active) return;
      const ended = rooms.filter(room => room.status === 'ENDED')
        .sort((a, b) => endedAt(b) - endedAt(a) || a.id.localeCompare(b.id))[0];
      if (ended) setResolved({ eventId, id: ended.id });
    }).catch(() => {
      if (active) setError(de ? 'Der Hausaufgabenstatus konnte nicht geladen werden.' : 'Не удалось загрузить статус домашки.');
    });
    return () => { active = false; requestVersion.current += 1; };
  }, [eventId, isPilot, de, refresh]);

  useEffect(() => {
    if (!id || !isPilot) return;
    let active = true;
    const load = () => {
      if (retryInFlight.current) return;
      const version = ++requestVersion.current;
      void onlineClassesApi.postLessonHomeworkStatus(id).then(response => {
        if (active && version === requestVersion.current) { setJob(response); setError(''); }
      }).catch(() => {
        if (active && version === requestVersion.current) {
          setError(de ? 'Der Hausaufgabenstatus konnte nicht geladen werden.' : 'Не удалось загрузить статус домашки.');
        }
      });
    };
    load();
    const timer = window.setInterval(load, 5000);
    return () => { active = false; requestVersion.current += 1; clearInterval(timer); };
  }, [id, de, isPilot]);

  const retry = async () => {
    if (!id || retryInFlight.current) return;
    retryInFlight.current = true;
    const version = ++requestVersion.current;
    setRetrying(true); setError('');
    try {
      const response = await onlineClassesApi.retryPostLessonHomework(id);
      if (version === requestVersion.current) {
        setJob(response);
        if (response.state === 'NONE') {
          setError(de ? 'Der Server hat keinen Neustart bestätigt. Bitte den Status aktualisieren.' :
            'Сервер не подтвердил повторный запуск. Обновите статус.');
        }
      }
    } catch {
      if (version === requestVersion.current) {
        setError(de ? 'Der erneute Versuch wurde nicht bestätigt. Bitte den Status aktualisieren.' :
          'Повторный запуск не подтверждён. Обновите статус.');
      }
    } finally {
      if (version === requestVersion.current) { retryInFlight.current = false; setRetrying(false); }
    }
  };

  if (!isPilot || (!error && (!id || !job || job.state === 'NONE'))) return null;
  const visibleJob = id && job?.state !== 'NONE' ? job : null;
  const label = visibleJob?.state === 'PUBLISHED'
    ? (de ? 'Hausaufgaben verteilt' : 'Домашка назначена')
    : visibleJob?.state === 'FAILED'
      ? (de ? 'Erstellung fehlgeschlagen' : 'Ошибка генерации')
      : visibleJob?.state === 'QUEUED'
        ? (de ? 'In Warteschlange' : 'В очереди')
        : (de ? 'PDFs werden erstellt' : 'Создаются PDF');
  return (
    <div className="post-homework-job-status" role="status" aria-live="polite"
      style={{ border: '1px solid var(--border-color, #7775)', borderRadius: 12, padding: 12, marginTop: 12 }}>
      {visibleJob && <>
        <strong>{label}</strong>
        {typeof visibleJob.expectedFiles === 'number' && <p style={{ margin: '6px 0' }}>
          {visibleJob.generatedFiles ?? 0} / {visibleJob.expectedFiles} PDF
        </p>}
        {visibleJob.state === 'FAILED' && <p>{postLessonHomeworkFailureMessage(visibleJob.failureCode, de)}</p>}
        {(visibleJob.state === 'FAILED' || visibleJob.state === 'RUNNING') && postLessonHomeworkStageMessage(visibleJob, de) &&
          <p>{postLessonHomeworkStageMessage(visibleJob, de)}</p>}
      </>}
      {error && <p role="alert">{error}</p>}
      {error && <button type="button" className="btn btn--secondary" disabled={retrying}
        onClick={() => setRefresh(value => value + 1)}>{de ? 'Status aktualisieren' : 'Обновить статус'}</button>}
      {visibleJob && id && (visibleJob.state === 'PUBLISHED' || (visibleJob.generatedFiles ?? 0) > 0) &&
        <Link className="btn btn--secondary" to={'/teacher/post-homework-review/' + encodeURIComponent(id)}>
          {de ? 'Hausaufgaben prüfen' : 'Проверить домашку и PDF'}
        </Link>}
      {visibleJob?.state === 'FAILED' && id && <button type="button" className="btn btn--secondary" disabled={retrying}
        onClick={() => void retry()}>{retrying ? (de ? 'Wird gestartet...' : 'Запускаем...') :
          (de ? 'Erneut versuchen' : 'Повторить')}</button>}
    </div>
  );
}
