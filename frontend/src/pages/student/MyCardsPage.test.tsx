import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api/client';
import type { Homework } from '../../api/types';
import { I18nProvider } from '../../i18n/I18nContext';
import { MyCardsPage } from './MyCardsPage';

vi.mock('../../api/client', async importOriginal => {
  const actual = await importOriginal<typeof import('../../api/client')>();
  return { ...actual, api: { ...actual.api, study: { ...actual.api.study, homeworks: vi.fn() } } };
});
beforeEach(() => { vi.resetAllMocks(); localStorage.clear(); localStorage.setItem('language', 'RU'); });
function mount() { render(<I18nProvider><MemoryRouter><MyCardsPage /></MemoryRouter></I18nProvider>); }
describe('student card batches', () => {
  it('keeps real batch links and all four existing counters while excluding PDF-only homework', async () => {
    vi.mocked(api.study.homeworks).mockResolvedValue([
      { id: 'cards-1', startDate: '2026-10-24', totalCards: 12, notStarted: 3, inProgress: 4, learned: 5 } as Homework,
      { id: 'worksheet-only', startDate: '2026-10-23', totalCards: 0, hasWorksheet: true } as Homework,
    ]);
    mount(); const batch = await screen.findByRole('link', { name: /2026-10-24/ });
    expect(batch).toHaveAttribute('href', '/my-cards/cards-1');
    for (const count of ['12', '3', '4', '5']) expect(within(batch).getByText(count)).toBeInTheDocument();
    expect(screen.queryByText('2026-10-23')).not.toBeInTheDocument();
  });
  it('keeps the existing empty state when no flashcard batches are assigned', async () => {
    vi.mocked(api.study.homeworks).mockResolvedValue([]); mount();
    expect(await screen.findByText('Карточек пока нет')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
