import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import { PushQuickStart } from './PushQuickStart';

vi.mock('../api/client', () => ({
  api: { push: { config: vi.fn(), subscribe: vi.fn(), test: vi.fn() } },
}));
vi.mock('../i18n/I18nContext', () => ({
  useI18n: () => ({ language: 'RU' }),
}));

const config = { enabled: true, publicKey: 'AQAB' };
const subscribeBrowser = vi.fn();
const getSubscription = vi.fn();
const register = vi.fn();
const originalSw = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
const originalAgent = Object.getOwnPropertyDescriptor(navigator, 'userAgent');

function mount(role: 'PARENT' | 'STUDENT' = 'PARENT') {
  return render(<MemoryRouter><PushQuickStart userId="parent-123" role={role} /></MemoryRouter>);
}

function setPermission(permission: 'default' | 'granted' | 'denied') {
  vi.stubGlobal('Notification', {
    permission,
    requestPermission: vi.fn().mockResolvedValue('granted'),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.stubGlobal('PushManager', function PushManager() {});
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 Chrome' });
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { register, ready: Promise.resolve({}) },
  });
  register.mockResolvedValue({ pushManager: { getSubscription, subscribe: subscribeBrowser } });
  getSubscription.mockResolvedValue(null);
  subscribeBrowser.mockResolvedValue({
    toJSON: () => ({ endpoint: 'https://push.example/sub/1', keys: { p256dh: 'p', auth: 'a' } }),
  });
  vi.mocked(api.push.config).mockResolvedValue(config);
  vi.mocked(api.push.subscribe).mockResolvedValue(undefined);
  vi.mocked(api.push.test).mockResolvedValue(undefined);
  setPermission('default');
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalSw) Object.defineProperty(navigator, 'serviceWorker', originalSw);
  else Reflect.deleteProperty(navigator, 'serviceWorker');
  if (originalAgent) Object.defineProperty(navigator, 'userAgent', originalAgent);
});

describe('one-click parent/student push onboarding', () => {
  it('shows a single clear call to action on the parent page and does not ask permission on render', async () => {
    mount('PARENT');
    expect(await screen.findByRole('button', { name: 'Включить уведомления' })).toBeInTheDocument();
    expect(Notification.requestPermission).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Включить уведомления' }));
    await waitFor(() => expect(api.push.subscribe).toHaveBeenCalledWith({
      endpoint: 'https://push.example/sub/1', p256dh: 'p', auth: 'a',
    }));
    expect(Notification.requestPermission).toHaveBeenCalledOnce();
    expect(subscribeBrowser).toHaveBeenCalledOnce();
    await waitFor(() => expect(api.push.test).toHaveBeenCalledOnce());
  });

  it('restores an existing approved subscription automatically after login', async () => {
    setPermission('granted');
    getSubscription.mockResolvedValue({
      options: { applicationServerKey: Uint8Array.from([1, 0, 1]).buffer },
      toJSON: () => ({ endpoint: 'https://push.example/sub/2', keys: { p256dh: 'p2', auth: 'a2' } }),
    });
    mount('STUDENT');
    await waitFor(() => expect(api.push.subscribe).toHaveBeenCalledWith({
      endpoint: 'https://push.example/sub/2', p256dh: 'p2', auth: 'a2',
    }));
    expect(Notification.requestPermission).not.toHaveBeenCalled();
    expect(subscribeBrowser).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Включить уведомления' })).not.toBeInTheDocument();
  });

  it('recreates a missing subscription silently when browser permission was already granted', async () => {
    setPermission('granted');
    mount('PARENT');
    await waitFor(() => expect(api.push.subscribe).toHaveBeenCalledOnce());
    expect(Notification.requestPermission).not.toHaveBeenCalled();
    expect(subscribeBrowser).toHaveBeenCalledOnce();
  });

  it('explains the iPhone Home Screen step instead of showing an impossible browser permission button', async () => {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' });
    mount('PARENT');
    expect(await screen.findByText(/«На экран Домой»/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Включить уведомления' })).not.toBeInTheDocument();
    expect(Notification.requestPermission).not.toHaveBeenCalled();
  });

  it('snoozes the offer without nagging on the next visit', async () => {
    const { unmount } = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Позже' }));
    expect(screen.queryByRole('button', { name: 'Включить уведомления' })).not.toBeInTheDocument();
    unmount();
    mount();
    await waitFor(() => expect(api.push.config).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('button', { name: 'Включить уведомления' })).not.toBeInTheDocument();
    expect(Notification.requestPermission).not.toHaveBeenCalled();
  });

  it('never requests a browser permission that the user has denied', async () => {
    setPermission('denied');
    mount();
    expect(await screen.findByText(/Уведомления заблокированы/)).toBeInTheDocument();
    expect(Notification.requestPermission).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Включить уведомления' })).not.toBeInTheDocument();
  });
});
