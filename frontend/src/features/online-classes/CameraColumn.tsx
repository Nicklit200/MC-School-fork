import {
  VideoTrack,
  useConnectionQualityIndicator,
  useConnectionState,
  useIsMuted,
  useIsSpeaking,
  useTracks,
  type TrackReferenceOrPlaceholder,
} from '@livekit/components-react';
import { Track } from 'livekit-client';
import { useRef } from 'react';
import { useI18n } from '../../i18n/I18nContext';
import { initialsOf, isReconnecting } from './cameraCard';
import { MAX_COLUMN_CAMERAS, mergeCameraOrder, sortByOrder } from './cameraOrder';
import { isFromHost } from './followTeacher';

function CameraCard({
  trackRef,
  isHost,
}: {
  trackRef: TrackReferenceOrPlaceholder;
  isHost: boolean;
}) {
  const { t } = useI18n();
  const { participant } = trackRef;
  const speaking = useIsSpeaking(participant);
  const micMuted = useIsMuted({ participant, source: Track.Source.Microphone });
  const cameraMuted = useIsMuted(trackRef);
  const { quality } = useConnectionQualityIndicator({ participant });
  const roomState = useConnectionState();

  const hasVideo = 'publication' in trackRef && !!trackRef.publication && !cameraMuted;
  const reconnecting = isReconnecting({ isLocal: participant.isLocal, quality, roomState });
  const name = participant.name || '';

  return (
    // Cards are purely informational: no click handler, so a card can never be
    // enlarged, and a teacher can see but not change a student's mic or camera.
    <li
      className="camera-card"
      data-speaking={speaking || undefined}
      data-host={isHost || undefined}
      data-camera={hasVideo ? 'on' : 'off'}
      data-reconnecting={reconnecting || undefined}
    >
      {hasVideo ? (
        <VideoTrack trackRef={trackRef as never} className="camera-card__video" />
      ) : (
        <div className="camera-card__avatar" aria-hidden="true">
          {initialsOf(name)}
        </div>
      )}

      {reconnecting && (
        <div className="camera-card__status" role="status">
          {t('onlineClass.cameras.reconnecting')}
        </div>
      )}

      <div className="camera-card__bar">
        <span className="camera-card__name">
          {name || (isHost ? t('onlineClass.cameras.teacher') : '')}
          {speaking && <span className="visually-hidden"> ({t('onlineClass.cameras.speaking')})</span>}
        </span>
        <span className="camera-card__indicators">
          <span
            className="camera-card__indicator"
            data-off={micMuted || undefined}
            role="img"
            aria-label={t(micMuted ? 'onlineClass.cameras.micOff' : 'onlineClass.cameras.micOn')}
          >
            {micMuted ? '🔇' : '🎤'}
          </span>
          <span
            className="camera-card__indicator"
            data-off={!hasVideo || undefined}
            role="img"
            aria-label={hasVideo ? undefined : t('onlineClass.cameras.cameraOff')}
            aria-hidden={hasVideo ? true : undefined}
          >
            {hasVideo ? '📹' : '🚫'}
          </span>
        </span>
      </div>
    </li>
  );
}

/**
 * Permanent camera column to the right of the board.
 *
 * Order is fixed for the whole lesson: the teacher first, students in the
 * order they arrived. The active speaker is highlighted where they stand, never
 * moved. Cards are all one size; a leaver's slot closes up, a latecomer lands
 * in the next free slot, and there is deliberately no scrolling at this stage
 * (the layout is sized for about five cameras).
 */
export function CameraColumn({
  hostUserId,
  localIsHost,
}: {
  hostUserId: string | null;
  localIsHost: boolean;
}) {
  const { t } = useI18n();
  const tracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }], {
    onlySubscribed: false,
  });

  const hostOf = (track: TrackReferenceOrPlaceholder) =>
    track.participant.isLocal ? localIsHost : isFromHost(track.participant.identity, hostUserId);

  // Remembered across renders so the order never reshuffles.
  const orderRef = useRef<string[]>([]);
  const order = mergeCameraOrder(
    orderRef.current,
    tracks.map((track) => ({ identity: track.participant.identity, isHost: hostOf(track) })),
  );
  orderRef.current = order;
  const ordered = sortByOrder(tracks, order, (track) => track.participant.identity);

  return (
    <ul className="camera-column" aria-label={t('onlineClass.cameras.label')} data-capacity={MAX_COLUMN_CAMERAS}>
      {ordered.map((track) => (
        <CameraCard key={track.participant.identity} trackRef={track} isHost={hostOf(track)} />
      ))}
    </ul>
  );
}
