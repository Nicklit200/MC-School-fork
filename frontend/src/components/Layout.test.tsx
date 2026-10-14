import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../api/client';
import { onlineClassesApi } from '../api/onlineClasses';
import { I18nProvider } from '../i18n/I18nContext';
import { resetOnlineClassesAvailability } from '../features/online-classes/useOnlineClassesAvailable';
import { Layout } from './Layout';

let role: 'TEACHER' | 'STUDENT' | 'PARENT' | 'ADMIN' = 'TEACHER';
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: `user-${role}`, role, fullName: 'Test', status: 'ACTIVE' },
    logout: vi.fn(),
    setUser: vi.fn(),
  }),
}));
vi.mock('../api/onlineClasses', async () => {
  const actual = await vi.importActual<typeof import('../api/onlineClasses')>('../api/onlineClasses');
  return { ...actual, onlineClassesApi: { listUpcoming: vi.fn() } };
});

const api = vi.mocked(onlineClassesApi);

// The teacher sidebar starts collapsed; open it the way a teacher would.
function openTeacherMenu() {
  fireEvent.click(screen.getByRole('button', { name: 'Показать меню' }));
}

function mount() {
  return render(
    <I18nProvider>
      <MemoryRouter>
        <Layout>
          <p>page</p>
        </Layout>
      </MemoryRouter>
    </I18nProvider>,
  );
}

describe('Layout: the online classes menu entry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetOnlineClassesAvailability();
    role = 'TEACHER';
  });

  it('gives a teacher a link to their online classes when the feature is on', async () => {
    api.listUpcoming.mockResolvedValue([]);
    mount();
    openTeacherMenu();
    const link = await screen.findByRole('link', { name: 'Онлайн-уроки' });
    expect(link).toHaveAttribute('href', '/online-classes');
  });

  it('gives a student the same link', async () => {
    role = 'STUDENT';
    api.listUpcoming.mockResolvedValue([]);
    mount();
    expect(await screen.findByRole('link', { name: 'Онлайн-уроки' })).toHaveAttribute('href', '/online-classes');
  });

  it('shows no link where the feature is switched off, rather than a page that errors', async () => {
    api.listUpcoming.mockRejectedValue(new ApiRequestError(404, 'NOT_FOUND', 'Online classes are not enabled'));
    mount();
    await screen.findByText('page');
    await vi.waitFor(() => expect(api.listUpcoming).toHaveBeenCalled());
    expect(screen.queryByRole('link', { name: 'Онлайн-уроки' })).not.toBeInTheDocument();
  });

  it('never asks for a parent or an admin, who cannot join classes', async () => {
    role = 'PARENT';
    mount();
    await screen.findByText('page');
    expect(api.listUpcoming).not.toHaveBeenCalled();
    expect(screen.queryByRole('link', { name: 'Онлайн-уроки' })).not.toBeInTheDocument();
  });

  it('keeps the greyed-out placeholders as they were', async () => {
    api.listUpcoming.mockResolvedValue([]);
    mount();
    openTeacherMenu();
    await screen.findByRole('link', { name: 'Онлайн-уроки' });
    expect(screen.getByText('Домашние задания').closest('a')).toBeNull();
  });
});
