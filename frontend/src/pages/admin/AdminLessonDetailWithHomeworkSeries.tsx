import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { adminLessonsApi } from '../../api/adminLessons';
import type { GroupLesson } from '../../api/types';
import { LessonHomeworkSeriesPanel } from '../../components/LessonHomeworkSeriesPanel';
import { AdminLessonDetailPage } from './AdminLessonDetailPage';

export function AdminLessonDetailWithHomeworkSeries() {
  const { teacherId = '', eventId = '' } = useParams();
  const decodedEventId = useMemo(() => decodeURIComponent(eventId), [eventId]);
  const [lesson, setLesson] = useState<GroupLesson | null>(null);

  useEffect(() => {
    let cancelled = false;
    adminLessonsApi.list(teacherId)
      .then((lessons) => {
        if (!cancelled) setLesson(lessons.find((item) => item.eventId === decodedEventId) ?? null);
      })
      .catch(() => {
        if (!cancelled) setLesson(null);
      });
    return () => { cancelled = true; };
  }, [teacherId, decodedEventId]);

  return (
    <div className="stack" style={{ gap: 14 }}>
      <AdminLessonDetailPage />
      <div style={{ maxWidth: 1200, width: '100%', margin: '0 auto' }}>
        <LessonHomeworkSeriesPanel
          lesson={lesson}
          onAssign={(startDate, days, files) => adminLessonsApi.assignHomeworkSeries(teacherId, decodedEventId, startDate, days, files)}
        />
      </div>
    </div>
  );
}
