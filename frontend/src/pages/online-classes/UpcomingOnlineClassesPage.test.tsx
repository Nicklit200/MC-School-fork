import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { onlineClassesApi, type OnlineClass } from '../../api/onlineClasses';
import { I18nProvider } from '../../i18n/I18nContext';
import { UpcomingOnlineClassesPage } from './UpcomingOnlineClassesPage';
vi.mock('../../api/onlineClasses', () => ({ onlineClassesApi: { listUpcoming: vi.fn() } }));
afterEach(cleanup);
describe('teacher room entry', () => {
  it.each([true, false])('routes a teacher to an appropriate entry when joinWindowOpen=%s', async open => {
    localStorage.setItem('language', 'RU');
    vi.mocked(onlineClassesApi.listUpcoming).mockResolvedValue([{
      id: 'class-1', eventId: 'event-1', title: 'Математика', viewerIsHost: true,
      joinWindowOpen: open, status: 'LIVE', scheduledStartAt: '2026-10-23T10:00:00Z',
    } as OnlineClass]);
    render(<MemoryRouter><I18nProvider><UpcomingOnlineClassesPage /></I18nProvider></MemoryRouter>);
    expect(await screen.findByRole('link', { name: /Математика/ })).toHaveAttribute('href',
      open ? '/online-classes/class-1' : '/teacher/lessons/event-1');
    expect(screen.queryByText('Запустите новую сессию из урока') !== null).toBe(!open);
  });
});
