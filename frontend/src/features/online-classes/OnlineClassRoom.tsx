import { lessonPreparationApi, completedLessonApi } from '../../api/lessonPreparation';
import { exportBoardPdf } from './boardExport';
import { NotebookCameraPanel } from '../notebook-camera/NotebookCameraPanel';
import { useLessonNotebookCameras } from '../notebook-camera/useLessonNotebookCameras';
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
import { ALL_STUDENT_BOARDS_ID, BoardSwitcher } from './BoardSwitcher';
import { SHARED_BOARD_ID, personalBoardId } from './boards';
import { useStudentRoster } from './useStudentRoster';
import { StudentWorkspaces } from './StudentWorkspaces';
import { BoardToolbarIcon } from './BoardToolbar';
import '../../styles/whiteboard-original-v3.css';
import { AnswersButton } from './AnswersButton';
import { AnswersPanel } from './AnswersPanel';
import { HomeworkDrawer } from './HomeworkDrawer';
import { CameraColumn } from './CameraColumn';
import { CaptionsPanel } from './CaptionsPanel';
import { RecordingControls } from './RecordingControls';
import { TranscriptionControls } from './TranscriptionControls';
import { ParticipantListPanel } from './ParticipantListPanel';
import { WaitingRoomPanel } from './WaitingRoomPanel';
import { useAnswersPanel } from './useAnswersPanel';
import { useBoardDocument } from './useBoardDocument';
import { useHostUserId } from './useHostUserId';
import { useClassEvents } from './useClassEvents';
import { DOCUMENT_TOPIC, documentEvent, VIEW_TOPIC } from './events';
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
  lessonTitle,
  currentUserId,
  eventId,
  connection,
  recordingState,
  transcriptionState,
  recordingAvailable,
  transcriptionAvailable,
  onLeave,
  onEndForAll,
  onStateChanged,
}: {
  classId: string;
  lessonTitle?: string;
  currentUserId: string;
  eventId?: string;
  connection: OnlineClassConnection;
  recordingState: ClassFeatureState;
  transcriptionState: ClassFeatureState;
  recordingAvailable: boolean;
  transcriptionAvailable: boolean;
  onLeave: () => void;
  onEndForAll?: () => void;
  onStateChanged?: () => void;
}) {
  const { t, language } = useI18n();
  // Automatically start Soniox transcription when the teacher joins a live lesson.
  // Never start for a student or if the feature is unavailable, already running,
  // or deliberately stopped during this room session.
  const connectionState = useConnectionState();
  const transcriptionAutoAttempted = useRef(false);
  const [transcriptionAutoError, setTranscriptionAutoError] = useState(false);
  useEffect(() => {
    if (!connection.host || !transcriptionAvailable ||
        connectionState !== ConnectionState.Connected ||
        transcriptionState !== 'INACTIVE' || transcriptionAutoAttempted.current) return;
    transcriptionAutoAttempted.current = true;
    let alive = true;
    void onlineClassesApi.startTranscription(classId).then(
      () => { if (alive) onStateChanged?.(); },
      () => { if (alive) setTranscriptionAutoError(true); },
    );
    return () => { alive = false; };
  }, [classId, connection.host, connectionState, transcriptionAvailable, transcriptionState, onStateChanged]);
  const [panelsOpen, setPanelsOpen] = useState(false);
  const [videosOpen, setVideosOpen] = useState(false);
  const materialInput = useRef<HTMLInputElement>(null);
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
  const [mainView, setMainView] = useState<'board' | 'screen' | 'notebook'>('board');
  const [notebookOpened, setNotebookOpened] = useState(false);
  const notebookTrigger = useRef<HTMLButtonElement>(null);
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
  const { camerasByOwner } = useLessonNotebookCameras({ eventId, classId, enabled: connection.host });
  const [archiving, setArchiving] = useState(false);
  const [archiveNotice, setArchiveNotice] = useState<string | null>(null);
  const [archiveError, setArchiveError] = useState(false);
  const archiveBoards = async (): Promise<void> => {
    if (archiving) return;
    if (!eventId) {
      setArchiveError(true);
      setArchiveNotice('Нельзя сохранить: доска не связана с календарным уроком.');
      return;
    }
    setArchiving(true);
    setArchiveError(false);
    setArchiveNotice('Подготавливаем документы досок…');
    try {
      const documents = await onlineClassesApi.listAnnotationDocuments(classId);
      // A student can leave the call before the teacher saves the boards.
      const boardNames = new Map<string, string>([[SHARED_BOARD_ID, 'Общая доска']]);
      for (const student of students) boardNames.set(personalBoardId(student.userId), student.displayName);
      for (const document of documents) {
        if (document.targetType === 'WHITEBOARD' && /^personal-[0-9a-fA-F-]{36}$/.test(document.targetId)) {
          if (!boardNames.has(document.targetId)) boardNames.set(document.targetId, 'Личная доска ученика');
        }
      }
      const boards = Array.from(boardNames, ([id, name]) => ({ id, name }));
      const saved: Array<{ id: string; boardId: string; classId: string; name: string }> = [];
      const failures: string[] = [];
      for (const [index, item] of boards.entries()) {
        setArchiveNotice(`Сохраняем ${item.name} (${index + 1}/${boards.length})…`);
        try {
          const count = Math.max(1, boardDocument?.pageCount ?? 1, ...documents
            .filter(document => document.targetType === 'WHITEBOARD' && document.targetId === item.id)
            .map(document => document.pageIndex + 1));
          const pdf = await exportBoardPdf({
            classId, targetType: 'WHITEBOARD', targetId: item.id, pageCount: count, pdfDocument: boardDocument,
          });
          if (pdf.size < 5 || pdf.size > 25 * 1024 * 1024) throw new Error('PDF пустой или больше 25 МБ');
          const result = await completedLessonApi.save(eventId, classId, item.id, pdf);
          if (!result?.id || result.classId !== classId || result.boardId !== item.id) {
            throw new Error('Сервер не подтвердил запись PDF');
          }
          saved.push({ id: result.id, classId, boardId: item.id, name: item.name });
        } catch (error) {
          failures.push(`${item.name}: ${error instanceof Error ? error.message : 'ошибка загрузки'}`);
        }
      }
      setArchiveNotice('Проверяем сохранённые PDF на сервере…');
      const verified = await completedLessonApi.list(eventId);
      const confirmed = saved.filter(item => verified.some(doc =>
        doc.id === item.id && doc.classId === item.classId && doc.boardId === item.boardId));
      const unconfirmed = saved.filter(item => !confirmed.includes(item));
      failures.push(...unconfirmed.map(item => `${item.name}: нет подтверждения на сервере`));
      if (failures.length) {
        setArchiveError(true);
        setArchiveNotice(`Подтверждено ${confirmed.length} из ${boards.length} PDF. Ошибки: ${failures.join('; ')}. Можно повторить без удаления других файлов.`);
      } else {
        setArchiveNotice(`Готово: все ${confirmed.length} PDF сохранены и проверены. Они доступны в разделе «Пройденный урок».`);
      }
    } catch (error) {
      setArchiveError(true);
      setArchiveNotice(`Не удалось подтвердить сохранение: ${error instanceof Error ? error.message : 'ошибка сервера'}. Попробуйте снова, оставаясь в уроке.`);
    } finally {
      setArchiving(false);
    }
  };
  const [activeBoard, setActiveBoard] = useState(SHARED_BOARD_ID);
  const [studentPages, setStudentPages] = useState<Record<string, number>>({});
  useClassEvents(classId, VIEW_TOPIC, ({ event, senderIdentity }) => {
    if (!connection.host || event.type !== 'view' || !event.boardId.startsWith('personal-')) return;
    // A student may announce only their own page; never trust an arbitrary data packet.
    if (event.boardId !== personalBoardId(senderIdentity?.split('|')[0] ?? '')) return;
    setStudentPages((current) => current[event.boardId] === event.page ? current : { ...current, [event.boardId]: event.page });
  });
  // Only the shared board and the one in view are mounted: the shared board
  // keeps its page, zoom and tool while a personal board is open, and a teacher
  // walking through a whole group does not pile up one canvas per student
  // (their marks live on the server, so reopening one loses nothing).
  const showingAllStudents = connection.host && activeBoard === ALL_STUDENT_BOARDS_ID;
  const boardsToShow = connection.host || activeBoard === SHARED_BOARD_ID ? [SHARED_BOARD_ID] : [SHARED_BOARD_ID, activeBoard];

  // A new screen share takes the main area; the user can switch back to the
  // board at any time, and the board keeps its marks while it is not shown.
  useEffect(() => {
    if (sharing && !wasSharing.current) setMainView(view => view === 'notebook' ? view : 'screen');
    if (!sharing) setMainView(view => view === 'screen' ? 'board' : view);
    wasSharing.current = sharing;
  }, [sharing]);

  const showScreen = sharing && mainView === 'screen';
  const showNotebook = !connection.host && Boolean(eventId) && mainView === 'notebook';
  const showStudentWorkspaces = connection.host && activeBoard !== SHARED_BOARD_ID && !showScreen;
  const selectBoard = (boardId: string) => {
    setActiveBoard(boardId);
    setMainView('board');
    if (connection.host && boardId !== SHARED_BOARD_ID && window.matchMedia?.('(max-width: 900px)').matches) setVideosOpen(false);
  };
  const returnToBoard = () => {
    setMainView('board');
    notebookTrigger.current?.focus();
  };

  // Homework and teacher-only solutions are both on the left, never stacked.
  useEffect(() => {
    if (answers.open) setHomeworkOpen(false);
  }, [answers.open]);
  const fileAction = connection.host ? <button type="button" className="board-toolbar__action"
    aria-label={materialBusy ? 'Загрузка…' : 'Добавить PDF / Фото'}
    title="Добавить PDF / Фото" disabled={materialBusy} onClick={() => materialInput.current?.click()}>
    <BoardToolbarIcon name="file" />
  </button> : undefined;

  return (
    <>
      <div className="online-class-room__topbar">
        <div className="online-class-room__lesson-island">
          <strong>{lessonTitle || t('onlineClass.title')}</strong>
          <ConnectionStatus />
        </div>
        <div className="online-class-room__lesson-actions">
        {!connection.host && <button type="button" className="classroom-homework-toggle"
          onClick={() => {
            if (!homeworkOpen) answers.close();
            setHomeworkOpen((open) => !open);
          }}
          aria-label={t('onlineClass.room.homework')}
          title={t('onlineClass.room.homework')}
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
        </button>}
        {eventId && !connection.host && <button
          ref={notebookTrigger}
          type="button"
          className="online-class-room__notebook-toggle"
          aria-pressed={showNotebook}
          aria-expanded={showNotebook}
          aria-controls="classroom-notebook"
          onClick={() => {
            if (showNotebook) { returnToBoard(); return; }
            setNotebookOpened(true);
            setMainView('notebook');
            setHomeworkOpen(false);
            answers.close();
            setPanelsOpen(false);
            // The participant rail otherwise covers the QR and settings on a
            // narrow tablet. It remains available from its normal toggle.
            if (window.matchMedia?.('(max-width: 900px)').matches) setVideosOpen(false);
          }}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 4h10v16H7zM4 7h3M4 12h3M4 17h3M10 8h4M10 12h4M10 16h2" />
          </svg>
          {language === 'DE' ? 'Heft verbinden' : 'Подключить тетрадь'}
        </button>}
        {materialError && <span role="alert" style={{ color: '#dc2626' }}>{materialError}</span>}
        {archiveNotice && <span role={archiveError ? 'alert' : 'status'} style={{fontSize:12,color:archiveError?'#dc2626':undefined}}>{archiveNotice}</span>}
        <RecordingControls
          classId={classId}
          isHost={connection.host}
          recordingState={recordingState}
          available={recordingAvailable}
          onChanged={onStateChanged}
        />
        {transcriptionAutoError && <span role="alert" className="transcription__unavailable">Не удалось автоматически запустить транскрипцию. Запустите её вручную.</span>}
        <TranscriptionControls
          classId={classId}
          isHost={connection.host}
          transcriptionState={transcriptionState}
          available={transcriptionAvailable}
          onChanged={onStateChanged}
        />
        </div>
        <div className="online-class-room__board-controls">
        <button type="button" className="online-class-room__videos-toggle" aria-expanded={videosOpen} aria-controls="online-class-videos" onClick={() => setVideosOpen((open) => !open)} title={videosOpen ? 'Скрыть видео участников' : 'Показать видео участников'}>
          {videosOpen ? 'Видео ›' : '‹ Видео'}
        </button>
        <BoardSwitcher
          isHost={connection.host}
          currentUserId={currentUserId}
          students={students}
          activeId={activeBoard}
          onChange={selectBoard}
        />
        </div>
      </div>
      {connection.host && <input ref={materialInput} type="file" multiple accept=".pdf,application/pdf,image/png,image/jpeg,image/webp"
        disabled={materialBusy} hidden
        onChange={(event) => { const files = Array.from(event.target.files ?? []); if (files.length) void uploadMaterial(files); event.target.value = ''; }} />}

      <div className={`online-class-room__stage${videosOpen ? " online-class-room__stage--videos-open" : ""}${showNotebook ? ' online-class-room__stage--notebook' : ''}${showStudentWorkspaces ? ' online-class-room__stage--student-workspaces' : ''}`}>
          {/* Teacher-only answer PDF has its own column. It must not cover the shared
              canvas: the sibling board reflows to the remaining available width. */}
          {connection.host && answers.open && (
            <AnswersPanel
              pdf={answers.pdf}
              view={answers.view}
              getView={answers.getView}
              onViewChange={answers.setView}
              onScroll={answers.rememberScroll}
              onClose={answers.close}
              onUpload={answers.upload}
              uploading={answers.uploading}
              uploadError={answers.uploadError}
            />
          )}
        <div className="online-class-room__main">
          {/* The board stays mounted while a screen is shown, so switching back
              returns to the same page, zoom, tool and marks. */}
          {boardsToShow.map((boardId) => {
            const visible = boardId === activeBoard && !showScreen && !showNotebook;
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
                    fileAction={visible ? fileAction : undefined}
                    active={visible}
                    observedPage={studentPages[boardId]}
                    onSaveLessonDocuments={connection.host ? archiveBoards : undefined}
                    savingLessonDocuments={archiving}
                    lessonDocumentsStatus={archiveNotice}
                    lessonDocumentsError={archiveError}
                    // Answers belong to whichever board the teacher is looking at.
                    hostActions={
                      connection.host && visible ? (
                        <AnswersButton compact status={answers.status} open={answers.open} onToggle={answers.toggle} />
                      ) : undefined
                    }
                  />
                </Suspense>
              </div>
            );
          })}
          {connection.host && <StudentWorkspaces
            key={classId}
            students={students}
            camerasByOwner={camerasByOwner}
            activeBoard={activeBoard}
            overview={showingAllStudents}
            visible={showStudentWorkspaces}
            onSelect={selectBoard}
            onOverview={() => selectBoard(ALL_STUDENT_BOARDS_ID)}
            renderBoard={(studentId, active, compact) => <Suspense fallback={null}>
              <WhiteboardPanel
                classId={classId}
                actorId={currentUserId}
                isHost
                targetId={personalBoardId(studentId)}
                observedPage={studentPages[personalBoardId(studentId)]}
                canAnnotate={!compact}
                active={active}
                document={boardDocument}
                fileAction={active && !compact ? fileAction : undefined}
                onSaveLessonDocuments={!compact ? archiveBoards : undefined}
                savingLessonDocuments={archiving}
                lessonDocumentsStatus={archiveNotice}
                lessonDocumentsError={archiveError}
                hostActions={active && !compact ? <AnswersButton compact status={answers.status} open={answers.open} onToggle={answers.toggle} /> : undefined}
              />
            </Suspense>}
            renderCameraBoard={(studentId, active, compact, source) => <Suspense fallback={null}>
              <WhiteboardPanel
                classId={classId}
                actorId={currentUserId}
                isHost
                targetType="NOTEBOOK_CAMERA"
                targetId={personalBoardId(studentId)}
                canAnnotate={!compact}
                active={active}
                fileAction={active && !compact ? fileAction : undefined}
                liveBackground={source ? { source: source.video, width: source.width, height: source.height } : null}
                hostActions={active && !compact ? <AnswersButton compact status={answers.status} open={answers.open} onToggle={answers.toggle} /> : undefined}
              />
            </Suspense>}
          />}
          {showScreen && (
            <div className="online-class-room__screen">
              <ScreenShareView />
            </div>
          )}

          {/* The processor and its media subscription stay mounted while the
              pupil looks at the board, preserving the QR, crop, rotation and
              unsaved ink. Leaving the classroom still releases the viewer. */}
          {eventId && !connection.host && notebookOpened && <div
            id="classroom-notebook"
            className="online-class-room__notebook"
            hidden={!showNotebook}
          >
            <NotebookCameraPanel
              key={`${eventId}:${classId}`}
              eventId={eventId}
              classId={classId}
              currentUserId={currentUserId}
              isTeacher={connection.host}
              students={connection.host ? students : undefined}
              autoPair={!connection.host}
              onClose={returnToBoard}
              closeLabel={language === 'DE' ? 'Zurück zur Tafel' : 'Вернуться к доске'}
            />
          </div>}

          {homeworkOpen && !connection.host && (
            <HomeworkDrawer classId={classId} onClose={() => setHomeworkOpen(false)} />
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

        <div id="online-class-videos" className={`online-class-room__videos-drawer${videosOpen ? ' is-open' : ''}`} aria-hidden={!videosOpen} ref={(element) => { element?.toggleAttribute('inert', !videosOpen); }}>
          <CameraColumn hostUserId={hostUserId} localIsHost={connection.host} />
        </div>
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
  lessonTitle,
  currentUserId,
  eventId,
  connection,
  initialMedia,
  recordingState,
  transcriptionState,
  recordingAvailable = false,
  transcriptionAvailable = false,
  onLeave,
  onConnectionLost,
  onMediaError,
  onEndForAll,
  onStateChanged,
}: {
  classId: string;
  lessonTitle?: string;
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
      className="online-class-room online-class-room--original-v3"
    >
      <RoomBody
        classId={classId}
        lessonTitle={lessonTitle}
        currentUserId={currentUserId}
        eventId={eventId}
        connection={connection}
        recordingState={recordingState}
        transcriptionState={transcriptionState}
        recordingAvailable={recordingAvailable}
        transcriptionAvailable={transcriptionAvailable}
        onLeave={onLeave}
        onEndForAll={onEndForAll}
        onStateChanged={onStateChanged}
      />
    </LiveKitRoom>
  );
}
