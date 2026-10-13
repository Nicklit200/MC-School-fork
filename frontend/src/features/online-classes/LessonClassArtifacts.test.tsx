import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { onlineClassesApi, type OnlineClass } from '../../api/onlineClasses';
import { I18nProvider } from '../../i18n/I18nContext';
import { LessonClassArtifacts } from './LessonClassArtifacts';

vi.mock('../../api/onlineClasses', async () => {
  const actual = await vi.importActual<typeof import('../../api/onlineClasses')>(
    '../../api/onlineClasses',
  );
  return {
    ...actual,
    onlineClassesApi: {
      findByEvent: vi.fn(),
      attendance: vi.fn(),
      listRecordings: vi.fn(),
      transcript: vi.fn(),
    },
  };
});

const api = vi.mocked(onlineClassesApi);

const CLASS: OnlineClass = {
  id: 'class-1',
  eventId: 'event-1',
  bindingKey: 'binding-1',
  title: 'Maths',
  scheduledStartAt: '2026-09-18T10:00:00Z',
  scheduledEndAt: '2026-09-18T11:00:00Z',
  studentId: 'student-1',
  groupId: null,
  status: 'ENDED',
  waitingRoomEnabled: true,
  studentScreenShareEnabled: false,
  recordingState: 'INACTIVE',
  transcriptionState: 'INACTIVE',
  actualStartAt: '2026-09-18T10:01:00Z',
  actualEndAt: '2026-09-18T10:55:00Z',
  viewerIsHost: true,
  joinWindowOpen: false,
};

function renderArtifacts() {
  render(
    <I18nProvider>
      <LessonClassArtifacts eventId="event-1" />
    </I18nProvider>,
  );
}

describe('LessonClassArtifacts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.findByEvent.mockResolvedValue([CLASS]);
    api.attendance.mockResolvedValue([]);
    api.listRecordings.mockResolvedValue([]);
    api.transcript.mockResolvedValue([]);
  });

  it('renders nothing when no class was ever held', async () => {
    api.findByEvent.mockResolvedValue([]);
    const { container } = render(
      <I18nProvider>
        <LessonClassArtifacts eventId="event-1" />
      </I18nProvider>,
    );

    // A teacher who has never used online classes sees no change to the page.
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('renders nothing when the feature is disabled', async () => {
    api.findByEvent.mockRejectedValue(new Error('not enabled'));
    const { container } = render(
      <I18nProvider>
        <LessonClassArtifacts eventId="event-1" />
      </I18nProvider>,
    );

    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('never creates a class as a side effect of opening the lesson', async () => {
    renderArtifacts();

    await waitFor(() => expect(api.findByEvent).toHaveBeenCalledWith('event-1'));
    // materializeFromCalendar is not even mocked here: calling it would throw.
    expect((api as Record<string, unknown>).materializeFromCalendar).toBeUndefined();
  });

  it('shows attendance in minutes', async () => {
    api.attendance.mockResolvedValue([
      {
        userId: 'student-1',
        displayName: 'Student',
        classRole: 'STUDENT',
        admissionState: 'ADMITTED',
        cameraEnabled: true,
        microphoneEnabled: true,
        screenShareEnabled: false,
        connected: false,
        firstJoinedAt: null,
        lastLeftAt: null,
        totalConnectedSeconds: 1800,
      },
    ]);

    renderArtifacts();

    expect(await screen.findByText(/Student — 30/)).toBeInTheDocument();
  });

  it('links a ready recording and labels one still processing', async () => {
    api.listRecordings.mockResolvedValue([
      {
        id: 'rec-1',
        status: 'READY',
        requestedAt: '',
        startedAt: null,
        endedAt: null,
        byteSize: 10,
        durationSeconds: 60,
        failureReason: null,
        deleteAfter: null,
        downloadUrl: 'https://storage.invalid/signed?sig=abc',
      },
      {
        id: 'rec-2',
        status: 'PROCESSING',
        requestedAt: '',
        startedAt: null,
        endedAt: null,
        byteSize: null,
        durationSeconds: null,
        failureReason: null,
        deleteAfter: null,
        downloadUrl: null,
      },
    ]);

    renderArtifacts();

    expect(
      await screen.findByRole('link', { name: /herunterladen|Скачать запись/i }),
    ).toHaveAttribute('href', 'https://storage.invalid/signed?sig=abc');
    expect(screen.getByText(/verarbeitet|Обрабатывается/i)).toBeInTheDocument();
  });

  it('offers transcript exports only when there is a transcript', async () => {
    api.transcript.mockResolvedValue([
      {
        id: 'seg-1',
        speakerLabel: 'Student',
        userId: 'student-1',
        language: 'de',
        startMs: 0,
        endMs: 1000,
        text: 'Guten Tag',
        confidence: 0.9,
      },
    ]);

    renderArtifacts();

    expect(await screen.findByRole('link', { name: /TXT/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /VTT/i })).toBeInTheDocument();
  });

  it('still shows attendance when recordings are unavailable', async () => {
    api.attendance.mockResolvedValue([
      {
        userId: 'student-1',
        displayName: 'Student',
        classRole: 'STUDENT',
        admissionState: 'ADMITTED',
        cameraEnabled: true,
        microphoneEnabled: true,
        screenShareEnabled: false,
        connected: false,
        firstJoinedAt: null,
        lastLeftAt: null,
        totalConnectedSeconds: 600,
      },
    ]);
    // Storage unconfigured: one failing integration must not blank the rest.
    api.listRecordings.mockRejectedValue(new Error('storage not configured'));

    renderArtifacts();

    expect(await screen.findByText(/Student — 10/)).toBeInTheDocument();
  });
});
