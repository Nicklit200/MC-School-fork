import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiRequestError } from '../api/client';
import { onlineClassesApi } from '../api/onlineClasses';
import type { User } from '../api/types';
import { resetOnlineClassesAvailability } from '../features/online-classes/useOnlineClassesAvailable';
import { I18nProvider } from '../i18n/I18nContext';
import { Layout } from './Layout';

let role: 'TEACHER' | 'STUDENT' | 'PARENT' | 'ADMIN' = 'TEACHER';
let userId = 'teacher';
const authActions = vi.hoisted(() => ({ logout: vi.fn(), setUser: vi.fn() }));

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: userId, role, fullName: 'Test', status: 'ACTIVE' },
    ...authActions,
  }),
}));
vi.mock('../api/onlineClasses', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/onlineClasses')>();
  return { ...actual, onlineClassesApi: { ...actual.onlineClassesApi, listUpcoming: vi.fn() } };
});

function mount(path = '/') {
  return render(
    <I18nProvider>
      <MemoryRouter initialEntries={[path]}>
        <Layout><p>page</p></Layout>
      </MemoryRouter>
    </I18nProvider>,
  );
}

describe('Layout: role designs and server-controlled online classroom navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('language', 'RU');
    sessionStorage.clear();
    resetOnlineClassesAvailability();
    role = 'TEACHER';
    userId = 'teacher';
    vi.mocked(onlineClassesApi.listUpcoming).mockResolvedValue([]);
  });
  afterEach(() => { sessionStorage.clear(); vi.unstubAllEnvs(); });

  it('uses a full-width content area only for the admin Stories workspace', () => {
    role = 'ADMIN';
    const { container, unmount } = mount('/admin/stories');
    expect(container.querySelector('main.content')).toHaveClass('content--stories-workspace');
    unmount();
    const otherPage = mount('/admin/accounts');
    expect(otherPage.container.querySelector('main.content')).not.toHaveClass('content--stories-workspace');
  });

  it('gives a teacher the shared online classes link when the server enables it', async () => {
    mount();
    expect(await screen.findByRole('link', { name: 'Онлайн-уроки' })).toHaveAttribute('href', '/teacher/lessons');
    expect(screen.getByRole('navigation', { name: 'Основная навигация' })).toBeInTheDocument();
  });

  it('gives a student the same server-authorized online classes entry', async () => {
    role = 'STUDENT';
    mount();
    expect(await screen.findByRole('link', { name: 'Онлайн-уроки' })).toHaveAttribute('href', '/online-classes');
  });

  it('does not restrict a server-authorized teacher to the old pilot id or build flag', async () => {
    userId = 'not-the-pilot';
    vi.stubEnv('VITE_MINDCRAFTI_LIVEKIT_ENABLED', 'false');
    mount();
    expect(await screen.findByRole('link', { name: 'Онлайн-уроки' })).toHaveAttribute('href', '/teacher/lessons');
  });

  it.each([403, 404])('hides the student classroom shortcut when the server rejects availability with %s', async (status) => {
    role = 'STUDENT';
    vi.mocked(onlineClassesApi.listUpcoming).mockRejectedValue(new ApiRequestError(status, 'NOT_FOUND', 'Unavailable'));
    mount();
    await waitFor(() => expect(onlineClassesApi.listUpcoming).toHaveBeenCalledOnce());
    expect(screen.queryByRole('link', { name: 'Онлайн-уроки' })).not.toBeInTheDocument();
  });

  it.each(['PARENT', 'ADMIN'] as const)('never probes online classrooms for %s', (nextRole) => {
    role = nextRole;
    mount();
    expect(onlineClassesApi.listUpcoming).not.toHaveBeenCalled();
    expect(screen.queryByRole('link', { name: 'Онлайн-уроки' })).not.toBeInTheDocument();
  });

  it('does not expose a dead-end teacher homework shortcut', async () => {
    mount();
    await screen.findByRole('link', { name: 'Онлайн-уроки' });
    expect(screen.queryByRole('link', { name: 'Домашние задания' })).not.toBeInTheDocument();
  });

  it('opens the additional sections, traps focus, and returns it on Escape', async () => {
    mount();
    await screen.findByRole('link', { name: 'Онлайн-уроки' });
    const more = screen.getByRole('button', { name: 'Показать меню' });
    fireEvent.click(more);
    const dialog = screen.getByRole('dialog', { name: 'Разделы кабинета' });
    const close = within(dialog).getByRole('button', { name: 'Закрыть меню' });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(within(dialog).getByRole('button', { name: 'Выйти' })).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(more).toHaveFocus();
  });

  it('closes the additional menu when navigating and keeps the official logo', async () => {
    mount();
    await screen.findByRole('link', { name: 'Онлайн-уроки' });
    expect(screen.getAllByRole('img', { name: 'Mindcrafti School' })[0]).toHaveAttribute('src', '/brand/Mindcrafti_Logo_M_OFFICIAL.webp');
    fireEvent.click(screen.getByRole('button', { name: 'Показать меню' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('link', { name: 'Родители' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('uses the student design with existing pupil routes and the available online classes', async () => {
    role = 'STUDENT';
    const { container } = mount();
    await screen.findByRole('link', { name: 'Онлайн-уроки' });
    expect(container.querySelector('.student-shell')).toBeInTheDocument();
    expect(container.querySelector('.teacher-shell')).not.toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Основная навигация' });
    expect(within(nav).getAllByRole('link').map(link => link.getAttribute('href'))).toEqual([
      '/today', '/my-cards', '/student/homeworks', '/student/lessons', '/online-classes', '/settings',
    ]);
    expect(screen.queryByRole('link', { name: 'Мой прогресс' })).not.toBeInTheDocument();
  });

  it('translates the student menu and keeps logout working', async () => {
    role = 'STUDENT';
    localStorage.setItem('language', 'DE');
    mount();
    await screen.findByRole('link', { name: 'Online-Unterricht' });
    expect(screen.getByRole('link', { name: 'Mein Unterricht' })).toHaveAttribute('href', '/student/lessons');
    fireEvent.click(screen.getByRole('button', { name: 'Abmelden' }));
    expect(authActions.logout).toHaveBeenCalledOnce();
  });

  it.each(['STUDENT', 'PARENT'] as const)('can return to the administrator from the %s design', async (nextRole) => {
    role = nextRole;
    sessionStorage.setItem('mindcrafti.impersonation.adminToken', 'test-admin-token');
    sessionStorage.setItem('mindcrafti.impersonation.returnTo', '/admin/accounts');
    const admin = { id: 'admin', fullName: 'Admin', role: 'ADMIN', preferredLanguage: 'RU' } as User;
    vi.spyOn(api.auth, 'me').mockResolvedValue(admin);
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Вернуться в админку' }));
    await waitFor(() => expect(authActions.setUser).toHaveBeenCalledWith(admin));
    expect(sessionStorage.getItem('mindcrafti.impersonation.adminToken')).toBeNull();
    expect(authActions.logout).not.toHaveBeenCalled();
  });

  it('uses the existing student design for parent navigation without exposing pupil actions', () => {
    role = 'PARENT';
    const { container } = mount('/parent/settings');
    expect(container.querySelector('.student-shell')).toHaveAttribute('data-variant', 'parent');
    expect(container.querySelector('.teacher-shell')).not.toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Основная навигация' });
    expect(within(nav).getAllByRole('link').map(link => link.getAttribute('href'))).toEqual([
      '/parent', '/parent/settings', '/parent/skills',
    ]);
    expect(within(nav).getByRole('link', { name: 'Настройки' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('link', { name: 'Мои карточки' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Выйти' }));
    expect(authActions.logout).toHaveBeenCalledOnce();
  });

  it('keeps administrators outside the student theme', () => {
    role = 'ADMIN';
    const { container } = mount();
    expect(container.querySelector('.student-shell')).not.toBeInTheDocument();
    expect(container.querySelector('.teacher-shell')).not.toBeInTheDocument();
  });
});
