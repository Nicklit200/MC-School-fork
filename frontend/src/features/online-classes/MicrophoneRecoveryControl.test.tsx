import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n/I18nContext';
import { MicrophoneRecoveryControl } from './MicrophoneRecoveryControl';

const sdk = vi.hoisted(() => ({
  connected: true,
  publication: null as unknown,
  restart: vi.fn(),
  unpublish: vi.fn(),
  enable: vi.fn(),
  unmute: vi.fn(),
}));

vi.mock('@livekit/components-react', () => ({
  useRoomContext: () => ({
    localParticipant: {
      getTrackPublication: () => sdk.publication,
      unpublishTrack: sdk.unpublish,
      setMicrophoneEnabled: sdk.enable,
    },
  }),
  useConnectionState: () => sdk.connected ? 'connected' : 'disconnected',
}));

function publication() {
  return {
    isMuted: false,
    unmute: sdk.unmute,
    track: { restartTrack: sdk.restart, mediaStreamTrack: { readyState: 'live' } },
  };
}

function mount() {
  return render(<I18nProvider><MicrophoneRecoveryControl /></I18nProvider>);
}

describe('MicrophoneRecoveryControl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sdk.connected = true;
    sdk.publication = publication();
    sdk.restart.mockResolvedValue(undefined);
    sdk.unpublish.mockResolvedValue(undefined);
    sdk.enable.mockResolvedValue(undefined);
    sdk.unmute.mockResolvedValue(undefined);
  });

  it('does not automatically unmute the pupil and restarts mic on a click only', async () => {
    mount();
    expect(sdk.restart).not.toHaveBeenCalled();
    expect(sdk.unmute).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Восстановить микрофон' }));
    await waitFor(() => expect(sdk.restart).toHaveBeenCalledTimes(1));
    expect(sdk.unmute).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent(/Микрофон подключён/);
  });

  it('publishes a mic after joining without one', async () => {
    sdk.publication = null;
    sdk.enable.mockImplementation(async () => { sdk.publication = publication(); });
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Восстановить микрофон' }));
    await waitFor(() => expect(sdk.enable).toHaveBeenCalledWith(true));
    expect(screen.getByRole('status')).toHaveTextContent(/Микрофон подключён/);
  });

  it('falls back to a fresh microphone when the existing capture restart fails', async () => {
    sdk.restart.mockRejectedValueOnce(new Error('device disconnected'));
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Восстановить микрофон' }));
    await waitFor(() => expect(sdk.enable).toHaveBeenCalledWith(true));
    expect(sdk.unpublish).toHaveBeenCalledTimes(1);
  });

  it('shows an actionable error if the browser rejects the capture', async () => {
    sdk.publication = null;
    sdk.enable.mockRejectedValueOnce(new Error('NotAllowedError'));
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Восстановить микрофон' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/разрешение браузера/);
  });

  it('does not offer a false recovery while disconnected', () => {
    sdk.connected = false;
    mount();
    expect(screen.getByRole('button', { name: 'Восстановить микрофон' })).toBeDisabled();
  });
});
