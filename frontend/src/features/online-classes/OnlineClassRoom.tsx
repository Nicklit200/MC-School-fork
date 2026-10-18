import { lessonPreparationApi } from '../../api/lessonPreparation';
import { onlineClassesApi } from '../../api/onlineClasses';
import { buildPdf, dataUrlToBytes } from './pdfWriter';
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
import { categorizeLiveKitError, type LiveKitErrorCategory } from './livekitDiagnostics';
import { BoardSwitcher } from './BoardSwitcher';
import { SHARED_BOARD_ID } from './boards';
import { useStudentRoster } from './useStudentRoster';
import { AnswersButton } from './AnswersButton';
import { AnswersPanel } from './AnswersPanel';
import { HomeworkDrawer } from './HomeworkDrawer';
import { SolutionsDrawer } from './SolutionsDrawer';
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
import { useClassEvents } from './useClassEvents';
import { DOCUMENT_TOPIC, documentEvent } from './events';
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
  const [homeworkOpen, setHomeworkOpen] = useState(false);
  const [materialBusy, setMaterialBusy] = useState(false);
  const [materialError, setMaterialError] = useState<string | null>(null);
  useEffect(() => {
    const report = (event: Event) => setMaterialError((event as CustomEvent<string>).detail);
    window.addEventListener('mc-workbook-render-error', report);
    return () => window.removeEventListener('mc-workbook-render-error', report);
  }, []);
  const uploadMaterial = async (files: File[]) => {
    if (!eventId) { setMaterialError('Урок не связан с календарём. Загрузка недоступна.'); return; }
    setMaterialBusy(true);
    setMaterialError(null);
    try {
      if (!files.length) return;
      for (const file of files) {
      let pdfFile = file;
      if (file.type.startsWith('image/')) {
        const url = URL.createObjectURL(file);
        try {
          const image = new Image();
          image.src = url;
          await image.decode();
          const scale = Math.min(1, 2200 / Math.max(image.naturalWidth, image.naturalHeight));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('Canvas unavailable');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
          const jpeg = dataUrlToBytes(canvas.toDataURL('image/jpeg', 0.88));
          const bytes = buildPdf([{ jpeg, width: canvas.width, height: canvas.height }]);
          pdfFile = new File([new Uint8Array(bytes)], file.name.replace(/\.[^.]+$/, '') + '.pdf', { type: 'application/pdf' });
        } finally { URL.revokeObjectURL(url); }
      } else if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
        throw new Error('Unsupported file');
      }
      if (!pdfFile.size) {
        throw new Error('Выбранный файл пустой. Откройте его в «Файлах» и сохраните PDF на iPad перед загрузкой.');
      }
      const saved = await lessonPreparationApi.appendWorkbook(eventId, pdfFile);
      if (!saved.hasWorkbook) {
        throw new Error('Сервер принял файл, но не сохранил его как рабочую тетрадь. Попробуйте ещё раз.');
      }
      // The classroom reads a different, student-authorized API. Verify that
      // endpoint too before saying the upload is complete. A transient delay
      // gets one short retry; do not silently tell teachers their PDF is gone.
      let bytes = await onlineClassesApi.documentBytes(classId);
      if (!bytes || bytes.byteLength === 0) {
        await new Promise((resolve) => window.setTimeout(resolve, 350));
        bytes = await onlineClassesApi.documentBytes(classId);
      }
      if (!bytes || bytes.byteLength === 0) {
        throw new Error('PDF сохранён, но пока недоступен на доске. Обновите урок или попробуйте снова.');
      }
      // Refresh teacher immediately, and push the update to every pupil over
      // LiveKit. Each PDF is an atomic append, so earlier files survive if
      // a later file fails.
      window.dispatchEvent(new Event('mc-workbook-updated'));
      const revision = await onlineClassesApi.documentVersion(classId);
      void publishDocument(documentEvent(classId, revision.version), true);
      }
    } catch (error) {
      setMaterialError(error instanceof Error ? error.message : 'Не удалось загрузить файл.');
    } finally { setMaterialBusy(false); }
  };
  const [waiting, setWaiting] = useState(0);
  const [mainView, setMainView] = useState<'board' | 'screen'>('board');
  const sharing = useScreenShareActive();
  const wasSharing = useRef(false);
  const hostUserId = useHostUserId(classId);
  const { publish: publishDocument } = useClassEvents(classId, DOCUMENT_TOPIC, ({ event, senderIdentity }) => {
    if (event.type !== 'document' || connection.host) return;
    // Ignore document-update packets from students. Only the bound teacher
    // can cause the shared PDF to reload.
    if (!hostUserId || senderIdentity?.split('|')[0] !== hostUserId) return;
    window.dispatchEvent(new Event('mc-workbook-updated'));
  });
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

  // Homework and teacher-only solutions are both on the left, never stacked.
  useEffect(() => {
    if (answers.open) setHomeworkOpen(false);
  }, [answers.open]);

  return (
    <>
      <div className="online-class-room__topbar">
        <button type="button" className="classroom-homework-toggle"
          onClick={() => {
            if (!homeworkOpen) answers.close();
            setHomeworkOpen((open) => !open);
          }}
          aria-label={connection.host ? 'Решения' : t('onlineClass.room.homework')}
          title={connection.host ? 'Решения' : t('onlineClass.room.homework')}
          aria-expanded={homeworkOpen}
          aria-controls="classroom-homework-panel"
          aria-pressed={homeworkOpen}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none"
            stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8"/>
            <path d="m9 15 2.5 2.5L21 8"/>
            <path d="M8 7h6M8 11h4"/>
          </svg>
        </button>
        {connection.host && (
          <label title="Загрузить PDF или фото на доску" style={{ cursor: materialBusy ? 'wait' : 'pointer', padding: '6px 10px', borderRadius: 8, background: '#1d4ed8', color: 'white' }}>
            {materialBusy ? 'Загрузка…' : '＋ Добавить PDF / Фото'}
            <input type="file" multiple accept=".pdf,application/pdf,image/png,image/jpeg,image/webp" disabled={materialBusy}
              style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }}
              onChange={(event) => { const files = Array.from(event.target.files ?? []); if (files.length) void uploadMaterial(files); event.target.value = ''; }} />
          </label>
        )}
        {materialError && <span role="alert" style={{ color: '#dc2626' }}>{materialError}</span>}
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

          {homeworkOpen && (
            connection.host ? <SolutionsDrawer eventId={eventId} onClose={() => setHomeworkOpen(false)} /> : <HomeworkDrawer classId={classId} onClose={() => setHomeworkOpen(false)} />
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
        {/* Leave is handled by our own button. LiveKit's built-in Leave
            would look like an unexpected network disconnect here. */}
        <ControlBar variation="verbose" controls={{ leave: false }} />
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
  initialMedia,
  recordingState,
  transcriptionState,
  studentScreenShareEnabled = false,
  recordingAvailable = false,
  transcriptionAvailable = false,
  onLeave,
  onConnectionLost,
  onMediaError,
  onEndForAll,
  onStateChanged,
}: {
  classId: string;
  currentUserId: string;
  /** Calendar event of the lesson; used to find the teacher's bound answers file. */
  eventId?: string;
  connection: OnlineClassConnection;
  initialMedia?: import('./PrejoinPanel').PrejoinChoice;
  recordingState: ClassFeatureState;
  transcriptionState: ClassFeatureState;
  /** Whether students may currently share their screen (teacher-controlled). */
  studentScreenShareEnabled?: boolean;
  /** What this server can do; the teacher is not offered buttons that cannot work. */
  recordingAvailable?: boolean;
  transcriptionAvailable?: boolean;
  onLeave: () => void;
  /** An involuntary LiveKit disconnect is not the user's Leave action. */
  onConnectionLost: (reason?: string, everConnected?: boolean) => void;
  onMediaError?: (category: LiveKitErrorCategory) => void;
  onEndForAll?: () => void;
  onStateChanged?: () => void;
}) {
  const connectedSinceMount = useRef(false);
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
      onConnected={() => {
        connectedSinceMount.current = true;
      }}
      onError={(error) => {
        // Send a category only, never the provider's raw potentially sensitive
        // error message, token or room URL to the page.
        onMediaError?.(categorizeLiveKitError(error));
      }}
      onDisconnected={(reason) => {
        // Code 0 means UNKNOWN, not a confirmed network or permission error.
        // Track whether LiveKit ever reached connected state for diagnosis.
        onConnectionLost(reason == null ? undefined : String(reason), connectedSinceMount.current);
      }}
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
