import { lessonPreparationApi, completedLessonApi, type PersonalWorkbooks } from '../../api/lessonPreparation';
import { exportBoardPdf } from './boardExport';
import { annotationPageCount } from './annotationPages';
import { flushClassAnnotations, hasPendingClassAnnotations } from './annotationSync';
import { NotebookCameraPanel } from '../notebook-camera/NotebookCameraPanel';
import type { NotebookCameraVideoSource } from '../notebook-camera/NotebookCameraViewer';
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
import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { categorizeLiveKitError, type LiveKitErrorCategory } from './livekitDiagnostics';
import { ALL_STUDENT_BOARDS_ID, BoardSwitcher } from './BoardSwitcher';
import { SHARED_BOARD_ID, personalBoardId, personalBoardOwner, personalWorkbookBoardId, isPersonalWorkbookBoard } from './boards';
import { useStudentRoster } from './useStudentRoster';
import { StudentWorkspaces } from './StudentWorkspaces';
import { BoardToolbarIcon } from './BoardToolbar';
import '../../styles/whiteboard-original-v3.css';
import { AnswersButton } from './AnswersButton';
import { AnswersPanel } from './AnswersPanel';
import { AnswersPanelResizer } from './AnswersPanelResizer';
import { CameraColumn } from './CameraColumn';
import { CaptionsPanel } from './CaptionsPanel';
import { RecordingControls } from './RecordingControls';
import { TranscriptionControls } from './TranscriptionControls';
import { ParticipantListPanel } from './ParticipantListPanel';
import { WaitingRoomPanel } from './WaitingRoomPanel';
import { useAnswersPanel } from './useAnswersPanel';
import { useKolinChat } from './useKolinChat';
import { useKolinBoardReview } from './useKolinBoardReview';
import { KolinPanel } from './KolinPanel';
import { DocumentWhiteboardPanel } from './DocumentWhiteboardPanel';
import { openPdf, type PdfDoc } from './pdfDocument';
import { useBoardDocument } from './useBoardDocument';
import { useHostUserId } from './useHostUserId';
import { useClassAudioFocus } from './useClassAudioFocus';
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
  onLeave: () => void | Promise<void>;
  onEndForAll?: () => void | Promise<void>;
  onStateChanged?: () => void;
}) {
  const { t, language } = useI18n();
  const topbarRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const topbar = topbarRef.current, controls = controlsRef.current;
    const room = topbar?.closest<HTMLElement>('.online-class-room');
    if (!room || !topbar || !controls) return;
    // The chrome overlays the board. Its actual wrapped height also keeps the
    // first/last page, device menu and chat composer reachable on small screens.
    const measure = () => {
      room.style.setProperty('--classroom-header-height', `${topbar.offsetHeight}px`);
      room.style.setProperty('--classroom-dock-height', `${controls.offsetHeight}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(topbar);
    observer.observe(controls);
    return () => observer.disconnect();
  }, []);
  // Automatically start Soniox transcription when the teacher joins a live lesson.
  // Each new media connection verifies the dispatch with the server, including
  // cached ACTIVE status after LiveKit has closed an empty physical room.
  // Never restart a deliberately stopped dispatch during the same entry.
  const connectionState = useConnectionState();
  const transcriptionStopping = transcriptionState === 'STOPPING';
  const transcriptionAutoEntry = useRef({ classId, attempted: false });
  const onTranscriptionStateChanged = useRef(onStateChanged);
  onTranscriptionStateChanged.current = onStateChanged;
  const [transcriptionAutoError, setTranscriptionAutoError] = useState(false);
  useEffect(() => {
    if (transcriptionState === 'ACTIVE' || transcriptionState === 'STARTING') {
      setTranscriptionAutoError(false);
    }
  }, [transcriptionState]);
  useEffect(() => {
    if (transcriptionAutoEntry.current.classId !== classId) {
      transcriptionAutoEntry.current = { classId, attempted: false };
    }
    if (connectionState !== ConnectionState.Connected) {
      transcriptionAutoEntry.current.attempted = false;
      return;
    }
    if (!connection.host || !transcriptionAvailable) return;
    if (transcriptionStopping) {
      transcriptionAutoEntry.current.attempted = true;
      return;
    }
    if (transcriptionAutoEntry.current.attempted) return;
    const entry = transcriptionAutoEntry.current;
    entry.attempted = true;
    setTranscriptionAutoError(false);
    let cancelled = false;
    let begun = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    const start = async () => {
      attempts += 1;
      try {
        await onlineClassesApi.startTranscription(classId);
      } catch {
        if (cancelled) return;
        if (attempts < 3) {
          // Connected can precede the teacher appearing in LiveKit's room API.
          retryTimer = setTimeout(() => { void start(); }, attempts * 500);
        } else {
          setTranscriptionAutoError(true);
        }
        return;
      }
      if (!cancelled) {
        setTranscriptionAutoError(false);
        onTranscriptionStateChanged.current?.();
      }
    };
    // React StrictMode rehearses setup/cleanup before committing this entry.
    // Defer the first request so that rehearsal cannot consume its attempts.
    queueMicrotask(() => {
      if (cancelled) return;
      begun = true;
      void start();
    });
    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
      if (!begun) entry.attempted = false;
    };
  }, [classId, connection.host, connectionState, transcriptionAvailable, transcriptionStopping]);
  const [panelsOpen, setPanelsOpen] = useState(false);
  const [videosOpen, setVideosOpen] = useState(false);
  const materialInput = useRef<HTMLInputElement>(null);
  const personalMaterialInput = useRef<HTMLInputElement>(null);
  const [activeBoard, setActiveBoard] = useState(SHARED_BOARD_ID);
  const materialTarget = useRef(SHARED_BOARD_ID);
  const [personalWorkbooks, setPersonalWorkbooks] = useState<{ eventId: string; data: PersonalWorkbooks } | null>(null);
  const personalWorkbookData = personalWorkbooks && personalWorkbooks.eventId === eventId ? personalWorkbooks.data : null;
  const personalUploadStudent = personalWorkbookData?.enabled ? personalBoardOwner(activeBoard) : null;
  const personalUploadStudentName = personalWorkbookData?.students.find(student => student.studentId === personalUploadStudent)?.studentName.trim();
  useEffect(() => {
    if (!connection.host || !eventId) return;
    let cancelled = false;
    let loading = false;
    let pending = false;
    const load = async () => {
      if (loading) { pending = true; return; }
      loading = true;
      try {
        const data = await lessonPreparationApi.personalWorkbooks(eventId);
        if (!cancelled) setPersonalWorkbooks({ eventId, data });
      } catch { /* Keep the last authorized roster through temporary failures. */ }
      finally {
        loading = false;
        if (pending && !cancelled) { pending = false; void load(); }
      }
    };
    const refresh = () => void load();
    void load();
    const timer = window.setInterval(refresh, 4000);
    window.addEventListener('mc-workbook-updated', refresh);
    return () => { cancelled = true; window.clearInterval(timer); window.removeEventListener('mc-workbook-updated', refresh); };
  }, [connection.host, eventId]);
  const [materialBusy, setMaterialBusy] = useState(false);
  const [materialError, setMaterialError] = useState<string | null>(null);
  useEffect(() => {
    const report = (event: Event) => setMaterialError((event as CustomEvent<string>).detail);
    window.addEventListener('mc-workbook-render-error', report);
    return () => window.removeEventListener('mc-workbook-render-error', report);
  }, []);
  const uploadMaterial = async (files: File[], targetId: string) => {
    if (!eventId) { setMaterialError('Урок не связан с календарём. Загрузка недоступна.'); return; }
    const studentId = personalWorkbookData?.enabled && isPersonalWorkbookBoard(targetId) ? personalBoardOwner(targetId) : null;
    if (isPersonalWorkbookBoard(targetId) && !studentId) {
      setMaterialError('Не удалось проверить доступ к персональным листам. Загрузите лист из подготовки урока.');
      return;
    }
    if (studentId && files.length !== 1) {
      setMaterialError('Для персонального листа выберите один PDF.');
      return;
    }
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
      const personalSaved = studentId ? await lessonPreparationApi.uploadPersonalWorkbook(eventId, studentId, pdfFile) : null;
      const saved = personalSaved ?? await lessonPreparationApi.appendWorkbook(eventId, pdfFile);
      if (!saved.hasWorkbook) {
        throw new Error('Сервер принял файл, но не сохранил его как рабочую тетрадь. Попробуйте ещё раз.');
      }
      if (personalSaved) setPersonalWorkbooks(current => current?.eventId === eventId ? {
        eventId, data: { ...current.data, students: current.data.students.map(student => student.studentId === personalSaved.studentId ? personalSaved : student) },
      } : current);
      // The classroom reads a different, student-authorized API. Verify that
      // endpoint too before saying the upload is complete. A transient delay
      // gets one short retry; do not silently tell teachers their PDF is gone.
      const readDocument = () => studentId ? onlineClassesApi.documentBytes(classId, targetId) : onlineClassesApi.documentBytes(classId);
      let bytes = await readDocument();
      if (!bytes || bytes.byteLength === 0) {
        await new Promise((resolve) => window.setTimeout(resolve, 350));
        bytes = await readDocument();
      }
      if (!bytes || bytes.byteLength === 0) {
        throw new Error('PDF сохранён, но пока недоступен на доске. Обновите урок или попробуйте снова.');
      }
      // Refresh teacher immediately, and push the update to every pupil over
      // LiveKit. Each PDF is an atomic append, so earlier files survive if
      // a later file fails.
      window.dispatchEvent(new Event('mc-workbook-updated'));
      if (!studentId) {
        const revision = await onlineClassesApi.documentVersion(classId);
        void publishDocument(documentEvent(classId, revision.version), true);
      }
      }
    } catch (error) {
      setMaterialError(error instanceof Error ? error.message : 'Не удалось загрузить файл.');
    } finally { setMaterialBusy(false); }
  };
  const [waiting, setWaiting] = useState(0);
  const [mainView, setMainView] = useState<'board' | 'screen'>('board');
  const [notebookSettingsOpen, setNotebookSettingsOpen] = useState(false);
  const notebookTrigger = useRef<HTMLButtonElement>(null);
  const notebookScope = JSON.stringify([eventId, classId, currentUserId]);
  const currentNotebookScope = useRef({ scope: notebookScope, host: connection.host });
  currentNotebookScope.current = { scope: notebookScope, host: connection.host };
  const [notebookVideo, setNotebookVideo] = useState<{ scope: string; cameraId: string; source: NotebookCameraVideoSource } | null>(null);
  const [cameraBoardScope, setCameraBoardScope] = useState('');
  const autoSelectedCamera = useRef('');
  const receiveNotebookVideo = useCallback((cameraId: string, source: NotebookCameraVideoSource | null) => {
    if (currentNotebookScope.current.scope !== notebookScope || currentNotebookScope.current.host) return;
    setNotebookVideo(previous => {
      if (currentNotebookScope.current.scope !== notebookScope || currentNotebookScope.current.host) return previous;
      return source ? { scope: notebookScope, cameraId, source }
        : previous?.scope === notebookScope && previous.cameraId === cameraId ? null : previous;
    });
  }, [notebookScope]);
  const ownNotebook = !connection.host && notebookVideo?.scope === notebookScope ? notebookVideo : null;
  const closeNotebookSettings = useCallback(() => {
    setNotebookSettingsOpen(false);
    notebookTrigger.current?.focus();
  }, []);
  useEffect(() => {
    setNotebookSettingsOpen(false);
  }, [notebookScope, connection.host]);
  useEffect(() => {
    if (!notebookSettingsOpen) return;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); closeNotebookSettings(); } };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [notebookSettingsOpen, closeNotebookSettings]);
  const sharing = useScreenShareActive();
  const wasSharing = useRef(false);
  const hostUserId = useHostUserId(classId);
  const audioFocus = useClassAudioFocus(classId, hostUserId, connection.host);
  const audioRestore = useRef(false);
  useEffect(() => { audioRestore.current = false; }, [classId]);
  useEffect(() => {
    if (!connection.host || audioRestore.current || !audioFocus.focus) return;
    audioRestore.current = true;
    if (audioFocus.focus.studentId) setActiveBoard(personalBoardId(audioFocus.focus.studentId));
  }, [connection.host, audioFocus.focus]);
  const { publish: publishDocument } = useClassEvents(classId, DOCUMENT_TOPIC, ({ event, senderIdentity }) => {
    if (event.type !== 'document' || connection.host) return;
    // Ignore document-update packets from students. Only the bound teacher
    // can cause the shared PDF to reload.
    if (!hostUserId || senderIdentity?.split('|')[0] !== hostUserId) return;
    window.dispatchEvent(new Event('mc-workbook-updated'));
  });
  const answerStudentId = personalWorkbookData?.enabled ? personalBoardOwner(activeBoard) ?? undefined : undefined;
  const answerStudentName = answerStudentId ? personalWorkbookData?.students.find(student => student.studentId === answerStudentId)?.studentName : undefined;
  const answers = useAnswersPanel(eventId, connection.host, answerStudentId, currentUserId,
    connection.host && Boolean(personalBoardOwner(activeBoard)) && !personalWorkbookData);
  const prepareKolinReview = useKolinBoardReview(classId, currentUserId, connection.host);
  const kolin = useKolinChat(classId, currentUserId, connection.host, prepareKolinReview);
  const toggleAnswers = () => { kolin.close(); answers.toggle(); };
  const boardDocument = useBoardDocument(classId);
  const admittedStudents = useStudentRoster(classId, connection.host);
  const students = [...new Map([
    ...(personalWorkbookData?.enabled ? personalWorkbookData.students.map(student => ({ userId: student.studentId, displayName: student.studentName })) : []),
    ...admittedStudents,
  ].map(student => [student.userId, student])).values()];
  const { camerasByOwner } = useLessonNotebookCameras({ eventId, classId, enabled: connection.host });
  const [archiving, setArchiving] = useState(false);
  const [archiveNotice, setArchiveNotice] = useState<string | null>(null);
  const [archiveError, setArchiveError] = useState(false);
  const archiveFlight = useRef<{ scope: string; promise: Promise<boolean> } | null>(null);
  const exitFlight = useRef<string | null>(null);
  const [exitPending, setExitPending] = useState(false);
  const boardsFrozen = exitPending || (connection.host && Boolean(eventId) && archiving);
  const archiveScope = JSON.stringify([classId, eventId, currentUserId, connection.host]);
  const currentArchiveScope = useRef(archiveScope);
  currentArchiveScope.current = archiveScope;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const [inkRecoveryBusy, setInkRecoveryBusy] = useState(false);
  const [inkRecoveryError, setInkRecoveryError] = useState(false);
  const inkRecoveryFlight = useRef<{ scope: string; promise: Promise<void> } | null>(null);
  const liveConnectionState = useRef(connectionState);
  liveConnectionState.current = connectionState;
  const recoverInk = useCallback(() => {
    const isCurrent = () => mounted.current && currentArchiveScope.current === archiveScope
      && liveConnectionState.current === ConnectionState.Connected;
    if (!currentUserId || !isCurrent()) return Promise.resolve();
    if (inkRecoveryFlight.current?.scope === archiveScope) return inkRecoveryFlight.current.promise;
    setInkRecoveryBusy(true);
    setInkRecoveryError(false);
    const promise = flushClassAnnotations(classId, currentUserId, isCurrent)
      .catch(() => { if (isCurrent()) setInkRecoveryError(true); })
      .finally(() => {
        if (inkRecoveryFlight.current?.scope === archiveScope) inkRecoveryFlight.current = null;
        if (isCurrent()) setInkRecoveryBusy(false);
      });
    inkRecoveryFlight.current = { scope: archiveScope, promise };
    return promise;
  }, [archiveScope, classId, currentUserId]);
  useEffect(() => {
    setInkRecoveryBusy(false);
    setInkRecoveryError(false);
  }, [archiveScope]);
  useEffect(() => {
    if (connectionState === ConnectionState.Connected && currentUserId
        && hasPendingClassAnnotations(classId, currentUserId)) void recoverInk();
  }, [archiveScope, classId, connectionState, currentUserId, recoverInk]);
  useEffect(() => {
    setArchiving(false);
    setExitPending(false);
    setArchiveNotice(null);
    setArchiveError(false);
  }, [archiveScope]);
  useEffect(() => {
    // Keep progress and errors visible. A completed save only needs a brief
    // confirmation; starting another save cancels the previous dismissal.
    if (!archiveNotice || archiving || exitPending || archiveError) return;
    const timer = window.setTimeout(() => setArchiveNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [archiveNotice, archiving, exitPending, archiveError]);
  const saveBoards = async (eventId: string, scope: string): Promise<boolean> => {
    const isCurrent = () => mounted.current && currentArchiveScope.current === scope;
    const notice = (message: string) => { if (isCurrent()) setArchiveNotice(message); };
    const fail = () => { if (isCurrent()) setArchiveError(true); };
    let sharedArchiveDocument: PdfDoc | null = null;
    try {
      if (!currentUserId) throw new Error('Не удалось подтвердить пользователя доски.');
      await flushClassAnnotations(classId, currentUserId, isCurrent);
      const documents = await onlineClassesApi.listAnnotationDocuments(classId);
      // Another tab or the connector may have assigned a sheet after entry.
      const latestWorkbooks = personalWorkbookData?.enabled ? await lessonPreparationApi.personalWorkbooks(eventId) : null;
      const sharedBytes = await onlineClassesApi.documentBytes(classId);
      if (sharedBytes?.byteLength) sharedArchiveDocument = await openPdf(sharedBytes);
      // A student can leave the call before the teacher saves the boards.
      const boardNames = new Map<string, string>([[SHARED_BOARD_ID, 'Общая доска']]);
      for (const student of students) boardNames.set(personalBoardId(student.userId), student.displayName);
      for (const student of latestWorkbooks?.students ?? []) {
        if (student.hasWorkbook) boardNames.set(personalWorkbookBoardId(student.studentId), `Персональный лист: ${student.studentName}`);
      }
      for (const document of documents) {
        if (document.targetType === 'WHITEBOARD' && /^personal-(?:workbook-)?[0-9a-fA-F-]{36}$/.test(document.targetId)) {
          if (!boardNames.has(document.targetId)) boardNames.set(document.targetId, 'Личная доска ученика');
        }
      }
      const boards = Array.from(boardNames, ([id, name]) => ({ id, name }));
      const saved: Array<{ id: string; boardId: string; classId: string; name: string }> = [];
      const failures: string[] = [];
      for (const [index, item] of boards.entries()) {
        notice(`Сохраняем ${item.name} (${index + 1}/${boards.length})…`);
        const worksheet = isPersonalWorkbookBoard(item.id);
        let exportDocument: PdfDoc | null = worksheet ? null : sharedArchiveDocument;
        try {
          if (worksheet) {
            const bytes = await onlineClassesApi.documentBytes(classId, item.id);
            exportDocument = bytes?.byteLength ? await openPdf(bytes) : null;
          }
          const count = annotationPageCount(documents, 'WHITEBOARD', item.id, exportDocument?.pageCount ?? 1);
          const pdf = await exportBoardPdf({
            classId, targetType: 'WHITEBOARD', targetId: item.id, pageCount: count, pdfDocument: exportDocument,
          });
          if (pdf.size < 5 || pdf.size > 25 * 1024 * 1024) throw new Error('PDF пустой или больше 25 МБ');
          const result = await completedLessonApi.save(eventId, classId, item.id, pdf);
          if (!result?.id || result.classId !== classId || result.boardId !== item.id) {
            throw new Error('Сервер не подтвердил запись PDF');
          }
          saved.push({ id: result.id, classId, boardId: item.id, name: item.name });
        } catch (error) {
          failures.push(`${item.name}: ${error instanceof Error ? error.message : 'ошибка загрузки'}`);
        } finally {
          if (worksheet) exportDocument?.destroy();
        }
      }
      notice('Проверяем сохранённые PDF на сервере…');
      const verified = await completedLessonApi.list(eventId);
      const confirmed = saved.filter(item => verified.some(doc =>
        doc.id === item.id && doc.classId === item.classId && doc.boardId === item.boardId));
      const unconfirmed = saved.filter(item => !confirmed.includes(item));
      failures.push(...unconfirmed.map(item => `${item.name}: нет подтверждения на сервере`));
      if (failures.length) {
        fail();
        notice(`Подтверждено ${confirmed.length} из ${boards.length} PDF. Ошибки: ${failures.join('; ')}. Можно повторить без удаления других файлов.`);
        return false;
      } else {
        notice(`PDF сохранены в разделе «Пройденный урок»: ${confirmed.length}.`);
        return true;
      }
    } catch (error) {
      fail();
      notice(`Не удалось подтвердить сохранение: ${error instanceof Error ? error.message : 'ошибка сервера'}. Попробуйте снова, оставаясь в уроке.`);
      return false;
    } finally {
      sharedArchiveDocument?.destroy();
      if (isCurrent()) setArchiving(false);
    }
  };
  const archiveBoards = (): Promise<boolean> => {
    if (archiveFlight.current?.scope === archiveScope) return archiveFlight.current.promise;
    if (!eventId) {
      setArchiveError(true);
      setArchiveNotice('Нельзя сохранить: доска не связана с календарным уроком.');
      return Promise.resolve(false);
    }
    setArchiving(true);
    setArchiveError(false);
    setArchiveNotice('Подготавливаем документы досок…');
    const scope = archiveScope;
    const promise = saveBoards(eventId, scope);
    archiveFlight.current = { scope, promise };
    const complete = () => { if (archiveFlight.current?.promise === promise) archiveFlight.current = null; };
    void promise.then(complete, complete);
    return promise;
  };
  const exitRoom = async (action: () => void | Promise<void>): Promise<void> => {
    if (exitFlight.current === archiveScope) return;
    exitFlight.current = archiveScope;
    setExitPending(true);
    const scope = archiveScope;
    try {
      let saved: boolean;
      if (connection.host && eventId) saved = await archiveBoards();
      else {
        if (!currentUserId) throw new Error('Не удалось подтвердить пользователя доски.');
        await flushClassAnnotations(classId, currentUserId,
          () => mounted.current && currentArchiveScope.current === scope);
        saved = true;
      }
      if (!mounted.current || currentArchiveScope.current !== scope) return;
      if (saved) await action();
      else setArchiveNotice(current => `${current ?? 'Документы не сохранены.'} Выход отложен. Повторите сохранение или нажмите кнопку выхода ещё раз.`);
    } catch (error) {
      if (mounted.current && currentArchiveScope.current === scope) {
        setArchiveError(true);
        setArchiveNotice(`Выход отложен: ${error instanceof Error ? error.message : 'ошибка сохранения'}. Повторите попытку, оставаясь в уроке.`);
      }
    } finally {
      if (exitFlight.current === scope) exitFlight.current = null;
      if (mounted.current && currentArchiveScope.current === scope) setExitPending(false);
    }
  };
  useEffect(() => {
    if (!ownNotebook) return;
    setCameraBoardScope(notebookScope);
    const key = `${notebookScope}:${ownNotebook.cameraId}`;
    if (autoSelectedCamera.current === key) return;
    autoSelectedCamera.current = key;
    setActiveBoard(personalBoardId(currentUserId));
    setMainView('board');
  }, [ownNotebook, notebookScope, currentUserId]);
  const [studentPages, setStudentPages] = useState<Record<string, number>>({});
  const [teacherPages, setTeacherPages] = useState<Record<string, number>>({});
  const rememberTeacherPage = useCallback((boardId: string, page: number) => {
    setTeacherPages(current => current[boardId] === page ? current : { ...current, [boardId]: page });
  }, []);
  useClassEvents(classId, VIEW_TOPIC, ({ event, senderIdentity }) => {
    if (!connection.host || event.type !== 'view' || !event.boardId.startsWith('personal-')) return;
    // A student may announce only their own page; never trust an arbitrary data packet.
    if (personalBoardOwner(event.boardId) !== senderIdentity?.split('|')[0]) return;
    setStudentPages((current) => current[event.boardId] === event.page ? current : { ...current, [event.boardId]: event.page });
  });
  // Only the shared board and the one in view are mounted: the shared board
  // keeps its page, zoom and tool while a personal board is open, and a teacher
  // walking through a whole group does not pile up one canvas per student
  // (their marks live on the server, so reopening one loses nothing).
  const showingAllStudents = connection.host && activeBoard === ALL_STUDENT_BOARDS_ID;
  const boardsToShow = connection.host
    ? [SHARED_BOARD_ID]
    : [SHARED_BOARD_ID, personalBoardId(currentUserId)];

  // A new screen share takes the main area; the user can switch back to the
  // board at any time, and the board keeps its marks while it is not shown.
  useEffect(() => {
    if (sharing && !wasSharing.current) setMainView('screen');
    if (!sharing) setMainView(view => view === 'screen' ? 'board' : view);
    wasSharing.current = sharing;
  }, [sharing]);

  const showScreen = sharing && mainView === 'screen';
  const showStudentWorkspaces = connection.host && activeBoard !== SHARED_BOARD_ID && !showScreen;
  const selectBoard = (boardId: string) => {
    audioRestore.current = true;
    if (connection.host) audioFocus.change(personalBoardOwner(boardId));
    setActiveBoard(boardId);
    setMainView('board');
    if (connection.host && boardId !== SHARED_BOARD_ID && window.matchMedia?.('(max-width: 900px)').matches) setVideosOpen(false);
  };
  const audioStudentName = students.find(student => student.userId === audioFocus.focus?.studentId)?.displayName
    ?? (language === 'DE' ? 'Schüler' : 'ученик');

  const fileAction = connection.host ? <>
    <button type="button" role="menuitem" tabIndex={-1} className="board-toolbar__action"
      disabled={materialBusy} onClick={() => materialInput.current?.click()}>
      <BoardToolbarIcon name="file" />{materialBusy ? 'Загрузка…'
        : language === 'DE' ? 'Gemeinsames Dokument für alle hinzufügen' : 'Добавить общий документ для всех'}
    </button>
    {personalUploadStudent && <button type="button" role="menuitem" tabIndex={-1} className="board-toolbar__action"
      disabled={materialBusy} onClick={() => {
        materialTarget.current = personalWorkbookBoardId(personalUploadStudent);
        personalMaterialInput.current?.click();
      }}>
      <BoardToolbarIcon name="file" />{language === 'DE'
        ? (personalUploadStudentName ? `Arbeitsblatt für ${personalUploadStudentName} hochladen` : 'Arbeitsblatt für Schüler hochladen')
        : (personalUploadStudentName ? `Загрузить лист для ${personalUploadStudentName}` : 'Загрузить лист ученику')}
    </button>}
  </> : undefined;

  return (
    <>
      <div ref={topbarRef} className="online-class-room__topbar">
        <div className="online-class-room__lesson-island">
          <strong>{lessonTitle || t('onlineClass.title')}</strong>
          <ConnectionStatus />
        </div>
        <div className="online-class-room__lesson-actions">
        <div className="online-class-room__audio-focus">
          <span role="status">{audioFocus.busy ? (language === 'DE' ? 'Audio wird umgeschaltet' : 'Переключаем звук')
            : connection.host ? (audioFocus.focus?.studentId && !audioFocus.focus.announceAll
              ? (language === 'DE' ? `Sie sprechen mit ${audioStudentName}. Sie hören alle.` : `Вас слышит ${audioStudentName}. Вы слышите всех.`)
              : (language === 'DE' ? 'Die ganze Gruppe hört Sie' : 'Вас слышит вся группа'))
              : audioFocus.focus?.announceAll ? (language === 'DE' ? 'Der Lehrer spricht mit allen' : 'Учитель обращается ко всем')
              : audioFocus.focus?.studentId ? (audioFocus.focus.studentId === currentUserId
                ? (language === 'DE' ? 'Gespräch mit dem Lehrer' : 'Разговор с учителем')
                : (language === 'DE' ? 'Selbstständige Arbeit. Sie hören Ihre Mitschüler.' : 'Самостоятельная работа. Вы слышите друг друга.'))
              : (language === 'DE' ? 'Gemeinsames Gespräch' : 'Общий разговор')}</span>
          {connection.host && audioFocus.focus?.studentId && <button type="button" disabled={audioFocus.busy}
            aria-pressed={audioFocus.focus.announceAll}
            onClick={() => audioFocus.change(audioFocus.focus!.studentId, !audioFocus.focus!.announceAll)}>
            {audioFocus.focus.announceAll ? (language === 'DE' ? 'Zurück zum Schüler' : 'Вернуться к ученику')
              : (language === 'DE' ? 'An alle sprechen' : 'Сказать всем')}
          </button>}
          {audioFocus.error && <span role="alert">
            {language === 'DE' ? 'Audio konnte nicht umgeschaltet werden.' : 'Не удалось переключить звук.'}
            {connection.host && <button type="button" disabled={audioFocus.busy} onClick={() => audioFocus.change(null)}>
              {language === 'DE' ? 'Gemeinsames Audio wiederherstellen' : 'Включить общий звук'}
            </button>}
          </span>}
        </div>
        {materialError && <span role="alert" style={{ color: '#dc2626' }}>{materialError}</span>}
        {inkRecoveryError && <div role="alert" className="online-class-room__archive-notice online-class-room__archive-notice--error">
          <span>{language === 'DE' ? 'Notizen konnten noch nicht gespeichert werden. Bitte erneut versuchen.'
            : 'Записи на доске ещё не сохранены. Повторите сохранение.'}</span>
          <button type="button" disabled={inkRecoveryBusy} onClick={() => void recoverInk()}>
            {language === 'DE' ? 'Notizen erneut speichern' : 'Повторить сохранение записей'}
          </button>
        </div>}
        {archiveNotice && <div className="online-class-room__archive-notice">
          <span role={archiveError ? 'alert' : 'status'} style={{color:archiveError?'#dc2626':undefined}}>{archiveNotice}</span>
          {!archiving && !exitPending && <button type="button" onClick={() => setArchiveNotice(null)}
            aria-label={language === 'DE' ? 'Speicherhinweis schließen' : 'Закрыть уведомление о сохранении'}>×</button>}
        </div>}
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
        <BoardSwitcher
          isHost={connection.host}
          currentUserId={currentUserId}
          students={students}
          activeId={activeBoard}
          onChange={selectBoard}
          teacherAction={<button type="button" aria-expanded={kolin.open} aria-controls="kolin-panel"
            onClick={() => { if (!kolin.open) answers.close(); kolin.toggle(); }}>Kolyn</button>}
        />
        <button type="button" className="online-class-room__videos-toggle" aria-expanded={videosOpen} aria-controls="online-class-videos" onClick={() => setVideosOpen((open) => !open)} title={videosOpen ? 'Скрыть видео участников' : 'Показать видео участников'}>
          {videosOpen ? 'Видео ›' : '‹ Видео'}
        </button>
        </div>
      </div>
      {connection.host && <input ref={materialInput} type="file" multiple accept=".pdf,application/pdf,image/png,image/jpeg,image/webp"
        disabled={materialBusy} hidden
        onChange={(event) => { const files = Array.from(event.target.files ?? []); if (files.length) void uploadMaterial(files, SHARED_BOARD_ID); event.target.value = ''; }} />}
      {connection.host && <input ref={personalMaterialInput} type="file" accept=".pdf,application/pdf,image/png,image/jpeg,image/webp"
        disabled={materialBusy} hidden
        onChange={(event) => { const files = Array.from(event.target.files ?? []); if (files.length) void uploadMaterial(files, materialTarget.current); event.target.value = ''; }} />}

      <div className={`online-class-room__stage${videosOpen ? " online-class-room__stage--videos-open" : ""}${showStudentWorkspaces ? ' online-class-room__stage--student-workspaces' : ''}`}>
          {/* Teacher-only answer PDF has its own column. It must not cover the shared
              canvas: the sibling board reflows to the remaining available width. */}
          {connection.host && answers.open && !kolin.open && (<>
            <AnswersPanel
              key={answers.scope}
              personal={answers.personal}
              studentName={answerStudentName}
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
            <AnswersPanelResizer storageKey={currentUserId} videosOpen={videosOpen} />
          </>)}
          {connection.host && kolin.open && (<>
            <KolinPanel chat={kolin} context={{
              ...(personalBoardOwner(activeBoard) ? { targetType: 'student' as const, studentId: personalBoardOwner(activeBoard)! } : { targetType: 'group' as const }),
              ...(Number.isInteger(teacherPages[activeBoard] ?? studentPages[activeBoard])
                ? { currentWorkbookPage: (teacherPages[activeBoard] ?? studentPages[activeBoard]) + 1 } : {}),
            }} />
            <AnswersPanelResizer storageKey={`kolin:${currentUserId}`} videosOpen={videosOpen} side="right" panelId="kolin-panel"
              defaultWidth={360} label={language === 'DE' ? 'Breite von Kolyn ändern' : 'Изменить ширину Kolyn'} />
          </>)}
        <div className="online-class-room__main" aria-busy={boardsFrozen}
          ref={element => { if (element) element.inert = boardsFrozen; }}>
          {/* The board stays mounted while a screen is shown, so switching back
              returns to the same page, zoom, tool and marks. */}
          {boardsToShow.map((boardId) => {
            const visible = boardId === activeBoard && !showScreen && !(ownNotebook && boardId === personalBoardId(currentUserId));
            return (
              <div key={boardId} className="online-class-room__board" hidden={!visible}>
                <Suspense fallback={null}>
                  <DocumentWhiteboardPanel
                    sharedDocument={boardDocument}
                    personalWorkbooksEnabled={connection.host ? personalWorkbookData?.enabled : undefined}
                    classId={classId}
                    actorId={currentUserId}
                    isHost={connection.host}
                    targetId={boardId}
                    // Everyone in the class may draw, on the shared board and on their own.
                    canAnnotate={!boardsFrozen}
                    fileAction={visible ? fileAction : undefined}
                    active={visible}
                    onPageChange={page => rememberTeacherPage(boardId, page)}
                    observedPages={studentPages}
                    onSaveLessonDocuments={connection.host ? archiveBoards : undefined}
                    savingLessonDocuments={archiving || exitPending}
                    // Answers belong to whichever board the teacher is looking at.
                    hostActions={
                      connection.host && visible ? (
                        <AnswersButton compact status={answers.status} open={answers.open} onToggle={toggleAnswers} />
                      ) : undefined
                    }
                  />
                </Suspense>
              </div>
            );
          })}
          {!connection.host && cameraBoardScope === notebookScope && <div className="online-class-room__board online-class-room__own-notebook"
            hidden={!ownNotebook || activeBoard !== personalBoardId(currentUserId) || showScreen}>
            <Suspense fallback={null}>
              <WhiteboardPanel key={notebookScope} classId={classId} actorId={currentUserId} isHost={false}
                targetType="NOTEBOOK_CAMERA" targetId={personalBoardId(currentUserId)} canAnnotate={!boardsFrozen}
                active={Boolean(ownNotebook) && activeBoard === personalBoardId(currentUserId) && !showScreen}
                liveBackground={ownNotebook ? { source: ownNotebook.source.rawVideo, width: ownNotebook.source.rawWidth, height: ownNotebook.source.rawHeight,
                  notebookView: { view: ownNotebook.source.view, rawWidth: ownNotebook.source.rawWidth, rawHeight: ownNotebook.source.rawHeight, renderer: ownNotebook.source.renderer } } : null} />
            </Suspense>
          </div>}
          {connection.host && <StudentWorkspaces
            key={classId}
            students={students}
            camerasByOwner={camerasByOwner}
            activeBoard={activeBoard}
            overview={showingAllStudents}
            visible={showStudentWorkspaces}
            onSelect={selectBoard}
            onOverview={() => selectBoard(ALL_STUDENT_BOARDS_ID)}
            renderBoard={(studentId, active, compact, following) => <Suspense fallback={null}>
              <DocumentWhiteboardPanel
                sharedDocument={boardDocument}
                personalWorkbooksEnabled={personalWorkbookData?.enabled}
                classId={classId}
                actorId={currentUserId}
                isHost
                targetId={personalBoardId(studentId)}
                compactPreview={compact}
                followStudent={following}
                observedPages={studentPages}
                canAnnotate={!compact && !boardsFrozen}
                active={active}
                onPageChange={page => rememberTeacherPage(personalBoardId(studentId), page)}
                fileAction={active && !compact ? fileAction : undefined}
                onSaveLessonDocuments={!compact ? archiveBoards : undefined}
                savingLessonDocuments={archiving || exitPending}
                hostActions={active && !compact ? <AnswersButton compact status={answers.status} open={answers.open} onToggle={toggleAnswers} /> : undefined}
              />
            </Suspense>}
            renderCameraBoard={(studentId, active, compact, source, following) => <Suspense fallback={null}>
              <WhiteboardPanel
                classId={classId}
                actorId={currentUserId}
                isHost
                targetType="NOTEBOOK_CAMERA"
                targetId={personalBoardId(studentId)}
                compactPreview={compact}
                followStudent={following}
                canAnnotate={!compact && !boardsFrozen}
                active={active}
                fileAction={active && !compact ? fileAction : undefined}
                liveBackground={source ? { source: source.rawVideo, width: source.rawWidth, height: source.rawHeight,
                  notebookView: { view: source.view, rawWidth: source.rawWidth, rawHeight: source.rawHeight, renderer: source.renderer } } : null}
                hostActions={active && !compact ? <AnswersButton compact status={answers.status} open={answers.open} onToggle={toggleAnswers} /> : undefined}
              />
            </Suspense>}
          />}
          {showScreen && (
            <div className="online-class-room__screen">
              <ScreenShareView />
            </div>
          )}

          {/* One owner connection supplies the ordinary board and the settings
              preview. Closing settings preserves its stream and calibration. */}
          {eventId && !connection.host && <aside
            id="classroom-notebook"
            className="online-class-room__notebook-settings"
            aria-label={language === 'DE' ? 'Hefteinstellungen' : 'Настройки тетради'}
            hidden={!notebookSettingsOpen}
            ref={element => element?.toggleAttribute('inert', !notebookSettingsOpen)}
          >
            <div className="online-class-room__notebook-settings-heading">
              <strong>{language === 'DE' ? 'Hefteinstellungen' : 'Настройки тетради'}</strong>
              <button type="button" onClick={closeNotebookSettings}
                aria-label={language === 'DE' ? 'Hefteinstellungen schließen' : 'Закрыть настройки тетради'}>
                {language === 'DE' ? 'Schließen' : 'Закрыть'}
              </button>
            </div>
            <NotebookCameraPanel
              key={`${eventId}:${classId}`}
              eventId={eventId}
              classId={classId}
              currentUserId={currentUserId}
              isTeacher={connection.host}
              students={connection.host ? students : undefined}
              autoPair={!connection.host}
              presentation="lesson"
              settingsOpen={notebookSettingsOpen}
              onBoardVideoChange={receiveNotebookVideo}
              onClose={closeNotebookSettings}
              closeLabel={language === 'DE' ? 'Schließen' : 'Закрыть настройки'}
            />
          </aside>}

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

      <div ref={controlsRef} className="online-class-room__controls">
        <div className="online-class-room__control-island">
        {/* Leave is handled by our own button. LiveKit's built-in Leave
            would look like an unexpected network disconnect here. */}
        <ControlBar controls={{ leave: false }} />
        <button
          type="button"
          aria-pressed={panelsOpen}
          aria-controls="online-class-drawer"
          onClick={() => { setPanelsOpen((open) => !open); setNotebookSettingsOpen(false); }}
        >
          {t('onlineClass.room.panels')}
          {waiting > 0 && <span className="online-class-room__badge"> ({waiting})</span>}
        </button>
        {eventId && !connection.host && <button ref={notebookTrigger} type="button"
          className="online-class-room__notebook-settings-toggle"
          aria-pressed={notebookSettingsOpen} aria-expanded={notebookSettingsOpen} aria-controls="classroom-notebook"
          onClick={() => {
            if (notebookSettingsOpen) { closeNotebookSettings(); return; }
            setNotebookSettingsOpen(true); setPanelsOpen(false);
            if (window.matchMedia?.('(max-width: 900px)').matches) setVideosOpen(false);
          }}>
          <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="m9 3 1-1h4l1 3 3 1 3-1 2 4-2 2v3l2 2-2 4-3-1-3 1-1 3h-4l-1-3-3-1-3 1-2-4 2-2v-3L1 9l2-4 3 1 3-1z" /><circle cx="12" cy="12" r="3" />
          </svg>
          {language === 'DE' ? 'Hefteinstellungen' : 'Настройки тетради'}
        </button>}
        {sharing && (
          <button type="button" onClick={() => setMainView(showScreen ? 'board' : 'screen')}>
            {t(showScreen ? 'onlineClass.room.showBoard' : 'onlineClass.room.showScreen')}
          </button>
        )}
        </div>
        <div className="online-class-room__control-island online-class-room__control-island--exit">
        <button type="button" className="online-class-room__leave" disabled={exitPending} onClick={() => void exitRoom(onLeave)}>
          {t('onlineClass.leave')}
        </button>
        {onEndForAll && (
          <button
            type="button"
            className="online-class-room__end"
            disabled={exitPending}
            onClick={() => {
              if (window.confirm(t('onlineClass.endConfirm'))) {
                void exitRoom(onEndForAll);
              }
            }}
          >
            {t('onlineClass.end')}
          </button>
        )}
        </div>
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
  onLeave: () => void | Promise<void>;
  /** An involuntary LiveKit disconnect is not the user's Leave action. */
  onConnectionLost: (reason?: string, everConnected?: boolean) => void;
  onMediaError?: (category: LiveKitErrorCategory) => void;
  onEndForAll?: () => void | Promise<void>;
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
