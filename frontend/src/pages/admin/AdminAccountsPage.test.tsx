import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api/client';
import type { AdminAccount, TeacherAssignmentOption, User } from '../../api/types';
import { I18nProvider } from '../../i18n/I18nContext';
import { AdminAccountsPage } from './AdminAccountsPage';

vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ setUser: vi.fn() }) }));
vi.mock('../../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/client')>();
  return { ...actual, api: { ...actual.api,
    adminAccounts: { ...actual.api.adminAccounts, list: vi.fn(), teacherOptions: vi.fn(), assignTeacher: vi.fn(), transferStudents: vi.fn() },
    teachers: { ...actual.api.teachers, list: vi.fn() },
  } };
});

const oldTeacher = { id: 'old-teacher', fullName: 'Прежний учитель', role: 'TEACHER', status: 'ACTIVE' } as User;
const newTeacher = { id: 'new-teacher', fullName: 'Новый учитель', role: 'TEACHER', status: 'ACTIVE' } as User;
const student = { id: 'student', fullName: 'Анна', username: 'anna', role: 'STUDENT', status: 'ACTIVE',
  teacherId: oldTeacher.id, teacherFullName: oldTeacher.fullName } as AdminAccount;
const parent = { id: 'parent', fullName: 'Родитель Анны', role: 'PARENT', status: 'ACTIVE',
  teacherId: oldTeacher.id, teacherFullName: oldTeacher.fullName } as AdminAccount;
const teacherOptions: TeacherAssignmentOption[] = [oldTeacher, newTeacher]
  .map(({ id, fullName, status }) => ({ id, fullName, status, archived: false }));

function renderPage() {
  return render(<I18nProvider><MemoryRouter><AdminAccountsPage /></MemoryRouter></I18nProvider>);
}

