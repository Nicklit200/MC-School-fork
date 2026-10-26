import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiRequestError } from '../../api/client';
import type { GroupLesson, StudentGroup, StudentListItem, User } from '../../api/types';
import { I18nProvider } from '../../i18n/I18nContext';
import { GroupLessonsPage } from './GroupLessonsPage';
import { lessonDayInstant, schoolDateKey } from '../../lib/lessonSchedule';

vi.mock('../../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/client')>();
  return { ...actual, api: { ...actual.api,
    auth: { ...actual.api.auth, me: vi.fn() },
    lessons: { ...actual.api.lessons, groupLessons: vi.fn(), googleCalendarConnection: vi.fn(), create: vi.fn(), createSeries: vi.fn(), deleteLesson: vi.fn() },
    students: { ...actual.api.students, list: vi.fn() },
    groups: { ...actual.api.groups, list: vi.fn() },
  } };
});

const lessonApi = vi.mocked(api.lessons);
const trialNameLabel = 'Имя ученика';
const durationLabel = 'Длительность урока, минут';
const timeLabel = 'Время начала (Берлин)';

function lesson(title = 'Математика без Google'): GroupLesson {
  const start = lessonDayInstant(schoolDateKey(new Date()), 12);
  return { eventId: 'local-lesson', bindingKey: 'local-lesson', title,
    groupId: null, groupName: null, studentId: null, studentName: null, participantStudentIds: [],
    startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 3600_000).toISOString(),
    meetUrl: null, calendarUrl: null };
}

function renderPage() {
  return render(<I18nProvider><MemoryRouter><GroupLessonsPage /></MemoryRouter></I18nProvider>);
}

async function chooseTarget(value: string) {
  const kind = value === 'trial' ? 'Пробный' : value.startsWith('group:') ? 'Группа' : 'Ученик';
  await userEvent.click(screen.getByRole('tab', { name: kind }));
  if (value === 'trial') return;
  await userEvent.click(screen.getByRole('combobox', { name: kind === 'Группа' ? 'Найти группу' : 'Найти ученика' }));
  const option = screen.getAllByRole('option').find((item) => item.getAttribute('data-value') === value);
  if (!option) throw new Error('Missing participant option: ' + value);
  await userEvent.click(option);
}

