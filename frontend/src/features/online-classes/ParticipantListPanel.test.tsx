import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { onlineClassesApi, type ClassParticipant } from '../../api/onlineClasses';
import { I18nProvider } from '../../i18n/I18nContext';
import { ParticipantListPanel } from './ParticipantListPanel';
import { WaitingRoomPanel } from './WaitingRoomPanel';

vi.mock('../../api/onlineClasses', async () => {
  const actual = await vi.importActual<typeof import('../../api/onlineClasses')>(
    '../../api/onlineClasses',
  );
  return {
    ...actual,
    onlineClassesApi: {
      listParticipants: vi.fn(),
      muteParticipant: vi.fn(),
      requestUnmute: vi.fn(),
      removeParticipant: vi.fn(),
      muteAllStudents: vi.fn(),
      listJoinRequests: vi.fn(),
      approveJoinRequest: vi.fn(),
      rejectJoinRequest: vi.fn(),
      approveAllJoinRequests: vi.fn(),
    },
  };
});

const api = vi.mocked(onlineClassesApi);

const host: ClassParticipant = {
  userId: 'teacher-1',
  displayName: 'Teacher',
  classRole: 'HOST',
  admissionState: 'ADMITTED',
  cameraEnabled: true,
  microphoneEnabled: true,
  screenShareEnabled: true,
  connected: true,
  firstJoinedAt: null,
  lastLeftAt: null,
  totalConnectedSeconds: 0,
};

const student: ClassParticipant = {
  ...host,
  userId: 'student-1',
  displayName: 'Student',
  classRole: 'STUDENT',
  screenShareEnabled: false,
};

function renderRoster(isHost: boolean, raisedHands?: Set<string>) {
  render(
    <I18nProvider>
      <ParticipantListPanel classId="class-1" isHost={isHost} raisedHands={raisedHands} />
    </I18nProvider>,
  );
}

describe('ParticipantListPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listParticipants.mockResolvedValue([host, student]);
    api.muteParticipant.mockResolvedValue(student);
    api.requestUnmute.mockResolvedValue(undefined);
    api.removeParticipant.mockResolvedValue(student);
    api.muteAllStudents.mockResolvedValue([student]);
  });

  it('shows the roster to everyone', async () => {
    renderRoster(false);

    expect(await screen.findByText('Teacher')).toBeInTheDocument();
    expect(screen.getByText('Student')).toBeInTheDocument();
  });

  it('hides moderation controls from students', async () => {
    renderRoster(false);
    await screen.findByText('Student');

    expect(screen.queryByRole('button', { name: /stummschalten|Выключить микрофон/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /entfernen|Удалить/i })).toBeNull();
  });

  it('gives the host mute, unmute-request and remove for a student', async () => {
    renderRoster(true);
    await screen.findByText('Student');

    await userEvent.click(screen.getByLabelText(/Mikrofon stummschalten Student|Выключить микрофон Student/i));
    await waitFor(() => expect(api.muteParticipant).toHaveBeenCalledWith('class-1', 'student-1'));

    await userEvent.click(screen.getByLabelText(/Mikrofon bitten Student|включить микрофон Student/i));
    await waitFor(() => expect(api.requestUnmute).toHaveBeenCalledWith('class-1', 'student-1'));

    await userEvent.click(screen.getByLabelText(/entfernen Student|Удалить из урока Student/i));
    await waitFor(() => expect(api.removeParticipant).toHaveBeenCalledWith('class-1', 'student-1'));
  });

  it('never offers moderation against the host themselves', async () => {
    renderRoster(true);
    await screen.findByText('Teacher');

    expect(screen.queryByLabelText(/stummschalten Teacher|Выключить микрофон Teacher/i)).toBeNull();
    expect(screen.queryByLabelText(/entfernen Teacher|Удалить из урока Teacher/i)).toBeNull();
  });

  it('marks a raised hand', async () => {
    renderRoster(false, new Set(['student-1']));

    expect(await screen.findByLabelText(/Hand gehoben|Рука поднята/i)).toBeInTheDocument();
  });

  it('omits removed participants', async () => {
    api.listParticipants.mockResolvedValue([host, { ...student, admissionState: 'REMOVED' }]);
    renderRoster(true);

    await screen.findByText('Teacher');
    expect(screen.queryByText('Student')).toBeNull();
  });
});

describe('WaitingRoomPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listJoinRequests.mockResolvedValue([
      {
        id: 'req-1',
        userId: 'student-1',
        displayName: 'Student',
        state: 'PENDING',
        requestedAt: '2026-09-18T10:00:00Z',
        decidedAt: null,
      },
    ]);
    api.approveJoinRequest.mockResolvedValue({
      id: 'req-1',
      userId: 'student-1',
      displayName: 'Student',
      state: 'APPROVED',
      requestedAt: '2026-09-18T10:00:00Z',
      decidedAt: '2026-09-18T10:01:00Z',
    });
    api.approveAllJoinRequests.mockResolvedValue([]);
  });

  it('lists who is waiting and admits them', async () => {
    render(
      <I18nProvider>
        <WaitingRoomPanel classId="class-1" pollIntervalMs={100000} />
      </I18nProvider>,
    );

    await screen.findByText('Student');
    await userEvent.click(screen.getByLabelText(/Einlassen Student|Впустить Student/i));

    await waitFor(() => expect(api.approveJoinRequest).toHaveBeenCalledWith('class-1', 'req-1'));
    // Removed locally so a second click cannot re-decide a settled request.
    await waitFor(() => expect(screen.queryByText('Student')).toBeNull());
  });

  it('announces an empty waiting room', async () => {
    api.listJoinRequests.mockResolvedValue([]);
    render(
      <I18nProvider>
        <WaitingRoomPanel classId="class-1" pollIntervalMs={100000} />
      </I18nProvider>,
    );

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent(/wartet|ожидает/i);
  });

  it('keeps the current list when polling fails', async () => {
    render(
      <I18nProvider>
        <WaitingRoomPanel classId="class-1" pollIntervalMs={100000} />
      </I18nProvider>,
    );
    await screen.findByText('Student');

    api.listJoinRequests.mockRejectedValue(new Error('network'));

    // The teacher must not have the list vanish mid-decision.
    expect(screen.getByText('Student')).toBeInTheDocument();
  });
});
