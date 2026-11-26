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
  it('switches children and resets the chat before showing another child’s work', async () => {
    vi.mocked(parentApi.children).mockResolvedValue([
      child(),
      child({ studentId: 'child-2', studentName: 'Мелисса', homeworks: [homework({ homeworkId: 'homework-2', filename: 'Уравнения.pdf' })] }),
    ]);
    mountPage();
    expect(await screen.findByText('Дроби')).toBeInTheDocument();
    expect(screen.queryByText('Уравнения')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Открыть чат' }));
    expect(screen.getByRole('region', { name: 'Чат: Семён' })).toHaveAttribute('data-student-id', 'child-1');
    fireEvent.change(screen.getByRole('textbox', { name: 'Черновик сообщения' }), { target: { value: 'Вопрос о дробях' } });

    fireEvent.change(screen.getByRole('combobox', { name: 'Выберите ребёнка' }), { target: { value: 'child-2' } });
    expect(screen.getByText('Уравнения')).toBeInTheDocument();
    expect(screen.queryByText('Дроби')).not.toBeInTheDocument();
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
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-26T23:30:00Z'));
    vi.mocked(parentApi.children).mockResolvedValue([child({ homeworks: [
      homework({ startDate: '2026-11-27', filename: 'Сегодня.pdf', deadlineAt: '2026-11-27T19:00:00Z' }),
      homework({ homeworkId: 'homework-2', startDate: '2026-11-28', filename: 'Завтра.pdf', deadlineAt: '2026-11-28T19:00:00Z' }),
    ] })]);
    mountPage();
    const todayRow = (await screen.findByText('Сегодня')).closest('li');
    const futureRow = screen.getByText('Завтра').closest('li');
    expect(todayRow).not.toBeNull();
    expect(futureRow).not.toBeNull();
    expect(within(todayRow!).getByText('Не выполнено')).toBeInTheDocument();
    expect(within(futureRow!).getByText('Запланировано')).toBeInTheDocument();
    expect(within(futureRow!).queryByText('Просрочено')).not.toBeInTheDocument();
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
