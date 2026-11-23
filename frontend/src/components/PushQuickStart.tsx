import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useI18n } from '../i18n/I18nContext';
import { IosPushInstallGuide } from './IosPushInstallGuide';

type Role = 'PARENT' | 'STUDENT' | 'TEACHER' | 'ADMIN';
type Phase = 'checking' | 'hidden' | 'ready' | 'ios-install' | 'denied' | 'enabled' | 'error';
type PushConfig = { enabled: boolean; publicKey: string };
// Parent and staff alerts are time-sensitive; never hide setup for two weeks.
const DISMISS_DAYS = 1;

function isIPhoneOrIPad() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function homeScreenApp() {
  return window.matchMedia?.('(display-mode: standalone)').matches === true
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function supported() {
  return 'serviceWorker' in navigator && 'PushManager' in window
    && 'Notification' in window;
}

function validKeys(subscription: PushSubscription, key: string): boolean {
  try {
    const raw = key.replace(/-/g, '+').replace(/_/g, '/');
    const padded = raw + '='.repeat((4 - raw.length % 4) % 4);
    const decoded = atob(padded);
    const expected = new Uint8Array([...decoded].map(char => char.charCodeAt(0)));
    const actual = subscription.options.applicationServerKey
      ? new Uint8Array(subscription.options.applicationServerKey) : null;
    return Boolean(actual && actual.length === expected.length
      && actual.every((byte, index) => byte === expected[index]));
  } catch { return false; }
}

function keyBuffer(value: string): ArrayBuffer {
  const raw = value.replace(/-/g, '+').replace(/_/g, '/');
  const decoded = atob(raw + '='.repeat((4 - raw.length % 4) % 4));
  const data = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i++) data[i] = decoded.charCodeAt(i);
  return data.buffer;
}

function subscriptionData(subscription: PushSubscription) {
  const data = subscription.toJSON();
  if (!data.endpoint || !data.keys?.p256dh || !data.keys?.auth)
    throw new Error('Invalid device notification subscription');
  return { endpoint: data.endpoint, p256dh: data.keys.p256dh, auth: data.keys.auth };
}

/**
 * One-click notification onboarding on the first parent/student home view.
 * The browser owns the permission dialog; we never request it automatically.
 * An EXISTING granted subscription is silently rebound on sign-in, which also
 * handles a device used by more than one school account.
 */
