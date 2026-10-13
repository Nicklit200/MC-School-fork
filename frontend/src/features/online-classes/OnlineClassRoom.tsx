import {
  ConnectionStateToast,
  ControlBar,
  FocusLayout,
  FocusLayoutContainer,
  LiveKitRoom,
  RoomAudioRenderer,
  useConnectionState,
  useTracks,
} from '@livekit/components-react';
import '@livekit/components-styles';
import { ConnectionState, Track } from 'livekit-client';
import { useI18n } from '../../i18n/I18nContext';
import type { ClassFeatureState, OnlineClassConnection } from '../../api/onlineClasses';
import { ChatPanel } from './ChatPanel';
import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { BoardSwitcher } from './BoardSwitcher';
import { SHARED_BOARD_ID } from './boards';
import { useStudentRoster } from './useStudentRoster';
import { AnswersButton } from './AnswersButton';
import { AnswersPanel } from './AnswersPanel';
import { CameraColumn } from './CameraColumn';
import { CaptionsPanel } from './CaptionsPanel';
import { RecordingControls } from './RecordingControls';
import { TranscriptionControls } from './TranscriptionControls';
import { ParticipantListPanel } from './ParticipantListPanel';
import { StudentScreenShareToggle } from './StudentScreenShareToggle';
import { WaitingRoomPanel } from './WaitingRoomPanel';
import { useAnswersPanel } from './useAnswersPanel';
import { useBoardDocument } from './useBoardDocument';
import { useHostUserId } from './useHostUserId';
import type { TranslationKey } from '../../i18n/translations';

// Konva is ~300 kB; the board gets its own lazy boundary inside the already-lazy
// class route.
const WhiteboardPanel = lazy(() =>
  import('./WhiteboardPanel').then((m) => ({ default: m.WhiteboardPanel })),
);

/**
 * The shared screen, when someone is presenting. Cameras are not drawn here:
 * they live in the permanent column on the right.
 */
function ScreenShareView() {
  const tracks = useTracks([{ source: Track.Source.ScreenShare, withPlaceholder: false }], {
    onlySubscribed: false,
  });
  const share = tracks[0];
  if (!share) return null;
  return (
    <FocusLayoutContainer>
      <FocusLayout trackRef={share} />
    </FocusLayoutContainer>
  );
}

