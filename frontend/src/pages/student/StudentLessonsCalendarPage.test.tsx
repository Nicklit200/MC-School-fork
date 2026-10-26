import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiRequestError } from '../../api/client';
import { onlineClassesApi, type OnlineClass } from '../../api/onlineClasses';
import { I18nProvider } from '../../i18n/I18nContext';
import { StudentLessonsCalendarPage } from './StudentLessonsCalendarPage';

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, api: { studentLessons: { list: vi.fn(), sharedDocument: vi.fn() } } };
});
vi.mock('../../api/onlineClasses', () => ({ onlineClassesApi: { listUpcoming: vi.fn() } }));

const list = vi.mocked(onlineClassesApi.listUpcoming);
const room = (overrides: Partial<OnlineClass> = {}): OnlineClass => ({
  id: 'late-room', eventId: 'yesterday-lesson', bindingKey: 'pupil-1', title: 'Урок математики',
  scheduledStartAt: '2026-10-23T10:00:00Z', scheduledEndAt: '2026-10-23T11:00:00Z',
  studentId: 'pupil-1', groupId: null, status: 'LIVE', waitingRoomEnabled: true,
  studentScreenShareEnabled: false, recordingState: 'INACTIVE', transcriptionState: 'INACTIVE',
  actualStartAt: '2026-10-23T10:00:00Z', actualEndAt: null, viewerIsHost: false,
  viewerHasJoined: true, entryState: 'RECONNECT',
  joinWindowOpen: true, recordingAvailable: false, transcriptionAvailable: false, ...overrides,
});
const scheduledLessons = [
  { eventId: 'available', title: 'Уравнения', groupName: 'Группа 8', startsAt: '2026-10-26T16:00:00Z', endsAt: '2026-10-26T17:00:00Z', meetUrl: 'https://meet.google.com/example', hasSharedDocument: true, sharedDocumentFilename: 'lesson.pdf' },
  { eventId: 'waiting', title: 'Дроби', groupName: null, startsAt: '2026-10-27T16:00:00Z', endsAt: '2026-10-27T17:00:00Z', meetUrl: null, hasSharedDocument: false, sharedDocumentFilename: null },
];
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
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it('shows an ongoing previous-day room only for its returning participant', async () => {
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

  it('does not advertise a legacy previous-day grant to someone who never entered', async () => {
    list.mockResolvedValue([room({ viewerHasJoined: false, entryState: undefined })]);
    mount(); await settle();
    expect(screen.queryByRole('link', { name: /Mindcrafti Online/ })).not.toBeInTheDocument();
  });

  it('shows waiting and the entry date for a lesson the teacher has not opened', async () => {
    vi.mocked(api.studentLessons.list).mockResolvedValue([{
      ...scheduledLessons[0], eventId: 'today', startsAt: '2026-10-24T16:00:00Z', endsAt: '2026-10-24T17:00:00Z',
    }]);
    mount(); await settle();
    const card = within(screen.getByRole('heading', { name: scheduledLessons[0].title }).closest('article')!);
    expect(card.queryByRole('link', { name: /Mindcrafti Online/ })).not.toBeInTheDocument();
    expect(card.getByRole('status')).toHaveTextContent('Ожидаем учителя');
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

  it('places native lessons on their Berlin date and shows their actual start time', async () => {
    vi.mocked(api.studentLessons.list).mockResolvedValue([{
      eventId: 'local-oct24', title: 'Урок на субботу', groupName: null,
      startsAt: '2026-10-23T22:00:00Z', endsAt: '2026-10-23T23:00:00Z', meetUrl: null,
      hasSharedDocument: false, sharedDocumentFilename: null,
    }]);
    mount(); await settle();
    expect(screen.getByText('Урок на субботу')).toBeInTheDocument();
    expect(screen.getByText('00:00')).toBeInTheDocument();
    expect(screen.getByText('00:00–01:00')).toBeInTheDocument();
  });

  it('keeps document and notebook actions but blocks first entry for a future lesson', async () => {
    vi.mocked(api.studentLessons.list).mockResolvedValue(scheduledLessons);
    list.mockResolvedValue([room({ id: 'available-room', eventId: 'available', title: 'Уравнения',
      scheduledStartAt: scheduledLessons[0].startsAt, scheduledEndAt: scheduledLessons[0].endsAt,
      viewerHasJoined: false, entryState: 'DAY_CLOSED', joinWindowOpen: false })]);
    mount(); await settle();
    const picker = screen.getByRole('group', { name: 'Выбери день недели' });
    expect(within(picker).getAllByRole('button')).toHaveLength(7);
    expect(within(picker).getByRole('button', { name: /24 октября/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('heading', { name: 'Уравнения' })).not.toBeInTheDocument();
    fireEvent.click(within(picker).getByRole('button', { name: /26 октября/ }));
    const card = within(screen.getByRole('heading', { name: 'Уравнения' }).closest('article')!);
    expect(card.getByRole('button', { name: 'Общий документ' })).toBeEnabled();
    expect(card.getByRole('link', { name: 'Подключиться к уроку' })).toHaveAttribute('href', scheduledLessons[0].meetUrl);
    expect(card.queryByRole('link', { name: /Mindcrafti Online/ })).not.toBeInTheDocument();
    expect(card.getByText(/Вход доступен только/)).toBeInTheDocument();
    expect(card.getByRole('link', { name: 'Камера тетради' })).toHaveAttribute('href', '/lesson-notebook/available');
    // The older package used a client flag. The server remains authoritative.
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('keeps missing actions disabled and retains the selected week day after a month view', async () => {
    vi.mocked(api.studentLessons.list).mockResolvedValue(scheduledLessons);
    mount(); await settle();
    fireEvent.click(within(screen.getByRole('group', { name: 'Выбери день недели' })).getByRole('button', { name: /27 октября/ }));
    const unavailable = screen.getByRole('button', { name: 'Документ ещё не готов' });
    expect(unavailable).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Ссылка на урок ещё не готова' })).toBeDisabled();
    fireEvent.click(unavailable);
    expect(api.studentLessons.sharedDocument).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Месяц' }));
    const month = screen.getByRole('group', { name: 'Выбери день' });
    expect(within(month).getAllByRole('button')).toHaveLength(42);
    fireEvent.click(within(month).getByRole('button', { name: /26 октября/ }));
    expect(screen.getByRole('button', { name: 'Общий документ' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Неделя' }));
    expect(screen.getByRole('heading', { name: 'Дроби' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Документ ещё не готов' })).toBeDisabled();
    expect(within(screen.getByRole('group', { name: 'Выбери день недели' })).getByRole('button', { name: /27 октября/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('changes calendar months and keeps native lessons on their Berlin date in month view', async () => {
    vi.mocked(api.studentLessons.list).mockResolvedValue([{
      eventId: 'local-oct24', title: 'Урок на субботу', groupName: null,
      startsAt: '2026-10-23T22:00:00Z', endsAt: '2026-10-23T22:45:00Z', meetUrl: null,
      hasSharedDocument: false, sharedDocumentFilename: null,
    }]);
    mount(); await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Месяц' }));
    const month = screen.getByRole('group', { name: 'Выбери день' });
    expect(within(month).getByRole('button', { name: /24 октября/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('00:00')).toBeInTheDocument();
    expect(screen.getByText('00:00–00:45')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Следующий месяц' }));
    expect(screen.getByRole('heading', { name: /Ноябрь 2026/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Урок на субботу' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Предыдущий месяц' }));
    expect(screen.getByRole('heading', { name: 'Урок на субботу' })).toBeInTheDocument();
  });

  it('pauses background discovery and refreshes when the pupil returns to the page', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    list.mockResolvedValueOnce([]).mockResolvedValue([room()]);
    mount(); await settle();
    visibility.mockReturnValue('hidden');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(20_000); });
    expect(list).toHaveBeenCalledTimes(1);
    visibility.mockReturnValue('visible');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(list).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('link', { name: /Mindcrafti Online.*подключиться/ })).toBeInTheDocument();
  });
});