export function PushQuickStart({ userId, role }: { userId: string; role: Role }) {
  const { language } = useI18n();
  const de = language === 'DE';
  const snoozeKey = 'mindcrafti.push.quickStart.snoozedUntil.' + userId;
  const [phase, setPhase] = useState<Phase>('checking');
  const [config, setConfig] = useState<PushConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showIosGuide, setShowIosGuide] = useState(false);

  useEffect(() => {
    let active = true;
    setPhase('checking');
    setError(null);
    setConfig(null);
    setShowIosGuide(false);

    const check = async () => {
      // On iPhone, Web Push is available to an installed Home Screen app,
      // not a normal Safari tab. Explain installation before feature detection.
      const iosBrowser = isIPhoneOrIPad() && !homeScreenApp();
      if (iosBrowser) {
        if (active) {
          const snoozed = Number(localStorage.getItem(snoozeKey) || 0) > Date.now();
          setPhase(snoozed ? 'hidden' : 'ios-install');
          setShowIosGuide(!snoozed);
        }
        return;
      }
      if (!supported()) { if (active) setPhase('hidden'); return; }
      try {
        const nextConfig = await api.push.config();
        if (!active) return;
        if (!nextConfig.enabled || !nextConfig.publicKey) { setPhase('hidden'); return; }
        setConfig(nextConfig);
        const registration = await navigator.serviceWorker.register('/sw.js');
        let subscription = await registration.pushManager.getSubscription();

        // Permission already granted and subscription retained: no second user
        // gesture, settings visit, or test alert needed. Always rebind to the
        // currently authenticated user to avoid mixing parent/child devices.
        if (Notification.permission === 'granted') {
          try {
            if (subscription && !validKeys(subscription, nextConfig.publicKey)) {
              await subscription.unsubscribe();
              subscription = null;
            }
            // Previously approved notifications may be restored without asking
            // again, even if the browser discarded the original subscription.
            if (!subscription) {
              subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true, applicationServerKey: keyBuffer(nextConfig.publicKey),
              });
            }
            await api.push.subscribe(subscriptionData(subscription));
            if (active) setPhase('enabled');
            return;
          } catch {
            // Some browsers require a new gesture to recreate an expired push
            // subscription. Fall back to the same clear one-button flow.
          }
        }
        if (!active) return;
        const snoozed = Number(localStorage.getItem(snoozeKey) || 0) > Date.now();
        if (snoozed) setPhase('hidden');
        else if (Notification.permission === 'denied') setPhase('denied');
        else setPhase('ready');
      } catch {
        if (active) setPhase('hidden');
      }
    };
    void check();
    return () => { active = false; };
  }, [userId, snoozeKey]);

  function later() {
    localStorage.setItem(snoozeKey, String(Date.now() + DISMISS_DAYS * 86400000));
    setPhase('hidden');
    setShowIosGuide(false);
  }

  async function enable() {
    if (busy || !config || !supported() || (isIPhoneOrIPad() && !homeScreenApp())) return;
    setBusy(true);
    setError(null);
    try {
      // Trigger the browser's permission dialog synchronously from the click.
      // Do not prompt during login, rendering or background effects.
      const permissionRequest = Notification.permission === 'granted'
        ? Promise.resolve('granted') : Notification.requestPermission();
      const permission = await permissionRequest;
      if (permission !== 'granted') {
        setPhase(permission === 'denied' ? 'denied' : 'ready');
        return;
      }
      const registration = await navigator.serviceWorker.register('/sw.js');
      let subscription = await registration.pushManager.getSubscription();
      if (subscription && !validKeys(subscription, config.publicKey)) {
        await subscription.unsubscribe();
        subscription = null;
      }
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true, applicationServerKey: keyBuffer(config.publicKey),
        });
      }
      await api.push.subscribe(subscriptionData(subscription));
      setPhase('enabled');
      // A single welcome push confirms the device is connected; no repeat
      // tests on subsequent sign-ins or passive account resynchronization.
      void api.push.test().catch(() => undefined);
    } catch {
      setError(de
        ? 'Benachrichtigungen konnten nicht aktiviert werden. Bitte versuche es erneut.'
        : 'Не удалось включить уведомления. Попробуйте ещё раз.');
    } finally { setBusy(false); }
  }

  if (phase === 'checking' || phase === 'hidden' || phase === 'enabled') return null;

  const staff = role === 'ADMIN' || role === 'TEACHER';
  const title = de ? 'Keine wichtigen Schulnachrichten verpassen'
    : 'Не пропускайте важное от школы';
  const description = staff
    ? (de ? 'Aktivieren Sie Warnungen über fehlgeschlagene Arbeitshefte und wichtige Schulereignisse.'
      : 'Включите уведомления об ошибках генератора рабочих тетрадей и важных событиях школы.')
    : role === 'PARENT'
      ? (de ? 'Erhalten Sie Erinnerungen, wenn Hausaufgaben oder Lernkarten Ihres Kindes offen sind.'
        : 'Получайте напоминания, если ребёнок не выполнил домашку или карточки.')
      : (de ? 'Wir erinnern dich an offene Hausaufgaben und tägliche Lernkarten.'
        : 'Напомним о домашке и ежедневных карточках.');
  const ios = phase === 'ios-install';
  const denied = phase === 'denied';
  return <><section className="panel" aria-label={de ? 'Benachrichtigungen einrichten' : 'Подключить уведомления'}
    style={{ display: 'flex', gap: 12, padding: 16, marginBottom: 16, alignItems: 'flex-start' }}>
    <span aria-hidden="true" style={{ fontSize: 24 }}>🔔</span>
    <div style={{ flex: 1, minWidth: 0 }}>
      <strong style={{ display: 'block', marginBottom: 5 }}>{title}</strong>
      <p className="muted" style={{ margin: '0 0 10px' }}>{description}</p>
      {ios && <p style={{ margin: '0 0 10px' }}>
        {de
          ? 'iPhone/iPad: In Safari auf „Teilen“ → „Zum Home-Bildschirm“ tippen. Mindcrafti über das neue Symbol öffnen und dann die Benachrichtigungen erlauben.'
          : 'iPhone/iPad: в Safari нажмите «Поделиться» → «На экран Домой». Откройте Mindcrafti с нового значка, затем разрешите уведомления.'}
      </p>}
      {denied && <p style={{ margin: '0 0 10px' }}>
        {de ? 'Benachrichtigungen wurden im Browser blockiert. Erlauben Sie sie in den Browser- bzw. App-Einstellungen.'
          : 'Уведомления заблокированы в браузере. Разрешите их в настройках браузера или приложения.'}
      </p>}
      {error && <p role="alert" style={{ color: '#b91c1c', margin: '0 0 10px' }}>{error}</p>}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        {phase === 'ready' && <button className="btn" type="button" disabled={busy} onClick={() => void enable()}>
          {busy ? (de ? 'Wird aktiviert…' : 'Подключаем…')
            : (de ? 'Benachrichtigungen aktivieren' : 'Включить уведомления')}
        </button>}
        <Link className="btn btn--secondary" to={role === 'PARENT' ? '/parent/settings'
          : role === 'TEACHER' ? '/teacher/settings'
          : role === 'ADMIN' ? '/admin/settings' : '/settings'}>
          {de ? 'Einstellungen' : 'Настройки'}
        </Link>
        <button className="btn btn--ghost" type="button" onClick={later}>
          {de ? 'Später' : 'Позже'}
        </button>
      </div>
    </div>
  </section>
  {showIosGuide && ios && <IosPushInstallGuide de={de} role={role} onDismiss={() => {
    setShowIosGuide(false);
    localStorage.setItem(snoozeKey, String(Date.now() + DISMISS_DAYS * 86400000));
    setPhase('hidden');
  }} />}
  </>;
}
