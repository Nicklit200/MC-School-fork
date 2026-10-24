import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { lessonPreparationApi } from '../../api/lessonPreparation';
import { onlineClassesApi, type OnlineClassConnection } from '../../api/onlineClasses';
import { I18nProvider } from '../../i18n/I18nContext';

let screenShares: unknown[] = [];

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
  useConnectionState: () => 'connected',
  useTracks: () => screenShares,
}));
vi.mock('./CameraColumn', () => ({ CameraColumn: () => <ul aria-label="cameras" /> }));
vi.mock('../notebook-camera/NotebookCameraPanel', () => ({
  NotebookCameraPanel: (props: {
    eventId: string; classId: string; currentUserId: string; isTeacher: boolean;
    students?: unknown[]; autoPair: boolean; closeLabel: string; onClose: () => void;
  }) => <section aria-label="Встроенная тетрадь"
    data-event={props.eventId} data-class={props.classId} data-owner={props.currentUserId}
    data-teacher={String(props.isTeacher)} data-auto-pair={String(props.autoPair)}
    data-roster={props.students?.length ?? 0}>
    <iframe title="Notebook processor" />
    <button type="button" onClick={props.onClose}>{props.closeLabel}</button>
  </section>,
}));
vi.mock('./ChatPanel', () => ({ ChatPanel: () => null }));
vi.mock('./CaptionsPanel', () => ({ CaptionsPanel: () => null }));
vi.mock('./HomeworkDrawer', () => ({
  HomeworkDrawer: ({ onClose }: { onClose: () => void }) => (
    <aside id="classroom-homework-panel" aria-label="Домашнее задание">
      <span>Текст или PDF домашки</span>
      <button type="button" onClick={onClose}>Закрыть домашнее задание</button>
    </aside>
  ),
}));
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
vi.mock('./useBoardDocument', () => ({ useBoardDocument: () => null }));
vi.mock('./useClassEvents', () => ({ useClassEvents: () => ({ publish: vi.fn() }) }));
vi.mock('./useHostUserId', () => ({ useHostUserId: () => 'me' }));
vi.mock('./usePdf', () => ({ usePdf: () => ({ status: 'idle' }), usePdfPage: () => null }));

const boardProps: Record<string, any>[] = [];
vi.mock('./WhiteboardPanel', () => ({
  WhiteboardPanel: (props: Record<string, any>) => {
    boardProps.push(props);
    return (
      <section data-testid={`board-${props.targetId}`} data-active={String(props.active)}>
        {props.hostActions}
      </section>
    );
  },
}));

vi.mock('../../api/lessonPreparation', () => ({
  lessonPreparationApi: { get: vi.fn(), answersBytes: vi.fn(), appendWorkbook: vi.fn() },
}));
vi.mock('../../api/onlineClasses', async () => {
  const actual = await vi.importActual<typeof import('../../api/onlineClasses')>('../../api/onlineClasses');
  return { ...actual, onlineClassesApi: { listParticipants: vi.fn(), documentBytes: vi.fn(), documentVersion: vi.fn() } };
});

import { OnlineClassRoom } from './OnlineClassRoom';

const connection = (host: boolean): OnlineClassConnection => ({
  serverUrl: 'wss://x', token: 't', identity: 'me|d', roomName: 'r', expiresAt: '', host,
  recordingActive: false, transcriptionActive: false,
});

function mount(host: boolean, extra: Partial<React.ComponentProps<typeof OnlineClassRoom>> = {}) {
  return render(
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
    </I18nProvider>,
  );
}

describe('PDF upload contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(onlineClassesApi.listParticipants).mockResolvedValue([]);
    vi.mocked(lessonPreparationApi.get).mockResolvedValue({ hasAnswers: false } as never);
    vi.mocked(onlineClassesApi.documentVersion).mockResolvedValue({ version: 2 });
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
    await waitFor(() => expect(screen.getByText('＋ Добавить PDF / Фото')).toBeInTheDocument());
  });
});

