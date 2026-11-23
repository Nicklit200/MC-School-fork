import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ParentPage } from './ParentPage';
import { parentApi } from '../../api/parent';
import { api } from '../../api/client';

vi.mock('../../api/parent', () => ({ parentApi: { children: vi.fn() } }));
vi.mock('../../api/client', () => ({ api: { push: { status: vi.fn(), test: vi.fn() } } }));
vi.mock('../../i18n/I18nContext', () => ({ useI18n: () => ({ language: 'RU' }) }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(parentApi.children).mockResolvedValue([]);
  vi.mocked(api.push.status).mockResolvedValue({
    enabled: true, registeredDevices: 0, ready: false, emailAvailable: false,
  });
  vi.mocked(api.push.test).mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('parent evening reminder setup', () => {
  it('warns when nightly push has no connected device and no email fallback', async () => {
    render(<ParentPage />);
    expect(await screen.findByText('Вечерние уведомления для этого аккаунта не подключены.')).toBeInTheDocument();
    expect(screen.getByText('У аккаунта также нет email для резервного сообщения.')).toBeInTheDocument();
  });

  it('allows a parent with a registered device to test notification delivery', async () => {
    vi.mocked(api.push.status).mockResolvedValue({
      enabled: true, registeredDevices: 1, ready: true, emailAvailable: false,
    });
    render(<ParentPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Проверить уведомление' }));
    await waitFor(() => expect(api.push.test).toHaveBeenCalledOnce());
    expect(await screen.findByText('Тест отправлен. Проверьте уведомления на устройстве.')).toBeInTheDocument();
  });
});
