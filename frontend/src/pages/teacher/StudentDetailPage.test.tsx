import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api/client';
import { I18nProvider } from '../../i18n/I18nContext';
import { StudentDetailPage } from './StudentDetailPage';

vi.mock('../../api/client', async importOriginal => {
  const actual = await importOriginal<typeof import('../../api/client')>();
  return { ...actual, api: { ...actual.api,
    homeworks: { ...actual.api.homeworks, listForStudent: vi.fn() },
    cards: { ...actual.api.cards, listForStudent: vi.fn(), summaryForStudent: vi.fn() },
    students: { ...actual.api.students, reviewHistory: vi.fn() },
  } };
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.setItem('language', 'RU');
  vi.mocked(api.homeworks.listForStudent).mockResolvedValue([]);
  vi.mocked(api.cards.listForStudent).mockResolvedValue([]);
  vi.mocked(api.students.reviewHistory).mockResolvedValue([]);
});
afterEach(cleanup);
const mount = () => render(<I18nProvider><MemoryRouter initialEntries={['/teacher/students/student']}><Routes>
  <Route path="/teacher/students/:studentId" element={<StudentDetailPage />} />
</Routes></MemoryRouter></I18nProvider>);

describe('teacher card minimum', () => {
  it.each([1, 2, 3])('does not claim that %s active cards are insufficient', async total => {
    vi.mocked(api.cards.summaryForStudent).mockResolvedValue({ total, dueNow: total, awaitingRepetition: 0, learned: 0 });
    mount();
    await screen.findByText('Карточек пока нет');
    expect(screen.queryByText(/Добавьте хотя бы одну карточку|Меньше 4 карточек/)).not.toBeInTheDocument();
  });

  it.each([
    ['RU', 'Добавьте хотя бы одну карточку, чтобы ученик мог начать сессию.'],
    ['DE', 'Füge mindestens eine Karte hinzu, damit der Schüler eine Sitzung starten kann.'],
  ])('asks for the first card only when no cards exist (%s)', async (language, message) => {
    localStorage.setItem('language', language);
    vi.mocked(api.cards.summaryForStudent).mockResolvedValue({ total: 0, dueNow: 0, awaitingRepetition: 0, learned: 0 });
    mount();
    expect(await screen.findByText(message)).toBeInTheDocument();
  });
});
