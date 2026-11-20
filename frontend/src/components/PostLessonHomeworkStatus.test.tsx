import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PostLessonHomeworkStatus } from './PostLessonHomeworkStatus';
import { onlineClassesApi, type OnlineClass, type PostLessonHomeworkJob } from '../api/onlineClasses';

const auth = vi.hoisted(() => ({
  user: { id: '14e3c7c1-1fc8-41bd-858a-6c20efdd957a', role: 'TEACHER' },
}));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../api/onlineClasses', () => ({
  onlineClassesApi: { findByEvent: vi.fn(), postLessonHomeworkStatus: vi.fn(), retryPostLessonHomework: vi.fn() },
}));

function room(id: string, actualEndAt: string | null, scheduledEndAt = '2026-11-20T16:00:00Z'): OnlineClass {
  return {
    id, eventId: 'event', bindingKey: 'event', title: 'Соня',
    scheduledStartAt: '2026-11-20T15:00:00Z', scheduledEndAt, actualEndAt, actualStartAt: null,
    studentId: 'student', groupId: null, status: 'ENDED', waitingRoomEnabled: true,
    studentScreenShareEnabled: false, recordingState: 'INACTIVE', transcriptionState: 'INACTIVE',
    viewerIsHost: true, joinWindowOpen: false, recordingAvailable: false, transcriptionAvailable: true,
  };
}

describe('PostLessonHomeworkStatus', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    auth.user = { id: '14e3c7c1-1fc8-41bd-858a-6c20efdd957a', role: 'TEACHER' };
    vi.mocked(onlineClassesApi.findByEvent).mockResolvedValue([room('class', '2026-11-20T16:00:00Z')]);
    vi.mocked(onlineClassesApi.postLessonHomeworkStatus).mockResolvedValue({ state: 'NONE' });
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('loads the latest ended room, even when the API lists an older room first', async () => {
    vi.mocked(onlineClassesApi.findByEvent).mockResolvedValue([
      room('older', '2026-11-20T15:30:00Z'),
      room('latest', '2026-11-20T16:05:00Z'),
      room('scheduled-fallback', null),
    ]);
    vi.mocked(onlineClassesApi.postLessonHomeworkStatus).mockResolvedValue({
      state: 'FAILED', failureCode: 'AI_EMPTY_RESPONSE', generatedFiles: 0, expectedFiles: 7,
      stage: 'AI_CONTENT', dayNumber: 1, days: 7,
    });
    render(<PostLessonHomeworkStatus eventId="event" de={false} />);
    expect(await screen.findByText('Ошибка генерации')).toBeInTheDocument();
    expect(onlineClassesApi.postLessonHomeworkStatus).toHaveBeenCalledWith('latest');
    expect(onlineClassesApi.postLessonHomeworkStatus).not.toHaveBeenCalledWith('older');
    expect(screen.getByText('0 / 7 PDF')).toBeInTheDocument();
    expect(screen.getByText('Этап: создание заданий, день 1 из 7.')).toBeInTheDocument();
    expect(screen.getByText(/не вернул пригодный ответ/)).toBeInTheDocument();
    expect(screen.queryByText('AI_EMPTY_RESPONSE')).not.toBeInTheDocument();
  });

  it('shows an initial status error and lets the teacher recover by refreshing', async () => {
    vi.mocked(onlineClassesApi.postLessonHomeworkStatus).mockRejectedValueOnce(new Error('offline'));
    render(<PostLessonHomeworkStatus eventId="event" de={false} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить статус домашки.');
    vi.mocked(onlineClassesApi.postLessonHomeworkStatus).mockResolvedValue({ state: 'QUEUED' });
    fireEvent.click(screen.getByRole('button', { name: 'Обновить статус' }));
    expect(await screen.findByText('В очереди')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('uses scheduled end time when an ended room has no actual end timestamp', async () => {
    vi.mocked(onlineClassesApi.findByEvent).mockResolvedValue([
      room('older', '2026-11-20T16:00:00Z'),
      room('legacy-latest', null, '2026-11-20T17:00:00Z'),
    ]);
    render(<PostLessonHomeworkStatus eventId="event" de={false} />);
    await waitFor(() => expect(onlineClassesApi.postLessonHomeworkStatus).toHaveBeenCalledWith('legacy-latest'));
    expect(onlineClassesApi.postLessonHomeworkStatus).not.toHaveBeenCalledWith('older');
  });

  it('shows a discovery failure before any classroom or job is loaded', async () => {
    vi.mocked(onlineClassesApi.findByEvent).mockRejectedValue(new Error('offline'));
    render(<PostLessonHomeworkStatus eventId="event" de />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Hausaufgabenstatus konnte nicht geladen werden');
    expect(screen.getByRole('button', { name: 'Status aktualisieren' })).toBeInTheDocument();
    expect(onlineClassesApi.postLessonHomeworkStatus).not.toHaveBeenCalled();
  });

  it('keeps a confirmed retry queued when an older status poll completes late', async () => {
    vi.useFakeTimers();
    let resolvePoll!: (job: PostLessonHomeworkJob) => void;
    vi.mocked(onlineClassesApi.postLessonHomeworkStatus)
      .mockResolvedValueOnce({ state: 'FAILED', failureCode: 'GENERATION_FAILED' })
      .mockImplementationOnce(() => new Promise(resolve => { resolvePoll = resolve; }));
    vi.mocked(onlineClassesApi.retryPostLessonHomework).mockResolvedValue({ state: 'QUEUED' });
    render(<PostLessonHomeworkStatus eventId="event" de={false} />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText('Ошибка генерации')).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Повторить' })); });
    expect(screen.getByText('В очереди')).toBeInTheDocument();
    await act(async () => { resolvePoll({ state: 'FAILED', failureCode: 'GENERATION_FAILED' }); });
    expect(screen.getByText('В очереди')).toBeInTheDocument();
    expect(screen.queryByText('Ошибка генерации')).not.toBeInTheDocument();
  });

  it('reports an unsuccessful retry without claiming that the job restarted', async () => {
    vi.mocked(onlineClassesApi.postLessonHomeworkStatus).mockResolvedValue({ state: 'FAILED', failureCode: 'AI_TIMEOUT' });
    vi.mocked(onlineClassesApi.retryPostLessonHomework).mockRejectedValue(new Error('offline'));
    render(<PostLessonHomeworkStatus eventId="event" de={false} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Повторный запуск не подтверждён'));
    expect(screen.getByText('Ошибка генерации')).toBeInTheDocument();
    expect(screen.queryByText('В очереди')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeEnabled();
  });

  it('does not fetch private pilot status for other teachers', () => {
    auth.user = { id: 'another-teacher', role: 'TEACHER' };
    const { container } = render(<PostLessonHomeworkStatus eventId="event" de={false} />);
    expect(container).toBeEmptyDOMElement();
    expect(onlineClassesApi.findByEvent).not.toHaveBeenCalled();
  });
});
