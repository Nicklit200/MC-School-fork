import '../../online-classes.css';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { useI18n } from '../../i18n/I18nContext';
import { onlineClassesApi } from '../../api/onlineClasses';
import { OnlineClassRoom } from '../../features/online-classes/OnlineClassRoom';
import { PrejoinPanel, type PrejoinChoice } from '../../features/online-classes/PrejoinPanel';
import { useClassSession } from '../../features/online-classes/useClassSession';
import type { LiveKitErrorCategory } from '../../features/online-classes/livekitDiagnostics';

/**
 * Prejoin, then the room. Server-side authorization still governs everything;
 * this only decides what to show.
 */

/** A server-side API probe is not a browser WebSocket/ICE connection test. */
type MediaApiStatus = 'idle' | 'checking' | 'reachable' | 'authRejected' | 'unreachable' | 'requestFailed';

export function OnlineClassPage() {
  const { classId } = useParams<{ classId: string }>();
  const { t, language } = useI18n();
  const { user } = useAuth();
  const navigate = useNavigate();
  const session = useClassSession(classId);
  const [hasDisconnected, setHasDisconnected] = useState(false);
  const [disconnectReason, setDisconnectReason] = useState<string | null>(null);
  const [mediaApiStatus, setMediaApiStatus] = useState<MediaApiStatus>('idle');
  const [liveKitErrorCategory, setLiveKitErrorCategory] = useState<LiveKitErrorCategory | null>(null);
  const [connectedBeforeDrop, setConnectedBeforeDrop] = useState<boolean | null>(null);
  const [initialMedia, setInitialMedia] = useState<PrejoinChoice>({
    videoDeviceId: null,
    audioDeviceId: null,
    cameraEnabled: false,
    microphoneEnabled: false,
  });

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

  if (!session.connection && session.onlineClass?.viewerIsHost && !session.onlineClass.joinWindowOpen
      && (session.onlineClass.status === 'LIVE' || session.onlineClass.status === 'LOBBY_OPEN')) {
    return <section className="panel">
      <p role="status">{language === 'DE'
        ? 'Diese Sitzung ist abgelaufen. Starten Sie den Unterricht erneut, damit der Schüler beitreten kann.'
        : 'Время этой сессии истекло. Запустите урок заново, чтобы ученик мог подключиться.'}</p>
      <Link className="btn" to={`/teacher/lessons/${encodeURIComponent(session.onlineClass.eventId)}`}>
        {language === 'DE' ? 'Zum Unterricht' : 'Открыть карточку урока'}
      </Link>
    </section>;
  }

  if (session.connection) {
    return (
      <OnlineClassRoom
        classId={classId!}
        currentUserId={user?.id ?? ''}
        eventId={session.onlineClass?.eventId}
        connection={session.connection}
        initialMedia={initialMedia}
        recordingState={session.onlineClass?.recordingState ?? 'INACTIVE'}
        transcriptionState={session.onlineClass?.transcriptionState ?? 'INACTIVE'}
        studentScreenShareEnabled={session.onlineClass?.studentScreenShareEnabled ?? false}
        recordingAvailable={session.onlineClass?.recordingAvailable ?? false}
        transcriptionAvailable={session.onlineClass?.transcriptionAvailable ?? false}
        onStateChanged={() => void session.reload()}
        onMediaError={(category) => {
          setLiveKitErrorCategory(category);
        }}
        onConnectionLost={(reason, everConnected) => {
          setDisconnectReason(reason ?? null);
          setConnectedBeforeDrop(everConnected ?? null);
          setHasDisconnected(true);
          session.transportDisconnected();
          if (session.onlineClass?.viewerIsHost && classId) {
            setMediaApiStatus('checking');
            // Only the teacher may run the server-side probe. No credentials,
            // room URL or access token are returned in this response.
            void onlineClassesApi.mediaDiagnostics(classId)
              .then(({ mediaApiReachable, diagnosticStatus }) =>
                setMediaApiStatus(
                  mediaApiReachable ? 'reachable'
                    : diagnosticStatus === 'AUTH_REJECTED' ? 'authRejected'
                      : 'unreachable'))
              .catch(() => setMediaApiStatus('requestFailed'));
          }
        }}
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

  // Unexpected LiveKit transport loss is NOT a click on the Leave button.
  // Keep the same lesson URL and allow requesting a fresh signed room token.
  // A failed retry stays on this screen instead of navigating back.
  if (hasDisconnected || session.phase === 'disconnected') {
    const retry = (withoutDevices: boolean) => {
      if (withoutDevices) {
        setInitialMedia({
          videoDeviceId: null,
          audioDeviceId: null,
          cameraEnabled: false,
          microphoneEnabled: false,
        });
      }
      void session.requestConnection();
    };
    return (
      <div className="online-class-page">
        <h1>{session.onlineClass?.title ?? t('onlineClass.title')}</h1>
        <section className="prejoin online-class-reconnect" aria-labelledby="reconnect-title">
          <div className="prejoin__eyebrow">Mindcrafti Online</div>
          <h2 id="reconnect-title">{t('onlineClass.disconnect.title')}</h2>
          <p>{t('onlineClass.disconnect.hint')}</p>
          {disconnectReason && (
            <p className="online-class-reconnect__code">{t('onlineClass.disconnect.code')}: {disconnectReason}</p>
          )}
          <div className="online-class-reconnect__diagnostics" role="status" aria-live="polite">
            {disconnectReason === '0' && (
              <p>{t('onlineClass.disconnect.unknownReason')}</p>
            )}
            {connectedBeforeDrop !== null && (
              <p>{t('onlineClass.disconnect.initialConnection')}: {
                connectedBeforeDrop
                  ? t('onlineClass.disconnect.initialConnectionYes')
                  : t('onlineClass.disconnect.initialConnectionNo')
              }</p>
            )}
            {liveKitErrorCategory && (
              <p>{t('onlineClass.disconnect.browserError')}: {
                t(`onlineClass.disconnect.error.${liveKitErrorCategory}` as
                  | 'onlineClass.disconnect.error.authorization'
                  | 'onlineClass.disconnect.error.signaling'
                  | 'onlineClass.disconnect.error.network'
                  | 'onlineClass.disconnect.error.devices'
                  | 'onlineClass.disconnect.error.unknown')
              }</p>
            )}
            {session.onlineClass?.viewerIsHost && mediaApiStatus !== 'idle' && (
              <p>{t('onlineClass.disconnect.apiStatus')}: {
                t(`onlineClass.disconnect.api.${mediaApiStatus}` as
                  | 'onlineClass.disconnect.api.checking'
                  | 'onlineClass.disconnect.api.reachable'
                  | 'onlineClass.disconnect.api.authRejected'
                  | 'onlineClass.disconnect.api.unreachable'
                  | 'onlineClass.disconnect.api.requestFailed')
              }</p>
            )}
          </div>
          {session.phase === 'failed' && (
            <p role="alert" className="prejoin__error">
              {session.errorMessage ?? t('onlineClass.status.failed')}
            </p>
          )}
          <div className="online-class-reconnect__actions">
            <button className="prejoin__join" type="button"
              disabled={session.phase === 'requesting'}
              onClick={() => retry(false)}>
              {t('onlineClass.disconnect.retry')}
            </button>
            <button className="prejoin__retry" type="button"
              disabled={session.phase === 'requesting'}
              onClick={() => retry(true)}>
              {t('onlineClass.disconnect.retryWithoutMedia')}
            </button>
            <button className="prejoin__retry" type="button" onClick={() => {
              session.release();
              navigate(-1);
            }}>
              {t('onlineClass.disconnect.back')}
            </button>
          </div>
        </section>
      </div>
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
        onJoin={(choice) => {
          setInitialMedia(choice);
          void session.requestConnection();
        }}
      />
    </div>
  );
}
