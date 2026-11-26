import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ParentPage } from './ParentPage';
import { ParentNotifications } from './ParentNotifications';
import { parentApi } from '../../api/parent';
import { api } from '../../api/client';
import type { ParentChildStatus, ParentHomeworkStatus } from '../../api/types';

const i18n = vi.hoisted(() => ({ language: 'RU' as 'RU' | 'DE' }));
vi.mock('../../api/parent', () => ({ parentApi: { children: vi.fn() } }));
vi.mock('../../api/client', () => ({ api: { push: { status: vi.fn(), test: vi.fn() } } }));
vi.mock('../../i18n/I18nContext', () => ({ useI18n: () => i18n }));
vi.mock('../../components/ParentTeacherChat', async () => {
  const { useState } = await import('react');
  return {
    ParentTeacherChat: function MockParentTeacherChat({ studentId, studentName }: { studentId: string; studentName: string }) {
      const [draft, setDraft] = useState('');
      return <section aria-label={`Чат: ${studentName}`} data-student-id={studentId}>
        <textarea aria-label="Черновик сообщения" value={draft} onChange={(event) => setDraft(event.target.value)} />
      </section>;
    },
  };
});

function homework(overrides: Partial<ParentHomeworkStatus> = {}): ParentHomeworkStatus {
  return {
    homeworkId: 'homework-1', startDate: '2026-11-26', hasWorksheet: true,
    filename: 'Дроби.pdf', submitted: false, submittedAt: null,
    deadlineAt: '2026-11-26T19:00:00Z', overdue: false, submittedLate: false,
    totalCards: 0, learnedCards: 0, ...overrides,
  };
}

function child(overrides: Partial<ParentChildStatus> = {}): ParentChildStatus {
  return {
    studentId: 'child-1', studentName: 'Семён', homeworkAssignedToday: 1,
    homeworkCompletedToday: 0, homeworkOpenToday: 1, cardsDueToday: 2,
    homeworks: [homework()], ...overrides,
  };
}

function mountPage() {
  return render(<MemoryRouter initialEntries={['/parent']}><ParentPage /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-26T12:00:00Z'));
  i18n.language = 'RU';
  vi.mocked(parentApi.children).mockResolvedValue([]);
  vi.mocked(api.push.status).mockResolvedValue({
    enabled: true, registeredDevices: 0, ready: false, emailAvailable: false,
  });
  vi.mocked(api.push.test).mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('parent evening reminder setup', () => {
  it('keeps the homework notice compact and links to notification settings', async () => {
    mountPage();
    expect(await screen.findByText('Напоминания о невыполненных заданиях пока не подключены.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Настроить' })).toHaveAttribute('href', '/parent/settings');
    expect(screen.queryByText('У аккаунта также нет email для резервного сообщения.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Проверить уведомление' })).not.toBeInTheDocument();
  });

  it('warns in full settings when nightly push has no connected device and no email fallback', async () => {
    render(<ParentNotifications />);
    expect(await screen.findByText('Вечерние уведомления для этого аккаунта не подключены.')).toBeInTheDocument();
    expect(screen.getByText('У аккаунта также нет email для резервного сообщения.')).toBeInTheDocument();
  });

  it('allows a parent with a registered device to test notification delivery from settings', async () => {
    vi.mocked(api.push.status).mockResolvedValue({
      enabled: true, registeredDevices: 1, ready: true, emailAvailable: false,
    });
    render(<ParentNotifications />);
    fireEvent.click(await screen.findByRole('button', { name: 'Проверить уведомление' }));
    await waitFor(() => expect(api.push.test).toHaveBeenCalledOnce());
    expect(await screen.findByText('Тест отправлен. Проверьте уведомления на устройстве.')).toBeInTheDocument();
  });
});

