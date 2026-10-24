// @vitest-environment-options {"url":"https://school.example"}
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotebookCameraPanel } from './NotebookCameraPanel';

const mocks = vi.hoisted(() => ({ list: vi.fn(), pair: vi.fn() }));
vi.mock('../../api/notebookCameras', async () => {
  const actual = await vi.importActual<typeof import('../../api/notebookCameras')>('../../api/notebookCameras');
  return { ...actual, notebookCamerasApi: { list: mocks.list, pair: mocks.pair } };
});
vi.mock('./cameraModules', () => ({ drawCameraQR: vi.fn(async () => {}) }));
vi.mock('./NotebookCameraViewer', () => ({ NotebookCameraViewer: () => <div>Изображение тетради</div> }));
beforeEach(() => {
  vi.clearAllMocks(); mocks.list.mockResolvedValue([]);
  mocks.pair.mockResolvedValue({ camera: { cameraId: 'camera-1', eventId: 'trial-event', ownerId: 'teacher-1', ownerName: 'Учитель', status: 'PAIRING',
    pairingExpiresAt: new Date(Date.now() + 300000).toISOString(), sessionExpiresAt: new Date(Date.now() + 10800000).toISOString() }, pairingToken: 'single-use-secret' });
});
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
