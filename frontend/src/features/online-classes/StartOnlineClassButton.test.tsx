import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../../api/client';
import { onlineClassesApi } from '../../api/onlineClasses';
import { I18nProvider } from '../../i18n/I18nContext';
import { StartOnlineClassButton } from './StartOnlineClassButton';

vi.mock('../../api/onlineClasses', () => ({
  onlineClassesApi: {
    materializeFromCalendar: vi.fn(),
    start: vi.fn(),
    mediaDiagnostics: vi.fn(),
  },
}));

const api = vi.mocked(onlineClassesApi);

describe('StartOnlineClassButton error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('language', 'RU');
    api.materializeFromCalendar.mockResolvedValue({ id: 'class-1' } as
      Awaited<ReturnType<typeof onlineClassesApi.materializeFromCalendar>>);
    api.mediaDiagnostics.mockResolvedValue({ mediaApiReachable: false, diagnosticStatus: 'AUTH_REJECTED' });
  });

  it('shows a retryable LiveKit failure instead of incorrectly claiming the feature is disabled', async () => {
    api.start.mockRejectedValue(new ApiRequestError(409, 'CONFLICT', 'Media API authentication failed'));

    render(
      <I18nProvider>
        <MemoryRouter>
          <StartOnlineClassButton eventId="calendar-lesson" />
        </MemoryRouter>
      </I18nProvider>,
    );
    await userEvent.click(screen.getByRole('button', {
      name: /Начать онлайн-урок|Online-Unterricht starten/,
    }));

    await waitFor(() => expect(api.start).toHaveBeenCalledWith('class-1'));
    const alert = await screen.findByRole('alert');
    // The button and long credential warning form one self-contained action;
    // generic .row children must not stretch them across the tablet page.
    const launch = screen.getByRole('button', { name: /Начать онлайн-урок|Online-Unterricht starten/ });
    expect(launch.closest('.online-class-start')).not.toBeNull();
    expect(alert.closest('.online-class-start')).toBe(launch.closest('.online-class-start'));
    expect(alert.textContent).toContain('LiveKit');
    expect(alert.textContent).toMatch(/401|403/);
    expect(api.mediaDiagnostics).toHaveBeenCalledWith('class-1');
    expect(screen.getByRole('button', {
      name: /Начать онлайн-урок|Online-Unterricht starten/,
    })).toBeEnabled();
    expect(screen.queryByText(/не настроены на этом сервере|nicht konfiguriert/)).not.toBeInTheDocument();
  });

  it('re-enters the same idle classroom instead of creating a replacement lesson', async () => {
    api.materializeFromCalendar.mockResolvedValue({ id: 'existing-class', status: 'LIVE', mediaState: 'IDLE' } as
      Awaited<ReturnType<typeof onlineClassesApi.materializeFromCalendar>>);
    api.start.mockResolvedValue({ id: 'existing-class', status: 'LIVE', mediaState: 'IDLE' } as never);
    render(<I18nProvider><MemoryRouter initialEntries={['/lesson']}><Routes>
      <Route path="/lesson" element={<StartOnlineClassButton eventId="calendar-lesson" />} />
      <Route path="/online-classes/existing-class" element={<p>Existing classroom</p>} />
    </Routes></MemoryRouter></I18nProvider>);
    await userEvent.click(screen.getByRole('button', { name: /Начать онлайн-урок|Online-Unterricht starten/ }));
    expect(await screen.findByText('Existing classroom')).toBeInTheDocument();
    expect(api.materializeFromCalendar).toHaveBeenCalledExactlyOnceWith('calendar-lesson');
    expect(api.start).toHaveBeenCalledExactlyOnceWith('existing-class');
  });

  it('starts a future lesson from a fresh page without a client calendar restriction', async () => {
    api.materializeFromCalendar.mockResolvedValue({ id: 'future-class', status: 'SCHEDULED',
      scheduledStartAt: '2099-11-03T15:00:00Z' } as Awaited<ReturnType<typeof onlineClassesApi.materializeFromCalendar>>);
    api.start.mockResolvedValue({ id: 'future-class', status: 'LIVE' } as never);
    render(<I18nProvider><MemoryRouter initialEntries={['/lesson']}><Routes>
      <Route path="/lesson" element={<StartOnlineClassButton eventId="future-lesson" />} />
      <Route path="/online-classes/future-class" element={<p>Future classroom</p>} />
    </Routes></MemoryRouter></I18nProvider>);
    await userEvent.click(screen.getByRole('button', { name: 'Начать онлайн-урок' }));
    expect(await screen.findByText('Future classroom')).toBeInTheDocument();
    expect(api.start).toHaveBeenCalledExactlyOnceWith('future-class');
  });

  it('opens an unassigned native trial through its original event without creating a replacement test lesson', async () => {
    api.materializeFromCalendar.mockResolvedValue({ id: 'trial-class', eventId: 'local-trial', status: 'SCHEDULED',
      studentId: null, groupId: null } as Awaited<ReturnType<typeof onlineClassesApi.materializeFromCalendar>>);
    api.start.mockResolvedValue({ id: 'trial-class', eventId: 'local-trial', status: 'LIVE' } as never);
    render(<I18nProvider><MemoryRouter initialEntries={['/teacher/lessons/local-trial']}><Routes>
      <Route path="/teacher/lessons/local-trial" element={<StartOnlineClassButton eventId="local-trial" />} />
      <Route path="/online-classes/trial-class" element={<p>Modern trial classroom</p>} />
    </Routes></MemoryRouter></I18nProvider>);
    expect(api.materializeFromCalendar).not.toHaveBeenCalled();
    expect(api.start).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Начать онлайн-урок' }));
    expect(await screen.findByText('Modern trial classroom')).toBeInTheDocument();
    expect(api.materializeFromCalendar).toHaveBeenCalledExactlyOnceWith('local-trial');
    expect(api.start).toHaveBeenCalledExactlyOnceWith('trial-class');
  });

  it.each(['RU', 'DE'])('does not repeat the obsolete teacher day-only rule after a legacy server rejection (%s)', async language => {
    localStorage.setItem('language', language);
    api.start.mockRejectedValue(new ApiRequestError(409, 'CONFLICT', 'Entry is only available on the lesson day in Europe/Berlin'));
    render(<I18nProvider><MemoryRouter><StartOnlineClassButton eventId="calendar-lesson" /></MemoryRouter></I18nProvider>);
    const start = screen.getByRole('button', { name: /Начать онлайн-урок|Online-Unterricht starten/ });
    await userEvent.click(start);
    expect(await screen.findByRole('status')).toHaveTextContent(language === 'DE'
      ? 'Bitte laden Sie die Seite neu' : 'Обновите страницу');
    expect(screen.queryByText(/день урока|Unterrichtstag/)).not.toBeInTheDocument();
    expect(start).toBeEnabled();
    expect(api.mediaDiagnostics).not.toHaveBeenCalled();
  });

  it.each(['ENDED', 'CANCELLED'] as const)('keeps an explicitly %s lesson closed', async status => {
    api.materializeFromCalendar.mockResolvedValue({ id: 'existing-class', status } as
      Awaited<ReturnType<typeof onlineClassesApi.materializeFromCalendar>>);
    render(<I18nProvider><MemoryRouter><StartOnlineClassButton eventId="calendar-lesson" /></MemoryRouter></I18nProvider>);
    await userEvent.click(screen.getByRole('button', { name: 'Начать онлайн-урок' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Урок завершён');
    expect(screen.getByRole('button', { name: 'Урок завершён' })).toBeDisabled();
    expect(api.start).not.toHaveBeenCalled();
  });
});
