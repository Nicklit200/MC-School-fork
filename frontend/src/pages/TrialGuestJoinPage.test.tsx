// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { TrialGuestJoinPage } from './TrialGuestJoinPage';
import { trialInvitationsApi } from '../api/trialInvitations';

const setUser = vi.fn();
const setSessionAccessToken = vi.fn();
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ setUser }) }));
vi.mock('../api/client', () => ({ setSessionAccessToken }));
vi.mock('../api/trialInvitations', () => ({
  trialInvitationsApi: { info: vi.fn(), join: vi.fn(), issue: vi.fn(), revoke: vi.fn() },
}));

function page() {
  return render(<MemoryRouter initialEntries={['/trial/join/guest-token']}>
    <Routes>
      <Route path="/trial/join/:token" element={<TrialGuestJoinPage />} />
      <Route path="/online-classes/:classId" element={<div>Класс открыт</div>} />
    </Routes>
  </MemoryRouter>);
}
beforeEach(() => {
  vi.mocked(trialInvitationsApi.info).mockResolvedValue({
    title: 'Пробный урок Mindcrafti',
    startsAt: '2026-11-12T15:00:00Z',
    endsAt: '2026-11-12T16:00:00Z',
    canJoin: true, claimed: false,
  });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe('trial guest entry', () => {
  it('asks only for name and grants the exact classroom after successful claim', async () => {
    vi.mocked(trialInvitationsApi.join).mockResolvedValue({
      classId: 'class-one',
      auth: { accessToken: 'scoped-jwt', tokenType: 'Bearer',
        expiresAt: '2026-11-12T17:00:00Z',
        user: { id: 'student-one', fullName: 'Anna', role: 'STUDENT', preferredLanguage: 'RU' } as any },
    });
    page();
    const input = await screen.findByLabelText('Как тебя зовут?');
    fireEvent.change(input, { target: { value: 'Anna' } });
    await act(async () => { fireEvent.click(screen.getByText('Войти на урок')); });
    await waitFor(() => expect(trialInvitationsApi.join).toHaveBeenCalledWith('guest-token', 'Anna'));
    expect(setSessionAccessToken).toHaveBeenCalledWith('scoped-jwt');
    expect(setUser).toHaveBeenCalled();
    expect(screen.getByText('Класс открыт')).toBeTruthy();
  });

  it('prevents early guest admission', async () => {
    vi.mocked(trialInvitationsApi.info).mockResolvedValue({
      title: 'Пробный урок Mindcrafti',
      startsAt: '2026-11-12T15:00:00Z',
      endsAt: '2026-11-12T16:00:00Z',
      canJoin: false, claimed: false,
    });
    page();
    expect(await screen.findByText(/Вход откроется за 60 минут/)).toBeTruthy();
    expect(screen.queryByText('Войти на урок')).toBeNull();
    expect(trialInvitationsApi.join).not.toHaveBeenCalled();
  });
});
