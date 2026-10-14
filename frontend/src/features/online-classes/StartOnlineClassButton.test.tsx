import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../../api/client';
import { onlineClassesApi } from '../../api/onlineClasses';
import { I18nProvider } from '../../i18n/I18nContext';
import { StartOnlineClassButton } from './StartOnlineClassButton';

vi.mock('../../api/onlineClasses', () => ({
  onlineClassesApi: {
    materializeFromCalendar: vi.fn(),
    start: vi.fn(),
  },
}));

const api = vi.mocked(onlineClassesApi);

describe('StartOnlineClassButton error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.materializeFromCalendar.mockResolvedValue({ id: 'class-1' } as
      Awaited<ReturnType<typeof onlineClassesApi.materializeFromCalendar>>);
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
    expect(alert.textContent).toContain('LiveKit');
    expect(screen.getByRole('button', {
      name: /Начать онлайн-урок|Online-Unterricht starten/,
    })).toBeEnabled();
    expect(screen.queryByText(/не настроены на этом сервере|nicht konfiguriert/)).not.toBeInTheDocument();
  });
});