describe('admin account loading and teacher transfer', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
    localStorage.setItem('language', 'RU');
    vi.mocked(api.adminAccounts.list).mockImplementation(async (role) => role === 'STUDENT' ? [student] : [parent]);
    vi.mocked(api.teachers.list).mockResolvedValue([oldTeacher, newTeacher]);
    vi.mocked(api.adminAccounts.teacherOptions).mockResolvedValue(teacherOptions);
  });

  it('keeps loaded students and transfer controls when only parents fail to load', async () => {
    vi.mocked(api.adminAccounts.list).mockImplementation(async (role) => {
      if (role === 'PARENT') throw new Error('server unavailable');
      return [student];
    });
    renderPage();

    expect(await screen.findByRole('button', { name: 'Ученики (1)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Родители (—)' })).toBeInTheDocument();
    expect(screen.getByText('Анна')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Не удалось загрузить: родители.');
    expect(screen.getByRole('combobox', { name: 'Назначенный учитель' })).toBeEnabled();
    expect(screen.getByRole('combobox', { name: 'От кого передаём' })).toBeEnabled();
    expect(screen.queryByText('Учеников пока нет.')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Родители (—)' }));
    expect(screen.getByText('Список родителей не загружен.')).toBeInTheDocument();
    expect(screen.queryByText('Родителей пока нет.')).not.toBeInTheDocument();
  });

  it('shows an unknown student count and retries instead of presenting a failed request as an empty school', async () => {
    vi.mocked(api.adminAccounts.list).mockImplementation(async (role) => {
      if (role === 'STUDENT') throw new Error('server unavailable');
      return [parent];
    });
    renderPage();
    expect(screen.getByRole('button', { name: 'Ученики (…)' })).toBeInTheDocument();
    expect(await screen.findByText('Список учеников не загружен.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ученики (—)' })).toBeInTheDocument();
    expect(screen.queryByText('Учеников пока нет.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Передать 0 учеников/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Передать учеников' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'От кого передаём' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Родители (1)' }));
    expect(screen.getByText('Родитель Анны')).toBeInTheDocument();
    vi.mocked(api.adminAccounts.list).mockImplementation(async (role) => role === 'STUDENT' ? [student] : [parent]);
    await userEvent.click(screen.getByRole('button', { name: 'Повторить загрузку' }));
    await screen.findByRole('button', { name: 'Ученики (1)' });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Ученики (1)' }));
    expect(screen.getByText('Анна')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Назначенный учитель' })).toHaveValue(oldTeacher.id);
  });

  it.each(['teachers', 'teacherOptions'] as const)('only disables the transfer controls requiring failed %s data', async (resource) => {
    if (resource === 'teachers') vi.mocked(api.teachers.list).mockRejectedValue(new Error('server unavailable'));
    else vi.mocked(api.adminAccounts.teacherOptions).mockRejectedValue(new Error('server unavailable'));
    renderPage();
    await screen.findByText('Анна');
    const single = screen.getByRole('combobox', { name: 'Назначенный учитель' });
    const bulk = screen.getByRole('combobox', { name: 'От кого передаём' });
    if (resource === 'teachers') {
      expect(single).toBeDisabled();
      expect(bulk).toBeEnabled();
    } else {
      expect(single).toBeEnabled();
      expect(bulk).toBeDisabled();
    }
    expect(screen.getByRole('button', { name: 'Ученики (1)' })).toBeInTheDocument();
  });

  it('preserves a selected teacher across a retry and transfers only the chosen student', async () => {
    vi.mocked(api.adminAccounts.list).mockImplementation(async (role) => {
      if (role === 'PARENT') throw new Error('server unavailable');
      return [student];
    });
    const transferred = { ...student, teacherId: newTeacher.id, teacherFullName: newTeacher.fullName };
    vi.mocked(api.adminAccounts.assignTeacher).mockResolvedValue({ student: transferred,
      copiedFutureLessons: 1, transferredGroups: 0, futureGroupLessonsNotTransferred: 0 });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      renderPage();
      await screen.findByText('Анна');
      await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Назначенный учитель' }), newTeacher.id);
      await userEvent.click(screen.getByRole('button', { name: 'Повторить загрузку' }));
      await waitFor(() => expect(screen.getByRole('combobox', { name: 'Назначенный учитель' })).toHaveValue(newTeacher.id));
      await userEvent.click(screen.getByRole('button', { name: 'Передать ученика' }));
      await waitFor(() => expect(api.adminAccounts.assignTeacher).toHaveBeenCalledWith(student.id, newTeacher.id));
      expect(api.adminAccounts.transferStudents).not.toHaveBeenCalled();
      expect(await screen.findByText('Учитель: Новый учитель')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Передать ученика' })).toBeDisabled();
    } finally { confirm.mockRestore(); }
  });

  it('keeps the bulk workflow available when the independent parent list failed', async () => {
    vi.mocked(api.adminAccounts.list).mockImplementation(async (role) => {
      if (role === 'PARENT') throw new Error('server unavailable');
      return [student];
    });
    vi.mocked(api.adminAccounts.transferStudents).mockResolvedValue({ fromTeacherId: oldTeacher.id,
      fromTeacherName: oldTeacher.fullName, toTeacherId: newTeacher.id, toTeacherName: newTeacher.fullName,
      transferredStudents: 1, transferredGroups: 0, copiedFutureLessons: 2, groupsWithLessonsNotTransferred: 0 });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      renderPage();
      await screen.findByText('Анна');
      await userEvent.selectOptions(screen.getByRole('combobox', { name: 'От кого передаём' }), oldTeacher.id);
      await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Кому передаём' }), newTeacher.id);
      await userEvent.click(screen.getByRole('button', { name: 'Передать 1 учеников' }));
      await waitFor(() => expect(api.adminAccounts.transferStudents).toHaveBeenCalledWith(oldTeacher.id, newTeacher.id));
      expect(api.adminAccounts.assignTeacher).not.toHaveBeenCalled();
      expect(await screen.findByText('Учитель: Новый учитель')).toBeInTheDocument();
      expect(screen.getByRole('combobox', { name: 'Назначенный учитель' })).toHaveValue(newTeacher.id);
    } finally { confirm.mockRestore(); }
  });
});
