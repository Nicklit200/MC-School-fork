import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { useI18n } from '../../i18n/I18nContext';
import { onlineClassesApi } from '../../api/onlineClasses';
import { OnlineClassRoom } from '../../features/online-classes/OnlineClassRoom';
import { OnlineClassErrorBoundary } from '../../features/online-classes/OnlineClassErrorBoundary';
import { PrejoinPanel } from '../../features/online-classes/PrejoinPanel';
import { useClassSession } from '../../features/online-classes/useClassSession';

/**
 * Prejoin, then the room. Server-side authorization still governs everything;
 * this only decides what to show.
 */
export function OnlineClassPage() {
  const { classId } = useParams<{ classId: string }>();
  const { t } = useI18n();
  const { user } = useAuth();
  const navigate = useNavigate();
  const session = useClassSession(classId);
  const endingRef = useRef(false);
  const [finishedLesson, setFinishedLesson] = useState<{ eventId: string; title: string } | null>(null);

  useEffect(() => {
    if (session.onlineClass?.id && classId && session.onlineClass.id !== classId) {
      navigate(`/online-classes/${session.onlineClass.id}`, { replace: true });
    }
  }, [classId, navigate, session.onlineClass?.id]);

  useEffect(() => {
    const current = session.onlineClass;
    const isStagingHost =
      typeof window !== 'undefined'
      && window.location.hostname === 'staging-web-production.up.railway.app';

    if (
      !isStagingHost
      || !current?.viewerIsHost
      || !current.eventId.startsWith('test-')
      || !classId
    ) {
      return;
    }

    let active = true;
    onlineClassesApi.listUpcoming()
      .then((classes) => {
        if (!active) return;
        const candidates = classes
          .filter((item) =>
            item.eventId.startsWith('test-')
            && item.status === 'LIVE'
            && item.studentId === current.studentId
            && item.groupId === current.groupId
          )
          .sort(
            (a, b) =>
              new Date(b.scheduledStartAt).getTime()
              - new Date(a.scheduledStartAt).getTime(),
          );

        const newest = candidates[0];
        if (newest && newest.id !== classId) {
          session.release();
          navigate(`/online-classes/${newest.id}`, { replace: true });
        }
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, [classId, navigate, session.onlineClass]);

  if (finishedLesson) {
    const uploadTranscript = () => {
      localStorage.removeItem('mindcrafti.startedGroupLesson');
      localStorage.removeItem('mindcrafti.startedGroupLessonOpenedAt');
      localStorage.removeItem(`mindcrafti.sonioxStopNotification.${finishedLesson.eventId}`);
      navigate(
        `/teacher/lessons?fromClass=1&completedLesson=${encodeURIComponent(finishedLesson.eventId)}`,
        { replace: true },
      );
    };

    return (
      <div style={{ minHeight: '70vh', display: 'grid', placeItems: 'center', padding: 20 }}>
        <div className="panel" style={{ width: 'min(620px, 100%)', padding: 30, textAlign: 'center', border: '2px solid #ff6a00', boxShadow: '0 24px 70px rgba(15,23,42,.24)' }}>
          <div style={{ fontSize: 30, fontWeight: 900, color: '#d94f00', marginBottom: 10 }}>
            Останови Soniox
          </div>
          <div style={{ fontSize: 18, lineHeight: 1.5, marginBottom: 10 }}>
            Урок «{finishedLesson.title}» завершён. Останови запись Soniox.
          </div>
          <div className="banner banner--success" style={{ marginBottom: 18, textAlign: 'left' }}>
            Доски урока уже сохраняются автоматически. После Soniox останется только загрузить транскрипцию.
          </div>
          <button
            className="btn"
            type="button"
            onClick={uploadTranscript}
            style={{ width: '100%', minHeight: 54, fontSize: 16 }}
          >
            Soniox остановлен — загрузить транскрипцию
          </button>
        </div>
      </div>
    );
  }

  if (session.phase === 'loading') {
    return <p>{t('common.loading')}</p>;
  }

  // A forbidden class and a missing one look identical by design.
  if (session.phase === 'denied') {
    return <p role="alert">{t('error.generic')}</p>;
  }

  if (session.phase === 'unavailable') {
    return <p role="alert">{t('onlineClass.unavailable')}</p>;
  }

  if (session.connection) {
    return (
      <OnlineClassErrorBoundary onBack={() => navigate('/teacher/lessons')}>
      <OnlineClassRoom
        classId={classId!}
        currentUserId={user?.id ?? ''}
        connection={session.connection}
        recordingState={session.onlineClass?.recordingState ?? 'INACTIVE'}
        transcriptionState={session.onlineClass?.transcriptionState ?? 'INACTIVE'}
        studentAnnotationAllowed={true}
        onStateChanged={() => void session.reload()}
        onLeave={() => {
          if (endingRef.current) return;
          session.release();
          navigate(-1);
        }}
        onEndForAll={
          session.onlineClass?.viewerIsHost && classId
            ? (attendance) => {
                if (endingRef.current) return;
                endingRef.current = true;
                void onlineClassesApi.finish(classId, attendance)
                  .then((endedClass) => {
                    setFinishedLesson({
                      eventId: endedClass.eventId,
                      title: endedClass.title,
                    });
                    session.release();
                  })
                  .catch(() => {
                    endingRef.current = false;
                    window.alert(t('error.generic'));
                  });
              }
            : undefined
        }
      />
      </OnlineClassErrorBoundary>
    );
  }

  return (
    <div className="online-class-page">
      <h1>{session.onlineClass?.title ?? t('onlineClass.title')}</h1>

      <div role="status" aria-live="polite">
        {session.phase === 'waiting' && <p>{t('onlineClass.waitingForTeacher')}</p>}
        {session.phase === 'notOpen' && <p>{t('onlineClass.notOpen')}</p>}
        {session.phase === 'failed' && <p>{t('error.generic')}</p>}
      </div>

      <PrejoinPanel
        joinDisabled={session.phase === 'requesting'}
        onJoin={() => {
          void session.requestConnection();
        }}
      />
    </div>
  );
}
