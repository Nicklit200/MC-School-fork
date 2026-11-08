import { act, cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../../api/client';
import { completedLessonApi, lessonPreparationApi } from '../../api/lessonPreparation';
import { exportBoardPdf } from './boardExport';
import { flushClassAnnotations, hasPendingClassAnnotations } from './annotationSync';
import { openPdf } from './pdfDocument';
import { onlineClassesApi, type OnlineClass, type OnlineClassConnection } from '../../api/onlineClasses';
import { I18nProvider } from '../../i18n/I18nContext';
import type { NotebookCameraVideoSource } from '../notebook-camera/NotebookCameraViewer';
import type { CameraModule } from '../notebook-camera/cameraModules';
import { useClassSession } from './useClassSession';
import { useBoardDocumentState } from './useBoardDocument';

let screenShares: unknown[] = [];
const notebookFixture = vi.hoisted(() => ({ camerasByOwner: new Map(), viewerProps: new Map(), panelProps: [] as Record<string, any>[] }));
const livekitFixture = vi.hoisted(() => ({ connectionState: 'connected' }));
const audioFixture = vi.hoisted(() => ({ focus: null as any, busy: false, error: false, change: vi.fn() }));
vi.mock('./useClassAudioFocus', () => ({ useClassAudioFocus: () => audioFixture }));

vi.mock('@livekit/components-react', () => ({
  LiveKitRoom: ({ children, onDisconnected, onConnected, onError }: {
    children: React.ReactNode;
    onDisconnected?: (reason?: number) => void;
    onConnected?: () => void;
    onError?: (error: Error) => void;
  }) => (
    <div>
      <button type="button" onClick={() => onDisconnected?.(1)}>
        Simulate LiveKit disconnect
      </button>
      <button type="button" onClick={() => onDisconnected?.(0)}>
        Simulate unknown disconnect
      </button>
      <button type="button" onClick={() => onConnected?.()}>
        Simulate media connected
      </button>
      <button type="button" onClick={() => onError?.(new Error('WebSocket handshake rejected'))}>
        Simulate signaling error
      </button>
      {children}
    </div>
  ),
  ControlBar: () => null,
  RoomAudioRenderer: () => null,
  ConnectionStateToast: () => null,
  FocusLayoutContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="screen">{children}</div>,
  FocusLayout: () => null,
  useConnectionState: () => livekitFixture.connectionState,
  useTracks: () => screenShares,
}));
vi.mock('./CameraColumn', () => ({ CameraColumn: () => <ul aria-label="cameras" /> }));
vi.mock('../notebook-camera/useLessonNotebookCameras', () => ({
  useLessonNotebookCameras: () => ({ cameras: [...notebookFixture.camerasByOwner.values()], camerasByOwner: notebookFixture.camerasByOwner, error: null }),
}));
vi.mock('../notebook-camera/NotebookCameraViewer', () => ({
  NotebookCameraViewer: (props: Record<string, any>) => {
    notebookFixture.viewerProps.set(props.cameraId, props);
    return <video title={props.title} />;
  },
}));
vi.mock('../notebook-camera/NotebookCameraPanel', () => ({
  NotebookCameraPanel: (props: Record<string, any>) => {
    notebookFixture.panelProps.push(props);
    return <section aria-label="Встроенная тетрадь" data-testid="notebook-session"
    data-event={props.eventId} data-class={props.classId} data-owner={props.currentUserId}
    data-teacher={String(props.isTeacher)} data-auto-pair={String(props.autoPair)}
    data-presentation={props.presentation} data-settings-open={String(props.settingsOpen)} data-roster={props.students?.length ?? 0}>
    <iframe title="Notebook processor" />
    <canvas data-testid="notebook-qr-fixture" />
    <button type="button" onClick={props.onClose}>{props.closeLabel}</button>
  </section>;
  },
}));
vi.mock('./ChatPanel', () => ({ ChatPanel: () => null }));
vi.mock('./CaptionsPanel', () => ({ CaptionsPanel: () => null }));
const recordingProps: Record<string, any>[] = [];
vi.mock('./RecordingControls', () => ({
  RecordingControls: (props: Record<string, any>) => {
    recordingProps.push(props);
    return null;
  },
}));
vi.mock('./TranscriptionControls', () => ({ TranscriptionControls: () => null }));
vi.mock('./ParticipantListPanel', () => ({ ParticipantListPanel: () => null }));
vi.mock('./WaitingRoomPanel', () => ({ WaitingRoomPanel: () => null }));
vi.mock('./AnswersPanelResizer', () => ({ AnswersPanelResizer: ({ storageKey }: { storageKey: string }) =>
  <div data-testid="answers-panel-resizer" data-owner={storageKey} /> }));
vi.mock('./useBoardDocument', () => ({ useBoardDocument: () => null, useBoardDocumentState: vi.fn() }));
vi.mock('./useClassEvents', () => ({ useClassEvents: () => ({ publish: vi.fn() }) }));
vi.mock('./useHostUserId', () => ({ useHostUserId: () => 'me' }));
vi.mock('./usePdf', () => ({ usePdf: () => ({ status: 'idle' }), usePdfPage: () => null }));
vi.mock('./pdfDocument', () => ({ openPdf: vi.fn(async () => ({ pageCount: 1, renderPage: vi.fn(), destroy: vi.fn() })) }));
vi.mock('./boardExport', () => ({ exportBoardPdf: vi.fn() }));
vi.mock('./annotationSync', () => ({ flushClassAnnotations: vi.fn(), hasPendingClassAnnotations: vi.fn() }));

const boardProps: Record<string, any>[] = [];
vi.mock('./WhiteboardPanel', () => ({
  WhiteboardPanel: (props: Record<string, any>) => {
    boardProps.push(props);
    return (
      <section data-testid={`board-${props.targetId}${props.targetType === 'NOTEBOOK_CAMERA' ? '-camera' : ''}`} data-active={String(props.active)}>
        {props.fileAction}
        {props.hostActions}
        {props.onSaveLessonDocuments && <button type="button" disabled={props.savingLessonDocuments}
          onClick={() => void props.onSaveLessonDocuments()}>Сохранить документы урока</button>}
        {props.lessonDocumentsStatus && <span role={props.lessonDocumentsError ? 'alert' : 'status'}>{props.lessonDocumentsStatus}</span>}
      </section>
    );
  },
}));

vi.mock('../../api/lessonPreparation', () => ({
  lessonPreparationApi: { answersMetadata: vi.fn(), answersBytes: vi.fn(), uploadAnswers: vi.fn(), appendWorkbook: vi.fn(), personalWorkbooks: vi.fn(), uploadPersonalWorkbook: vi.fn(),
    personalAnswersMetadata: vi.fn(), personalAnswersBytes: vi.fn(), uploadPersonalAnswers: vi.fn() },
  completedLessonApi: { list: vi.fn(), save: vi.fn() },
}));
vi.mock('../../api/onlineClasses', async () => {
  const actual = await vi.importActual<typeof import('../../api/onlineClasses')>('../../api/onlineClasses');
  return { ...actual, onlineClassesApi: { listParticipants: vi.fn(), documentBytes: vi.fn(), documentVersion: vi.fn(), startTranscription: vi.fn(), get: vi.fn(), connect: vi.fn(), listAnnotationDocuments: vi.fn() } };
});

import { OnlineClassRoom } from './OnlineClassRoom';

beforeEach(() => {
  audioFixture.focus = null; audioFixture.busy = false; audioFixture.error = false; audioFixture.change.mockClear();
  vi.mocked(flushClassAnnotations).mockReset().mockResolvedValue(undefined);
  vi.mocked(hasPendingClassAnnotations).mockReset().mockReturnValue(false);
  vi.mocked(useBoardDocumentState).mockReset().mockReturnValue({ status: 'empty', document: null, version: 0 });
  livekitFixture.connectionState = 'connected';
  vi.mocked(onlineClassesApi.startTranscription).mockReset().mockResolvedValue(undefined);
  vi.mocked(lessonPreparationApi.personalWorkbooks).mockReset().mockResolvedValue({ enabled: false, students: [] });
  vi.mocked(lessonPreparationApi.personalAnswersMetadata).mockReset().mockImplementation(async (_eventId, studentId) => ({ studentId, hasAnswers: false, answersFilename: null, version: 0 }));
});

const connection = (host: boolean): OnlineClassConnection => ({
  serverUrl: 'wss://x', token: 't', identity: 'me|d', roomName: 'r', expiresAt: '', host,
  recordingActive: false, transcriptionActive: false,
});

function classroom(host: boolean, extra: Partial<React.ComponentProps<typeof OnlineClassRoom>> = {}) {
  return (
    <I18nProvider>
      <OnlineClassRoom
        classId="c1"
        currentUserId="me"
        eventId="e1"
        connection={connection(host)}
        recordingState="INACTIVE"
        transcriptionState="INACTIVE"
        onLeave={vi.fn()}
        onConnectionLost={vi.fn()}
        {...extra}
      />
    </I18nProvider>
  );
}
function mount(host: boolean, extra: Partial<React.ComponentProps<typeof OnlineClassRoom>> = {}) {
  return render(classroom(host, extra));
}
function pupilCameraSource(overrides: Partial<NotebookCameraVideoSource> = {}): NotebookCameraVideoSource {
  return { video: document.createElement('canvas'), width: 1080, height: 1920,
    rawVideo: document.createElement('video'), rawWidth: 1920, rawHeight: 1080,
    view: { type: 'document-view', version: 1, corners: null, ratio: null, turn: 1, sourceAspect: 16 / 9 },
    renderer: {} as CameraModule, ...overrides };
}
function emitPupilCamera(cameraId: string, source: NotebookCameraVideoSource | null) {
  act(() => notebookFixture.panelProps.at(-1)!.onBoardVideoChange(cameraId, source));
}

describe('PDF upload contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(onlineClassesApi.listParticipants).mockResolvedValue([]);
    vi.mocked(lessonPreparationApi.answersMetadata).mockResolvedValue({ hasAnswers: false } as never);
    vi.mocked(onlineClassesApi.documentVersion).mockResolvedValue({ version: 2 });
  });

  it('opens the real workbook picker from the compact board action', async () => {
    const view = mount(true, { lessonTitle: 'Алгебра' });
    const action = await screen.findByRole('menuitem', { name: 'Добавить общий документ для всех' });
    const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;
    const picker = vi.spyOn(input, 'click').mockImplementation(() => undefined);
    await userEvent.click(action);
    expect(picker).toHaveBeenCalledOnce();
    expect(screen.getByText('Алгебра')).toBeInTheDocument();
    expect(lessonPreparationApi.appendWorkbook).not.toHaveBeenCalled();
  });

  it('uploads a PDF and verifies that the classroom can read it', async () => {
    vi.mocked(lessonPreparationApi.appendWorkbook).mockResolvedValue({ hasWorkbook: true } as never);
    vi.mocked(onlineClassesApi.documentBytes).mockResolvedValue(new ArrayBuffer(16));
    const refresh = vi.fn();
    window.addEventListener('mc-workbook-updated', refresh);
    const view = mount(true);
    const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['%PDF-1.4 sample'], 'lesson.pdf', { type: 'application/pdf' });
    await userEvent.upload(input, file);
    await waitFor(() => expect(lessonPreparationApi.appendWorkbook).toHaveBeenCalledWith('e1', file));
    await waitFor(() => expect(onlineClassesApi.documentBytes).toHaveBeenCalledWith('c1'));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    window.removeEventListener('mc-workbook-updated', refresh);
  });

  it('appends multiple PDFs in the selected order and keeps existing pages', async () => {
    vi.mocked(lessonPreparationApi.appendWorkbook).mockResolvedValue({ hasWorkbook: true } as never);
    vi.mocked(onlineClassesApi.documentBytes).mockResolvedValue(new ArrayBuffer(32));
    const view = mount(true);
    const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.multiple).toBe(true);
    const a = new File(['%PDF-1.4 first'], 'first.pdf', { type: 'application/pdf' });
    const b = new File(['%PDF-1.4 second'], 'second.pdf', { type: 'application/pdf' });
    await userEvent.upload(input, [a, b]);
    await waitFor(() => expect(lessonPreparationApi.appendWorkbook).toHaveBeenCalledTimes(2));
    expect(vi.mocked(lessonPreparationApi.appendWorkbook).mock.calls).toEqual([['e1', a], ['e1', b]]);
    expect(onlineClassesApi.documentVersion).toHaveBeenCalledTimes(2);
  });

  it('reports when the saved PDF cannot be opened from the classroom', async () => {
    vi.mocked(lessonPreparationApi.appendWorkbook).mockResolvedValue({ hasWorkbook: true } as never);
    vi.mocked(onlineClassesApi.documentBytes).mockResolvedValue(null);
    const view = mount(true);
    const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, new File(['pdf'], 'lesson.pdf', { type: 'application/pdf' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('PDF сохранён, но пока недоступен на доске');
    expect(onlineClassesApi.documentBytes).toHaveBeenCalledTimes(2);
  });

  it('does not report success if iPad upload was stored in the wrong slot', async () => {
    vi.mocked(lessonPreparationApi.appendWorkbook).mockResolvedValue({ hasWorkbook: false } as never);
    const view = mount(true);
    const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, new File(['%PDF-1.4 sample'], 'math_answers.pdf', { type: 'application/pdf' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('не сохранил его как рабочую тетрадь');
    expect(onlineClassesApi.documentBytes).not.toHaveBeenCalled();
  });

  it('rejects empty iPad file before asking the server to store it', async () => {
    const view = mount(true);
    const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, new File([], 'empty.pdf', { type: 'application/pdf' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Выбранный файл пустой');
    expect(lessonPreparationApi.appendWorkbook).not.toHaveBeenCalled();
  });

  it('reports a rejected upload instead of spinning forever', async () => {
    vi.mocked(lessonPreparationApi.appendWorkbook).mockRejectedValue(new Error('HTTP 413'));
    const view = mount(true);
    const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, new File(['pdf'], 'large.pdf', { type: 'application/pdf' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('HTTP 413');
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Добавить общий документ для всех' })).toBeEnabled());
  });

  it('uploads a pilot personal worksheet to that student without changing the shared PDF', async () => {
    vi.mocked(lessonPreparationApi.personalWorkbooks).mockResolvedValue({ enabled: true, students: [
      { studentId: 'alice', studentName: 'Анна', hasWorkbook: false, filename: null, version: 0 },
      { studentId: 'bob', studentName: 'Борис', hasWorkbook: false, filename: null, version: 0 },
    ] });
    vi.mocked(onlineClassesApi.listParticipants).mockResolvedValue([
      { userId: 'alice', displayName: 'Анна', classRole: 'STUDENT', admissionState: 'ADMITTED' } as never,
    ]);
    vi.mocked(lessonPreparationApi.uploadPersonalWorkbook).mockResolvedValue({ studentId: 'alice', studentName: 'Анна', hasWorkbook: true, filename: 'anna.pdf', version: 1 });
    vi.mocked(onlineClassesApi.documentBytes).mockResolvedValue(new ArrayBuffer(8));
    const view = mount(true);
    await screen.findByRole('button', { name: 'Доска ученика: Анна' });
    expect(screen.getAllByRole('button', { name: 'Доска ученика: Анна' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Доска ученика: Борис' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Персональный лист/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Доска ученика: Анна' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Загрузить лист для Анна' }));
    // The native picker can stay open while the teacher changes the board.
    await userEvent.click(screen.getByRole('button', { name: 'Доска ученика: Борис' }));
    const input = view.container.querySelector('input[type="file"]:not([multiple])') as HTMLInputElement;
    expect(input.multiple).toBe(false);
    const file = new File(['%PDF-1.7'], 'anna.pdf', { type: 'application/pdf' });
    await userEvent.upload(input, file);
    await waitFor(() => expect(lessonPreparationApi.uploadPersonalWorkbook).toHaveBeenCalledWith('e1', 'alice', file));
    expect(lessonPreparationApi.appendWorkbook).not.toHaveBeenCalled();
    await waitFor(() => expect(onlineClassesApi.documentBytes).toHaveBeenCalledWith('c1', 'personal-workbook-alice'));
  });

  it('keeps the shared upload explicit on a pupil’s assigned My board', async () => {
    vi.mocked(lessonPreparationApi.personalWorkbooks).mockResolvedValue({ enabled: true, students: [
      { studentId: 'alice', studentName: 'Анна', hasWorkbook: true, filename: 'anna.pdf', version: 1 },
    ] });
    vi.mocked(useBoardDocumentState).mockReturnValue({ status: 'ready', document: { pageCount: 1, renderPage: vi.fn(), destroy: vi.fn() }, version: 1 });
    vi.mocked(lessonPreparationApi.appendWorkbook).mockResolvedValue({ hasWorkbook: true } as never);
    vi.mocked(onlineClassesApi.documentBytes).mockResolvedValue(new ArrayBuffer(8));
    const view = mount(true);
    await screen.findByRole('button', { name: 'Доска ученика: Анна' });
    await userEvent.click(screen.getByRole('button', { name: 'Доска ученика: Анна' }));
    const board = await screen.findByTestId('board-personal-workbook-alice');
    expect(within(board).getByRole('menuitem', { name: 'Загрузить лист для Анна' })).toBeInTheDocument();
    await userEvent.click(within(board).getByRole('menuitem', { name: 'Добавить общий документ для всех' }));
    const file = new File(['%PDF-1.7'], 'all.pdf', { type: 'application/pdf' });
    await userEvent.upload(view.container.querySelector('input[type="file"][multiple]')!, file);
    await waitFor(() => expect(lessonPreparationApi.appendWorkbook).toHaveBeenCalledWith('e1', file));
    expect(lessonPreparationApi.uploadPersonalWorkbook).not.toHaveBeenCalled();
    expect(screen.getByTestId('board-personal-workbook-alice')).toHaveAttribute('data-active', 'true');
  });

  it('archives each board using its own PDF background', async () => {
    const sharedBytes = new ArrayBuffer(8);
    const sharedDocument = { pageCount: 3, renderPage: vi.fn(), destroy: vi.fn() };
    vi.mocked(onlineClassesApi.listParticipants).mockResolvedValue([
      { userId: 'alice', displayName: 'Анна', classRole: 'STUDENT', admissionState: 'ADMITTED' } as never,
    ]);
    vi.mocked(onlineClassesApi.listAnnotationDocuments).mockResolvedValue([]);
    vi.mocked(onlineClassesApi.documentBytes).mockResolvedValue(sharedBytes);
    vi.mocked(openPdf).mockResolvedValue(sharedDocument);
    vi.mocked(exportBoardPdf).mockResolvedValue(new Blob(['%PDF-1.7']));
    vi.mocked(completedLessonApi.save).mockImplementation(async (_eventId, classId, boardId) => ({
      id: boardId, classId, boardId, filename: 'board.pdf', savedAt: '',
    }));
    vi.mocked(completedLessonApi.list).mockResolvedValue(['board-1', 'personal-alice'].map(boardId => ({
      id: boardId, classId: 'c1', boardId, filename: 'board.pdf', savedAt: '',
    })));
    mount(true);
    await screen.findByRole('button', { name: /Анна/ });
    await act(async () => boardProps.filter(props => props.targetId === 'board-1').at(-1)!.onSaveLessonDocuments());
    expect(exportBoardPdf).toHaveBeenCalledWith(expect.objectContaining({ targetId: 'board-1', pageCount: 3, pdfDocument: sharedDocument }));
    expect(exportBoardPdf).toHaveBeenCalledWith(expect.objectContaining({ targetId: 'personal-alice', pageCount: 3, pdfDocument: sharedDocument }));
    expect(sharedDocument.destroy).toHaveBeenCalledOnce();
    expect(onlineClassesApi.documentBytes).toHaveBeenCalledTimes(1);
  });

  it('includes a connector-uploaded worksheet without annotations and exports its own PDF', async () => {
    const student = { studentId: 'bob', studentName: 'Борис', hasWorkbook: false, filename: null, version: 0 };
    vi.mocked(lessonPreparationApi.personalWorkbooks).mockResolvedValueOnce({ enabled: true, students: [student] });
    const sharedBytes = new ArrayBuffer(8), personalBytes = new ArrayBuffer(16);
    const sharedDocument = { pageCount: 3, renderPage: vi.fn(), destroy: vi.fn() };
    const personalDocument = { pageCount: 1, renderPage: vi.fn(), destroy: vi.fn() };
    vi.mocked(onlineClassesApi.listAnnotationDocuments).mockResolvedValue([]);
    vi.mocked(onlineClassesApi.documentBytes).mockImplementation(async (_classId, boardId) => boardId ? personalBytes : sharedBytes);
    vi.mocked(openPdf).mockImplementation(async bytes => bytes === sharedBytes ? sharedDocument : personalDocument);
    vi.mocked(exportBoardPdf).mockResolvedValue(new Blob(['%PDF-1.7']));
    vi.mocked(completedLessonApi.save).mockImplementation(async (_eventId, classId, boardId) => ({ id: boardId, classId, boardId, filename: 'board.pdf', savedAt: '' }));
    vi.mocked(completedLessonApi.list).mockResolvedValue(['board-1', 'personal-workbook-bob'].map(boardId => ({ id: boardId, classId: 'c1', boardId, filename: 'board.pdf', savedAt: '' })));
    mount(true);
    await screen.findByRole('button', { name: 'Доска ученика: Борис' });
    vi.mocked(lessonPreparationApi.personalWorkbooks).mockResolvedValue({ enabled: true, students: [{ ...student, hasWorkbook: true, filename: 'bob.pdf', version: 1 }] });
    await act(async () => boardProps.filter(props => props.targetId === 'board-1').at(-1)!.onSaveLessonDocuments());
    expect(exportBoardPdf).toHaveBeenCalledWith(expect.objectContaining({ targetId: 'personal-workbook-bob', pageCount: 1, pdfDocument: personalDocument }));
    expect(lessonPreparationApi.personalWorkbooks).toHaveBeenCalledTimes(2);
    expect(sharedDocument.destroy).toHaveBeenCalledOnce();
    expect(personalDocument.destroy).toHaveBeenCalledOnce();
  });

  it('opens the assigned worksheet through My board while keeping only two navigation buttons', async () => {
    vi.mocked(useBoardDocumentState).mockReturnValue({ status: 'ready', document: { pageCount: 1, renderPage: vi.fn(), destroy: vi.fn() }, version: 1 });
    mount(false);
    await userEvent.click(await screen.findByRole('button', { name: 'Моя доска' }));
    expect(screen.getByTestId('board-personal-workbook-me')).toHaveAttribute('data-active', 'true');
    expect(screen.queryByRole('button', { name: 'Персональный лист' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('board-personal-me')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Общая доска' }));
    expect(screen.getByTestId('board-board-1')).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('board-personal-workbook-me')).toHaveAttribute('data-active', 'false');
  });
});

describe('lesson PDF save notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    boardProps.length = 0;
    screenShares = [];
    notebookFixture.camerasByOwner.clear();
    vi.mocked(onlineClassesApi.listParticipants).mockResolvedValue([
      { userId: 'alice', displayName: 'Анна', classRole: 'STUDENT', admissionState: 'ADMITTED' } as never,
    ]);
    vi.mocked(lessonPreparationApi.answersMetadata).mockResolvedValue({ hasAnswers: false } as never);
    vi.mocked(onlineClassesApi.listAnnotationDocuments).mockResolvedValue([]);
    vi.mocked(onlineClassesApi.documentBytes).mockResolvedValue(null);
    vi.mocked(exportBoardPdf).mockResolvedValue(new Blob(['%PDF-1.7']));
    vi.mocked(completedLessonApi.save).mockImplementation(async (_eventId, classId, boardId) => ({
      id: boardId, classId, boardId, filename: 'board.pdf', savedAt: '',
    }));
    vi.mocked(completedLessonApi.list).mockResolvedValue(['board-1', 'personal-alice'].map(boardId => ({
      id: boardId, classId: 'c1', boardId, filename: 'board.pdf', savedAt: '',
    })));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const saveBoards = () => boardProps.filter(props => props.targetId === 'board-1').at(-1)!.onSaveLessonDocuments() as Promise<boolean>;

  it('ignores invalid persisted page indices when determining the archive page count', async () => {
    vi.mocked(onlineClassesApi.listAnnotationDocuments).mockResolvedValue([
      ...[2, -1, 2.5, 10_000, 2_147_483_647].map(pageIndex => ({ targetType: 'WHITEBOARD', targetId: 'board-1', pageIndex })),
      { targetType: 'WHITEBOARD', targetId: 'personal-alice', pageIndex: 10_000 },
    ] as never);
    mount(true);
    await screen.findByRole('button', { name: /Анна/ });
    await act(async () => { expect(await saveBoards()).toBe(true); });
    expect(exportBoardPdf).toHaveBeenCalledWith(expect.objectContaining({ targetId: 'board-1', pageCount: 3 }));
    expect(exportBoardPdf).toHaveBeenCalledWith(expect.objectContaining({ targetId: 'personal-alice', pageCount: 1 }));
  });

  it('shows one confirmation across the room and mounted boards, then clears it after five seconds', async () => {
    mount(true);
    await screen.findByRole('button', { name: /Анна/ });
    vi.useFakeTimers();
    await act(async () => { await saveBoards(); });
    expect(screen.getAllByText(/PDF сохранены в разделе/)).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Закрыть уведомление о сохранении' })).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(4999); });
    expect(screen.getByText(/PDF сохранены в разделе/)).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(screen.queryByText(/PDF сохранены в разделе/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Закрыть уведомление о сохранении' })).not.toBeInTheDocument();
  });

  it('keeps a new save visible past the old timeout and starts dismissal only after verification', async () => {
    mount(true);
    await screen.findByRole('button', { name: /Анна/ });
    vi.useFakeTimers();
    await act(async () => { await saveBoards(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    let verify!: (docs: Awaited<ReturnType<typeof completedLessonApi.list>>) => void;
    vi.mocked(completedLessonApi.list).mockImplementationOnce(() => new Promise(resolve => { verify = resolve; }));
    let saving!: Promise<boolean>;
    await act(async () => { saving = saveBoards(); });
    expect(screen.getByText('Проверяем сохранённые PDF на сервере…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Закрыть уведомление о сохранении' })).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(screen.getByText('Проверяем сохранённые PDF на сервере…')).toBeInTheDocument();
    await act(async () => {
      verify(['board-1', 'personal-alice'].map(boardId => ({ id: boardId, classId: 'c1', boardId, filename: 'board.pdf', savedAt: '' })));
      await saving;
    });
    expect(screen.getAllByText(/PDF сохранены в разделе/)).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(screen.queryByText(/PDF сохранены в разделе/)).not.toBeInTheDocument();
  });

  it('keeps a failed verification visible until the teacher dismisses it', async () => {
    vi.mocked(completedLessonApi.list).mockRejectedValueOnce(new Error('Проверка недоступна'));
    mount(true);
    await screen.findByRole('button', { name: /Анна/ });
    vi.useFakeTimers();
    await act(async () => { await saveBoards(); });
    expect(screen.getByRole('alert')).toHaveTextContent('Проверка недоступна');
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(screen.getByRole('alert')).toHaveTextContent('Проверка недоступна');
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть уведомление о сохранении' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each(['leave', 'end'] as const)('waits for pending ink, saved PDFs and server verification before teacher %s', async action => {
    let flush!: () => void;
    vi.mocked(flushClassAnnotations).mockImplementationOnce(() => new Promise(resolve => { flush = resolve; }));
    let verify!: (docs: Awaited<ReturnType<typeof completedLessonApi.list>>) => void;
    vi.mocked(completedLessonApi.list).mockImplementationOnce(() => new Promise(resolve => { verify = resolve; }));
    const onLeave = vi.fn(), onEndForAll = vi.fn();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      mount(true, { onLeave, onEndForAll });
      await screen.findByRole('button', { name: /Анна/ });
      fireEvent.click(screen.getByRole('button', { name: action === 'leave' ? 'Выйти' : 'Завершить урок для всех' }));
      expect(flushClassAnnotations).toHaveBeenCalledExactlyOnceWith('c1', 'me', expect.any(Function));
      expect(exportBoardPdf).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Выйти' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Завершить урок для всех' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Сохранить документы урока' })).toBeDisabled();
      expect(screen.getByTestId('board-board-1').closest('.online-class-room__main')).toHaveProperty('inert', true);
      expect(boardProps.filter(props => props.targetId === 'board-1').at(-1)?.canAnnotate).toBe(false);
      await act(async () => flush());
      await waitFor(() => expect(completedLessonApi.list).toHaveBeenCalledWith('e1'));
      expect(onLeave).not.toHaveBeenCalled();
      expect(onEndForAll).not.toHaveBeenCalled();
      await act(async () => verify(['board-1', 'personal-alice'].map(boardId => ({
        id: boardId, classId: 'c1', boardId, filename: 'board.pdf', savedAt: '',
      }))));
      await waitFor(() => expect(action === 'leave' ? onLeave : onEndForAll).toHaveBeenCalledOnce());
      expect(action === 'leave' ? onEndForAll : onLeave).not.toHaveBeenCalled();
    } finally { confirm.mockRestore(); }
  });

  it.each(['ink', 'verification'] as const)('keeps the lesson open after failed %s and permits an explicit retry', async failure => {
    if (failure === 'ink') vi.mocked(flushClassAnnotations).mockRejectedValueOnce(new Error('Последние записи не сохранены'));
    else vi.mocked(completedLessonApi.list).mockResolvedValueOnce([]);
    const onEndForAll = vi.fn();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      mount(true, { onEndForAll });
      await screen.findByRole('button', { name: /Анна/ });
      fireEvent.click(screen.getByRole('button', { name: 'Завершить урок для всех' }));
      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Выход отложен'));
      expect(onEndForAll).not.toHaveBeenCalled();
      expect(screen.getByTestId('board-board-1')).toHaveAttribute('data-active', 'true');
      expect(screen.getByRole('button', { name: 'Завершить урок для всех' })).toBeEnabled();
      if (failure === 'ink') expect(exportBoardPdf).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Завершить урок для всех' }));
      await waitFor(() => expect(onEndForAll).toHaveBeenCalledOnce());
      expect(flushClassAnnotations).toHaveBeenCalledTimes(2);
    } finally { confirm.mockRestore(); }
  });

  it('shares an in-flight manual save with exit and rejects duplicate exit clicks', async () => {
    let verify!: (docs: Awaited<ReturnType<typeof completedLessonApi.list>>) => void;
    vi.mocked(completedLessonApi.list).mockImplementationOnce(() => new Promise(resolve => { verify = resolve; }));
    const onLeave = vi.fn(), onEndForAll = vi.fn();
    mount(true, { onLeave, onEndForAll });
    await screen.findByRole('button', { name: /Анна/ });
    let saving!: Promise<boolean>;
    await act(async () => { saving = saveBoards(); expect(saveBoards()).toBe(saving); });
    expect(screen.getByTestId('board-board-1').closest('.online-class-room__main')).toHaveProperty('inert', true);
    expect(boardProps.filter(props => props.targetId === 'board-1').at(-1)?.canAnnotate).toBe(false);
    expect(screen.getByRole('button', { name: 'Выйти' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Выйти' }));
    fireEvent.click(screen.getByRole('button', { name: 'Выйти' }));
    fireEvent.click(screen.getByRole('button', { name: 'Завершить урок для всех' }));
    expect(flushClassAnnotations).toHaveBeenCalledOnce();
    expect(completedLessonApi.save).toHaveBeenCalledTimes(2);
    expect(onLeave).not.toHaveBeenCalled();
    await act(async () => {
      verify(['board-1', 'personal-alice'].map(boardId => ({ id: boardId, classId: 'c1', boardId, filename: 'board.pdf', savedAt: '' })));
      expect(await saving).toBe(true);
    });
    await waitFor(() => expect(onLeave).toHaveBeenCalledOnce());
    expect(onEndForAll).not.toHaveBeenCalled();
    expect(completedLessonApi.list).toHaveBeenCalledOnce();
  });

  it('keeps exit controls locked until the server finishes ending the lesson', async () => {
    let finish!: () => void;
    const onEndForAll = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      mount(true, { onEndForAll });
      await screen.findByRole('button', { name: /Анна/ });
      fireEvent.click(screen.getByRole('button', { name: 'Завершить урок для всех' }));
      await waitFor(() => expect(onEndForAll).toHaveBeenCalledOnce());
      expect(completedLessonApi.list).toHaveBeenCalledOnce();
      expect(screen.getByRole('button', { name: 'Выйти' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Завершить урок для всех' })).toBeDisabled();
      fireEvent.click(screen.getByRole('button', { name: 'Завершить урок для всех' }));
      expect(onEndForAll).toHaveBeenCalledOnce();
      await act(async () => finish());
      expect(screen.getByRole('button', { name: 'Завершить урок для всех' })).toBeEnabled();
    } finally { confirm.mockRestore(); }
  });

  it.each([false, true])('flushes own ink without teacher archive work for a pupil or standalone room (host=%s)', async host => {
    let finish!: () => void;
    const onLeave = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    mount(host, { onLeave, ...(host ? { eventId: undefined } : {}) });
    await screen.findByTestId('board-board-1');
    await userEvent.click(screen.getByRole('button', { name: 'Выйти' }));
    expect(onLeave).toHaveBeenCalledOnce();
    expect(flushClassAnnotations).toHaveBeenCalledExactlyOnceWith('c1', 'me', expect.any(Function));
    expect(completedLessonApi.save).not.toHaveBeenCalled();
    expect(screen.getByTestId('board-board-1').closest('.online-class-room__main')).toHaveProperty('inert', true);
    expect(boardProps.filter(props => props.targetId === 'board-1').at(-1)?.canAnnotate).toBe(false);
    await act(async () => finish());
  });

  it('does not navigate a new classroom when an old exit save completes', async () => {
    let verify!: (docs: Awaited<ReturnType<typeof completedLessonApi.list>>) => void;
    vi.mocked(completedLessonApi.list).mockImplementationOnce(() => new Promise(resolve => { verify = resolve; }));
    const onLeave = vi.fn();
    const view = mount(true, { onLeave });
    await screen.findByRole('button', { name: /Анна/ });
    fireEvent.click(screen.getByRole('button', { name: 'Выйти' }));
    await waitFor(() => expect(completedLessonApi.list).toHaveBeenCalledOnce());
    view.rerender(classroom(true, { classId: 'c2', eventId: 'e2', onLeave }));
    await act(async () => verify(['board-1', 'personal-alice'].map(boardId => ({
      id: boardId, classId: 'c1', boardId, filename: 'board.pdf', savedAt: '',
    }))));
    expect(onLeave).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Выйти' })).toBeEnabled();
    expect(screen.queryByText(/PDF сохранены в разделе/)).not.toBeInTheDocument();
  });

  it('waits for a pupil’s own pending ink before leaving and keeps their board frozen', async () => {
    let finish!: () => void;
    vi.mocked(flushClassAnnotations).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const onLeave = vi.fn();
    mount(false, { onLeave });
    await screen.findByTestId('board-board-1');
    emitPupilCamera('camera-me', pupilCameraSource());
    await screen.findByTestId('board-personal-me-camera');
    fireEvent.click(screen.getByRole('button', { name: 'Выйти' }));
    expect(flushClassAnnotations).toHaveBeenCalledExactlyOnceWith('c1', 'me', expect.any(Function));
    expect(onLeave).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Выйти' })).toBeDisabled();
    expect(screen.getByTestId('board-board-1').closest('.online-class-room__main')).toHaveProperty('inert', true);
    expect(boardProps.filter(props => props.targetId === 'board-1').at(-1)?.canAnnotate).toBe(false);
    expect(boardProps.filter(props => props.targetType === 'NOTEBOOK_CAMERA' && props.actorId === 'me').at(-1)?.canAnnotate).toBe(false);
    await act(async () => finish());
    await waitFor(() => expect(onLeave).toHaveBeenCalledOnce());
    expect(completedLessonApi.save).not.toHaveBeenCalled();
  });

  it('keeps a pupil in the lesson after failed ink saving and allows an explicit exit retry', async () => {
    vi.mocked(flushClassAnnotations).mockRejectedValueOnce(new Error('Есть несохранённые записи'));
    const onLeave = vi.fn();
    mount(false, { onLeave });
    await screen.findByTestId('board-board-1');
    fireEvent.click(screen.getByRole('button', { name: 'Выйти' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Выход отложен'));
    expect(onLeave).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Выйти' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Выйти' }));
    await waitFor(() => expect(onLeave).toHaveBeenCalledOnce());
    expect(flushClassAnnotations).toHaveBeenCalledTimes(2);
    expect(completedLessonApi.save).not.toHaveBeenCalled();
  });
});

describe('pupil ink recovery after reconnect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    screenShares = [];
    vi.mocked(onlineClassesApi.listParticipants).mockResolvedValue([]);
    vi.mocked(lessonPreparationApi.answersMetadata).mockResolvedValue({ hasAnswers: false } as never);
    vi.mocked(hasPendingClassAnnotations).mockReturnValue(true);
  });

  it('retries the current pupil on entry and after a new connected transition, not on ordinary rerenders', async () => {
    livekitFixture.connectionState = 'connecting';
    const room = mount(false);
    await screen.findByTestId('board-board-1');
    expect(flushClassAnnotations).not.toHaveBeenCalled();
    livekitFixture.connectionState = 'connected';
    room.rerender(classroom(false));
    await waitFor(() => expect(flushClassAnnotations).toHaveBeenCalledExactlyOnceWith('c1', 'me', expect.any(Function)));
    room.rerender(classroom(false));
    expect(flushClassAnnotations).toHaveBeenCalledOnce();
    livekitFixture.connectionState = 'reconnecting';
    room.rerender(classroom(false));
    livekitFixture.connectionState = 'connected';
    room.rerender(classroom(false));
    await waitFor(() => expect(flushClassAnnotations).toHaveBeenCalledTimes(2));
  });

  it('shows a recovery error and retries without leaving or archiving another pupil’s work', async () => {
    vi.mocked(flushClassAnnotations).mockRejectedValueOnce(new Error('offline'));
    const onLeave = vi.fn();
    mount(false, { onLeave });
    await screen.findByRole('button', { name: 'Повторить сохранение записей' });
    expect(screen.getByRole('alert')).toHaveTextContent('Записи на доске ещё не сохранены');
    await userEvent.click(screen.getByRole('button', { name: 'Повторить сохранение записей' }));
    await waitFor(() => expect(flushClassAnnotations).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Повторить сохранение записей' })).not.toBeInTheDocument());
    expect(onLeave).not.toHaveBeenCalled();
    expect(completedLessonApi.save).not.toHaveBeenCalled();
  });

  it('tries the same actor again after leaving and re-entering the classroom', async () => {
    vi.mocked(flushClassAnnotations).mockRejectedValueOnce(new Error('offline'));
    const room = mount(false, { currentUserId: 'alice' });
    await screen.findByRole('button', { name: 'Повторить сохранение записей' });
    room.unmount();
    mount(false, { currentUserId: 'alice' });
    await waitFor(() => expect(flushClassAnnotations).toHaveBeenCalledTimes(2));
    expect(vi.mocked(flushClassAnnotations).mock.calls.map(([classId, actorId]) => [classId, actorId]))
      .toEqual([['c1', 'alice'], ['c1', 'alice']]);
    expect(screen.queryByRole('button', { name: 'Повторить сохранение записей' })).not.toBeInTheDocument();
  });

  it('cancels an old class/account recovery scope and hides its late failure', async () => {
    let fail!: (error: Error) => void;
    vi.mocked(flushClassAnnotations).mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
    const room = mount(false, { currentUserId: 'alice' });
    await waitFor(() => expect(flushClassAnnotations).toHaveBeenCalledOnce());
    const isCurrent = vi.mocked(flushClassAnnotations).mock.calls[0][2]!;
    expect(isCurrent()).toBe(true);
    vi.mocked(hasPendingClassAnnotations).mockReturnValue(false);
    room.rerender(classroom(false, { classId: 'c2', eventId: 'e2', currentUserId: 'bob' }));
    expect(isCurrent()).toBe(false);
    await act(async () => fail(new Error('old offline failure')));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(flushClassAnnotations).toHaveBeenCalledExactlyOnceWith('c1', 'alice', expect.any(Function));
  });

  it('never performs an unscoped recovery for a missing actor', async () => {
    mount(false, { currentUserId: '' });
    await screen.findByTestId('board-board-1');
    expect(hasPendingClassAnnotations).not.toHaveBeenCalled();
    expect(flushClassAnnotations).not.toHaveBeenCalled();
  });
});

describe('transcription starts when the teacher enters the media room', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    screenShares = [];
    notebookFixture.camerasByOwner.clear();
    notebookFixture.viewerProps.clear();
    notebookFixture.panelProps.length = 0;
    vi.mocked(onlineClassesApi.listParticipants).mockResolvedValue([]);
    vi.mocked(lessonPreparationApi.answersMetadata).mockResolvedValue({ hasAnswers: false } as never);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it.each(['disconnected', 'connecting', 'reconnecting'])('does not start while the teacher is %s', async (state) => {
    livekitFixture.connectionState = state;
    mount(true, { transcriptionAvailable: true });
    await screen.findByTestId('board-board-1');
    expect(onlineClassesApi.startTranscription).not.toHaveBeenCalled();
  });

  it('starts after the teacher connects and verifies again on reconnect without repeating on status refresh', async () => {
    livekitFixture.connectionState = 'connecting';
    const onStateChanged = vi.fn();
    const view = mount(true, { transcriptionAvailable: true, onStateChanged });
    await screen.findByTestId('board-board-1');
    expect(onlineClassesApi.startTranscription).not.toHaveBeenCalled();

    livekitFixture.connectionState = 'connected';
    view.rerender(classroom(true, { transcriptionAvailable: true, onStateChanged }));
    await waitFor(() => expect(onlineClassesApi.startTranscription).toHaveBeenCalledExactlyOnceWith('c1'));
    await waitFor(() => expect(onStateChanged).toHaveBeenCalledOnce());

    // An INACTIVE status can remain briefly while the server status refreshes.
    view.rerender(classroom(true, { transcriptionAvailable: true, onStateChanged }));
    livekitFixture.connectionState = 'reconnecting';
    view.rerender(classroom(true, { transcriptionAvailable: true, transcriptionState: 'ACTIVE', onStateChanged }));
    livekitFixture.connectionState = 'connected';
    view.rerender(classroom(true, { transcriptionAvailable: true, transcriptionState: 'ACTIVE', onStateChanged }));
    await waitFor(() => expect(onlineClassesApi.startTranscription).toHaveBeenCalledTimes(2));
    view.rerender(classroom(true, { transcriptionAvailable: true, transcriptionState: 'ACTIVE', onStateChanged }));
    expect(onlineClassesApi.startTranscription).toHaveBeenCalledTimes(2);
  });

  it('never dispatches transcription from a connected or reconnecting student', async () => {
    const view = mount(false, { transcriptionAvailable: true });
    await screen.findByTestId('board-board-1');
    livekitFixture.connectionState = 'reconnecting';
    view.rerender(classroom(false, { transcriptionAvailable: true }));
    livekitFixture.connectionState = 'connected';
    view.rerender(classroom(false, { transcriptionAvailable: true }));
    expect(onlineClassesApi.startTranscription).not.toHaveBeenCalled();
  });

  it('does not start for a connected teacher when transcription is unavailable', async () => {
    mount(true, { transcriptionAvailable: false });
    await screen.findByTestId('board-board-1');
    expect(onlineClassesApi.startTranscription).not.toHaveBeenCalled();
  });

  it.each(['STARTING', 'ACTIVE'] as const)('verifies cached %s dispatch status once for each new media entry', async (state) => {
    const first = mount(true, { transcriptionAvailable: true, transcriptionState: state });
    await screen.findByTestId('board-board-1');
    await waitFor(() => expect(onlineClassesApi.startTranscription).toHaveBeenCalledOnce());
    first.rerender(classroom(true, { transcriptionAvailable: true, transcriptionState: state }));
    expect(onlineClassesApi.startTranscription).toHaveBeenCalledOnce();
    first.unmount();
    mount(true, { transcriptionAvailable: true, transcriptionState: state });
    await screen.findByTestId('board-board-1');
    await waitFor(() => expect(onlineClassesApi.startTranscription).toHaveBeenCalledTimes(2));
  });

  it('does not automatically undo a manual stop during an already active entry', async () => {
    const view = mount(true, { transcriptionAvailable: true, transcriptionState: 'ACTIVE' });
    await screen.findByTestId('board-board-1');
    await waitFor(() => expect(onlineClassesApi.startTranscription).toHaveBeenCalledOnce());
    view.rerender(classroom(true, { transcriptionAvailable: true, transcriptionState: 'INACTIVE' }));
    expect(onlineClassesApi.startTranscription).toHaveBeenCalledOnce();
  });

  it('does not verify or restart a dispatch while the teacher is stopping it', async () => {
    const view = mount(true, { transcriptionAvailable: true, transcriptionState: 'STOPPING' });
    await screen.findByTestId('board-board-1');
    view.rerender(classroom(true, { transcriptionAvailable: true, transcriptionState: 'INACTIVE' }));
    expect(onlineClassesApi.startTranscription).not.toHaveBeenCalled();
  });

  it('starts transcription when a fresh re-entry token resets stale ACTIVE feature flags', async () => {
    vi.mocked(onlineClassesApi.get).mockResolvedValue({
      id: 'c1', eventId: 'e1', status: 'LIVE', mediaState: 'IDLE', viewerIsHost: true,
      recordingState: 'ACTIVE', transcriptionState: 'ACTIVE', transcriptionAvailable: true,
    } as OnlineClass);
    vi.mocked(onlineClassesApi.connect).mockResolvedValue(connection(true));
    function Reentry() {
      const session = useClassSession('c1');
      if (!session.onlineClass) return null;
      if (!session.connection) return <button onClick={() => void session.requestConnection()}>Re-enter lesson</button>;
      return classroom(true, { connection: session.connection,
        transcriptionAvailable: true, transcriptionState: session.onlineClass?.transcriptionState ?? 'INACTIVE',
        onStateChanged: session.reload });
    }
    render(<Reentry />);
    await waitFor(() => expect(onlineClassesApi.get).toHaveBeenCalledOnce());
    await userEvent.click(screen.getByRole('button', { name: 'Re-enter lesson' }));
    await waitFor(() => expect(onlineClassesApi.startTranscription).toHaveBeenCalledExactlyOnceWith('c1'));
    expect(onlineClassesApi.connect).toHaveBeenCalledExactlyOnceWith('c1');
  });

  it('retries a transient presence conflict and uses the latest status callback', async () => {
    vi.useFakeTimers();
    vi.mocked(onlineClassesApi.startTranscription).mockRejectedValueOnce(
      new ApiRequestError(409, 'CONFLICT', 'Teacher is not yet present'));
    const oldCallback = vi.fn(), latestCallback = vi.fn();
    const view = mount(true, { transcriptionAvailable: true, onStateChanged: oldCallback });
    await act(async () => {});
    expect(onlineClassesApi.startTranscription).toHaveBeenCalledOnce();
    view.rerender(classroom(true, { transcriptionAvailable: true, transcriptionState: 'FAILED', onStateChanged: latestCallback }));
    await act(async () => { await vi.advanceTimersByTimeAsync(499); });
    expect(onlineClassesApi.startTranscription).toHaveBeenCalledOnce();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(onlineClassesApi.startTranscription).toHaveBeenCalledTimes(2);
    expect(latestCallback).toHaveBeenCalledOnce();
    expect(oldCallback).not.toHaveBeenCalled();
    expect(screen.queryByText(/Не удалось автоматически запустить транскрипцию/)).not.toBeInTheDocument();
  });

  it('keeps startup retries working across StrictMode setup and cleanup without duplicate requests', async () => {
    vi.useFakeTimers();
    vi.mocked(onlineClassesApi.startTranscription).mockRejectedValueOnce(
      new ApiRequestError(409, 'CONFLICT', 'Teacher is not yet present'));
    const onStateChanged = vi.fn();
    render(<StrictMode>{classroom(true, { transcriptionAvailable: true, onStateChanged })}</StrictMode>);
    await act(async () => {});
    expect(onlineClassesApi.startTranscription).toHaveBeenCalledOnce();
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(onlineClassesApi.startTranscription).toHaveBeenCalledTimes(2);
    expect(onStateChanged).toHaveBeenCalledOnce();
    expect(screen.queryByText(/Не удалось автоматически запустить транскрипцию/)).not.toBeInTheDocument();
  });

  it('shows the compact failure message after three attempts and stops retrying', async () => {
    vi.useFakeTimers();
    vi.mocked(onlineClassesApi.startTranscription).mockRejectedValue(
      new ApiRequestError(409, 'CONFLICT', 'Teacher is not yet present'));
    const onStateChanged = vi.fn();
    const view = mount(true, { transcriptionAvailable: true, onStateChanged });
    await act(async () => {});
    expect(onlineClassesApi.startTranscription).toHaveBeenCalledOnce();
    // Polling the failed backend state must not reset the bounded attempt loop.
    view.rerender(classroom(true, { transcriptionAvailable: true, transcriptionState: 'FAILED', onStateChanged }));
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(onlineClassesApi.startTranscription).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(onlineClassesApi.startTranscription).toHaveBeenCalledTimes(3);
    expect(screen.getByRole('alert')).toHaveTextContent('Не удалось автоматически запустить транскрипцию');
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(onlineClassesApi.startTranscription).toHaveBeenCalledTimes(3);
    expect(onStateChanged).not.toHaveBeenCalled();
    view.rerender(classroom(true, { transcriptionAvailable: true, transcriptionState: 'ACTIVE', onStateChanged }));
    expect(screen.queryByText(/Не удалось автоматически запустить транскрипцию/)).not.toBeInTheDocument();
    view.rerender(classroom(true, { transcriptionAvailable: true, transcriptionState: 'INACTIVE', onStateChanged }));
    expect(onlineClassesApi.startTranscription).toHaveBeenCalledTimes(3);
  });

  it('cancels pending retries on disconnect and permits a new attempt on the next entry', async () => {
    vi.useFakeTimers();
    vi.mocked(onlineClassesApi.startTranscription).mockRejectedValueOnce(
      new ApiRequestError(409, 'CONFLICT', 'Teacher is not yet present'));
    const onStateChanged = vi.fn();
    const view = mount(true, { transcriptionAvailable: true, onStateChanged });
    await act(async () => {});
    livekitFixture.connectionState = 'disconnected';
    view.rerender(classroom(true, { transcriptionAvailable: true, onStateChanged }));
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(onlineClassesApi.startTranscription).toHaveBeenCalledOnce();
    livekitFixture.connectionState = 'connected';
    view.rerender(classroom(true, { transcriptionAvailable: true, onStateChanged }));
    await act(async () => {});
    expect(onlineClassesApi.startTranscription).toHaveBeenCalledTimes(2);
    expect(onStateChanged).toHaveBeenCalledOnce();
  });

  it('cancels pending retries when the classroom is unmounted', async () => {
    vi.useFakeTimers();
    vi.mocked(onlineClassesApi.startTranscription).mockRejectedValue(
      new ApiRequestError(409, 'CONFLICT', 'Teacher is not yet present'));
    const view = mount(true, { transcriptionAvailable: true });
    await act(async () => {});
    view.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(onlineClassesApi.startTranscription).toHaveBeenCalledOnce();
  });
});

describe('OnlineClassRoom', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    boardProps.length = 0;
    recordingProps.length = 0;
    screenShares = [];
    notebookFixture.camerasByOwner.clear();
    notebookFixture.viewerProps.clear();
    notebookFixture.panelProps.length = 0;
    vi.mocked(onlineClassesApi.listParticipants).mockResolvedValue([
      { userId: 'u1', displayName: 'Alice', classRole: 'STUDENT', admissionState: 'ADMITTED' } as never,
    ]);
    vi.mocked(lessonPreparationApi.answersMetadata).mockResolvedValue({ hasAnswers: true, answersFilename: 'a.pdf' } as never);
  });

  it('puts named board buttons before Video and switches listening with names, Open and All pupils', async () => {
    vi.mocked(onlineClassesApi.listParticipants).mockResolvedValue([
      { userId: 'u1', displayName: 'Alice', classRole: 'STUDENT', admissionState: 'ADMITTED' } as never,
      { userId: 'u2', displayName: 'Boris', classRole: 'STUDENT', admissionState: 'ADMITTED' } as never,
    ]);
    mount(true);
    await screen.findByRole('button', { name: 'Доска ученика: Boris' });
    const switcher = screen.getByRole('group', { name: 'Доска' });
    expect(within(switcher).getAllByRole('button').map(button => button.textContent)).toEqual(['Общая группа', 'Alice', 'Boris', 'Все', 'Kolyn']);
    const controls = switcher.parentElement!;
    expect(controls.firstElementChild).toBe(switcher);
    expect(within(controls).getByRole('button', { name: /Видео/ })).toBe(controls.lastElementChild);
    await userEvent.click(within(switcher).getByRole('button', { name: 'Доска ученика: Boris' }));
    expect(audioFixture.change).toHaveBeenLastCalledWith('u2');
    await userEvent.click(within(switcher).getByRole('button', { name: 'Общая группа' }));
    expect(audioFixture.change).toHaveBeenLastCalledWith(null);
    await userEvent.click(screen.getByRole('button', { name: 'Все ученики (2×2)' }));
    audioFixture.change.mockClear();
    await userEvent.click(within(screen.getByRole('region', { name: 'Работа ученика: Alice' })).getByRole('button', { name: 'Открыть' }));
    expect(audioFixture.change).toHaveBeenLastCalledWith('u1');
    await userEvent.click(screen.getByRole('button', { name: 'Все ученики' }));
    expect(audioFixture.change).toHaveBeenLastCalledWith(null);
  });

  it('announces to all without navigating away, then returns to the selected pupil', async () => {
    audioFixture.focus = { version: 1, classId: 'c1', teacherId: 'me', studentId: 'u1', announceAll: false };
    const view = mount(true);
    const announce = await screen.findByRole('button', { name: 'Сказать всем' });
    await userEvent.click(announce);
    expect(audioFixture.change).toHaveBeenLastCalledWith('u1', true);
    audioFixture.focus = { ...audioFixture.focus, announceAll: true };
    view.rerender(classroom(true));
    await userEvent.click(screen.getByRole('button', { name: 'Вернуться к ученику' }));
    expect(audioFixture.change).toHaveBeenLastCalledWith('u1', false);
    expect(screen.getByTestId('board-personal-u1')).toHaveAttribute('data-active', 'true');
  });

  it('shows a failed audio switch and exposes recovery without ending the call', async () => {
    audioFixture.error = true;
    mount(true);
    expect(await screen.findByText('Не удалось переключить звук.')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Включить общий звук' }));
    expect(audioFixture.change).toHaveBeenLastCalledWith(null);
  });

  it('handles an unexpected LiveKit disconnect without clicking Leave', async () => {
    const onLeave = vi.fn();
    const onEndForAll = vi.fn();
    const onConnectionLost = vi.fn();
    mount(true, { onLeave, onEndForAll, onConnectionLost });
    await screen.findByTestId('board-board-1');
    await userEvent.click(screen.getByRole('button', { name: 'Simulate LiveKit disconnect' }));
    expect(onConnectionLost).toHaveBeenCalledWith('1', false);
    expect(onLeave).not.toHaveBeenCalled();
    expect(onEndForAll).not.toHaveBeenCalled();
  });

  it('keeps Leave separate from the explicitly confirmed End for everyone action', async () => {
    localStorage.setItem('language', 'RU');
    const onLeave = vi.fn(), onEndForAll = vi.fn();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    try {
      mount(true, { eventId: undefined, onLeave, onEndForAll });
      const end = await screen.findByRole('button', { name: 'Завершить урок для всех' });
      await userEvent.click(end);
      expect(onEndForAll).not.toHaveBeenCalled();
      await userEvent.click(screen.getByRole('button', { name: 'Выйти' }));
      expect(onLeave).toHaveBeenCalledOnce();
      expect(onEndForAll).not.toHaveBeenCalled();
      await userEvent.click(end);
      expect(onEndForAll).toHaveBeenCalledOnce();
      expect(onLeave).toHaveBeenCalledOnce();
      expect(confirm).toHaveBeenCalledTimes(2);
    } finally {
      confirm.mockRestore();
    }
  });

  it('distinguishes initial LiveKit handshake failure from a drop after connection', async () => {
    const onConnectionLost = vi.fn();
    const onMediaError = vi.fn();
    const room = mount(true, { onConnectionLost, onMediaError });
    await screen.findByTestId('board-board-1');
    await userEvent.click(screen.getByRole('button', { name: 'Simulate signaling error' }));
    expect(onMediaError).toHaveBeenCalledWith('signaling');
    await userEvent.click(screen.getByRole('button', { name: 'Simulate unknown disconnect' }));
    expect(onConnectionLost).toHaveBeenLastCalledWith('0', false);
    room.unmount();

    const onConnectedThenLost = vi.fn();
    mount(true, { onConnectionLost: onConnectedThenLost });
    await screen.findByTestId('board-board-1');
    await userEvent.click(screen.getByRole('button', { name: 'Simulate media connected' }));
    await userEvent.click(screen.getByRole('button', { name: 'Simulate unknown disconnect' }));
    expect(onConnectedThenLost).toHaveBeenLastCalledWith('0', true);
  });

  it('shows a student no answers button and never asks for the answers', async () => {
    mount(false);
    await screen.findByTestId('board-board-1');
    expect(screen.queryByRole('button', { name: /Ответы/ })).not.toBeInTheDocument();
    expect(lessonPreparationApi.answersMetadata).not.toHaveBeenCalled();
    expect(lessonPreparationApi.answersBytes).not.toHaveBeenCalled();
    expect(lessonPreparationApi.uploadAnswers).not.toHaveBeenCalled();
    expect(lessonPreparationApi.personalAnswersMetadata).not.toHaveBeenCalled();
    expect(lessonPreparationApi.personalAnswersBytes).not.toHaveBeenCalled();
    expect(screen.queryByTestId('answers-panel-resizer')).not.toBeInTheDocument();
  });

  it('keeps the answers panel open and selects the pupil’s private solutions on both personal surfaces', async () => {
    const previous = globalThis.ResizeObserver;
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
    try {
    vi.mocked(lessonPreparationApi.personalWorkbooks).mockResolvedValue({ enabled: true, students: [
      { studentId: 'u1', studentName: 'Alice', hasWorkbook: true, filename: 'alice.pdf', version: 1 },
      { studentId: 'u2', studentName: 'Bob', hasWorkbook: true, filename: 'bob.pdf', version: 1 },
    ] });
    vi.mocked(onlineClassesApi.listParticipants).mockResolvedValue([
      { userId: 'u1', displayName: 'Alice', classRole: 'STUDENT', admissionState: 'ADMITTED' } as never,
      { userId: 'u2', displayName: 'Bob', classRole: 'STUDENT', admissionState: 'ADMITTED' } as never,
    ]);
    mount(true);
    const board = await screen.findByTestId('board-board-1');
    const button = await within(board).findByRole('button', { name: 'Ответы' });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);
    expect(screen.getByText('Решения для учителя')).toBeInTheDocument();
    await screen.findByRole('button', { name: 'Доска ученика: Alice' });
    await userEvent.click(screen.getByRole('button', { name: 'Доска ученика: Alice' }));
    await waitFor(() => expect(lessonPreparationApi.personalAnswersMetadata).toHaveBeenCalledWith('e1', 'u1'));
    expect(await screen.findByText('Решения: Alice')).toBeInTheDocument();
    expect(screen.getByTestId('answers-panel-resizer')).toBeInTheDocument();
    expect(screen.getByText('Решения: Alice')).toBeInTheDocument();
    expect(lessonPreparationApi.personalAnswersMetadata).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Доска ученика: Bob' }));
    expect(await screen.findByText('Решения: Bob')).toBeInTheDocument();
    expect(screen.getByText(/Для этого ученика решения ещё не загружены/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Все ученики (2×2)' }));
    expect(await screen.findByText('Решения для учителя')).toBeInTheDocument();
    expect(lessonPreparationApi.answersMetadata).toHaveBeenCalledWith('e1');
    } finally {
      if (previous) vi.stubGlobal('ResizeObserver', previous); else vi.unstubAllGlobals();
    }
  });

  it('retains common answers on personal boards for teachers outside the pilot', async () => {
    const previous = globalThis.ResizeObserver;
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
    try {
    mount(true);
    await screen.findByRole('button', { name: 'Доска ученика: Alice' });
    await userEvent.click(screen.getByRole('button', { name: 'Доска ученика: Alice' }));
    const board = await screen.findByTestId('board-personal-u1');
    const button = await within(board).findByRole('button', { name: 'Ответы' });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);
    expect(screen.getByText('Решения для учителя')).toBeInTheDocument();
    expect(lessonPreparationApi.personalAnswersMetadata).not.toHaveBeenCalled();
    expect(screen.getByTestId('answers-panel-resizer')).toHaveAttribute('data-owner', 'me');
    } finally {
      if (previous) vi.stubGlobal('ResizeObserver', previous); else vi.unstubAllGlobals();
    }
  });

  it('keeps one teacher answers entry on the board and a lesson title without a logo', async () => {
    const view = mount(true, { lessonTitle: 'Группа 1' });
    const board = await screen.findByTestId('board-board-1');
    expect(await within(board).findByRole('button', { name: 'Ответы' })).toBeEnabled();
    expect(screen.getAllByRole('button', { name: 'Ответы' })).toHaveLength(1);
    const topbar = view.container.querySelector('.online-class-room__topbar') as HTMLElement;
    expect(within(topbar).queryByRole('button', { name: /Ответы|Решения/ })).not.toBeInTheDocument();
    expect(within(topbar).getByText('Группа 1')).toBeInTheDocument();
    expect(within(topbar).queryByRole('img')).not.toBeInTheDocument();
  });

  it('opens board toolbar answers in the same separate teacher sidebar', async () => {
    const previous = globalThis.ResizeObserver;
    class FakeResizeObserver {
      observe() {}
      disconnect() {}
      unobserve() {}
    }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    try {
      mount(true);
      const board = await screen.findByTestId('board-board-1');
      const button = await within(board).findByRole('button', { name: 'Ответы' });
      await userEvent.click(button);
      const sidebar = screen.getByRole('complementary', { name: 'Панель ответов' });
      expect(sidebar.parentElement).toHaveClass('online-class-room__stage');
      expect(sidebar.nextElementSibling).toBe(screen.getByTestId('answers-panel-resizer'));
      expect(sidebar.nextElementSibling?.nextElementSibling).toHaveClass('online-class-room__main');
      expect(boardProps.at(-1)?.overlay).toBeUndefined();
    } finally {
      if (previous) vi.stubGlobal('ResizeObserver', previous);
      else vi.unstubAllGlobals();
    }
  });

  it.each(['loading', 'failed'])('keeps the trial lesson resize handle while worksheet metadata is %s', async state => {
    const previous = globalThis.ResizeObserver;
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
    try {
      vi.mocked(onlineClassesApi.listParticipants).mockResolvedValue([]);
      vi.mocked(lessonPreparationApi.personalWorkbooks).mockImplementation(() => state === 'loading'
        ? new Promise(() => {}) : Promise.reject(new Error('worksheet metadata unavailable')));
      mount(true, { lessonTitle: 'Пробный урок · Тестовый урок' });
      const board = await screen.findByTestId('board-board-1');
      await userEvent.click(await within(board).findByRole('button', { name: 'Ответы' }));
      const sidebar = screen.getByRole('complementary', { name: 'Панель ответов' });
      const handle = screen.getByTestId('answers-panel-resizer');
      expect(handle).toHaveAttribute('data-owner', 'me');
      expect(handle.parentElement).toBe(sidebar.parentElement);
      expect(lessonPreparationApi.personalAnswersMetadata).not.toHaveBeenCalled();
      await userEvent.click(within(sidebar).getByRole('button', { name: 'Закрыть ответы' }));
      expect(screen.queryByTestId('answers-panel-resizer')).not.toBeInTheDocument();
    } finally {
      if (previous) vi.stubGlobal('ResizeObserver', previous); else vi.unstubAllGlobals();
    }
  });

  it('gives the teacher the answers button on the board they are looking at', async () => {
    mount(true);
    const board = await screen.findByTestId('board-board-1');
    expect(await within(board).findByRole('button', { name: 'Ответы' })).toBeEnabled();
  });

  it('uploads the first teacher answers PDF through the only board answers action', async () => {
    const previous = globalThis.ResizeObserver;
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
    try {
      vi.mocked(lessonPreparationApi.answersMetadata).mockResolvedValue({ hasAnswers: false } as never);
      vi.mocked(lessonPreparationApi.uploadAnswers).mockResolvedValue({ hasAnswers: true, answersFilename: 'solutions.pdf' } as never);
      vi.mocked(lessonPreparationApi.answersBytes).mockResolvedValue(new ArrayBuffer(16));
      mount(true);
      const board = await screen.findByTestId('board-board-1');
      const action = await within(board).findByRole('button', { name: 'Ответы' });
      await waitFor(() => expect(action).toBeEnabled());
      await userEvent.click(action);
      const sidebar = screen.getByRole('complementary', { name: 'Панель ответов' });
      expect(sidebar.parentElement).toHaveClass('online-class-room__stage');
      expect(within(sidebar).getByText('Добавьте PDF с решениями')).toBeInTheDocument();
      const file = new File(['%PDF-1.4 solutions'], 'solutions.pdf', { type: 'application/pdf' });
      await userEvent.upload(within(sidebar).getByLabelText('PDF решений'), file);
      await waitFor(() => expect(lessonPreparationApi.uploadAnswers).toHaveBeenCalledWith('e1', file));
      await waitFor(() => expect(lessonPreparationApi.answersBytes).toHaveBeenCalledWith('e1'));
      await waitFor(() => expect(action).toHaveAttribute('title', 'Ответы'));
      expect(screen.getAllByRole('button', { name: 'Ответы' })).toHaveLength(1);
    } finally {
      if (previous) vi.stubGlobal('ResizeObserver', previous);
      else vi.unstubAllGlobals();
    }
  });

  it('keeps homework out of the pupil classroom while notebook pairing remains available', async () => {
    mount(false);
    await screen.findByTestId('board-board-1');
    expect(screen.queryByRole('button', { name: 'Домашнее задание' })).not.toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'Домашнее задание' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Настройки тетради' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Подключить тетрадь' })).not.toBeInTheDocument();
  });

  it('keeps the same notebook settings and personal board for a pupil of a non-pilot teacher', async () => {
    mount(false, { currentUserId: 'regular-pupil', connection: { ...connection(false), identity: 'regular-pupil|tablet' } });
    await screen.findByTestId('board-board-1');
    await userEvent.click(screen.getByRole('button', { name: 'Настройки тетради' }));
    const notebook = screen.getByRole('region', { name: 'Встроенная тетрадь' });
    expect(notebook).toHaveAttribute('data-event', 'e1');
    expect(notebook).toHaveAttribute('data-class', 'c1');
    expect(notebook).toHaveAttribute('data-owner', 'regular-pupil');
    expect(notebook).toHaveAttribute('data-teacher', 'false');
    expect(notebook).toHaveAttribute('data-presentation', 'lesson');
    await userEvent.click(screen.getByRole('button', { name: 'Моя доска' }));
    expect(await screen.findByTestId('board-personal-regular-pupil')).toBeInTheDocument();
  });

  it('shows the camera column next to the board', async () => {
    mount(false);
    await userEvent.click(screen.getByRole('button', { name: '‹ Видео' }));
    expect(await screen.findByRole('list', { name: 'cameras' })).toBeInTheDocument();
  });

  it('keeps one class-bound pupil session mounted and opens its settings from the footer without hiding the board', async () => {
    const view = mount(false);
    const board = await screen.findByTestId('board-board-1');
    const toggle = screen.getByRole('button', { name: 'Настройки тетради' });
    expect(view.container.querySelector('.online-class-room__controls')).toContainElement(toggle);
    expect(view.container.querySelector('.online-class-room__topbar')).not.toContainElement(toggle);
    const processor = screen.getByTitle('Notebook processor');
    const qr = screen.getByTestId('notebook-qr-fixture');
    const session = screen.getByTestId('notebook-session');
    expect(session).not.toBeVisible();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(toggle);
    const notebook = screen.getByRole('region', { name: 'Встроенная тетрадь' });
    expect(notebook).toHaveAttribute('data-event', 'e1');
    expect(notebook).toHaveAttribute('data-class', 'c1');
    expect(notebook).toHaveAttribute('data-owner', 'me');
    expect(notebook).toHaveAttribute('data-auto-pair', 'true');
    expect(notebook).toHaveAttribute('data-teacher', 'false');
    expect(notebook).toHaveAttribute('data-presentation', 'lesson');
    expect(notebook).toHaveAttribute('data-settings-open', 'true');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(board).toHaveAttribute('data-active', 'true');
    expect(screen.getByRole('list', { name: 'cameras', hidden: true })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Закрыть настройки' }));
    expect(board).toHaveAttribute('data-active', 'true');
    expect(processor).toBeInTheDocument();
    expect(processor).not.toBeVisible();
    expect(toggle).toHaveFocus();
    await userEvent.click(toggle);
    expect(screen.getByTitle('Notebook processor')).toBe(processor);
    expect(screen.getByTestId('notebook-qr-fixture')).toBe(qr);
    expect(screen.getByTestId('notebook-session')).toBe(session);
    expect(screen.getByTestId('board-board-1')).toBe(board);
    expect(processor).toBeVisible();
  });

  it('uses the existing pupil board picker instead of a separate teacher notebook workspace', async () => {
    mount(true);
    await screen.findByRole('button', { name: 'Доска ученика: Alice' });
    expect(screen.queryByRole('button', { name: 'Тетради учеников' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Настройки тетради' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('notebook-session')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Доска ученика: Alice' }));
    expect(screen.getByTestId('board-personal-u1')).toHaveAttribute('data-active', 'true');
    expect(boardProps.filter(p => p.targetId === 'personal-u1').at(-1)).toMatchObject({ compactPreview: false });
    expect(screen.queryByRole('region', { name: 'Встроенная тетрадь' })).not.toBeInTheDocument();
  });

  it('forwards independent pupil follow choices to the right paper panels and retains them when opening a tile', async () => {
    const user = userEvent.setup();
    vi.mocked(onlineClassesApi.listParticipants).mockResolvedValue([
      { userId: 'u1', displayName: 'Alice', classRole: 'STUDENT', admissionState: 'ADMITTED' } as never,
      { userId: 'u2', displayName: 'Boris', classRole: 'STUDENT', admissionState: 'ADMITTED' } as never,
    ]);
    mount(true);
    await screen.findByRole('button', { name: 'Доска ученика: Boris' });
    await user.click(screen.getByRole('button', { name: 'Все ученики (2×2)' }));
    const alice = await screen.findByTestId('board-personal-u1');
    const boris = await screen.findByTestId('board-personal-u2');
    const latest = (targetId: string) => boardProps.filter(props => props.targetId === targetId && !props.targetType).at(-1);
    expect(latest('personal-u1')).toMatchObject({ followStudent: false, compactPreview: true, isHost: true });
    expect(latest('personal-u2')).toMatchObject({ followStudent: false, compactPreview: true });

    await user.click(screen.getByRole('button', { name: 'Следовать за учеником: Alice' }));
    expect(latest('personal-u1')).toMatchObject({ followStudent: true });
    expect(latest('personal-u2')).toMatchObject({ followStudent: false });
    expect(latest('board-1')?.followStudent).toBeUndefined();
    await user.click(within(screen.getByRole('region', { name: 'Работа ученика: Alice' })).getByRole('button', { name: 'Открыть' }));
    expect(latest('personal-u1')).toMatchObject({ followStudent: true, compactPreview: false, active: true });
    expect(screen.getByTestId('board-personal-u1')).toBe(alice);
    expect(screen.getByRole('button', { name: 'Следовать за учеником: Alice' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Все ученики' }));
    expect(latest('personal-u1')).toMatchObject({ followStudent: true, compactPreview: true });
    expect(screen.getByTestId('board-personal-u2')).toBe(boris);

    await user.click(screen.getByRole('button', { name: 'Следовать за учеником: Boris' }));
    await user.click(screen.getByRole('button', { name: 'Следовать за учеником: Alice' }));
    expect(latest('personal-u1')).toMatchObject({ followStudent: false });
    expect(latest('personal-u2')).toMatchObject({ followStudent: true });
  });

  it('keeps follow scoped to each pupil when their camera replaces paper and when returning to the overview', async () => {
    const user = userEvent.setup();
    vi.mocked(onlineClassesApi.listParticipants).mockResolvedValue([
      { userId: 'u1', displayName: 'Alice', classRole: 'STUDENT', admissionState: 'ADMITTED' } as never,
      { userId: 'u2', displayName: 'Boris', classRole: 'STUDENT', admissionState: 'ADMITTED' } as never,
    ]);
    for (const id of ['u1', 'u2']) notebookFixture.camerasByOwner.set(id, { cameraId: `camera-${id}`, ownerId: id, status: 'CONNECTED' });
    mount(true);
    await screen.findByRole('button', { name: 'Доска ученика: Boris' });
    await user.click(screen.getByRole('button', { name: 'Все ученики (2×2)' }));
    const paper = await screen.findByTestId('board-personal-u1');
    await user.click(screen.getByRole('button', { name: 'Следовать за учеником: Alice' }));
    const aliceSource = pupilCameraSource(), borisSource = pupilCameraSource();
    act(() => {
      notebookFixture.viewerProps.get('camera-u1').onVideoAvailableChange(true);
      notebookFixture.viewerProps.get('camera-u1').onBoardVideoChange(aliceSource);
      notebookFixture.viewerProps.get('camera-u2').onVideoAvailableChange(true);
      notebookFixture.viewerProps.get('camera-u2').onBoardVideoChange(borisSource);
    });
    const camera = await screen.findByTestId('board-personal-u1-camera');
    const latest = (targetId: string) => boardProps.filter(props => props.targetId === targetId && props.targetType === 'NOTEBOOK_CAMERA').at(-1);
    expect(latest('personal-u1')).toMatchObject({ followStudent: true, compactPreview: true, active: true, targetType: 'NOTEBOOK_CAMERA' });
    expect(latest('personal-u1')!.liveBackground.source).toBe(aliceSource.rawVideo);
    expect(latest('personal-u2')).toMatchObject({ followStudent: false, active: true });
    expect(latest('personal-u2')!.liveBackground.source).toBe(borisSource.rawVideo);
    await user.click(within(screen.getByRole('region', { name: 'Работа ученика: Alice' })).getByRole('button', { name: 'Открыть' }));
    expect(latest('personal-u1')).toMatchObject({ followStudent: true, compactPreview: false });
    expect(screen.getByTestId('board-personal-u1-camera')).toBe(camera);
    await user.click(screen.getByRole('button', { name: 'Следовать за учеником: Alice' }));
    expect(latest('personal-u1')).toMatchObject({ followStudent: false });
    act(() => {
      notebookFixture.viewerProps.get('camera-u1').onVideoAvailableChange(false);
      notebookFixture.viewerProps.get('camera-u1').onBoardVideoChange(null);
    });
    expect(screen.getByTestId('board-personal-u1')).toBe(paper);
    expect(paper).toHaveAttribute('data-active', 'true');
    expect(boardProps.filter(props => props.targetId === 'personal-u1' && !props.targetType).at(-1)).toMatchObject({ followStudent: false });
    await user.click(screen.getByRole('button', { name: 'Все ученики' }));
    expect(screen.getByRole('button', { name: 'Следовать за учеником: Alice' })).toHaveAttribute('aria-pressed', 'false');
    expect(latest('personal-u2')!.liveBackground.source).toBe(borisSource.rawVideo);
  });

  it('never applies the teacher follow control to a pupil’s own paper or camera board', async () => {
    const user = userEvent.setup();
    mount(false);
    await screen.findByTestId('board-board-1');
    await user.click(screen.getByRole('button', { name: 'Моя доска' }));
    await screen.findByTestId('board-personal-me');
    expect(screen.queryByRole('button', { name: /^Следовать за учеником:/ })).not.toBeInTheDocument();
    const source = pupilCameraSource();
    emitPupilCamera('camera-me', source);
    await screen.findByTestId('board-personal-me-camera');
    for (const props of boardProps.filter(item => item.targetId === 'personal-me')) {
      expect(props.isHost).toBe(false);
      expect(props.followStudent).toBeUndefined();
    }
    expect(screen.queryByRole('button', { name: /^Следовать за учеником:/ })).not.toBeInTheDocument();
  });

  it('starts a new lesson with pupil follow disabled even when the same pupil remains selected', async () => {
    const user = userEvent.setup();
    const view = mount(true);
    await screen.findByRole('button', { name: 'Доска ученика: Alice' });
    await user.click(screen.getByRole('button', { name: 'Доска ученика: Alice' }));
    await user.click(screen.getByRole('button', { name: 'Следовать за учеником: Alice' }));
    expect(boardProps.filter(props => props.targetId === 'personal-u1').at(-1)).toMatchObject({ classId: 'c1', followStudent: true });
    view.rerender(classroom(true, { classId: 'c2', eventId: 'e2' }));
    await waitFor(() => expect(boardProps.filter(props => props.targetId === 'personal-u1').at(-1)).toMatchObject({ classId: 'c2', followStudent: false }));
    expect(screen.getByRole('button', { name: 'Следовать за учеником: Alice' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('uses the ordinary drawing panel with a private camera target and live video, without the pupil PDF', async () => {
    notebookFixture.camerasByOwner.set('u1', { cameraId: 'camera-u1', ownerId: 'u1', status: 'CONNECTED' });
    mount(true);
    await screen.findByRole('button', { name: 'Доска ученика: Alice' });
    await userEvent.click(screen.getByRole('button', { name: 'Доска ученика: Alice' }));
    const paper = await screen.findByTestId('board-personal-u1');
    const video = document.createElement('video');
    const view = { type: 'document-view', version: 1, corners: null, ratio: null, turn: 2, sourceAspect: 16 / 9 };
    const renderer = {};
    act(() => {
      notebookFixture.viewerProps.get('camera-u1').onVideoAvailableChange(true);
      notebookFixture.viewerProps.get('camera-u1').onBoardVideoChange({ video: document.createElement('canvas'), width: 1080, height: 1920,
        rawVideo: video, rawWidth: 1920, rawHeight: 1080, view, renderer });
    });
    const camera = await screen.findByTestId('board-personal-u1-camera');
    const props = boardProps.filter(p => p.targetType === 'NOTEBOOK_CAMERA').at(-1)!;
    expect(props).toMatchObject({ targetId: 'personal-u1', isHost: true, canAnnotate: true, active: true,
      liveBackground: { source: video, width: 1920, height: 1080, notebookView: { view, rawWidth: 1920, rawHeight: 1080, renderer } } });
    expect(props.document).toBeUndefined();
    expect(props.observedPage).toBeUndefined();
    expect(props.onSaveLessonDocuments).toBeUndefined();
    expect(notebookFixture.viewerProps.get('camera-u1').presentation).toBe('board');
    expect(paper).toHaveAttribute('data-active', 'false');
    expect(await within(camera).findByRole('button', { name: 'Ответы' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Все ученики (2×2)' }));
    expect(screen.getByTestId('board-personal-u1-camera')).toBe(camera);
    expect(boardProps.filter(p => p.targetType === 'NOTEBOOK_CAMERA').at(-1)).toMatchObject({ canAnnotate: false, active: true, compactPreview: true });
  });

  it('automatically opens the pupil’s private ordinary drawing surface on its first live camera frame', async () => {
    mount(false);
    const shared = await screen.findByTestId('board-board-1');
    const session = screen.getByTestId('notebook-session');
    expect(session).not.toBeVisible();
    expect(notebookFixture.panelProps.at(-1)).toMatchObject({ presentation: 'lesson', settingsOpen: false,
      currentUserId: 'me', isTeacher: false, autoPair: true });
    const source = pupilCameraSource(); emitPupilCamera('camera-me', source);
    const camera = await screen.findByTestId('board-personal-me-camera');
    expect(camera).toBeVisible(); expect(camera).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('board-board-1')).toBe(shared); expect(shared).toHaveAttribute('data-active', 'false');
    expect(screen.getByTestId('board-personal-me')).toHaveAttribute('data-active', 'false');
    expect(screen.getByRole('button', { name: 'Моя доска' })).toHaveAttribute('aria-pressed', 'true');
    const props = boardProps.filter(item => item.targetType === 'NOTEBOOK_CAMERA').at(-1)!;
    expect(props).toMatchObject({ targetId: 'personal-me', actorId: 'me', isHost: false, canAnnotate: true, active: true,
      liveBackground: { source: source.rawVideo, width: 1920, height: 1080,
        notebookView: { view: source.view, rawWidth: 1920, rawHeight: 1080, renderer: source.renderer } } });
    expect(props.document).toBeUndefined(); expect(props.observedPage).toBeUndefined();
    expect(props.onSaveLessonDocuments).toBeUndefined(); expect(props.hostActions).toBeUndefined();
    expect(screen.queryByRole('button', { name: /Ответы|Сохранить документы урока/ })).not.toBeInTheDocument();
    expect(notebookFixture.viewerProps.size).toBe(0);
    expect(screen.getByTestId('notebook-session')).toBe(session);
  });

  it('auto-selects once per camera and never steals a manual shared-board selection on geometry updates or restart', async () => {
    mount(false);
    await screen.findByTestId('board-board-1');
    const first = pupilCameraSource(); emitPupilCamera('camera-first', first);
    const camera = await screen.findByTestId('board-personal-me-camera');
    await userEvent.click(screen.getByRole('button', { name: 'Общая доска' }));
    const shared = screen.getByTestId('board-board-1');
    expect(shared).toHaveAttribute('data-active', 'true'); expect(camera).not.toBeVisible();
    emitPupilCamera('camera-first', { ...first, view: { ...first.view, turn: 3 } });
    expect(shared).toHaveAttribute('data-active', 'true');
    emitPupilCamera('camera-first', null); emitPupilCamera('camera-first', first);
    expect(shared).toHaveAttribute('data-active', 'true'); expect(camera).not.toBeVisible();
    const replacement = pupilCameraSource(); emitPupilCamera('camera-replacement', replacement);
    expect(shared).toHaveAttribute('data-active', 'false');
    expect(screen.getByTestId('board-personal-me-camera')).toBe(camera);
    expect(camera).toHaveAttribute('data-active', 'true'); expect(camera).toBeVisible();
    emitPupilCamera('camera-first', null);
    expect(camera).toHaveAttribute('data-active', 'true');
    expect(boardProps.filter(item => item.targetType === 'NOTEBOOK_CAMERA').at(-1)!.liveBackground.source).toBe(replacement.rawVideo);
  });

  it('falls back to the personal whiteboard on Stop and resumes the same camera board, QR and settings session', async () => {
    mount(false);
    await screen.findByTestId('board-board-1');
    const session = screen.getByTestId('notebook-session'), processor = screen.getByTitle('Notebook processor');
    const qr = screen.getByTestId('notebook-qr-fixture'), toggle = screen.getByRole('button', { name: 'Настройки тетради' });
    const source = pupilCameraSource(); emitPupilCamera('camera-me', source);
    const camera = await screen.findByTestId('board-personal-me-camera'), paper = screen.getByTestId('board-personal-me');
    await userEvent.click(toggle);
    expect(camera).toBeVisible(); expect(camera).toHaveAttribute('data-active', 'true');
    emitPupilCamera('camera-me', null);
    expect(paper).toBeVisible(); expect(paper).toHaveAttribute('data-active', 'true');
    expect(camera).not.toBeVisible(); expect(camera).toHaveAttribute('data-active', 'false');
    expect(boardProps.filter(item => item.targetType === 'NOTEBOOK_CAMERA').at(-1)!.liveBackground).toBeNull();
    emitPupilCamera('camera-me', source);
    expect(screen.getByTestId('board-personal-me-camera')).toBe(camera); expect(camera).toBeVisible();
    expect(screen.getByTestId('board-personal-me')).toBe(paper); expect(paper).not.toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Закрыть настройки' }));
    expect(camera).toBeVisible(); expect(camera).toHaveAttribute('data-active', 'true');
    expect(processor).not.toBeVisible(); expect(toggle).toHaveFocus();
    await userEvent.click(toggle);
    expect(screen.getByTestId('notebook-session')).toBe(session);
    expect(screen.getByTitle('Notebook processor')).toBe(processor);
    expect(screen.getByTestId('notebook-qr-fixture')).toBe(qr);
    expect(camera).toHaveAttribute('data-active', 'true');
  });

  it('keeps old lesson or owner sources outside the new camera board scope', async () => {
    const view = mount(false);
    await screen.findByTestId('board-board-1');
    const previousSource = pupilCameraSource(); emitPupilCamera('old-camera', previousSource);
    await screen.findByTestId('board-personal-me-camera');
    const oldCallback = notebookFixture.panelProps.at(-1)!.onBoardVideoChange;
    view.rerender(classroom(false, { classId: 'c2', eventId: 'e2', currentUserId: 'next-pupil' }));
    expect(screen.queryByTestId('board-personal-me-camera')).not.toBeInTheDocument();
    act(() => oldCallback('old-camera', previousSource));
    expect(screen.queryByTestId('board-personal-next-pupil-camera')).not.toBeInTheDocument();
    const currentSource = pupilCameraSource(); emitPupilCamera('new-camera', currentSource);
    const camera = await screen.findByTestId('board-personal-next-pupil-camera');
    expect(camera).toBeVisible(); expect(camera).toHaveAttribute('data-active', 'true');
    act(() => oldCallback('old-camera', null));
    expect(camera).toHaveAttribute('data-active', 'true');
    act(() => oldCallback('old-camera', previousSource));
    expect(camera).toBeVisible(); expect(camera).toHaveAttribute('data-active', 'true');
    expect(boardProps.filter(item => item.targetType === 'NOTEBOOK_CAMERA').at(-1)).toMatchObject({ classId: 'c2', actorId: 'next-pupil', targetId: 'personal-next-pupil' });
    expect(boardProps.filter(item => item.targetType === 'NOTEBOOK_CAMERA').at(-1)!.liveBackground.source).toBe(currentSource.rawVideo);
  });

  it('keeps the selected personal board active while settings are open and restores focus on Escape', async () => {
    mount(false);
    await screen.findByTestId('board-board-1');
    const toggle = screen.getByRole('button', { name: 'Настройки тетради' });
    await userEvent.click(toggle);
    const processor = screen.getByTitle('Notebook processor');
    await userEvent.click(screen.getByRole('button', { name: 'Моя доска' }));
    expect(screen.getByTestId('board-personal-me')).toHaveAttribute('data-active', 'true');
    expect(processor).toBeVisible();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(processor).not.toBeVisible(); expect(toggle).toHaveFocus();
    expect(screen.getByTestId('board-personal-me')).toHaveAttribute('data-active', 'true');
    await userEvent.click(toggle);
    expect(screen.getByTitle('Notebook processor')).toBe(processor);
  });

  it('keeps the same settings session when a screen share starts or ends', async () => {
    const view = mount(false);
    await screen.findByTestId('board-board-1');
    await userEvent.click(screen.getByRole('button', { name: 'Настройки тетради' }));
    const processor = screen.getByTitle('Notebook processor');
    screenShares = [{ participant: { identity: 'teacher' }, source: 'screen_share', publication: {} }];
    view.rerender(classroom(false));
    expect(processor).toBeVisible();
    expect(screen.getByTestId('screen')).toBeVisible();
    screenShares = [];
    view.rerender(classroom(false));
    expect(processor).toBeVisible();
    expect(screen.getByTitle('Notebook processor')).toBe(processor);
    expect(screen.queryByTestId('screen')).not.toBeInTheDocument();
  });

  it('does not offer notebook pairing for a room without a calendar lesson', async () => {
    mount(false, { eventId: undefined });
    await screen.findByTestId('board-board-1');
    expect(screen.queryByRole('button', { name: 'Настройки тетради' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('notebook-session')).not.toBeInTheDocument();
  });

  it('opens a student’s own personal board, leaving the shared one mounted', async () => {
    mount(false);
    await screen.findByTestId('board-board-1');
    await userEvent.click(screen.getByRole('button', { name: 'Моя доска' }));

    expect(screen.getByTestId('board-personal-me')).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('board-board-1')).toHaveAttribute('data-active', 'false');
    // Anyone may draw on their own board.
    expect(boardProps.some((p) => p.targetId === 'personal-me' && p.canAnnotate)).toBe(true);
  });

  it('moves the answers button to the student board the teacher opens', async () => {
    mount(true);
    await screen.findByTestId('board-board-1');
    await screen.findByRole('button', { name: 'Доска ученика: Alice' });
    await userEvent.click(screen.getByRole('button', { name: 'Доска ученика: Alice' }));

    const personal = screen.getByTestId('board-personal-u1');
    expect(await within(personal).findByRole('button', { name: 'Ответы' })).toBeInTheDocument();
    expect(within(screen.getByTestId('board-board-1')).queryByRole('button', { name: 'Ответы' })).not.toBeInTheDocument();
  });

  it('keeps the board mounted but inactive while a screen share is shown, and can switch back', async () => {
    screenShares = [{ participant: { identity: 'x' }, source: 'screen_share', publication: {} }];
    mount(false);
    expect(await screen.findByTestId('screen')).toBeInTheDocument();
    expect(screen.getByTestId('board-board-1')).toHaveAttribute('data-active', 'false');

    await userEvent.click(screen.getByRole('button', { name: 'Показать доску' }));
    expect(screen.getByTestId('board-board-1')).toHaveAttribute('data-active', 'true');
  });

  it('hides chat and people in a drawer until asked', async () => {
    mount(false);
    const drawer = document.getElementById('online-class-drawer')!;
    expect(drawer).toHaveAttribute('hidden');
    await userEvent.click(screen.getByRole('button', { name: /Чат и участники/ }));
    expect(drawer).not.toHaveAttribute('hidden');
  });

  it('lets a student draw on the shared board, not only on their own', async () => {
    mount(false);
    await screen.findByTestId('board-board-1');
    expect(boardProps.some((p) => p.targetId === 'board-1' && p.canAnnotate)).toBe(true);
  });

  it('keeps the removed class screen-sharing permission switch out of the lesson toolbar', async () => {
    const student = mount(false);
    await screen.findByTestId('board-board-1');
    expect(screen.queryByRole('button', { name: /показывать экран/i })).not.toBeInTheDocument();
    student.unmount();

    mount(true);
    await screen.findByTestId('board-board-1');
    expect(screen.queryByRole('button', { name: /показывать экран/i })).not.toBeInTheDocument();
  });

  it('tells the recording button what the server can do, so it is not offered when it cannot work', async () => {
    mount(true, { recordingAvailable: false });
    await screen.findByTestId('board-board-1');
    expect(recordingProps.at(-1)).toMatchObject({ available: false });
  });
});
