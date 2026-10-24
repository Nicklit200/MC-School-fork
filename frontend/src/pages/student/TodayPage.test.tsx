import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api/client';
import type { Homework, Today } from '../../api/types';
import { I18nProvider } from '../../i18n/I18nContext';
import { TodayPage } from './TodayPage';

vi.mock('../../api/client', async importOriginal => {
  const actual = await importOriginal<typeof import('../../api/client')>();
  return { ...actual, api: { ...actual.api, study: { ...actual.api.study, today: vi.fn(), homeworks: vi.fn(), startSession: vi.fn() } } };
});
const today: Today = { totalCards: 20, dueCardCount: 8, learnedCount: 12, minCardsToStart: 5, canStartScheduled: true, canPractice: true, inProgressSessionId: null };
function homework(id: string, patch: Partial<Homework> = {}): Homework {
  return { id, studentId: 'student', startDate: '2026-10-24', createdAt: '2026-10-24T08:00:00Z', totalCards: 0,
    notStarted: 0, inProgress: 0, learned: 0, status: 'ACTIVE', hasWorksheet: true, worksheetFilename: `${id}.pdf`,
    worksheetPageCount: 3, submitted: false, submittedAt: null, deadlineAt: '2026-10-25T00:00:00Z', overdue: false, submittedLate: false, ...patch };
}
function Location() { return <output data-testid="route">{useLocation().pathname}</output>; }
function mount() { return render(<I18nProvider><MemoryRouter initialEntries={['/today']}><TodayPage /><Location /></MemoryRouter></I18nProvider>); }
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear(); localStorage.setItem('language', 'RU');
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-24T12:00:00Z'));
  vi.mocked(api.study.today).mockResolvedValue(today); vi.mocked(api.study.homeworks).mockResolvedValue([]);
  vi.mocked(api.study.startSession).mockResolvedValue({ id: 'new-session', sessionType: 'SCHEDULED', status: 'IN_PROGRESS', totalCards: 8, answeredCards: 0 });
});
afterEach(() => vi.useRealTimers());
describe('student today tasks', () => {
  it('starts scheduled review and retains the real session route', async () => {
    mount(); await userEvent.click(await screen.findByRole('button', { name: 'Начать' }));
    expect(api.study.startSession).toHaveBeenCalledWith('SCHEDULED');
    await waitFor(() => expect(screen.getByTestId('route')).toHaveTextContent('/session/new-session'));
  });
  it('resumes an existing session without creating another one', async () => {
    vi.mocked(api.study.today).mockResolvedValue({ ...today, inProgressSessionId: 'saved-session', canStartScheduled: false });
    mount(); const resume = await screen.findByRole('button', { name: 'Продолжить сессию' });
    fireEvent.click(resume); expect(screen.getByTestId('route')).toHaveTextContent('/session/saved-session');
    expect(api.study.startSession).not.toHaveBeenCalled();
  });
  it('shows today and overdue PDF tasks while excluding completed, future and card-only assignments', async () => {
    vi.mocked(api.study.homeworks).mockResolvedValue([homework('today'), homework('overdue', { startDate: '2026-10-22', overdue: true }),
      homework('submitted', { submitted: true }), homework('future', { startDate: '2026-10-25' }), homework('cards', { hasWorksheet: false, totalCards: 10 })]);
    mount();
    expect(await screen.findByRole('link', { name: /today\.pdf/ })).toHaveAttribute('href', '/student/homeworks/today/worksheet');
    expect(screen.getByRole('link', { name: /overdue\.pdf/ })).toHaveAttribute('href', '/student/homeworks/overdue/worksheet');
    for (const name of ['submitted.pdf', 'future.pdf', 'cards.pdf']) expect(screen.queryByText(name)).not.toBeInTheDocument();
  });
});