describe('parent homework dashboard', () => {
  it('switches children and resets the calendar and chat before showing another child’s work', async () => {
    vi.mocked(parentApi.children).mockResolvedValue([
      child({ homeworks: [homework(), homework({ homeworkId: 'october-homework', startDate: '2026-10-01', filename: 'Проценты.pdf', deadlineAt: '2026-10-01T22:00:00Z' })] }),
      child({ studentId: 'child-2', studentName: 'Мелисса', homeworks: [homework({ homeworkId: 'homework-2', filename: 'Уравнения.pdf' })] }),
    ]);
    mountPage();
    expect(await screen.findByText('Дроби')).toBeInTheDocument();
    expect(screen.queryByText('Уравнения')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Открыть чат' }));
    expect(screen.getByRole('region', { name: 'Чат: Семён' })).toHaveAttribute('data-student-id', 'child-1');
    fireEvent.change(screen.getByRole('textbox', { name: 'Черновик сообщения' }), { target: { value: 'Вопрос о дробях' } });
    fireEvent.click(screen.getByRole('button', { name: 'Предыдущий месяц' }));
    expect(screen.getByText('Проценты')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^01\.10\.2026/ })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.change(screen.getByRole('combobox', { name: 'Выберите ребёнка' }), { target: { value: 'child-2' } });
    expect(screen.getByText('Уравнения')).toBeInTheDocument();
    expect(screen.queryByText('Дроби')).not.toBeInTheDocument();
    expect(screen.queryByText('Проценты')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^26\.11\.2026/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('region', { name: 'Чат: Семён' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Черновик сообщения' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Открыть чат' })).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'Открыть чат' }));
    expect(screen.getByRole('region', { name: 'Чат: Мелисса' })).toHaveAttribute('data-student-id', 'child-2');
    expect(screen.getByRole('textbox', { name: 'Черновик сообщения' })).toHaveValue('');
  });

  it('replaces generated PDF names with a readable label and retains descriptive filenames', async () => {
    const generated = 'Mindcrafti_Hausaufgabe_2026-11-27_Tag_7_26fc34ca-3f3e-4772-956e-7319a4d31ab2.pdf';
    vi.mocked(parentApi.children).mockResolvedValue([child({ homeworks: [
      homework({ filename: generated }),
      homework({ homeworkId: 'homework-2', filename: 'Дроби_и_знаки.pdf' }),
    ] })]);
    mountPage();
    expect(await screen.findByText('Рабочий лист')).toBeInTheDocument();
    expect(screen.getByText('Дроби и знаки')).toBeInTheDocument();
    expect(screen.queryByText(generated, { exact: false })).not.toBeInTheDocument();
    expect(screen.queryByText(/26fc34ca-3f3e-4772-956e-7319a4d31ab2/)).not.toBeInTheDocument();
  });

  it('uses the Berlin calendar day to distinguish today’s assignment from scheduled work', async () => {
    vi.setSystemTime(new Date('2026-11-26T23:30:00Z'));
    vi.mocked(parentApi.children).mockResolvedValue([child({ homeworks: [
      homework({ startDate: '2026-11-27', filename: 'Задание на сегодня.pdf', deadlineAt: '2026-11-27T23:00:00Z' }),
      homework({ homeworkId: 'homework-2', startDate: '2026-11-28', filename: 'Задание на завтра.pdf', deadlineAt: '2026-11-28T23:00:00Z' }),
    ] })]);
    mountPage();
    const todayRow = (await screen.findByText('Задание на сегодня')).closest('.parent-dashboard__homework');
    expect(todayRow).not.toBeNull();
    expect(screen.getByRole('button', { name: /^27\.11\.2026/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^27\.11\.2026/ })).toHaveAttribute('aria-current', 'date');
    expect(within(todayRow! as HTMLElement).getByText('Нужно сделать сегодня')).toHaveAttribute('data-status', 'TODAY');
    expect(screen.queryByText('Задание на завтра')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^28\.11\.2026/ }));
    const futureRow = screen.getByText('Задание на завтра').closest('.parent-dashboard__homework');
    expect(futureRow).not.toBeNull();
    expect(within(futureRow! as HTMLElement).getByText('Запланировано')).toHaveAttribute('data-status', 'UPCOMING');
    expect(within(futureRow! as HTMLElement).queryByText('Не сдано')).not.toBeInTheDocument();
    expect(screen.queryByText('Задание на сегодня')).not.toBeInTheDocument();
  });

  it('counts only the displayed month and opens every assignment on a selected day', async () => {
    vi.mocked(parentApi.children).mockResolvedValue([child({ homeworks: [
      homework(),
      homework({ homeworkId: 'on-time', startDate: '2026-11-25', filename: 'Сложение дробей.pdf', submitted: true, submittedAt: '2026-11-25T17:00:00Z', deadlineAt: '2026-11-25T23:00:00Z', totalCards: 6, learnedCards: 4 }),
      homework({ homeworkId: 'late', startDate: '2026-11-25', filename: 'Вычитание дробей.pdf', submitted: true, submittedAt: '2026-11-26T00:00:00Z', deadlineAt: '2026-11-25T23:00:00Z', submittedLate: true }),
      homework({ homeworkId: 'missed', startDate: '2026-11-24', filename: 'Умножение дробей.pdf', deadlineAt: '2026-11-24T23:00:00Z', overdue: true }),
      homework({ homeworkId: 'previous-month', startDate: '2026-10-25', filename: 'Проценты.pdf', submitted: true, submittedAt: '2026-10-25T17:00:00Z', deadlineAt: '2026-10-25T23:00:00Z' }),
    ] })]);
    mountPage();
    const calendar = await screen.findByRole('region', { name: 'Календарь домашки' });
    expect(screen.getByRole('heading', { name: 'История домашки' })).toBeInTheDocument();
    expect(within(calendar).getByRole('button', { name: /^26\.11\.2026/ })).toHaveAttribute('aria-pressed', 'true');
    const summary = calendar.querySelector('.homework-calendar__summary')!;
    expect(summary.querySelector('[data-status="DONE"] strong')).toHaveTextContent(/^1$/);
    expect(summary.querySelector('[data-status="MISSED"] strong')).toHaveTextContent(/^1$/);
    expect(summary.querySelector('[data-status="LATE"] strong')).toHaveTextContent(/^1$/);
    expect(screen.getByText('Дроби')).toBeInTheDocument();
    expect(screen.queryByText('Сложение дробей')).not.toBeInTheDocument();

    const selectedDay = within(calendar).getByRole('button', { name: /^25\.11\.2026/ });
    expect(selectedDay).toHaveAccessibleName(/Сдано вовремя: 1/);
    expect(selectedDay).toHaveAccessibleName(/Сдано с опозданием: 1/);
    fireEvent.click(selectedDay);
    const details = within(calendar).getByRole('region', { name: /^Задания на 25 ноября 2026/ });
    expect(details.querySelectorAll('.parent-dashboard__homework')).toHaveLength(2);
    const onTimeRow = within(details).getByText('Сложение дробей').closest<HTMLElement>('.parent-dashboard__homework')!;
    expect(within(onTimeRow).getByText('Сдано вовремя')).toHaveAttribute('data-status', 'DONE');
    expect(within(onTimeRow).getByText(/Сдано: 25\.11, 18:00/)).toHaveTextContent('Карточек изучено: 4/6');
    const lateRow = within(details).getByText('Вычитание дробей').closest<HTMLElement>('.parent-dashboard__homework')!;
    expect(within(lateRow).getByText('Сдано с опозданием')).toHaveAttribute('data-status', 'LATE');
    expect(screen.queryByText('Дроби')).not.toBeInTheDocument();
    expect(screen.queryByText('Проценты')).not.toBeInTheDocument();
    expect(parentApi.children).toHaveBeenCalledOnce();
  });

  it('navigates months, returns to today, and shows the selected day’s deadline or empty state', async () => {
    vi.mocked(parentApi.children).mockResolvedValue([child({ homeworks: [
      homework(),
      homework({ homeworkId: 'october', startDate: '2026-10-01', filename: 'Проценты.pdf', deadlineAt: '2026-10-01T22:00:00Z' }),
      homework({ homeworkId: 'december', startDate: '2026-12-01', filename: 'Десятичные дроби.pdf', deadlineAt: '2026-12-01T23:00:00Z' }),
    ] })]);
    mountPage();
    const calendar = await screen.findByRole('region', { name: 'Календарь домашки' });
    fireEvent.click(within(calendar).getByRole('button', { name: 'Следующий месяц' }));
    expect(within(calendar).getByRole('button', { name: /^01\.12\.2026/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Десятичные дроби')).toBeInTheDocument();
    expect(screen.queryByText('Дроби')).not.toBeInTheDocument();

    fireEvent.click(within(calendar).getByRole('button', { name: 'Предыдущий месяц' }));
    expect(within(calendar).getByRole('button', { name: /^26\.11\.2026/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(calendar).getByRole('button', { name: 'Предыдущий месяц' }));
    expect(within(calendar).getByRole('button', { name: /^01\.10\.2026/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Проценты')).toBeInTheDocument();

    fireEvent.click(within(calendar).getByRole('button', { name: 'Сегодня' }));
    expect(within(calendar).getByRole('button', { name: /^26\.11\.2026/ })).toHaveAttribute('aria-pressed', 'true');
    const todayRow = screen.getByText('Дроби').closest<HTMLElement>('.parent-dashboard__homework')!;
    expect(within(todayRow).getByText(/Срок сдачи: 26\.11, 20:00/)).toBeInTheDocument();
    fireEvent.click(within(calendar).getByRole('button', { name: /^25\.11\.2026/ }));
    expect(within(calendar).getByText('На этот день домашнего задания нет.')).toBeInTheDocument();
    expect(calendar.querySelectorAll('.parent-dashboard__homework')).toHaveLength(0);
    expect(parentApi.children).toHaveBeenCalledOnce();
  });

  it('keeps card progress out of worksheet submission counts and preserves worksheet status with incomplete cards', async () => {
    vi.mocked(parentApi.children).mockResolvedValue([child({ homeworks: [
      homework({ submitted: true, submittedAt: '2026-11-26T10:00:00Z', totalCards: 4, learnedCards: 1 }),
      homework({ homeworkId: 'cards-done', startDate: '2026-11-25', hasWorksheet: false, filename: null, deadlineAt: '2026-11-25T23:00:00Z', totalCards: 10, learnedCards: 10, overdue: true }),
      homework({ homeworkId: 'cards-open', startDate: '2026-11-24', hasWorksheet: false, filename: null, deadlineAt: '2026-11-24T23:00:00Z', totalCards: 10, learnedCards: 2, overdue: true }),
      homework({ homeworkId: 'cards-future', startDate: '2026-11-28', hasWorksheet: false, filename: null, deadlineAt: '2026-11-28T23:00:00Z', totalCards: 10, learnedCards: 0 }),
    ] })]);
    mountPage();
    const calendar = await screen.findByRole('region', { name: 'Календарь домашки' });
    const summary = calendar.querySelector('.homework-calendar__summary')!;
    expect(summary.querySelector('[data-status="DONE"] strong')).toHaveTextContent(/^1$/);
    expect(summary.querySelector('[data-status="MISSED"] strong')).toHaveTextContent(/^0$/);
    expect(summary.querySelector('[data-status="LATE"] strong')).toHaveTextContent(/^0$/);
    const worksheet = screen.getByText('Дроби').closest<HTMLElement>('.parent-dashboard__homework')!;
    expect(within(worksheet).getByText('Сдано вовремя')).toHaveAttribute('data-status', 'DONE');
    expect(within(worksheet).getByText(/Карточек изучено: 1\/4/)).toBeInTheDocument();
    expect(within(calendar).getByRole('button', { name: /^25\.11\.2026/ })).toHaveAttribute('data-status', 'CARDS_DONE');
    expect(within(calendar).getByRole('button', { name: /^24\.11\.2026/ })).toHaveAttribute('data-status', 'CARDS_OPEN');
    expect(within(calendar).getByRole('button', { name: /^28\.11\.2026/ })).toHaveAttribute('data-status', 'UPCOMING');

    fireEvent.click(within(calendar).getByRole('button', { name: /^25\.11\.2026/ }));
    let details = within(calendar).getByRole('region', { name: /^Задания на 25 ноября 2026/ });
    expect(within(details).getByText('Карточки изучены')).toHaveAttribute('data-status', 'CARDS_DONE');
    expect(within(details).getByText('Карточек изучено: 10/10')).toBeInTheDocument();
    expect(within(details).queryByText(/Срок сдачи:/)).not.toBeInTheDocument();
    fireEvent.click(within(calendar).getByRole('button', { name: /^24\.11\.2026/ }));
    details = within(calendar).getByRole('region', { name: /^Задания на 24 ноября 2026/ });
    expect(within(details).getByText('Нужно повторить карточки')).toHaveAttribute('data-status', 'CARDS_OPEN');
    expect(within(details).getByText('Карточек изучено: 2/10')).toBeInTheDocument();
    expect(within(details).queryByText('Не сдано')).not.toBeInTheDocument();
  });

  it('shows a localized German calendar and day-empty state for a child with no homework', async () => {
    i18n.language = 'DE';
    vi.mocked(parentApi.children).mockResolvedValue([child({ homeworks: [], homeworkAssignedToday: 0, homeworkOpenToday: 0 })]);
    mountPage();
    const calendar = await screen.findByRole('region', { name: 'Hausaufgaben-Kalender' });
    expect(screen.getByRole('heading', { name: 'Hausaufgaben-Verlauf' })).toBeInTheDocument();
    expect(within(calendar).getByRole('button', { name: /^26\.11\.2026/ })).toHaveAttribute('aria-pressed', 'true');
    expect(within(calendar).getByRole('button', { name: 'Heute' })).toBeInTheDocument();
    expect(within(calendar).getByRole('button', { name: 'Vorheriger Monat' })).toBeInTheDocument();
    expect(within(calendar).getByRole('button', { name: 'Nächster Monat' })).toBeInTheDocument();
    expect(within(calendar).getByText('Keine Hausaufgaben an diesem Tag.')).toBeInTheDocument();
    expect(calendar.querySelectorAll('.parent-dashboard__homework')).toHaveLength(0);
  });

  it('localizes loading and the no-linked-child state in German', async () => {
    i18n.language = 'DE';
    mountPage();
    expect(screen.getByRole('heading', { name: 'Hausaufgaben', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('Laden…')).toBeInTheDocument();
    expect(await screen.findByText('Diesem Konto ist noch kein Kind zugeordnet.')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByText('Hausaufgaben-Verlauf')).not.toBeInTheDocument();
  });

  it('shows a load error in the German view without misreporting an unlinked child', async () => {
    i18n.language = 'DE';
    vi.mocked(parentApi.children).mockRejectedValue(new Error('Die Aufgaben konnten nicht geladen werden.'));
    mountPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Die Aufgaben konnten nicht geladen werden.');
    expect(screen.getByRole('heading', { name: 'Hausaufgaben', level: 1 })).toBeInTheDocument();
    expect(screen.queryByText('Laden…')).not.toBeInTheDocument();
    expect(screen.queryByText('Diesem Konto ist noch kein Kind zugeordnet.')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });
});
