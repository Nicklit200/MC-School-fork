import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  else Reflect.deleteProperty(navigator, 'userAgent');
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

  it('quiet parent view rebinds approved notifications and announces the updated device without showing setup', async () => {
    setPermission('granted');
    getSubscription.mockResolvedValue({
      options: { applicationServerKey: Uint8Array.from([1, 0, 1]).buffer },
      toJSON: () => ({ endpoint: 'https://push.example/sub/parent', keys: { p256dh: 'parent-key', auth: 'parent-auth' } }),
    });
    const onPushChanged = vi.fn();
    window.addEventListener('mindcrafti-push-changed', onPushChanged);
    try {
      const { container } = render(<MemoryRouter><PushQuickStart userId="parent-123" role="PARENT" quiet /></MemoryRouter>);
      await waitFor(() => expect(api.push.subscribe).toHaveBeenCalledWith({
        endpoint: 'https://push.example/sub/parent', p256dh: 'parent-key', auth: 'parent-auth',
      }));
      await waitFor(() => expect(onPushChanged).toHaveBeenCalledOnce());
      expect(container).toBeEmptyDOMElement();
      expect(Notification.requestPermission).not.toHaveBeenCalled();
      expect(subscribeBrowser).not.toHaveBeenCalled();
      expect(api.push.test).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('mindcrafti-push-changed', onPushChanged);
    }
  });

  it('recreates a missing subscription silently when browser permission was already granted', async () => {
    setPermission('granted');
    mount('PARENT');
    await waitFor(() => expect(api.push.subscribe).toHaveBeenCalledOnce());
    expect(Notification.requestPermission).not.toHaveBeenCalled();
    expect(subscribeBrowser).toHaveBeenCalledOnce();
  });

  it('automatically opens four iPhone setup steps for parents right after sign-in', async () => {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' });
    mount('PARENT');
    const dialog = await screen.findByRole('dialog', { name: /Как включить уведомления Mindcrafti на iPhone/ });
    expect(within(dialog).getByRole('list').children).toHaveLength(4);
    expect(within(dialog).getByText('Нажмите «Поделиться»')).toBeInTheDocument();
    expect(within(dialog).getByText('Выберите «На экран Домой»')).toBeInTheDocument();
    expect(within(dialog).getByText('Откройте Mindcrafti с нового значка')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Закрыть инструкцию' })).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Включить уведомления' })).not.toBeInTheDocument();
    expect(Notification.requestPermission).not.toHaveBeenCalled();
  });

  it('allows parents to dismiss the iPhone guide and prevents repeat interruptions', async () => {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' });
    const { unmount } = mount('PARENT');
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Напомнить позже' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    unmount();
    mount('PARENT');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(Notification.requestPermission).not.toHaveBeenCalled();
  });

  it('never shows the Safari install walkthrough when iPhone opens the installed PWA', async () => {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' });
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({ matches: true, media: '(display-mode: standalone)' })),
    });
    try {
      mount('PARENT');
      expect(await screen.findByRole('button', { name: 'Включить уведомления' })).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    } finally {
      Object.defineProperty(window, 'matchMedia', { configurable: true, value: originalMatchMedia });
    }
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
