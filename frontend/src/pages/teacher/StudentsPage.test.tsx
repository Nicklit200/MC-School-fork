import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api/client';
import type { StudentListItem } from '../../api/types';
import { I18nProvider } from '../../i18n/I18nContext';
import { StudentsPage } from './StudentsPage';

vi.mock('../../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/client')>();
  return { ...actual, api: { ...actual.api,
    students: { ...actual.api.students, list: vi.fn(), create: vi.fn(), reviewHistory: vi.fn() },
    cards: { ...actual.api.cards, summaryForStudent: vi.fn() },
    homeworks: { ...actual.api.homeworks, listForStudent: vi.fn() },
  } };
});

const student = (id: string, fullName: string, grade: number, status = 'ACTIVE') => ({ id, fullName, grade, status, username: `student-${id}`, schoolType: 'REALSCHULE' } as StudentListItem);
function mount() { return render(<I18nProvider><MemoryRouter><StudentsPage /></MemoryRouter></I18nProvider>); }

describe('teacher student cards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(api.students.list).mockResolvedValue([student('1','Анна',8),student('2','Марк',6),student('3','София',7,'INACTIVE')]);
    vi.mocked(api.cards.summaryForStudent).mockResolvedValue({ total: 4, dueNow: 2, awaitingRepetition: 1, learned: 1 });
    vi.mocked(api.homeworks.listForStudent).mockResolvedValue([]);
    vi.mocked(api.students.reviewHistory).mockResolvedValue([]);
  });

  it('filters students by name and grade without changing the active/inactive counts', async () => {
    mount();
    await screen.findByRole('link', { name: 'Анна' });
    const search = screen.getByRole('searchbox', { name: 'Поиск учеников' });
    fireEvent.change(search, { target: { value: '8' } });
    expect(screen.getByRole('link', { name: 'Анна' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Марк' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Активные · 2' })).toHaveAttribute('aria-pressed','true');
    fireEvent.change(search, { target: { value: 'мар' } });
    expect(screen.getByRole('link', { name: 'Марк' })).toBeInTheDocument();
    fireEvent.change(search, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Неактивные · 1' }));
    expect(screen.getByRole('link', { name: 'София' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Анна' })).not.toBeInTheDocument();
  });

  it('keeps distinct task statuses and preserves the profile/menu actions', async () => {
    mount();
    const card = (await screen.findByRole('link', { name: 'Анна' })).closest('article')!;
    expect(within(card).getByText('Не выполнено')).toBeInTheDocument();
    expect(within(card).getByText('Не задано')).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: 'Открыть профиль →' })).toHaveAttribute('href','/students/1');
    fireEvent.click(within(card).getByRole('button', { name: 'Дополнительные действия' }));
    expect(within(card).getByRole('button', { name: /Изменить имя/ })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: /Задать\/изменить пароль/ })).toBeInTheDocument();
  });

  it('opens the add form on demand and shows the created login after it closes', async () => {
    vi.mocked(api.students.create).mockResolvedValue({ student: student('4','Новый ученик',8), invitationToken: '', invitationExpiresAt: '' });
    mount();
    await screen.findByRole('link', { name: 'Анна' });
    expect(screen.queryByRole('textbox', { name: 'Имя ученика' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '+ Добавить ученика' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Имя ученика' }), { target: { value: 'Новый ученик' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить ученика' }));
    await waitFor(() => expect(api.students.create).toHaveBeenCalledWith('Новый ученик',''));
    expect(await screen.findByRole('status')).toHaveTextContent('student-4');
    expect(screen.queryByRole('textbox', { name: 'Имя ученика' })).not.toBeInTheDocument();
  });

  it('clears loading when the initial request fails', async () => {
    vi.mocked(api.students.list).mockRejectedValue(new Error('Offline'));
    mount();
    await waitFor(() => expect(screen.queryByText('Загрузка…')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: '+ Добавить ученика' })).toBeInTheDocument();
  });
});
