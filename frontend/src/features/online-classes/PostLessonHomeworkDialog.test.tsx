import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PostLessonHomeworkDialog } from './PostLessonHomeworkDialog';
import { onlineClassesApi } from '../../api/onlineClasses';

vi.mock('../../api/onlineClasses', () => ({
  onlineClassesApi: { postLessonHomework: vi.fn(), transcribePostLessonHomework: vi.fn() },
}));

describe('PostLessonHomeworkDialog', () => {
  const onDone = vi.fn();
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(onlineClassesApi.postLessonHomework).mockResolvedValue({
      state: 'QUEUED', jobId: 'job', classId: 'class',
    });
  });
  afterEach(cleanup);

  it('highlights every day through the selected number, without extra cards or student selector', () => {
    render(<PostLessonHomeworkDialog classId="class" title="Группа 1" language="RU" onDone={onDone} />);
    const controls = screen.getByRole('group', { name: 'Количество дней' });
    const buttons = Array.from(controls.querySelectorAll('button'));
    expect(buttons).toHaveLength(7);
    expect(buttons.every(button => button.classList.contains('is-selected'))).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '3' }));
    expect(buttons.map(button => button.classList.contains('is-selected')))
      .toEqual([true, true, true, false, false, false, false]);
    expect(screen.queryByText('День 1')).toBeNull();
    expect(screen.queryByText('Всем')).toBeNull();
  });

  it('sends teacher notes and days, then closes only after the server acknowledges the job', async () => {
    render(<PostLessonHomeworkDialog classId="class" title="Группа 1" language="RU" onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: '5' }));
    fireEvent.change(screen.getByPlaceholderText(/Мелиссы сегодня не было/), {
      target: { value: 'Мелиссы сегодня не было, ей не задавай.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Задать домашнее задание' }));
    await waitFor(() => expect(onlineClassesApi.postLessonHomework).toHaveBeenCalledWith(
      'class', 5, 'Мелиссы сегодня не было, ей не задавай.',
    ));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('keeps the modal open when enqueue fails', async () => {
    vi.mocked(onlineClassesApi.postLessonHomework).mockRejectedValue(new Error('offline'));
    render(<PostLessonHomeworkDialog classId="class" title="Группа 1" language="RU" onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: 'Задать домашнее задание' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Не удалось запустить домашку.'));
    expect(onDone).not.toHaveBeenCalled();
  });
});
