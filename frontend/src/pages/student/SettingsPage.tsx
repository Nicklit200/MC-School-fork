import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { Language } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { useI18n } from '../../i18n/I18nContext';
import { toErrorMessage } from '../../lib/errors';

/** Student settings: language and free PWA push notifications. */
export function SettingsPage() {
  const { t, language, setLanguage } = useI18n();
  const { user, setUser } = useAuth();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushConfigured, setPushConfigured] = useState<boolean | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const languages: Language[] = ['RU', 'DE'];

  useEffect(() => {
    async function loadPushState() {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        setPushConfigured(false);
        return;
      }
      try {
        const config = await api.push.config();
        setPushConfigured(config.enabled);
        if (!config.enabled) return;

        const registration = await navigator.serviceWorker.register('/sw.js');
        await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();

        if (!subscription) {
          setPushEnabled(false);
          return;
        }

        // A browser may still have a local subscription while the backend no longer
        // has it (for example after a database reset) or while it is bound to an old
        // account on the same device. Re-register it every time Settings is opened.
        const json = subscription.toJSON();
        if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
          setPushEnabled(false);
          return;
        }
        await api.push.subscribe({ endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth });
        setPushEnabled(true);
      } catch {
        setPushConfigured(false);
        setPushEnabled(false);
      }
    }
    loadPushState();
  }, []);

  async function choose(next: Language) {
    setError(null);
    setSaved(false);
    setLanguage(next);
    try {
      const updated = await api.users.updateLanguage(next);
      if (user) setUser(updated);
      setSaved(true);
    } catch (e) {
      setError(toErrorMessage(e, t));
    }
  }

  async function enablePush() {
    setPushBusy(true);
    setError(null);
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        throw new Error(language === 'DE' ? 'Push-Benachrichtigungen werden auf diesem Gerät nicht unterstützt.' : 'На этом устройстве push-уведомления не поддерживаются.');
      }
      const config = await api.push.config();
      if (!config.enabled || !config.publicKey) {
        throw new Error(language === 'DE' ? 'Push ist auf dem Server noch nicht konfiguriert.' : 'Push на сервере пока не настроен.');
      }
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        throw new Error(language === 'DE' ? 'Benachrichtigungen wurden nicht erlaubt.' : 'Разрешение на уведомления не выдано.');
      }
      const registration = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToArrayBuffer(config.publicKey),
        });
      }
      const json = subscription.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
        throw new Error('Invalid push subscription');
      }
      await api.push.subscribe({ endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth });
      setPushEnabled(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : toErrorMessage(e, t));
    } finally {
      setPushBusy(false);
    }
  }

  async function disablePush() {
    setPushBusy(true);
    setError(null);
    try {
      const registration = await navigator.serviceWorker.getRegistration('/');
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        const json = subscription.toJSON();
        if (json.endpoint && json.keys?.p256dh && json.keys?.auth) {
          await api.push.unsubscribe({ endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth });
        }
        await subscription.unsubscribe();
      }
      setPushEnabled(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : toErrorMessage(e, t));
    } finally {
      setPushBusy(false);
    }
  }

  async function testPush() {
    setPushBusy(true);
    setError(null);
    try {
      await api.push.test();
    } catch (e) {
      setError(e instanceof Error ? e.message : toErrorMessage(e, t));
    } finally {
      setPushBusy(false);
    }
  }

  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

  return (
    <div className="stack">
      <h1>{t('settings.title')}</h1>
      {error && <div className="banner banner--error">{error}</div>}
      {saved && <div className="banner banner--success">{t('settings.saved')}</div>}

      <div className="panel">
        <div className="field__label">{t('settings.language')}</div>
        <div className="stack">
          {languages.map((lang) => (
            <button
              key={lang}
              type="button"
              className={`btn btn--block ${language === lang ? '' : 'btn--secondary'}`}
              onClick={() => choose(lang)}
            >
              {t(`lang.${lang}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="panel stack">
        <div>
          <h2 style={{ marginTop: 0 }}>{language === 'DE' ? 'Handy-Benachrichtigungen' : 'Уведомления на телефон'}</h2>
          <p className="muted" style={{ marginBottom: 0 }}>
            {language === 'DE'
              ? 'Kostenlose Erinnerung an Karten und offene Hausaufgaben.'
              : 'Бесплатное напоминание о карточках и невыполненной домашке.'}
          </p>
        </div>

        {ios && !standalone && (
          <div className="banner banner--info">
            {language === 'DE'
              ? 'Auf iPhone/iPad: zuerst Teilen → Zum Home-Bildschirm. Danach Mindcrafti vom Home-Bildschirm öffnen und Benachrichtigungen aktivieren.'
              : 'На iPhone/iPad сначала нажми «Поделиться» → «На экран Домой». Потом открой Mindcrafti с домашнего экрана и включи уведомления.'}
          </div>
        )}

        {pushConfigured === false && (
          <div className="banner banner--info">
            {language === 'DE' ? 'Server-Konfiguration wird noch vorbereitet.' : 'Серверная часть push пока не активирована.'}
          </div>
        )}

        {!pushEnabled ? (
          <button className="btn btn--block" type="button" disabled={pushBusy || pushConfigured === false || (ios && !standalone)} onClick={enablePush}>
            {pushBusy ? (language === 'DE' ? 'Wird aktiviert…' : 'Включаем…') : (language === 'DE' ? 'Benachrichtigungen aktivieren' : 'Включить уведомления')}
          </button>
        ) : (
          <>
            <div className="banner banner--success">
              {language === 'DE' ? 'Benachrichtigungen sind aktiviert.' : 'Уведомления включены.'}
            </div>
            <button className="btn btn--secondary btn--block" type="button" disabled={pushBusy} onClick={testPush}>
              {language === 'DE' ? 'Test senden' : 'Отправить тест'}
            </button>
            <button className="btn btn--ghost btn--block" type="button" disabled={pushBusy} onClick={disablePush}>
              {language === 'DE' ? 'Benachrichtigungen ausschalten' : 'Выключить уведомления'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function urlBase64ToArrayBuffer(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const bytes = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    bytes[i] = rawData.charCodeAt(i);
  }
  return bytes.buffer;
}
