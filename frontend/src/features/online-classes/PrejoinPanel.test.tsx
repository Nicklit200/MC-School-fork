import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n/I18nContext';
import { PrejoinPanel } from './PrejoinPanel';

/** Tracks whether every acquired track was stopped, i.e. the camera light is off. */
function fakeStream() {
  const stop = vi.fn();
  return {
    stream: { getTracks: () => [{ stop, kind: 'video' }] } as unknown as MediaStream,
    stop,
  };
}

function setMediaDevices(value: unknown) {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    writable: true,
    value,
  });
}

const devices: MediaDeviceInfo[] = [
  { deviceId: 'cam-1', kind: 'videoinput', label: 'Built-in camera', groupId: 'g1' } as MediaDeviceInfo,
  { deviceId: 'mic-1', kind: 'audioinput', label: 'Built-in mic', groupId: 'g1' } as MediaDeviceInfo,
];

function renderPanel(onJoin = vi.fn()) {
  render(
    <I18nProvider>
      <PrejoinPanel onJoin={onJoin} />
    </I18nProvider>,
  );
  return onJoin;
}

describe('PrejoinPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    setMediaDevices(undefined);
  });

  it('lists devices once permission is granted', async () => {
    const { stream } = fakeStream();
    setMediaDevices({
      getUserMedia: vi.fn().mockResolvedValue(stream),
      enumerateDevices: vi.fn().mockResolvedValue(devices),
    });

    renderPanel();

    expect(await screen.findByRole('option', { name: 'Built-in camera' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Built-in mic' })).toBeInTheDocument();
  });

  it('explains a denied permission and offers a retry', async () => {
    const getUserMedia = vi.fn().mockRejectedValue(
      Object.assign(new Error('denied'), { name: 'NotAllowedError' }),
    );
    setMediaDevices({ getUserMedia, enumerateDevices: vi.fn().mockResolvedValue([]) });

    renderPanel();

    // The denial is announced, not just rendered.
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent(/verweigert|запрещ/i);

    const retry = screen.getByRole('button', { name: /erneut|Повторить/i });
    await userEvent.click(retry);
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
  });

  it('distinguishes missing hardware from a denied permission', async () => {
    setMediaDevices({
      getUserMedia: vi.fn().mockRejectedValue(
        Object.assign(new Error('none'), { name: 'NotFoundError' }),
      ),
      enumerateDevices: vi.fn().mockResolvedValue([]),
    });

    renderPanel();

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent(/gefunden|не найдены/i);
  });

  it('reports an unsupported browser when getUserMedia is absent', async () => {
    setMediaDevices({});

    renderPanel();

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent(/unterstützt|не поддерживает/i);
  });

  it('stops local tracks on unmount so the camera is released', async () => {
    const { stream, stop } = fakeStream();
    setMediaDevices({
      getUserMedia: vi.fn().mockResolvedValue(stream),
      enumerateDevices: vi.fn().mockResolvedValue(devices),
    });

    const { unmount } = render(
      <I18nProvider>
        <PrejoinPanel onJoin={vi.fn()} />
      </I18nProvider>,
    );
    await screen.findByRole('option', { name: 'Built-in camera' });

    unmount();

    await waitFor(() => expect(stop).toHaveBeenCalled());
  });

  it('passes the chosen devices to the join handler', async () => {
    const { stream } = fakeStream();
    setMediaDevices({
      getUserMedia: vi.fn().mockResolvedValue(stream),
      enumerateDevices: vi.fn().mockResolvedValue(devices),
    });
    const onJoin = renderPanel();

    await screen.findByRole('option', { name: 'Built-in camera' });
    await userEvent.click(screen.getByRole('button', { name: /Beitreten|Присоединиться/i }));

    expect(onJoin).toHaveBeenCalledWith({
      videoDeviceId: 'cam-1',
      audioDeviceId: 'mic-1',
      cameraEnabled: true,
      microphoneEnabled: true,
    });
  });
});