describe('native lesson schedule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('language', 'RU');
    vi.mocked(api.auth.me).mockResolvedValue({ id: 'teacher', fullName: 'Teacher' } as User);
    vi.mocked(api.students.list).mockResolvedValue([]);
    vi.mocked(api.groups.list).mockResolvedValue([]);
    lessonApi.googleCalendarConnection.mockResolvedValue({ connected: false, authorizationUrl: null });
    lessonApi.groupLessons.mockResolvedValue([]);
    lessonApi.create.mockResolvedValue(lesson());
    lessonApi.createSeries.mockResolvedValue([lesson()]);
    lessonApi.deleteLesson.mockResolvedValue(undefined);
  });

  it('deletes a test lesson only after confirmation and refreshes the timetable', async () => {
    lessonApi.groupLessons.mockResolvedValueOnce([lesson()]).mockResolvedValue([]);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      renderPage();
      await screen.findByText('Математика без Google');
      await userEvent.click(screen.getByRole('button', { name: /Настройки урока/ }));
      await userEvent.click(screen.getByRole('button', { name: 'Удалить урок' }));
      await waitFor(() => expect(lessonApi.deleteLesson).toHaveBeenCalledWith('local-lesson'));
      await waitFor(() => expect(screen.queryByText('Математика без Google')).not.toBeInTheDocument());
      expect(confirm).toHaveBeenCalledOnce();
    } finally { confirm.mockRestore(); }
  });

  it('keeps lessons visible when deletion is rejected as a conflict', async () => {
    lessonApi.groupLessons.mockResolvedValue([lesson()]);
    lessonApi.deleteLesson.mockRejectedValue(new ApiRequestError(409, 'CONFLICT', 'Online class open'));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      renderPage();
      await screen.findByText('Математика без Google');
      await userEvent.click(screen.getByRole('button', { name: /Настройки урока/ }));
      await userEvent.click(screen.getByRole('button', { name: 'Удалить урок' }));
      await waitFor(() => expect(screen.getByText(/Не удалось удалить урок из-за конфликта/)).toBeInTheDocument());
      expect(screen.getByText('Математика без Google')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Повторить загрузку' })).not.toBeInTheDocument();
    } finally { confirm.mockRestore(); }
  });

  it('does not remove an unconfirmed lesson', async () => {
    lessonApi.groupLessons.mockResolvedValue([lesson()]);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    try {
      renderPage();
      await screen.findByText('Математика без Google');
      await userEvent.click(screen.getByRole('button', { name: /Настройки урока/ }));
      await userEvent.click(screen.getByRole('button', { name: 'Удалить урок' }));
      expect(lessonApi.deleteLesson).not.toHaveBeenCalled();
      expect(screen.getByText('Математика без Google')).toBeInTheDocument();
    } finally { confirm.mockRestore(); }
  });

  it('shows the selected-day agenda and week controls without Google', async () => {
    lessonApi.groupLessons.mockResolvedValue([lesson()]);
    renderPage();
    expect(await screen.findByText('Математика без Google')).toBeInTheDocument();
    expect(lessonApi.groupLessons).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Запланировать урок' })).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Выбрать день уроков' })).getAllByRole('button')).toHaveLength(7);
    expect(screen.getByRole('button', { name: 'Следующая неделя' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Открыть урок' })).toHaveAttribute('href', '/teacher/lessons/local-lesson');
    expect(screen.queryByRole('button', { name: 'Начать урок' })).not.toBeInTheDocument();
    expect(screen.getByText('60 мин')).toBeInTheDocument();
    expect(screen.getByText('12:00')).toBeInTheDocument();
  });

  it('keeps the scheduled time visible for imported Google lessons', async () => {
    const imported = { ...lesson('Google lesson'), eventId: 'google-event', bindingKey: 'google-event' };
    lessonApi.groupLessons.mockResolvedValue([imported]);
    renderPage();
    await screen.findByText('Google lesson');
    expect(screen.getByText('12:00')).toBeInTheDocument();
    expect(screen.queryByText('60 мин')).not.toBeInTheDocument();
  });

  it('does not hide the schedule when optional Google connection lookup fails', async () => {
    lessonApi.googleCalendarConnection.mockRejectedValue(new Error('Google unavailable'));
    lessonApi.groupLessons.mockResolvedValue([lesson()]);
    renderPage();
    expect(await screen.findByText('Математика без Google')).toBeInTheDocument();
  });

  it('creates a trial with a date, name-based title and 45-minute duration', async () => {
    const trialTitle = 'Пробный урок · Анна Петрова';
    lessonApi.create.mockResolvedValue(lesson(trialTitle));
    lessonApi.groupLessons.mockResolvedValueOnce([]).mockResolvedValue([lesson(trialTitle)]);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Запланировать урок' }));
    expect(screen.queryByLabelText('Название урока')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Окончание урока')).not.toBeInTheDocument();
    expect(screen.getByLabelText(timeLabel)).toHaveAttribute('type', 'time');
    expect(screen.getByLabelText('Дата урока')).toHaveAttribute('type', 'date');
    await chooseTarget('trial');
    fireEvent.change(screen.getByLabelText(timeLabel), { target: { value: '13:00' } });
    await userEvent.type(screen.getByLabelText(trialNameLabel), 'Анна Петрова');
    fireEvent.change(screen.getByLabelText('Дата урока'), { target: { value: '2026-11-10' } });
    fireEvent.change(screen.getByLabelText(timeLabel), { target: { value: '16:30' } });
    fireEvent.change(screen.getByLabelText(durationLabel), { target: { value: '45' } });
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить урок' }));
    await waitFor(() => expect(lessonApi.create).toHaveBeenCalledOnce());
    const payload = lessonApi.create.mock.calls[0][0];
    expect(payload).toMatchObject({ title: trialTitle, groupId: null, studentId: null });
    expect(payload.startsAt).toBe('2026-11-10T15:30:00.000Z');
    expect(payload.endsAt).toBe('2026-11-10T16:15:00.000Z');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Урок создан: ' + trialTitle));
    expect(lessonApi.groupLessons).toHaveBeenCalledTimes(2);
    expect(screen.getAllByRole('link', { name: 'Открыть урок' })).toHaveLength(2);
  });

  it('uses the selected student name and keeps selection and duration when saving fails', async () => {
    vi.mocked(api.students.list).mockResolvedValue([{ id: 'student-1', fullName: 'Локальный ученик' } as StudentListItem]);
    lessonApi.create.mockRejectedValue(new Error('Network unavailable'));
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Запланировать урок' }));
    await chooseTarget('student:student-1');
    fireEvent.change(screen.getByLabelText(timeLabel), { target: { value: '14:00' } });
    fireEvent.change(screen.getByLabelText(durationLabel), { target: { value: '90' } });
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить урок' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(lessonApi.create).toHaveBeenCalledWith(expect.objectContaining({ title: 'Локальный ученик', groupId: null, studentId: 'student-1' }));
    expect(screen.getByRole('combobox', { name: 'Найти ученика' })).toHaveValue('Локальный ученик');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByLabelText(durationLabel)).toHaveValue(90);
    expect(screen.getByLabelText(timeLabel)).toHaveValue('14:00');
    expect(screen.getByRole('button', { name: 'Сохранить урок' })).toBeEnabled();
    expect(screen.queryByLabelText(trialNameLabel)).not.toBeInTheDocument();
  });

  it('uses the group name and selects a created lesson outside this week', async () => {
    const future = lesson('Тестовая группа');
    const date = new Date();
    date.setDate(date.getDate() + 20);
    future.startsAt = date.toISOString();
    future.endsAt = new Date(date.getTime() + 3600_000).toISOString();
    lessonApi.create.mockResolvedValue(future);
    lessonApi.groupLessons.mockResolvedValueOnce([]).mockResolvedValue([future]);
    vi.mocked(api.groups.list).mockResolvedValue([{ id: 'group-1', name: 'Тестовая группа', students: [] } as unknown as StudentGroup]);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Запланировать урок' }));
    await chooseTarget('group:group-1');
    fireEvent.change(screen.getByLabelText(timeLabel), { target: { value: '15:00' } });
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить урок' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Урок создан: Тестовая группа'));
    expect(lessonApi.create).toHaveBeenCalledWith(expect.objectContaining({ title: 'Тестовая группа', groupId: 'group-1', studentId: null }));
    expect(screen.getByLabelText('Перейти к дате')).toHaveValue(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('requires a target and a positive whole-minute duration before posting', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Запланировать урок' }));
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить урок' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Выберите');
    expect(lessonApi.create).not.toHaveBeenCalled();
    await chooseTarget('trial');
    await userEvent.type(screen.getByLabelText(trialNameLabel), 'Анна Петрова');
    for (const value of ['0', '-5', '1.5', '1441']) {
      fireEvent.change(screen.getByLabelText(durationLabel), { target: { value } });
      await userEvent.click(screen.getByRole('button', { name: 'Сохранить урок' }));
      expect(screen.getByLabelText(durationLabel)).toBeInvalid();
    }
    expect(lessonApi.create).not.toHaveBeenCalled();
  });

  it('requires a nonblank trial name without creating a lesson', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Запланировать урок' }));
    await chooseTarget('trial');
    await userEvent.type(screen.getByLabelText(trialNameLabel), '   ');
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить урок' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Укажите имя ученика');
    expect(lessonApi.create).not.toHaveBeenCalled();
  });

  it('previews a month of Thursdays and saves it with one series request', async () => {
    vi.mocked(api.groups.list).mockResolvedValue([{ id: 'group-1', name: 'Группа 1', students: [] } as unknown as StudentGroup]);
    const created = ['2026-10-22', '2026-10-29', '2026-11-05', '2026-11-12', '2026-11-19'].map((date, index) => ({
      ...lesson('Группа 1'), eventId: 'local-series-' + index,
      startsAt: new Date(date + 'T00:00:00').toISOString(), endsAt: new Date(new Date(date + 'T00:00:00').getTime() + 3600_000).toISOString(),
    }));
    lessonApi.createSeries.mockResolvedValue(created);
    lessonApi.groupLessons.mockResolvedValueOnce([]).mockResolvedValue(created);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Запланировать урок' }));
    await chooseTarget('group:group-1');
    fireEvent.change(screen.getByLabelText('Дата урока'), { target: { value: '2026-10-22' } });
    await userEvent.click(screen.getByRole('button', { name: 'Месяц', pressed: false }));
    expect(screen.getByRole('checkbox', { name: 'Четверг' })).toBeChecked();
    expect(screen.getByRole('list', { name: 'Даты уроков' }).children).toHaveLength(5);
    expect(screen.getByRole('status')).toHaveTextContent('Период: 22.10.2026 — 21.11.2026');
    await userEvent.click(screen.getByRole('button', { name: 'Создать серию (5)' }));
    await waitFor(() => expect(lessonApi.createSeries).toHaveBeenCalledOnce());
    expect(lessonApi.createSeries).toHaveBeenCalledWith({ title: 'Группа 1', startDate: '2026-10-22', startTime: '15:00', durationMinutes: 60, period: 'MONTH', weekdays: [4], groupId: 'group-1', studentId: null });
    expect(lessonApi.create).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Создано уроков: 5'));
  });

  it('requires a weekday for a series and can return to a single lesson', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Запланировать урок' }));
    await chooseTarget('trial');
    await userEvent.type(screen.getByLabelText(trialNameLabel), 'Анна Петрова');
    fireEvent.change(screen.getByLabelText('Дата урока'), { target: { value: '2026-10-22' } });
    await userEvent.click(screen.getByRole('button', { name: '2 недели' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Четверг' }));
    await userEvent.click(screen.getByRole('button', { name: 'Создать серию (0)' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Выберите хотя бы один день недели');
    expect(lessonApi.createSeries).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Один урок' }));
    expect(screen.queryByRole('checkbox', { name: 'Четверг' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить урок' }));
    await waitFor(() => expect(lessonApi.create).toHaveBeenCalledOnce());
    expect(lessonApi.createSeries).not.toHaveBeenCalled();
  });

  it('keeps repeat options and selected dates after a failed series request', async () => {
    lessonApi.createSeries.mockRejectedValue(new Error('Network failure'));
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Запланировать урок' }));
    await chooseTarget('trial');
    await userEvent.type(screen.getByLabelText(trialNameLabel), 'Анна Петрова');
    fireEvent.change(screen.getByLabelText('Дата урока'), { target: { value: '2026-10-22' } });
    await userEvent.click(screen.getByRole('button', { name: '3 недели' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Понедельник' }));
    await userEvent.click(screen.getByRole('button', { name: 'Создать серию (6)' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '3 недели' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('checkbox', { name: 'Четверг' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Понедельник' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Создать серию (6)' })).toBeEnabled();
  });

  it('does not carry a trial name into a regular group lesson', async () => {
    vi.mocked(api.groups.list).mockResolvedValue([{ id: 'group-1', name: 'Группа 1', students: [] } as unknown as StudentGroup]);
    lessonApi.create.mockRejectedValue(new Error('Keep the form open'));
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Запланировать урок' }));
    await chooseTarget('trial');
    await userEvent.type(screen.getByLabelText(trialNameLabel), 'Анна Петрова');
    await chooseTarget('group:group-1');
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить урок' }));
    await screen.findByRole('alert');
    expect(lessonApi.create).toHaveBeenCalledWith(expect.objectContaining({ title: 'Группа 1', groupId: 'group-1', studentId: null }));
    await chooseTarget('trial');
    expect(screen.getByLabelText(trialNameLabel)).toHaveValue('');
  });
  it('opens planning above the page, traps focus and restores the trigger on Escape while preserving a draft', async () => {
    const view = renderPage();
    const trigger = await screen.findByRole('button', { name: 'Запланировать урок' });
    await waitFor(() => expect(trigger).toBeEnabled());
    await userEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Запланировать урок' });
    const close = within(dialog).getByRole('button', { name: 'Закрыть планирование' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(document.body.style.overflow).toBe('hidden');
    expect(view.container).toHaveAttribute('inert');
    expect(close).toHaveFocus();
    await chooseTarget('trial');
    await userEvent.type(screen.getByLabelText(trialNameLabel), 'Анна Петрова');
    fireEvent.change(screen.getByLabelText(durationLabel), { target: { value: '90' } });
    close.focus();
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('button', { name: 'Сохранить урок' })).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(document.body.style.overflow).toBe('');
    expect(view.container).not.toHaveAttribute('inert');
    await userEvent.click(trigger);
    expect(screen.getByLabelText(trialNameLabel)).toHaveValue('Анна Петрова');
    expect(screen.getByLabelText(durationLabel)).toHaveValue(90);
    expect(lessonApi.create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('dialog').parentElement!);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('navigates across weeks and shows only lessons on the selected date', async () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const shifted = (days: number, title: string): GroupLesson => {
      const start = new Date(today + 'T12:00:00'); start.setDate(start.getDate() + days);
      return { ...lesson(title), eventId: 'local-' + days, startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 3600_000).toISOString() };
    };
    lessonApi.groupLessons.mockResolvedValue([shifted(-7, 'Прошлая неделя'), shifted(7, 'Следующая неделя')]);
    renderPage();
    await screen.findByText('На этот день уроков нет');
    expect(screen.queryByRole('heading', { name: 'Следующая неделя' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Следующая неделя' }));
    expect(screen.getByRole('heading', { name: 'Следующая неделя' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Прошлая неделя' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Предыдущая неделя' }));
    await userEvent.click(screen.getByRole('button', { name: 'Предыдущая неделя' }));
    expect(screen.getByRole('heading', { name: 'Прошлая неделя' })).toBeInTheDocument();
    expect(screen.getByText('Прошедший')).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Выбрать день уроков' })).getByRole('button', { pressed: true })).toBeInTheDocument();
  });

  it('starts planning on the selected day and restores body scrolling when unmounted', async () => {
    const view = renderPage();
    const trigger = await screen.findByRole('button', { name: 'Запланировать урок' });
    await waitFor(() => expect(trigger).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Перейти к дате'), { target: { value: '2026-11-19' } });
    await userEvent.click(trigger);
    expect(screen.getByLabelText('Дата урока')).toHaveValue('2026-11-19');
    view.unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('keeps the imported Meet launch and binding controls available in lesson settings', async () => {
    lessonApi.groupLessons.mockResolvedValue([{ ...lesson('Google lesson'), eventId: 'google-event', meetUrl: 'https://meet.google.com/test', calendarUrl: 'https://calendar.google.com/' }]);
    renderPage();
    await screen.findByText('Google lesson');
    expect(screen.getByRole('link', { name: 'Открыть урок' })).toHaveAttribute('href', '/teacher/lessons/google-event');
    await userEvent.click(screen.getByRole('button', { name: 'Настройки урока: Google lesson' }));
    expect(screen.getByRole('button', { name: 'Начать урок' })).toBeInTheDocument();
    expect(screen.getByLabelText('Группа или ученик для этого события')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Google Calendar' })).toHaveAttribute('href', 'https://calendar.google.com/');
  });

  it('keeps the drawer open and prevents duplicate submission while the save is pending', async () => {
    let finishSave!: (value: GroupLesson) => void;
    lessonApi.create.mockImplementation(() => new Promise((resolve) => { finishSave = resolve; }));
    renderPage();
    const trigger = await screen.findByRole('button', { name: 'Запланировать урок' });
    await waitFor(() => expect(trigger).toBeEnabled());
    await userEvent.click(trigger);
    await chooseTarget('trial');
    await userEvent.type(screen.getByLabelText(trialNameLabel), 'Анна Петрова');
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить урок' }));
    const dialog = screen.getByRole('dialog');
    expect(screen.getByRole('button', { name: 'Закрыть планирование' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Сохраняем…' })).toBeDisabled();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    fireEvent.click(dialog.parentElement!);
    expect(dialog).toBeInTheDocument();
    expect(lessonApi.create).toHaveBeenCalledOnce();
    finishSave(lesson('Сохранённый пробный урок'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(document.body.style.overflow).toBe('');
    expect(trigger).toHaveFocus();
  });

  it('opens student and group lists only on request, searches and closes after choosing', async () => {
    vi.mocked(api.students.list).mockResolvedValue([
      { id: 'anna', fullName: 'Анна Иванова', username: 'anna8', grade: 8, status: 'ACTIVE' },
      { id: 'mark', fullName: 'Марк', username: 'mark6', grade: 6, status: 'ACTIVE' },
      { id: 'inactive', fullName: 'Бывший ученик', status: 'INACTIVE' },
    ] as StudentListItem[]);
    vi.mocked(api.groups.list).mockResolvedValue([{ id: 'group-1', name: 'Математика 8', students: [{ id: 'anna', fullName: 'Анна Иванова' }] }] as StudentGroup[]);
    renderPage();
    const trigger = await screen.findByRole('button', { name: 'Запланировать урок' });
    await waitFor(() => expect(trigger).toBeEnabled());
    await userEvent.click(trigger);
    const search = screen.getByRole('combobox', { name: 'Найти ученика' });
    expect(search).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    await userEvent.click(search);
    expect(screen.getAllByRole('option')).toHaveLength(2);
    expect(screen.queryByRole('option', { name: 'Бывший ученик' })).not.toBeInTheDocument();
    fireEvent.change(search, { target: { value: '8' } });
    expect(screen.getByRole('option', { name: 'Анна Иванова' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Марк' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('option', { name: 'Анна Иванова' }));
    expect(search).toHaveValue('Анна Иванова');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    await userEvent.click(search);
    expect(screen.getAllByRole('option')).toHaveLength(2);
    expect(screen.getByRole('option', { name: 'Анна Иванова' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.change(search, { target: { value: 'не существует' } });
    expect(screen.getByText(/Ничего не найдено/)).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Дата урока'));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(search).toHaveValue('Анна Иванова');
    await userEvent.click(screen.getByRole('tab', { name: 'Группа' }));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    const groupSearch = screen.getByRole('combobox', { name: 'Найти группу' });
    await userEvent.click(groupSearch);
    fireEvent.change(groupSearch, { target: { value: 'Анна' } });
    await userEvent.click(screen.getByRole('option', { name: 'Математика 8' }));
    expect(groupSearch).toHaveValue('Математика 8');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    lessonApi.create.mockRejectedValue(new Error('Keep form open'));
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить урок' }));
    await screen.findByRole('alert');
    expect(lessonApi.create).toHaveBeenCalledWith(expect.objectContaining({ title: 'Математика 8', groupId: 'group-1', studentId: null }));
  });

  it('selects with the keyboard and dismisses the list with Escape without closing planning', async () => {
    vi.mocked(api.students.list).mockResolvedValue([
      { id: 'anna', fullName: 'Анна', status: 'ACTIVE' },
      { id: 'mark', fullName: 'Марк', status: 'ACTIVE' },
    ] as StudentListItem[]);
    renderPage();
    const trigger = await screen.findByRole('button', { name: 'Запланировать урок' });
    await waitFor(() => expect(trigger).toBeEnabled());
    await userEvent.click(trigger);
    const search = screen.getByRole('combobox', { name: 'Найти ученика' });
    await userEvent.click(search);
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(search).toHaveValue('Марк');
    expect(search).toHaveFocus();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(lessonApi.create).not.toHaveBeenCalled();
    await userEvent.keyboard('{ArrowDown}{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(search).toHaveValue('Марк');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('supports category keyboard navigation, empty lists and trial entry without any students', async () => {
    renderPage();
    const trigger = await screen.findByRole('button', { name: 'Запланировать урок' });
    await waitFor(() => expect(trigger).toBeEnabled());
    await userEvent.click(trigger);
    const studentTab = screen.getByRole('tab', { name: 'Ученик' });
    studentTab.focus();
    fireEvent.keyDown(studentTab, { key: 'ArrowRight' });
    const groupTab = screen.getByRole('tab', { name: 'Группа' });
    expect(groupTab).toHaveFocus();
    expect(groupTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByText(/Групп пока нет/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('combobox', { name: 'Найти группу' }));
    expect(screen.getByText(/Групп пока нет/)).toBeInTheDocument();
    fireEvent.keyDown(groupTab, { key: 'End' });
    expect(screen.getByRole('tab', { name: 'Пробный' })).toHaveFocus();
    expect(screen.getByLabelText(trialNameLabel)).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Телефон ученика или родителя')).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Пробный' }), { key: 'Home' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('combobox', { name: 'Найти ученика' }));
    expect(screen.getByText(/Учеников пока нет/)).toBeInTheDocument();
  });

});
