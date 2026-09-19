import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../../api/client';
import { onlineClassesApi, type ClassFeatureState } from '../../api/onlineClasses';
import { I18nProvider } from '../../i18n/I18nContext';
import { RecordingControls } from './RecordingControls';

vi.mock('../../api/onlineClasses', async () => {
  const actual = await vi.importActual<typeof import('../../api/onlineClasses')>(
    '../../api/onlineClasses',
  );
  return {
    ...actual,
    onlineClassesApi: {
      startRecording: vi.fn(),
      stopRecording: vi.fn(),
      acknowledgeRecording: vi.fn(),
    },
  };
});

const api = vi.mocked(onlineClassesApi);

function renderControls(isHost: boolean, recordingState: ClassFeatureState) {
  render(
    <I18nProvider>
      <RecordingControls classId="class-1" isHost={isHost} recordingState={recordingState} />
    </I18nProvider>,
  );
}

describe('RecordingControls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.startRecording.mockResolvedValue({} as never);
    api.stopRecording.mockResolvedValue({} as never);
    api.acknowledgeRecording.mockResolvedValue(undefined);
  });

  it('shows the recording notice to a student, not only to the host', async () => {
    renderControls(false, 'ACTIVE');

    expect(await screen.findByRole('alertdialog')).toHaveTextContent(
      /aufgezeichnet|записывается/i,
    );
  });

  it('records acknowledgment when the participant confirms', async () => {
    renderControls(false, 'ACTIVE');

    await userEvent.click(screen.getByRole('button', { name: /Verstanden|Понятно/i }));

    await waitFor(() => expect(api.acknowledgeRecording).toHaveBeenCalledWith('class-1'));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('shows no notice when nothing is being recorded', () => {
    renderControls(false, 'INACTIVE');

    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('hides start/stop from students', () => {
    renderControls(false, 'INACTIVE');

    expect(screen.queryByRole('button', { name: /Aufnahme starten|Начать запись/i })).toBeNull();
  });

  it('lets the host start and stop', async () => {
    const { unmount } = render(
      <I18nProvider>
        <RecordingControls classId="class-1" isHost recordingState="INACTIVE" />
      </I18nProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: /Aufnahme starten|Начать запись/i }));
    await waitFor(() => expect(api.startRecording).toHaveBeenCalledWith('class-1'));
    unmount();

    renderControls(true, 'ACTIVE');
    await userEvent.click(screen.getByRole('button', { name: /Aufnahme stoppen|Остановить запись/i }));
    await waitFor(() => expect(api.stopRecording).toHaveBeenCalledWith('class-1'));
  });

  it('announces the processing state rather than claiming the recording is ready', () => {
    renderControls(true, 'STOPPING');

    expect(screen.getByRole('status')).toHaveTextContent(/verarbeitet|обрабатывается/i);
  });

  it('announces a failed recording', () => {
    renderControls(true, 'FAILED');

    expect(screen.getByRole('alert')).toHaveTextContent(/fehlgeschlagen|не удалась/i);
  });

  it('explains when recording is not configured instead of failing silently', async () => {
    api.startRecording.mockRejectedValue(
      new ApiRequestError(409, 'CONFLICT', 'Recording is not available on this server'),
    );
    renderControls(true, 'INACTIVE');

    await userEvent.click(screen.getByRole('button', { name: /Aufnahme starten|Начать запись/i }));

    expect(
      await screen.findByText(/nicht konfiguriert|не настроена/i),
    ).toBeInTheDocument();
  });
});
