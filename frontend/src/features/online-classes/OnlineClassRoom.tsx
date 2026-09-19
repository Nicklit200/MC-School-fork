import {
  CarouselLayout,
  ConnectionStateToast,
  ControlBar,
  FocusLayout,
  FocusLayoutContainer,
  GridLayout,
  LiveKitRoom,
  ParticipantTile,
  RoomAudioRenderer,
  useConnectionState,
  useTracks,
} from '@livekit/components-react';
import '@livekit/components-styles';
import { ConnectionState, Track } from 'livekit-client';
import { useI18n } from '../../i18n/I18nContext';
import {
  onlineClassesApi,
  type ClassFeatureState,
  type OnlineClassBoardContext,
  type OnlineClassConnection,
} from '../../api/onlineClasses';
import { ChatPanel } from './ChatPanel';
import { useEffect, useState } from 'react';
import { CaptionsPanel } from './CaptionsPanel';
import { RecordingControls } from './RecordingControls';
import { TranscriptionControls } from './TranscriptionControls';
import { ParticipantListPanel } from './ParticipantListPanel';
import { WaitingRoomPanel } from './WaitingRoomPanel';
import type { TranslationKey } from '../../i18n/translations';
import { BoardWorkspace } from './BoardWorkspace';

/**
 * Chooses grid or screen-share focus automatically, with a filmstrip of the
 * other participants when something is being shared.
 *
 * <p>Lives inside {@link LiveKitRoom} because the LiveKit hooks need the room
 * context.
 */
function ClassStage() {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );

  const screenShare = tracks.find((track) => track.source === Track.Source.ScreenShare);
  const cameras = tracks.filter((track) => track.source === Track.Source.Camera);

  if (screenShare) {
    return (
      <FocusLayoutContainer>
        <CarouselLayout tracks={cameras}>
          <ParticipantTile />
        </CarouselLayout>
        <FocusLayout trackRef={screenShare} />
      </FocusLayoutContainer>
    );
  }

  return (
    <GridLayout tracks={cameras}>
      <ParticipantTile />
    </GridLayout>
  );
}

function statusKeyFor(state: ConnectionState): TranslationKey {
  switch (state) {
    case ConnectionState.Connected:
      return 'onlineClass.status.connected';
    case ConnectionState.Reconnecting:
      return 'onlineClass.status.reconnecting';
    case ConnectionState.Disconnected:
      return 'onlineClass.status.disconnected';
    default:
      return 'onlineClass.status.connecting';
  }
}

/** Announces connection changes; must be rendered inside the room context. */
function ConnectionStatus() {
  const { t } = useI18n();
  const state = useConnectionState();

  return (
    <div role="status" aria-live="polite" className="online-class-room__status">
      {t(statusKeyFor(state))}
    </div>
  );
}

/**
 * Room shell. Built on the official LiveKit React components rather than a
 * hand-rolled WebRTC layer; MC-School owns the surrounding authorization,
 * localization and chrome.
 */
export function OnlineClassRoom({
  classId,
  currentUserId,
  connection,
  recordingState,
  transcriptionState,
  studentAnnotationAllowed = false,
  onLeave,
  onEndForAll,
  onStateChanged,
}: {
  classId: string;
  currentUserId: string;
  connection: OnlineClassConnection;
  recordingState: ClassFeatureState;
  transcriptionState: ClassFeatureState;
  /** Teacher-governed: students annotate only when the class allows it. */
  studentAnnotationAllowed?: boolean;
  onLeave: () => void;
  onEndForAll?: () => void;
  onStateChanged?: () => void;
}) {
  const { t } = useI18n();
  // The classroom is board-first: starting a lesson opens its durable lesson
  // board immediately. Video remains one click away via the toggle below.
  const [boardOpen, setBoardOpen] = useState(true);
  const [boardContext, setBoardContext] = useState<OnlineClassBoardContext | null>(null);

  useEffect(() => {
    let active = true;
    onlineClassesApi
      .boardContext(classId)
      .then((context) => {
        if (!active) return;
        setBoardContext(context);
        // Board state is tied to this lesson/class. If a workbook was prepared
        // for the lesson it appears as the sheet background automatically.
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [classId]);

  useEffect(() => {
    if (!connection.host) return;

    let active = true;
    let inFlight = false;

    const refreshConnectedStudents = async () => {
      if (!active || inFlight) return;
      inFlight = true;
      try {
        const participants = await onlineClassesApi.listParticipants(classId);
        if (!active) return;

        const students = participants
          .filter((participant) => participant.classRole === 'STUDENT' && participant.connected)
          .map((participant) => ({
            id: participant.userId,
            fullName: participant.displayName,
          }))
          .sort((a, b) => a.fullName.localeCompare(b.fullName));

        setBoardContext((current) =>
          current ? { ...current, students } : current,
        );
      } catch {
        // Participant polling elsewhere in the room may still recover; avoid
        // hiding an already visible private board on a transient request error.
      } finally {
        inFlight = false;
      }
    };

    void refreshConnectedStudents();
    const timer = window.setInterval(() => void refreshConnectedStudents(), 1000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [classId, connection.host]);

  return (
    <LiveKitRoom
      serverUrl={connection.serverUrl}
      token={connection.token}
      connect
      video={false}
      audio={false}
      // Adaptive streaming and dynacast keep classroom video stable on weak
      // school networks instead of chasing maximum resolution.
      options={{ adaptiveStream: true, dynacast: true }}
      onDisconnected={onLeave}
      data-lk-theme="default"
      className="online-class-room"
    >
      <ConnectionStatus />

      <RecordingControls
        classId={classId}
        isHost={connection.host}
        recordingState={recordingState}
        onChanged={onStateChanged}
      />
      <TranscriptionControls
        classId={classId}
        isHost={connection.host}
        transcriptionState={transcriptionState}
        onChanged={onStateChanged}
      />

      <div className="online-class-room__stage">
        <div className="online-class-room__main">
          {boardOpen && boardContext ? (
            <BoardWorkspace
              classId={classId}
              currentUserId={currentUserId}
              isHost={connection.host}
              canAnnotate={connection.host || studentAnnotationAllowed}
              context={boardContext}
            />
          ) : (
            <ClassStage />
          )}
        </div>
        <aside className="online-class-room__sidebar">
          {/* The waiting room is host-only; the server rejects it for students
              regardless of what is rendered here. */}
          {connection.host && <WaitingRoomPanel classId={classId} />}
          <ParticipantListPanel classId={classId} isHost={connection.host} />
          <ChatPanel classId={classId} currentUserId={currentUserId} isHost={connection.host} />
        </aside>
      </div>
      <button
        type="button"
        className="online-class-room__board-toggle"
        onClick={() => setBoardOpen((open) => !open)}
      >
        {boardOpen ? t('onlineClass.whiteboard.close') : t('onlineClass.whiteboard.open')}
      </button>

      <CaptionsPanel enabled={transcriptionState === 'ACTIVE'} />
      <RoomAudioRenderer />
      <ConnectionStateToast />

      <div className="online-class-room__controls">
        <ControlBar variation="verbose" />
        <button type="button" className="online-class-room__leave" onClick={onLeave}>
          {t('onlineClass.leave')}
        </button>
        {onEndForAll && (
          <button
            type="button"
            className="online-class-room__end"
            onClick={() => {
              if (window.confirm(t('onlineClass.endConfirm'))) {
                onEndForAll();
              }
            }}
          >
            {t('onlineClass.end')}
          </button>
        )}
      </div>
    </LiveKitRoom>
  );
}
