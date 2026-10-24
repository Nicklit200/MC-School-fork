import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiRequestError } from '../../api/client';
import { onlineClassesApi, type OnlineClass } from '../../api/onlineClasses';
import { I18nProvider } from '../../i18n/I18nContext';
import { StudentLessonsCalendarPage } from './StudentLessonsCalendarPage';

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, api: { studentLessons: { list: vi.fn() } } };
});
vi.mock('../../api/onlineClasses', () => ({ onlineClassesApi: { listUpcoming: vi.fn() } }));

const list = vi.mocked(onlineClassesApi.listUpcoming);
const room = (overrides: Partial<OnlineClass> = {}): OnlineClass => ({
  id: 'late-room', eventId: 'yesterday-lesson', bindingKey: 'pupil-1', title: 'Урок математики',
  scheduledStartAt: '2026-10-23T10:00:00Z', scheduledEndAt: '2026-10-23T11:00:00Z',
  studentId: 'pupil-1', groupId: null, status: 'LIVE', waitingRoomEnabled: true,
  studentScreenShareEnabled: false, recordingState: 'INACTIVE', transcriptionState: 'INACTIVE',
  actualStartAt: '2026-10-24T16:00:00Z', actualEndAt: null, viewerIsHost: false,
  joinWindowOpen: true, recordingAvailable: false, transcriptionAvailable: false, ...overrides,
});
function mount() {
  return render(<MemoryRouter><I18nProvider><StudentLessonsCalendarPage /></I18nProvider></MemoryRouter>);
}
async function settle() { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); }

describe('student online lesson discovery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-24T16:05:00Z'));
    vi.clearAllMocks();
    localStorage.setItem('language', 'RU');
    vi.mocked(api.studentLessons.list).mockResolvedValue([]);
    list.mockResolvedValue([]);
    // Student discovery relies on server authorization even in an older web build.
    vi.stubEnv('VITE_MINDCRAFTI_LIVEKIT_ENABLED', 'false');
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllEnvs(); });

  it('shows a late room automatically, including lessons outside the visible calendar week', async () => {
    list.mockResolvedValueOnce([]).mockResolvedValue([room()]);
    const view = mount();
    await settle();
    expect(screen.queryByRole('link', { name: /Mindcrafti Online.*подключиться/ })).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(screen.getByRole('link', { name: /Mindcrafti Online.*подключиться/ })).toHaveAttribute('href', '/online-classes/late-room');
    view.unmount();
    const calls = list.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    window.dispatchEvent(new Event('focus'));
    expect(list).toHaveBeenCalledTimes(calls);
  });

  it('refreshes on focus and removes a room after it ends', async () => {
    list.mockResolvedValueOnce([room()]).mockResolvedValue([room({ status: 'ENDED', joinWindowOpen: false })]);
    mount(); await settle();
    expect(screen.getByRole('link', { name: /Mindcrafti Online.*подключиться/ })).toBeInTheDocument();
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    expect(screen.queryByRole('link', { name: /Mindcrafti Online.*подключиться/ })).not.toBeInTheDocument();
  });

  it('explains a temporary lookup failure and allows a retry', async () => {
    list.mockRejectedValueOnce(new Error('offline')).mockResolvedValue([room()]);
    mount(); await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('Не удалось проверить');
    fireEvent.click(screen.getByRole('button', { name: 'Проверить ещё раз' }));
    await settle();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Mindcrafti Online.*подключиться/ })).toBeInTheDocument();
  });

  it('keeps ineligible pupils out and stops polling when the server denies access', async () => {
    list.mockRejectedValue(new ApiRequestError(404, 'NOT_FOUND', 'Not found'));
    mount(); await settle();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); window.dispatchEvent(new Event('focus')); });
    expect(list).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/когда преподаватель откроет/)).not.toBeInTheDocument();
  });

  it('does not advertise expired rooms or rooms the teacher has not opened', async () => {
    list.mockResolvedValue([room({ joinWindowOpen: false }), room({ id: 'scheduled', status: 'SCHEDULED' })]);
    mount(); await settle();
    expect(screen.queryByRole('link', { name: /Mindcrafti Online.*подключиться/ })).not.toBeInTheDocument();
  });
});
