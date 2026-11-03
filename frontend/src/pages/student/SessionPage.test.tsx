import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api/client';
import type { Question } from '../../api/types';
import { I18nProvider } from '../../i18n/I18nContext';
import { SessionPage } from './SessionPage';

vi.mock('../../api/client', async importOriginal => {
  const actual = await importOriginal<typeof import('../../api/client')>();
  return { ...actual, api: { ...actual.api, study: { ...actual.api.study, currentQuestion: vi.fn(), answer: vi.fn() } } };
});
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ user: { id: 'student', email: 'student@example.test' } }) }));
vi.mock('./useScreenshotGuard', () => ({ useScreenshotGuard: () => ({ blurred: false, guardProps: {} }) }));
vi.mock('../../hooks/useActiveLearningTime', () => ({ useActiveLearningTime: vi.fn() }));

const question = (options: string[], patch: Partial<Question> = {}): Question => ({
  cardId: 'one-card', question: 'Сколько будет 2 + 2?', options,
  answeredCount: 0, totalCards: 1, timeLimitSeconds: null, ...patch,
});
const mount = () => render(<I18nProvider><MemoryRouter initialEntries={['/session/one-card-session']}><Routes>
  <Route path="/session/:sessionId" element={<SessionPage />} />
  <Route path="/session/:sessionId/result" element={<div>Результат сессии</div>} />
</Routes></MemoryRouter></I18nProvider>);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.setItem('language', 'RU');
  vi.mocked(api.study.answer).mockResolvedValue({ correct: true, correctAnswer: '4', sessionCompleted: true, remaining: 0 });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('single-card study sessions', () => {
  it.each([
    ['one', ['4']],
    ['two', ['5', '4']],
    ['three', ['5', '4', '6']],
    ['four', ['5', '4', '6', '7']],
  ] as Array<[string, string[]]>)('renders %s server-provided choices and completes a one-card session', async (_name, options) => {
    vi.mocked(api.study.currentQuestion).mockResolvedValue(question(options));
    mount();
    await screen.findByText('Сколько будет 2 + 2?');
    expect(screen.getByText('0 из 1')).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(options.length);
    for (const option of options) expect(screen.getByRole('button', { name: option })).toBeEnabled();
    vi.useFakeTimers();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '4' })); });
    expect(api.study.answer).toHaveBeenCalledWith('one-card-session', 'one-card', '4', false);
    expect(screen.getByText('Верно')).toBeInTheDocument();
    expect(screen.getAllByRole('button').every(button => button.hasAttribute('disabled'))).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(screen.getByText('Результат сессии')).toBeInTheDocument();
    expect(api.study.currentQuestion).toHaveBeenCalledTimes(1);
  });

  it('keeps a timed-out single card in the session when the server requires another attempt', async () => {
    vi.useFakeTimers();
    vi.mocked(api.study.currentQuestion).mockResolvedValue(question(['4'], { timeLimitSeconds: 1 }));
    vi.mocked(api.study.answer).mockResolvedValue({ correct: false, correctAnswer: '4', sessionCompleted: false, remaining: 1 });
    await act(async () => { mount(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(api.study.answer).toHaveBeenCalledWith('one-card-session', 'one-card', '', true);
    expect(screen.getByText('Время вышло!')).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(api.study.currentQuestion).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: '4' })).toBeEnabled();
    expect(screen.queryByText('Результат сессии')).not.toBeInTheDocument();
  });
});
