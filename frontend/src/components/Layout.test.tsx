import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n/I18nContext';
import { Layout } from './Layout';

const PILOT_OWNER_ID = '14e3c7c1-1fc8-41bd-858a-6c20efdd957a';
let role: 'TEACHER' | 'STUDENT' | 'PARENT' | 'ADMIN' = 'TEACHER';
let userId: string = PILOT_OWNER_ID;

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: userId, role, fullName: 'Test', status: 'ACTIVE' },
    logout: vi.fn(),
    setUser: vi.fn(),
  }),
}));

function mount() {
  return render(
    <I18nProvider>
      <MemoryRouter>
        <Layout><p>page</p></Layout>
      </MemoryRouter>
    </I18nProvider>,
  );
}

function showTeacherSidebar() {
  fireEvent.click(screen.getByRole('button', { name: 'Показать меню' }));
}

describe('Layout: owner-only online classroom pilot navigation', () => {
  beforeEach(() => {
    role = 'TEACHER';
    userId = PILOT_OWNER_ID;
    vi.stubEnv('VITE_MINDCRAFTI_LIVEKIT_ENABLED', 'true');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('shows the original online classroom entry for the designated pilot teacher', () => {
    mount();
    showTeacherSidebar();
    expect(screen.getByRole('link', { name: 'Онлайн-уроки' }))
      .toHaveAttribute('href', '/teacher/online-classes');
  });

  it('does not expose the pilot to unrelated teachers', () => {
    userId = 'not-the-pilot';
    mount();
    showTeacherSidebar();
    expect(screen.queryByRole('link', { name: 'Онлайн-уроки' })).not.toBeInTheDocument();
  });

  it('does not show the navigation entry when the pilot flag is disabled', () => {
    vi.stubEnv('VITE_MINDCRAFTI_LIVEKIT_ENABLED', 'false');
    mount();
    showTeacherSidebar();
    expect(screen.queryByRole('link', { name: 'Онлайн-уроки' })).not.toBeInTheDocument();
  });

  it('does not give a parent a teacher-only menu', () => {
    role = 'PARENT';
    mount();
    expect(screen.queryByRole('link', { name: 'Онлайн-уроки' })).not.toBeInTheDocument();
  });

  it('keeps the future-only homework shortcut disabled', () => {
    mount();
    showTeacherSidebar();
    expect(screen.getByText('Домашние задания').closest('a')).toBeNull();
  });
});
