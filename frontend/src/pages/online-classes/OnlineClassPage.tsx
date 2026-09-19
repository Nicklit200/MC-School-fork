import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { useI18n } from '../../i18n/I18nContext';
import { onlineClassesApi } from '../../api/onlineClasses';
import { OnlineClassRoom } from '../../features/online-classes/OnlineClassRoom';
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
      <OnlineClassRoom
        classId={classId!}
        currentUserId={user?.id ?? ''}
        connection={session.connection}
        recordingState={session.onlineClass?.recordingState ?? 'INACTIVE'}
        transcriptionState={session.onlineClass?.transcriptionState ?? 'INACTIVE'}
        studentAnnotationAllowed={session.onlineClass?.studentScreenShareEnabled ?? false}
        onStateChanged={() => void session.reload()}
        onLeave={() => {
          session.release();
          navigate(-1);
        }}
        onEndForAll={
          session.onlineClass?.viewerIsHost && classId
            ? () => {
                void onlineClassesApi.end(classId).then(() => {
                  session.release();
                  navigate(-1);
                });
              }
            : undefined
        }
      />
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
