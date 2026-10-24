// @vitest-environment-options {"url":"https://school.example"}
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CameraPairing, NotebookCamera } from '../../api/notebookCameras';
import { NotebookCameraPanel } from './NotebookCameraPanel';

const mocks = vi.hoisted(() => ({ list: vi.fn(), pair: vi.fn() }));
vi.mock('../../api/notebookCameras', async () => {
  const actual = await vi.importActual<typeof import('../../api/notebookCameras')>('../../api/notebookCameras');
  return { ...actual, notebookCamerasApi: { list: mocks.list, pair: mocks.pair } };
});
vi.mock('./cameraModules', () => ({ drawCameraQR: vi.fn(async () => {}) }));
vi.mock('./NotebookCameraViewer', () => ({ NotebookCameraViewer: ({ cameraId }: { cameraId: string }) => <div data-testid="notebook-viewer" data-camera-id={cameraId}>Изображение тетради</div> }));
beforeEach(() => {
  vi.clearAllMocks(); mocks.list.mockReset(); mocks.pair.mockReset(); mocks.list.mockResolvedValue([]);
  mocks.pair.mockResolvedValue({ camera: { cameraId: 'camera-1', eventId: 'trial-event', ownerId: 'teacher-1', ownerName: 'Учитель', status: 'PAIRING',
    pairingExpiresAt: new Date(Date.now() + 300000).toISOString(), sessionExpiresAt: new Date(Date.now() + 10800000).toISOString() }, pairingToken: 'single-use-secret' });
});
afterEach(() => { vi.useRealTimers(); });