describe('OnlineClassRoom', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    boardProps.length = 0;
    recordingProps.length = 0;
    screenShares = [];
    vi.mocked(onlineClassesApi.listParticipants).mockResolvedValue([
      { userId: 'u1', displayName: 'Alice', classRole: 'STUDENT', admissionState: 'ADMITTED' } as never,
    ]);
    vi.mocked(lessonPreparationApi.get).mockResolvedValue({ hasAnswers: true, answersFilename: 'a.pdf' } as never);
  });

  it('handles an unexpected LiveKit disconnect without clicking Leave', async () => {
    const onLeave = vi.fn();
    const onConnectionLost = vi.fn();
    mount(true, { onLeave, onConnectionLost });
    await screen.findByTestId('board-board-1');
    await userEvent.click(screen.getByRole('button', { name: 'Simulate LiveKit disconnect' }));
    expect(onConnectionLost).toHaveBeenCalledWith('1', false);
    expect(onLeave).not.toHaveBeenCalled();
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
    expect(lessonPreparationApi.get).not.toHaveBeenCalled();
    expect(lessonPreparationApi.answersBytes).not.toHaveBeenCalled();
  });

  it('opens top-row teacher solutions as a sibling of the resizable main board', async () => {
    const view = mount(true);
    await screen.findByTestId('board-board-1');
    await userEvent.click(screen.getByRole('button', { name: 'Решения' }));
    const sidebar = screen.getByRole('complementary', { name: 'Решения' });
    expect(sidebar.parentElement).toHaveClass('online-class-room__stage');
    expect(sidebar.nextElementSibling).toHaveClass('online-class-room__main');
    expect(view.container.querySelector('.online-class-room__board')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Закрыть решения' }));
    expect(screen.queryByRole('complementary', { name: 'Решения' })).not.toBeInTheDocument();
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
      expect(sidebar.nextElementSibling).toHaveClass('online-class-room__main');
      expect(boardProps.at(-1)?.overlay).toBeUndefined();
    } finally {
      if (previous) vi.stubGlobal('ResizeObserver', previous);
      else vi.unstubAllGlobals();
    }
  });

  it('gives the teacher the answers button on the board they are looking at', async () => {
    mount(true);
    const board = await screen.findByTestId('board-board-1');
    expect(await within(board).findByRole('button', { name: 'Ответы' })).toBeEnabled();
  });

  it('opens an assignment drawer from a single top-row icon and closes it', async () => {
    mount(false);
    const toggle = screen.getByRole('button', { name: 'Домашнее задание' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('complementary', { name: 'Домашнее задание' })).not.toBeInTheDocument();
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Текст или PDF домашки')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Закрыть домашнее задание' }));
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('shows the camera column next to the board', async () => {
    mount(false);
    expect(await screen.findByRole('list', { name: 'cameras' })).toBeInTheDocument();
  });

  it('opens a class-bound pupil notebook from one prominent button, keeping board and call mounted', async () => {
    const view = mount(false);
    const board = await screen.findByTestId('board-board-1');
    const toggle = screen.getByRole('button', { name: 'Подключить тетрадь' });
    expect(view.container.querySelector('.online-class-room__topbar')).toContainElement(toggle);
    expect(screen.queryByTitle('Notebook processor')).not.toBeInTheDocument();

    await userEvent.click(toggle);
    const notebook = screen.getByRole('region', { name: 'Встроенная тетрадь' });
    expect(notebook).toHaveAttribute('data-event', 'e1');
    expect(notebook).toHaveAttribute('data-class', 'c1');
    expect(notebook).toHaveAttribute('data-owner', 'me');
    expect(notebook).toHaveAttribute('data-auto-pair', 'true');
    expect(notebook).toHaveAttribute('data-teacher', 'false');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(board).toHaveAttribute('data-active', 'false');
    expect(screen.getByRole('list', { name: 'cameras' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    const processor = screen.getByTitle('Notebook processor');
    await userEvent.click(screen.getByRole('button', { name: 'Вернуться к доске' }));
    expect(board).toHaveAttribute('data-active', 'true');
    expect(processor).toBeInTheDocument();
    expect(processor).not.toBeVisible();
    expect(toggle).toHaveFocus();
    await userEvent.click(toggle);
    expect(screen.getByTitle('Notebook processor')).toBe(processor);
    expect(processor).toBeVisible();
  });

  it('lets the teacher view enrolled pupils’ notebooks without replacing their phone QR', async () => {
    mount(true);
    await screen.findByRole('option', { name: 'Доска ученика: Alice' });
    await userEvent.click(screen.getByRole('button', { name: 'Тетради учеников' }));
    const notebook = screen.getByRole('region', { name: 'Встроенная тетрадь' });
    expect(notebook).toHaveAttribute('data-auto-pair', 'false');
    expect(notebook).toHaveAttribute('data-roster', '1');
    expect(notebook).toHaveAttribute('data-teacher', 'true');
  });

  it('returns to the selected personal board without discarding the notebook processor', async () => {
    mount(false);
    await screen.findByTestId('board-board-1');
    await userEvent.click(screen.getByRole('button', { name: 'Подключить тетрадь' }));
    const processor = screen.getByTitle('Notebook processor');
    await userEvent.click(screen.getByRole('button', { name: 'Моя доска' }));
    expect(screen.getByTestId('board-personal-me')).toHaveAttribute('data-active', 'true');
    expect(processor).not.toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Подключить тетрадь' }));
    expect(screen.getByTitle('Notebook processor')).toBe(processor);
  });

  it('keeps the notebook open when a screen share starts or ends', async () => {
    const view = mount(false);
    await screen.findByTestId('board-board-1');
    await userEvent.click(screen.getByRole('button', { name: 'Подключить тетрадь' }));
    const processor = screen.getByTitle('Notebook processor');
    const renderRoom = () => <I18nProvider><OnlineClassRoom classId="c1" eventId="e1" currentUserId="me"
      connection={connection(false)} recordingState="INACTIVE" transcriptionState="INACTIVE"
      onLeave={vi.fn()} onConnectionLost={vi.fn()} /></I18nProvider>;
    screenShares = [{ participant: { identity: 'teacher' }, source: 'screen_share', publication: {} }];
    view.rerender(renderRoom());
    expect(processor).toBeVisible();
    expect(screen.queryByTestId('screen')).not.toBeInTheDocument();
    screenShares = [];
    view.rerender(renderRoom());
    expect(processor).toBeVisible();
  });

  it('does not offer notebook pairing for a room without a calendar lesson', async () => {
    mount(false, { eventId: undefined });
    await screen.findByTestId('board-board-1');
    expect(screen.queryByRole('button', { name: 'Подключить тетрадь' })).not.toBeInTheDocument();
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
    await screen.findByRole('option', { name: 'Доска ученика: Alice' });
    await userEvent.selectOptions(screen.getByRole('combobox'), 'personal-u1');

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
