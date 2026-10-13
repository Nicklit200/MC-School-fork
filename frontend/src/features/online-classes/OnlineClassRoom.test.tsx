import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { lessonPreparationApi } from '../../api/lessonPreparation';
import { onlineClassesApi, type OnlineClassConnection } from '../../api/onlineClasses';
import { I18nProvider } from '../../i18n/I18nContext';

let screenShares: unknown[] = [];

vi.mock('@livekit/components-react', () => ({
  LiveKitRoom: ({ children, onDisconnected }: {
    children: React.ReactNode;
    onDisconnected?: (reason?: number) => void;
  }) => (
    <div>
      <button type="button" onClick={() => onDisconnected?.(1)}>
        Simulate LiveKit disconnect
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
vi.mock('./useBoardDocument', () => ({ useBoardDocument: () => null }));
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
  lessonPreparationApi: { get: vi.fn(), answersBytes: vi.fn() },
}));
vi.mock('../../api/onlineClasses', async () => {
  const actual = await vi.importActual<typeof import('../../api/onlineClasses')>('../../api/onlineClasses');
  return { ...actual, onlineClassesApi: { listParticipants: vi.fn() } };
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
    expect(onConnectionLost).toHaveBeenCalledWith('1');
    expect(onLeave).not.toHaveBeenCalled();
  });

  it('shows a student no answers button and never asks for the answers', async () => {
    mount(false);
    await screen.findByTestId('board-board-1');
    expect(screen.queryByRole('button', { name: /Ответы/ })).not.toBeInTheDocument();
    expect(lessonPreparationApi.get).not.toHaveBeenCalled();
    expect(lessonPreparationApi.answersBytes).not.toHaveBeenCalled();
  });

  it('gives the teacher the answers button on the board they are looking at', async () => {
    mount(true);
    const board = await screen.findByTestId('board-board-1');
    expect(await within(board).findByRole('button', { name: 'Ответы' })).toBeEnabled();
  });

  it('shows the camera column next to the board', async () => {
    mount(false);
    expect(await screen.findByRole('list', { name: 'cameras' })).toBeInTheDocument();
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

  it('gives only the teacher the switch for student screen sharing', async () => {
    const student = mount(false);
    await screen.findByTestId('board-board-1');
    expect(screen.queryByRole('button', { name: /показывать экран/i })).not.toBeInTheDocument();
    student.unmount();

    mount(true);
    expect(await screen.findByRole('button', { name: /показывать экран/i })).toBeInTheDocument();
  });

  it('tells the recording button what the server can do, so it is not offered when it cannot work', async () => {
    mount(true, { recordingAvailable: false });
    await screen.findByTestId('board-board-1');
    expect(recordingProps.at(-1)).toMatchObject({ available: false });
  });
});