function camera(overrides: Partial<NotebookCamera> = {}): NotebookCamera {
  return { cameraId: 'student-camera', eventId: 'lesson-1', classId: 'class-1', ownerId: 'pupil-1', ownerName: 'Ученик', status: 'PAIRING',
    pairingExpiresAt: new Date(Date.now() + 300000).toISOString(), sessionExpiresAt: new Date(Date.now() + 10800000).toISOString(), ...overrides };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const studentProps = { eventId: 'lesson-1', classId: 'class-1', currentUserId: 'pupil-1', isTeacher: false, autoPair: true };
async function poll() { await act(async () => { await vi.advanceTimersByTimeAsync(5000); }); }
describe('trial lesson camera pairing', () => {
  it('creates a teacher-owned QR for a trial pupil without a registered account', async () => {
    render(<NotebookCameraPanel eventId="trial-event" currentUserId="teacher-1" isTeacher students={[]} />);
    expect(screen.getByRole('combobox', { name: 'Ученик для подключения камеры' })).toHaveValue('teacher-1');
    const connect = screen.getByRole('button', { name: 'Подключить телефон' });
    expect(connect).toBeEnabled(); fireEvent.click(connect);
    await waitFor(() => expect(mocks.pair).toHaveBeenCalledWith('trial-event', 'teacher-1', undefined));
    expect(await screen.findByLabelText('QR-код для камеры тетради')).toBeInTheDocument();
  });
  it('defaults to a roster pupil but preserves an explicit trial choice across roster refreshes', async () => {
    const props = { eventId: 'trial-event', currentUserId: 'teacher-1', isTeacher: true };
    const { rerender } = render(<NotebookCameraPanel {...props} students={[{ userId: 'pupil-1', displayName: 'Ученик' }]} />);
    await act(async () => { await mocks.list.mock.results[0].value; });
    const select = screen.getByRole('combobox', { name: 'Ученик для подключения камеры' });
    expect(select).toHaveValue('pupil-1'); fireEvent.change(select, { target: { value: 'teacher-1' } });
    rerender(<NotebookCameraPanel {...props} students={[{ userId: 'pupil-1', displayName: 'Ученик' }]} />);
    expect(select).toHaveValue('teacher-1');
  });
});

describe('student workspace camera pairing', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    mocks.pair.mockResolvedValue({ camera: camera(), pairingToken: 'student-secret' });
  });

  it('creates a class-bound QR after one explicit workspace click and the initial list response', async () => {
    const initialList = deferred<NotebookCamera[]>();
    mocks.list.mockReturnValue(initialList.promise);
    function Workspace() {
      const [open, setOpen] = useState(false);
      return <><button onClick={() => setOpen(true)}>Открыть тетрадь</button>{open && <NotebookCameraPanel {...studentProps} />}</>;
    }
    render(<Workspace />);
    expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.pair).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Открыть тетрадь' }));
    expect(mocks.list).toHaveBeenCalledWith('lesson-1'); expect(mocks.pair).not.toHaveBeenCalled();
    await act(async () => { initialList.resolve([]); });
    expect(await screen.findByLabelText('QR-код для камеры тетради')).toBeInTheDocument();
    expect(mocks.pair).toHaveBeenCalledExactlyOnceWith('lesson-1', undefined, 'class-1');
    expect(screen.getByTestId('notebook-viewer')).toHaveAttribute('data-camera-id', 'student-camera');
  });

  it('resumes only the current pupil’s connected camera in the current class', async () => {
    const connected = camera({ cameraId: 'current-connected', status: 'CONNECTED' });
    mocks.list.mockResolvedValue([
      camera({ cameraId: 'foreign', status: 'CONNECTED', ownerId: 'pupil-2' }),
      camera({ cameraId: 'other-class', status: 'CONNECTED', classId: 'old-class' }),
      camera({ cameraId: 'standalone', status: 'CONNECTED', classId: null }),
      camera({ cameraId: 'other-lesson', status: 'CONNECTED', eventId: 'other-lesson' }),
      camera({ cameraId: 'expired', status: 'CONNECTED', sessionExpiresAt: new Date(Date.now() - 1000).toISOString() }),
      camera({ cameraId: 'revoked', status: 'REVOKED' }),
      camera({ cameraId: 'waiting' }), connected,
    ]);
    render(<NotebookCameraPanel {...studentProps} />);
    await waitFor(() => expect(screen.getByTestId('notebook-viewer')).toHaveAttribute('data-camera-id', 'current-connected'));
    expect(mocks.pair).not.toHaveBeenCalled();
    const select = screen.getByRole('combobox', { name: 'Выбрать камеру тетради' });
    expect(select).toHaveValue('current-connected');
    expect(Array.from(select.querySelectorAll('option')).map(option => option.value)).toEqual(['', 'waiting', 'current-connected']);
    expect(screen.queryByLabelText('QR-код для камеры тетради')).not.toBeInTheDocument();
  });

  it.each([
    ['a previous PAIRING whose secret is unavailable', { status: 'PAIRING' as const }],
    ['an expired CONNECTED session', { status: 'CONNECTED' as const, sessionExpiresAt: '2020-01-01T00:00:00Z' }],
    ['a different class connection', { status: 'CONNECTED' as const, classId: 'previous-class' }],
    ['another pupil’s connection', { status: 'CONNECTED' as const, ownerId: 'pupil-2' }],
  ])('creates a fresh QR instead of reusing %s', async (_name, overrides) => {
    mocks.list.mockResolvedValue([camera({ cameraId: 'old-camera', ...overrides })]);
    render(<NotebookCameraPanel {...studentProps} />);
    expect(await screen.findByLabelText('QR-код для камеры тетради')).toBeInTheDocument();
    expect(mocks.pair).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('notebook-viewer')).toHaveAttribute('data-camera-id', 'student-camera');
  });

  it('preserves its QR and viewer through polling and a hidden workspace', async () => {
    const { rerender } = render(<div hidden={false}><NotebookCameraPanel {...studentProps} /></div>);
    const qr = await screen.findByLabelText('QR-код для камеры тетради');
    const viewer = screen.getByTestId('notebook-viewer');
    mocks.list.mockResolvedValue([camera()]);
    rerender(<div hidden><NotebookCameraPanel {...studentProps} /></div>);
    await poll(); await poll();
    rerender(<div hidden={false}><NotebookCameraPanel {...studentProps} /></div>);
    expect(screen.getByLabelText('QR-код для камеры тетради')).toBe(qr);
    expect(screen.getByTestId('notebook-viewer')).toBe(viewer);
    expect(mocks.pair).toHaveBeenCalledTimes(1);
  });

  it('selects the active replacement when a poll removes the previous camera', async () => {
    mocks.list.mockResolvedValue([camera({ cameraId: 'first-camera', status: 'CONNECTED' })]);
    render(<NotebookCameraPanel {...studentProps} />);
    await waitFor(() => expect(screen.getByTestId('notebook-viewer')).toHaveAttribute('data-camera-id', 'first-camera'));
    mocks.list.mockResolvedValue([camera({ cameraId: 'replacement', status: 'CONNECTED' })]);
    await poll();
    expect(screen.getByTestId('notebook-viewer')).toHaveAttribute('data-camera-id', 'replacement');
    expect(screen.getByRole('combobox', { name: 'Выбрать камеру тетради' })).toHaveValue('replacement');
    expect(mocks.pair).not.toHaveBeenCalled();
  });

  it('keeps the current viewer when an older list finishes after a newer connected-camera poll', async () => {
    const initialList = deferred<NotebookCamera[]>();
    mocks.list.mockReturnValueOnce(initialList.promise);
    render(<NotebookCameraPanel {...studentProps} />);
    mocks.list.mockResolvedValue([camera({ cameraId: 'newest-connected', status: 'CONNECTED' })]);
    await poll();
    const viewer = screen.getByTestId('notebook-viewer');
    expect(viewer).toHaveAttribute('data-camera-id', 'newest-connected');
    await act(async () => { initialList.resolve([]); });
    expect(screen.getByTestId('notebook-viewer')).toBe(viewer);
    expect(screen.getByRole('combobox', { name: 'Выбрать камеру тетради' })).toHaveValue('newest-connected');
    expect(mocks.pair).not.toHaveBeenCalled();
  });

  it('offers a manual retry after a failed automatic request without retrying on every poll', async () => {
    mocks.pair.mockRejectedValueOnce(new Error('Нет связи с сервером'));
    render(<NotebookCameraPanel {...studentProps} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Нет связи с сервером');
    await poll(); await poll();
    expect(mocks.pair).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Подключить телефон' }));
    expect(await screen.findByLabelText('QR-код для камеры тетради')).toBeInTheDocument();
    expect(mocks.pair).toHaveBeenCalledTimes(2);
  });

  it('creates only one pairing in StrictMode and retains the returned secret', async () => {
    const pendingPair = deferred<CameraPairing>(); mocks.pair.mockReturnValue(pendingPair.promise);
    render(<StrictMode><NotebookCameraPanel {...studentProps} /></StrictMode>);
    await waitFor(() => expect(mocks.pair).toHaveBeenCalledTimes(1));
    await poll();
    expect(mocks.pair).toHaveBeenCalledTimes(1);
    await act(async () => { pendingPair.resolve({ camera: camera(), pairingToken: 'strict-mode-secret' }); });
    expect(screen.getByLabelText('QR-код для камеры тетради')).toBeInTheDocument();
    mocks.list.mockResolvedValue([camera()]); await poll();
    expect(mocks.pair).toHaveBeenCalledTimes(1);
  });

  it('does not start pairing from a list response received after unmount', async () => {
    const initialList = deferred<NotebookCamera[]>(); mocks.list.mockReturnValue(initialList.promise);
    const { unmount } = render(<StrictMode><NotebookCameraPanel {...studentProps} /></StrictMode>);
    unmount(); await act(async () => { initialList.resolve([]); }); await poll();
    expect(mocks.pair).not.toHaveBeenCalled();
  });

  it('ignores late pairing results after unmount without starting more requests', async () => {
    const pendingPair = deferred<CameraPairing>(); mocks.pair.mockReturnValue(pendingPair.promise);
    const { unmount } = render(<StrictMode><NotebookCameraPanel {...studentProps} /></StrictMode>);
    await waitFor(() => expect(mocks.pair).toHaveBeenCalledTimes(1)); unmount();
    await act(async () => { pendingPair.resolve({ camera: camera(), pairingToken: 'late-secret' }); }); await poll();
    expect(mocks.pair).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('QR-код для камеры тетради')).not.toBeInTheDocument();
  });

  it('does not let an old class request replace the newly opened class camera', async () => {
    const previousPair = deferred<CameraPairing>(); mocks.pair.mockReturnValueOnce(previousPair.promise);
    const { rerender } = render(<NotebookCameraPanel {...studentProps} />);
    await waitFor(() => expect(mocks.pair).toHaveBeenCalledTimes(1));
    mocks.pair.mockResolvedValue({ camera: camera({ cameraId: 'new-class-camera', classId: 'class-2' }), pairingToken: 'new-secret' });
    rerender(<NotebookCameraPanel {...studentProps} classId="class-2" />);
    await waitFor(() => expect(screen.getByTestId('notebook-viewer')).toHaveAttribute('data-camera-id', 'new-class-camera'));
    await act(async () => { previousPair.resolve({ camera: camera(), pairingToken: 'old-secret' }); });
    expect(screen.getByTestId('notebook-viewer')).toHaveAttribute('data-camera-id', 'new-class-camera');
    expect(mocks.pair).toHaveBeenCalledTimes(2);
  });

  it('uses the supplied return label and leaves teacher pairing manual', async () => {
    const close = vi.fn();
    render(<NotebookCameraPanel eventId="trial-event" currentUserId="teacher-1" isTeacher autoPair students={[]} onClose={close} closeLabel="Вернуться к доске" />);
    await act(async () => { await mocks.list.mock.results[0].value; });
    expect(mocks.pair).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Вернуться к доске' })); expect(close).toHaveBeenCalledOnce();
  });
});
