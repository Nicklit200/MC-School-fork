import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { useI18n } from '../../i18n/I18nContext';
import './parent-dashboard.css';

/** Account-wide delivery status, separate from the current browser's permission. */
export function ParentNotifications({ compact = false }: { compact?: boolean }) {
  const { language } = useI18n();
  const de = language === 'DE';
  const [status, setStatus] = useState<{ enabled: boolean; registeredDevices: number; ready: boolean; emailAvailable: boolean } | null>(null);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const refresh = () => { void api.push.status().then((next) => { if (active) setStatus(next); }).catch(() => { if (active) setStatus(null); }); };
    refresh();
    window.addEventListener('focus', refresh);
    window.addEventListener('mindcrafti-push-changed', refresh);
    return () => {
      active = false;
      window.removeEventListener('focus', refresh);
      window.removeEventListener('mindcrafti-push-changed', refresh);
    };
  }, []);

  async function test() {
    if (testing) return;
    setTesting(true);
    setResult(null);
    try {
      await api.push.test();
      setResult(de ? 'Test gesendet. Prüfen Sie die Benachrichtigungen auf Ihrem Gerät.' : 'Тест отправлен. Проверьте уведомления на устройстве.');
    } catch {
      setResult(de ? 'Test konnte nicht zugestellt werden. Bitte Benachrichtigungen im Browser erlauben und die Geräteverbindung erneuern.' : 'Тест не прошёл. Разрешите уведомления в браузере и подключите устройство заново.');
    } finally { setTesting(false); }
  }

  if (!status || (compact && status.ready)) return null;
  if (compact) return <div className="parent-dashboard__notice" role="status">
    <span>{de ? 'Erinnerungen an offene Aufgaben sind noch nicht eingerichtet.' : 'Напоминания о невыполненных заданиях пока не подключены.'}</span>
    <Link to="/parent/settings">{de ? 'Einrichten' : 'Настроить'}</Link>
  </div>;

  return <section className="panel stack" aria-labelledby="parent-notification-status">
    <h2 id="parent-notification-status">{de ? 'Abenderinnerungen' : 'Вечерние напоминания'}</h2>
    {status.ready ? <>
      <p className="muted">{de ? 'Verbundene Geräte: ' : 'Подключено устройств: '}{status.registeredDevices}</p>
      <button className="btn btn--secondary" type="button" disabled={testing} onClick={() => void test()}>{testing ? (de ? 'Wird gesendet…' : 'Отправляем…') : (de ? 'Testnachricht senden' : 'Проверить уведомление')}</button>
      {result && <p role="status">{result}</p>}
    </> : <div className="muted" role="status">
      <p>{de ? 'Abenderinnerungen sind für dieses Konto nicht eingerichtet.' : 'Вечерние уведомления для этого аккаунта не подключены.'}</p>
      <p>{de ? 'Aktivieren Sie oben die Benachrichtigungen auf Ihrem Gerät. Auf dem iPhone öffnen Sie Mindcrafti zuerst über den Home-Bildschirm.' : 'Включите уведомления на этом устройстве. На iPhone сначала откройте Mindcrafti с экрана Домой.'}</p>
      {!status.emailAvailable && <p>{de ? 'Es ist keine E-Mail-Adresse für eine alternative Nachricht hinterlegt.' : 'У аккаунта также нет email для резервного сообщения.'}</p>}
    </div>}
  </section>;
}
