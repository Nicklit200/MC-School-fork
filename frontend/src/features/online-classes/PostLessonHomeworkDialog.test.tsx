import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PostLessonHomeworkDialog } from './PostLessonHomeworkDialog';
import { onlineClassesApi } from '../../api/onlineClasses';

vi.mock('../../api/onlineClasses', () => ({
  onlineClassesApi: { postLessonHomework: vi.fn(), postLessonHomeworkRecipients: vi.fn(), retryPostLessonHomework: vi.fn(), transcribePostLessonHomework: vi.fn() },
}));

describe('PostLessonHomeworkDialog', () => {
  const onDone = vi.fn();
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(onlineClassesApi.postLessonHomeworkRecipients).mockResolvedValue([{id: 'sofia', name:'София'}, {id:'semen', name:'Семён'}]);
    vi.mocked(onlineClassesApi.postLessonHomework).mockResolvedValue({
      state: 'QUEUED', jobId: 'job', classId: 'class',
    });
  });
  afterEach(cleanup);

  it('highlights every day through the selected number, with participants selected by default', async () => {
    render(<PostLessonHomeworkDialog classId="class" title="Группа 1" language="RU" onDone={onDone} />);
    const controls = screen.getByRole('group', { name: 'Количество дней' });
    const buttons = Array.from(controls.querySelectorAll('button'));
    expect(buttons).toHaveLength(7);
    expect(buttons.every(button => button.classList.contains('is-selected'))).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '3' }));
    expect(buttons.map(button => button.classList.contains('is-selected')))
      .toEqual([true, true, true, false, false, false, false]);
    expect(screen.queryByText('День 1')).toBeNull();
    expect(await screen.findByLabelText('София')).toBeChecked();
    expect(screen.getByLabelText('Семён')).toBeChecked();
  });

  it('sends teacher notes and days, then closes only after the server acknowledges the job', async () => {
    render(<PostLessonHomeworkDialog classId="class" title="Группа 1" language="RU" onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: '5' }));
    fireEvent.change(screen.getByPlaceholderText(/Мелиссы сегодня не было/), {
      target: { value: 'Мелиссы сегодня не было, ей не задавай.' },
    });
    await screen.findByLabelText('София');
    fireEvent.click(screen.getByLabelText('София'));
    await screen.findByLabelText('София');
    fireEvent.click(screen.getByRole('button', { name: 'Задать домашнее задание' }));
    await waitFor(() => expect(onlineClassesApi.postLessonHomework).toHaveBeenCalledWith(
      'class', 5, 'Мелиссы сегодня не было, ей не задавай.', ['semen'],
    ));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('keeps the modal open when enqueue fails', async () => {
    vi.mocked(onlineClassesApi.postLessonHomework).mockRejectedValue(new Error('offline'));
    render(<PostLessonHomeworkDialog classId="class" title="Группа 1" language="RU" onDone={onDone} />);
    await screen.findByLabelText('София');
    fireEvent.click(screen.getByRole('button', { name: 'Задать домашнее задание' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Не удалось запустить домашку.'));
    expect(onDone).not.toHaveBeenCalled();
  });

  it('shows a returned failed job instead of reporting success, and retries the saved request only when asked', async () => {
    vi.mocked(onlineClassesApi.postLessonHomework).mockResolvedValue({
      state: 'FAILED', jobId: 'job', classId: 'class', failureCode: 'AI_EMPTY_RESPONSE',
      days: 5, stage: 'AI_CONTENT', dayNumber: 1,
    });
    vi.mocked(onlineClassesApi.retryPostLessonHomework).mockResolvedValue({
      state: 'QUEUED', jobId: 'job', classId: 'class',
    });
    render(<PostLessonHomeworkDialog classId="class" title="Соня" language="RU" onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: '5' }));
    const notes = screen.getByRole('textbox');
    fireEvent.change(notes, { target: { value: 'Повторить нули функций.' } });
    await screen.findByLabelText('София');
    fireEvent.click(screen.getByRole('button', { name: 'Задать домашнее задание' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('не вернул пригодный ответ');
    expect(screen.getByText('Этап: создание заданий, день 1 из 5.')).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
    expect(onlineClassesApi.retryPostLessonHomework).not.toHaveBeenCalled();
    expect(notes).toBeDisabled();
    expect(notes).toHaveValue('Повторить нули функций.');
    expect(screen.getByRole('button', { name: '3' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Повторить создание' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(onlineClassesApi.retryPostLessonHomework).toHaveBeenCalledWith('class');
    expect(onlineClassesApi.postLessonHomework).toHaveBeenCalledTimes(1);
  });

  it('keeps retry failures visible in German and does not close or submit a second job', async () => {
    vi.mocked(onlineClassesApi.postLessonHomework).mockResolvedValue({ state: 'FAILED', failureCode: 'GENERATION_FAILED' });
    vi.mocked(onlineClassesApi.retryPostLessonHomework).mockResolvedValue({ state: 'FAILED', failureCode: 'RENDERER_UNAVAILABLE' });
    render(<PostLessonHomeworkDialog classId="class" title="Sonja" language="DE" onDone={onDone} />);
    await screen.findByLabelText('София');
    fireEvent.click(screen.getByRole('button', { name: 'Hausaufgaben im Hintergrund zuweisen' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Erstellung erneut versuchen' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('PDF-Erstellung ist nicht betriebsbereit'));
    expect(onDone).not.toHaveBeenCalled();
    expect(onlineClassesApi.postLessonHomework).toHaveBeenCalledTimes(1);
  });

  it('does not close when the server returns no job', async () => {
    vi.mocked(onlineClassesApi.postLessonHomework).mockResolvedValue({ state: 'NONE' });
    render(<PostLessonHomeworkDialog classId="class" title="Соня" language="RU" onDone={onDone} />);
    await screen.findByLabelText('София');
    fireEvent.click(screen.getByRole('button', { name: 'Задать домашнее задание' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Сервер не подтвердил запуск');
    expect(onDone).not.toHaveBeenCalled();
  });
});