/** True while anyone is sharing their screen. */
function useScreenShareActive(): boolean {
  const tracks = useTracks([{ source: Track.Source.ScreenShare, withPlaceholder: false }], {
    onlySubscribed: false,
  });
  return tracks.length > 0;
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
 * Everything inside the LiveKit room context: the board as the main surface,
 * the permanent camera column on the right, a drawer for chat and people, and
 * a compact control bar.
 */
function RoomBody({
  classId,
  currentUserId,
  eventId,
  connection,
  initialMedia,
  recordingState,
  transcriptionState,
  studentScreenShareEnabled,
  recordingAvailable,
  transcriptionAvailable,
  onLeave,
  onEndForAll,
  onStateChanged,
}: {
  classId: string;
  currentUserId: string;
  eventId?: string;
  connection: OnlineClassConnection;
  initialMedia?: import('./PrejoinPanel').PrejoinChoice;
  recordingState: ClassFeatureState;
  transcriptionState: ClassFeatureState;
  studentScreenShareEnabled: boolean;
  recordingAvailable: boolean;
  transcriptionAvailable: boolean;
  onLeave: () => void;
  onEndForAll?: () => void;
  onStateChanged?: () => void;
}) {
  const { t } = useI18n();
  const [panelsOpen, setPanelsOpen] = useState(false);
  const [waiting, setWaiting] = useState(0);
  const [mainView, setMainView] = useState<'board' | 'screen'>('board');
  const sharing = useScreenShareActive();
  const wasSharing = useRef(false);
  const hostUserId = useHostUserId(classId);
  const answers = useAnswersPanel(eventId, connection.host);
  const boardDocument = useBoardDocument(classId);
  const students = useStudentRoster(classId, connection.host);
  const [activeBoard, setActiveBoard] = useState(SHARED_BOARD_ID);
  // Only the shared board and the one in view are mounted: the shared board
  // keeps its page, zoom and tool while a personal board is open, and a teacher
  // walking through a whole group does not pile up one canvas per student
  // (their marks live on the server, so reopening one loses nothing).
  const boardsToShow = activeBoard === SHARED_BOARD_ID ? [SHARED_BOARD_ID] : [SHARED_BOARD_ID, activeBoard];

  // A new screen share takes the main area; the user can switch back to the
  // board at any time, and the board keeps its marks while it is not shown.
  useEffect(() => {
    if (sharing && !wasSharing.current) setMainView('screen');
    if (!sharing) setMainView('board');
    wasSharing.current = sharing;
  }, [sharing]);

  const showScreen = sharing && mainView === 'screen';

  return (
    <>
      <div className="online-class-room__topbar">
        <ConnectionStatus />
        <RecordingControls
          classId={classId}
          isHost={connection.host}
          recordingState={recordingState}
          available={recordingAvailable}
          onChanged={onStateChanged}
        />
        <TranscriptionControls
          classId={classId}
          isHost={connection.host}
          transcriptionState={transcriptionState}
          available={transcriptionAvailable}
          onChanged={onStateChanged}
        />
        {connection.host && (
          <StudentScreenShareToggle classId={classId} initiallyEnabled={studentScreenShareEnabled} />
        )}
        <BoardSwitcher
          isHost={connection.host}
          currentUserId={currentUserId}
          students={students}
          activeId={activeBoard}
          onChange={setActiveBoard}
        />
      </div>

      <div className="online-class-room__stage">
        <div className="online-class-room__main">
          {/* The board stays mounted while a screen is shown, so switching back
              returns to the same page, zoom, tool and marks. */}
          {boardsToShow.map((boardId) => {
            const visible = boardId === activeBoard && !showScreen;
            return (
              <div key={boardId} className="online-class-room__board" hidden={!visible}>
                <Suspense fallback={null}>
                  <WhiteboardPanel
                    classId={classId}
                    actorId={currentUserId}
                    isHost={connection.host}
                    targetId={boardId}
                    // Everyone in the class may draw, on the shared board and on their own.
                    canAnnotate
                    document={boardDocument}
                    active={visible}
                    // Answers belong to whichever board the teacher is looking at.
                    hostActions={
                      connection.host && visible ? (
                        <AnswersButton status={answers.status} open={answers.open} onToggle={answers.toggle} />
                      ) : undefined
                    }
                    overlay={
                      connection.host && visible && answers.open && answers.status === 'available' ? (
                        <AnswersPanel
                          pdf={answers.pdf}
                          view={answers.view}
                          getView={answers.getView}
                          onViewChange={answers.setView}
                          onScroll={answers.rememberScroll}
                          onClose={answers.close}
                        />
                      ) : undefined
                    }
                  />
                </Suspense>
              </div>
            );
          })}
          {showScreen && (
            <div className="online-class-room__screen">
              <ScreenShareView />
            </div>
          )}

          {/* Kept mounted (just hidden) so chat history, the roster and the
              waiting-room poll are not reset by closing the drawer. */}
          <aside
            id="online-class-drawer"
            className="online-class-room__drawer"
            hidden={!panelsOpen}
            aria-label={t('onlineClass.room.panels')}
          >
            {/* The waiting room is host-only; the server rejects it for students
                regardless of what is rendered here. */}
            {connection.host && <WaitingRoomPanel classId={classId} onPendingChange={setWaiting} />}
            <ParticipantListPanel classId={classId} isHost={connection.host} />
            <ChatPanel classId={classId} currentUserId={currentUserId} isHost={connection.host} />
          </aside>
        </div>

        <CameraColumn hostUserId={hostUserId} localIsHost={connection.host} />
      </div>

      <CaptionsPanel enabled={transcriptionState === 'ACTIVE'} />
      <RoomAudioRenderer />
      <ConnectionStateToast />

      <div className="online-class-room__controls">
        <ControlBar variation="verbose" />
        <button
          type="button"
          aria-pressed={panelsOpen}
          aria-controls="online-class-drawer"
          onClick={() => setPanelsOpen((open) => !open)}
        >
          {t('onlineClass.room.panels')}
          {waiting > 0 && <span className="online-class-room__badge"> ({waiting})</span>}
        </button>
        {sharing && (
          <button type="button" onClick={() => setMainView(showScreen ? 'board' : 'screen')}>
            {t(showScreen ? 'onlineClass.room.showBoard' : 'onlineClass.room.showScreen')}
          </button>
        )}
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
    </>
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
  eventId,
  connection,
  recordingState,
  transcriptionState,
  studentScreenShareEnabled = false,
  recordingAvailable = false,
  transcriptionAvailable = false,
  onLeave,
  onEndForAll,
  onStateChanged,
}: {
  classId: string;
  currentUserId: string;
  /** Calendar event of the lesson; used to find the teacher's bound answers file. */
  eventId?: string;
  connection: OnlineClassConnection;
  recordingState: ClassFeatureState;
  transcriptionState: ClassFeatureState;
  /** Whether students may currently share their screen (teacher-controlled). */
  studentScreenShareEnabled?: boolean;
  /** What this server can do; the teacher is not offered buttons that cannot work. */
  recordingAvailable?: boolean;
  transcriptionAvailable?: boolean;
  onLeave: () => void;
  onEndForAll?: () => void;
  onStateChanged?: () => void;
}) {
  return (
    <LiveKitRoom
      serverUrl={connection.serverUrl}
      token={connection.token}
      connect
      video={initialMedia?.cameraEnabled
        ? { deviceId: initialMedia.videoDeviceId ?? undefined }
        : false}
      audio={initialMedia?.microphoneEnabled
        ? { deviceId: initialMedia.audioDeviceId ?? undefined }
        : false}
      // Adaptive streaming and dynacast keep classroom video stable on weak
      // school networks instead of chasing maximum resolution.
      options={{ adaptiveStream: true, dynacast: true }}
      onDisconnected={onLeave}
      data-lk-theme="default"
      className="online-class-room"
    >
      <RoomBody
        classId={classId}
        currentUserId={currentUserId}
        eventId={eventId}
        connection={connection}
        recordingState={recordingState}
        transcriptionState={transcriptionState}
        studentScreenShareEnabled={studentScreenShareEnabled}
        recordingAvailable={recordingAvailable}
        transcriptionAvailable={transcriptionAvailable}
        onLeave={onLeave}
        onEndForAll={onEndForAll}
        onStateChanged={onStateChanged}
      />
    </LiveKitRoom>
  );
}
