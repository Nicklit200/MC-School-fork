import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../../api/client';
import { onlineClassesApi, type ClassFeatureState } from '../../api/onlineClasses';
import { I18nProvider } from '../../i18n/I18nContext';
import { TranscriptionControls } from './TranscriptionControls';

vi.mock('../../api/onlineClasses', async () => {
  const actual = await vi.importActual<typeof import('../../api/onlineClasses')>(
    '../../api/onlineClasses',
  );
  return {
    ...actual,
    onlineClassesApi: {
      startTranscription: vi.fn(),
      stopTranscription: vi.fn(),
    },
  };
});

const api = vi.mocked(onlineClassesApi);

function renderControls(isHost: boolean, state: ClassFeatureState) {
  render(
    <I18nProvider>
      <TranscriptionControls classId="class-1" isHost={isHost} transcriptionState={state} />
    </I18nProvider>,
  );
}

describe('TranscriptionControls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.startTranscription.mockResolvedValue(undefined);
    api.stopTranscription.mockResolvedValue(undefined);
  });

  it('hides start/stop from students', () => {
    renderControls(false, 'INACTIVE');

    expect(
      screen.queryByRole('button', { name: /Transkription starten|Включить расшифровку/i }),
    ).toBeNull();
  });

  it('lets the host start transcription', async () => {
    renderControls(true, 'INACTIVE');

    await userEvent.click(
      screen.getByRole('button', { name: /Transkription starten|Включить расшифровку/i }),
    );

    await waitFor(() => expect(api.startTranscription).toHaveBeenCalledWith('class-1'));
  });

  it('lets the host stop transcription', async () => {
    renderControls(true, 'ACTIVE');

    await userEvent.click(
      screen.getByRole('button', { name: /Transkription stoppen|Выключить расшифровку/i }),
    );

    await waitFor(() => expect(api.stopTranscription).toHaveBeenCalledWith('class-1'));
  });

  it('reports a failure without implying the class has ended', () => {
    renderControls(false, 'FAILED');

    expect(screen.getByRole('alert')).toHaveTextContent(/läuft weiter|урок продолжается/i);
  });

  it('explains when transcription is not configured', async () => {
    api.startTranscription.mockRejectedValue(
      new ApiRequestError(409, 'CONFLICT', 'Transcription is not available on this server'),
    );
    renderControls(true, 'INACTIVE');

    await userEvent.click(
      screen.getByRole('button', { name: /Transkription starten|Включить расшифровку/i }),
    );

    expect(await screen.findByText(/nicht konfiguriert|не настроена/i)).toBeInTheDocument();
  });

  it('is independent of recording state', async () => {
    // Recording and transcription are separate toggles; starting one must not
    // touch the other.
    renderControls(true, 'INACTIVE');

    await userEvent.click(
      screen.getByRole('button', { name: /Transkription starten|Включить расшифровку/i }),
    );

    await waitFor(() => expect(api.startTranscription).toHaveBeenCalled());
    expect(api.stopTranscription).not.toHaveBeenCalled();
  });
});
