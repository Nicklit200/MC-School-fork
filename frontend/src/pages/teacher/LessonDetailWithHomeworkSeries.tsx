import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../api/client';
import { lessonPreparationApi } from '../../api/lessonPreparation';
import type { GroupLesson } from '../../api/types';
import { LessonHomeworkSeriesPanel } from '../../components/LessonHomeworkSeriesPanel';
import { LessonDetailPage } from './LessonDetailPage';

export function LessonDetailWithHomeworkSeries() {
  const { eventId = '' } = useParams();
  const decodedEventId = useMemo(() => decodeURIComponent(eventId), [eventId]);
  const [lesson, setLesson] = useState<GroupLesson | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.lessons.groupLessons()
      .then((lessons) => {
        if (!cancelled) setLesson(lessons.find((item) => item.eventId === decodedEventId) ?? null);
      })
      .catch(() => {
        if (!cancelled) setLesson(null);
      });
    return () => { cancelled = true; };
  }, [decodedEventId]);

  return (
    <div className="stack" style={{ gap: 14 }}>
      <LessonDetailPage />
      <div style={{ maxWidth: 1320, width: '100%', margin: '0 auto' }}>
        <LessonHomeworkSeriesPanel
          lesson={lesson}
          onAssign={(startDate, days, files) => lessonPreparationApi.assignHomeworkSeries(decodedEventId, startDate, days, files)}
        />
      </div>
    </div>
  );
}
