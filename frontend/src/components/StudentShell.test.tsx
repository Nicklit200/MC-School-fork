import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n/I18nContext';
import { StudentShell } from './StudentShell';

beforeEach(() => { localStorage.clear(); localStorage.setItem('language', 'RU'); });
function mount(path: string, overrides: Partial<React.ComponentProps<typeof StudentShell>> = {}) {
  const callbacks = { onLogout: vi.fn(), onReturnToAdmin: vi.fn() };
  render(<I18nProvider><MemoryRouter initialEntries={[path]}><StudentShell name="Ученик" isImpersonating={false} returningToAdmin={false} {...callbacks} {...overrides}>
    <p>Содержимое страницы</p>
  </StudentShell></MemoryRouter></I18nProvider>);
  return callbacks;
}
describe('student role shell', () => {
  it('keeps the five real sections and highlights cards during an active review', () => {
    mount('/session/active-review');
    const navigation = screen.getByRole('navigation', { name: 'Основная навигация' });
    expect(within(navigation).getAllByRole('link').map(link => link.getAttribute('href'))).toEqual([
      '/today', '/my-cards', '/student/homeworks', '/student/lessons', '/settings',
    ]);
    expect(within(navigation).getByRole('link', { name: 'Мои карточки' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getAllByRole('img', { name: 'Mindcrafti School' })[0]).toHaveAttribute('src', '/brand/Mindcrafti_Logo_M_OFFICIAL.webp');
    expect(screen.getByText('Содержимое страницы')).toBeInTheDocument();
  });
  it('retains lesson context for the notebook camera and delegates logout to existing auth', () => {
    const callbacks = mount('/lesson-notebook/local-lesson');
    expect(screen.getByRole('link', { name: 'Мои уроки' })).toHaveAttribute('aria-current', 'page');
    fireEvent.click(screen.getByRole('button', { name: 'Выйти' }));
    expect(callbacks.onLogout).toHaveBeenCalledOnce();
  });
  it('delegates administrator return through the existing callback', () => {
    const callbacks = mount('/today', { isImpersonating: true });
    fireEvent.click(screen.getByRole('button', { name: 'Вернуться в админку' }));
    expect(callbacks.onReturnToAdmin).toHaveBeenCalledOnce();
  });
  it('shows and highlights the shared online classroom list only when available', () => {
    mount('/online-classes', { onlineClassesAvailable: true });
    expect(screen.getByRole('link', { name: 'Онлайн-уроки' })).toHaveAttribute('href', '/online-classes');
    expect(screen.getByRole('link', { name: 'Онлайн-уроки' })).toHaveAttribute('aria-current', 'page');
  });
  it('gives parents the three requested sections and keeps account links in the parent cabinet', () => {
    mount('/parent/skills', { name: 'Родитель', variant: 'parent', onlineClassesAvailable: true });
    const navigation = screen.getByRole('navigation', { name: 'Основная навигация' });
    expect(within(navigation).getAllByRole('link').map(link => link.getAttribute('href'))).toEqual([
      '/parent', '/parent/settings', '/parent/skills',
    ]);
    expect(within(navigation).getByRole('link', { name: 'Карта навыков' })).toHaveAttribute('aria-current', 'page');
    expect(within(navigation).getByRole('link', { name: 'Домашние задания' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Открыть настройки аккаунта' })).toHaveAttribute('href', '/parent/settings');
    for (const logo of screen.getAllByRole('img', { name: 'Mindcrafti School' })) {
      expect(logo.closest('a')).toHaveAttribute('href', '/parent');
    }
  });
  it('translates parent navigation and delegates logout', () => {
    localStorage.setItem('language', 'DE');
    const callbacks = mount('/parent', { variant: 'parent' });
    expect(screen.getByRole('link', { name: 'Hausaufgaben' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Kompetenzkarte' })).toHaveAttribute('href', '/parent/skills');
    expect(screen.getByText('Elternkonto')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Abmelden' }));
    expect(callbacks.onLogout).toHaveBeenCalledOnce();
  });
});
