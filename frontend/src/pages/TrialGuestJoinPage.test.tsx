// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n/I18nContext';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { TrialGuestJoinPage } from './TrialGuestJoinPage';
import { trialInvitationsApi } from '../api/trialInvitations';

const { setUser, setSessionAccessToken } = vi.hoisted(() => ({
  setUser: vi.fn(),
  setSessionAccessToken: vi.fn(),
}));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ setUser }) }));
vi.mock('../api/client', () => ({ setSessionAccessToken }));
vi.mock('../api/trialInvitations', () => ({
  trialInvitationsApi: { info: vi.fn(), join: vi.fn(), issue: vi.fn(), revoke: vi.fn() },
}));

function EnteredClass() {
  const location = useLocation();
  return <div>Класс открыт<output data-testid="media-choice">{JSON.stringify(location.state)}</output></div>;
}
function page() {
  return render(<I18nProvider><MemoryRouter initialEntries={['/trial/join/guest-token']}>
    <Routes>
      <Route path="/trial/join/:token" element={<TrialGuestJoinPage />} />
      <Route path="/online-classes/:classId" element={<EnteredClass />} />
    </Routes>
  </MemoryRouter></I18nProvider>);
}
beforeEach(() => {
  localStorage.setItem('language', 'RU');
  const video = { stop: vi.fn(), enabled: true, readyState: 'live', getSettings: () => ({ deviceId: 'cam-1' }) };
  const audio = { stop: vi.fn(), enabled: true, readyState: 'live', getSettings: () => ({ deviceId: 'mic-1' }) };
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
    getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [video, audio], getVideoTracks: () => [video], getAudioTracks: () => [audio] }),
    enumerateDevices: vi.fn().mockResolvedValue([{ deviceId: 'cam-1', kind: 'videoinput', label: 'Camera' }, { deviceId: 'mic-1', kind: 'audioinput', label: 'Microphone' }]),
  } });
  vi.mocked(trialInvitationsApi.info).mockResolvedValue({
    title: 'Пробный урок Mindcrafti',
    startsAt: '2026-11-12T15:00:00Z',
    endsAt: '2026-11-12T16:00:00Z',
    canJoin: true, claimed: false,
  });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined }); });
describe('trial guest entry', () => {
  it('verifies devices before granting the exact classroom after successful claim', async () => {
    vi.mocked(trialInvitationsApi.join).mockResolvedValue({
      classId: 'class-one',
      auth: { accessToken: 'scoped-jwt', tokenType: 'Bearer',
        expiresAt: '2026-11-12T17:00:00Z',
        user: { id: 'student-one', fullName: 'Anna', role: 'STUDENT', preferredLanguage: 'RU' } as any },
    });
    page();
    const input = await screen.findByLabelText('Как тебя зовут?');
    fireEvent.change(input, { target: { value: 'Anna' } });
    await screen.findByRole('option', { name: 'Microphone' });
    expect(trialInvitationsApi.join).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Присоединиться|Войти на урок/ })); });
    await waitFor(() => expect(trialInvitationsApi.join).toHaveBeenCalledWith('guest-token', 'Anna'));
    expect(setSessionAccessToken).toHaveBeenCalledWith('scoped-jwt', '/trial/join/guest-token');
    expect(setUser).toHaveBeenCalled();
    expect(screen.getByText('Класс открыт')).toBeTruthy();
    expect(JSON.parse(screen.getByTestId('media-choice').textContent ?? '{}')).toEqual({ trialClassId: 'class-one', trialMedia: { videoDeviceId: 'cam-1', audioDeviceId: 'mic-1', cameraEnabled: true, microphoneEnabled: true } });
  });

  it('prevents early guest admission', async () => {
    vi.mocked(trialInvitationsApi.info).mockResolvedValue({
      title: 'Пробный урок Mindcrafti',
      startsAt: '2026-11-12T15:00:00Z',
      endsAt: '2026-11-12T16:00:00Z',
      canJoin: false, claimed: false,
    });
    page();
    expect(await screen.findByText(/можешь оставить эту страницу открытой/)).toBeTruthy();
    await screen.findByRole('option', { name: 'Microphone' });
    fireEvent.change(screen.getByLabelText('Как тебя зовут?'), { target: { value: 'Anna' } });
    fireEvent.click(screen.getByRole('button', { name: /Присоединиться|Ждать преподавателя/ }));
    expect(screen.getByText(/Ты в комнате ожидания/)).toBeTruthy();
    expect(trialInvitationsApi.join).not.toHaveBeenCalled();
  });

  it('allows a returning pupil to enter using the same name and link', async () => {
    vi.mocked(trialInvitationsApi.info).mockResolvedValue({
      title: 'Пробный урок Mindcrafti',
      startsAt: '2026-11-12T15:00:00Z', endsAt: '2026-11-12T16:00:00Z',
      canJoin: true, claimed: true,
    });
    vi.mocked(trialInvitationsApi.join).mockResolvedValue({
      classId: 'class-one',
      auth: { accessToken: 'scoped-jwt', tokenType: 'Bearer',
        expiresAt: '2026-11-12T17:00:00Z',
        user: { id: 'student-one', fullName: 'Anna', role: 'STUDENT', preferredLanguage: 'RU' } as any },
    });
    page();
    expect(await screen.findByText(/то же имя/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Как тебя зовут?'), { target: { value: 'Anna' } });
    await screen.findByRole('option', { name: 'Microphone' });
    fireEvent.click(screen.getByRole('button', { name: /Присоединиться|Войти на урок/ }));
    await waitFor(() => expect(trialInvitationsApi.join).toHaveBeenCalledWith('guest-token', 'Anna'));
  });
});
