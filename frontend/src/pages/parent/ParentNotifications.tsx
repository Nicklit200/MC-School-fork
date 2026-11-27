import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { useI18n } from '../../i18n/I18nContext';
import './parent-dashboard.css';

type DeliveryStatus = {
  web: {enabled:boolean;registeredDevices:number;ready:boolean;emailAvailable:boolean}|null;
  native: {registeredDevices:number;ready:boolean}|null;
};

/** True for the existing approved TestFlight shell: it launches /parent?mobileRefresh=... */
function inNativeSchoolApp() {
  try {
    if (new URLSearchParams(location.search).has('mobileRefresh'))
      sessionStorage.setItem('mindcrafti.nativeApp','yes');
    return sessionStorage.getItem('mindcrafti.nativeApp') === 'yes';
  } catch { return false; }
}

/** Parents can see native TestFlight phones AND classic browser subscriptions. */
export function ParentNotifications({ compact = false }: { compact?: boolean }) {
  const {language} = useI18n();
  const de = language === 'DE';
  const [status,setStatus] = useState<DeliveryStatus|null>(null);
  const [testing,setTesting] = useState(false);
  const [result,setResult] = useState<string|null>(null);
  const nativeShell = inNativeSchoolApp();

  useEffect(() => {
    let active=true;
    const refresh=async () => {
      const [web,native]=await Promise.allSettled([
        api.push.status(),
        api.mobilePush.status(),
      ]);
      if(active) setStatus({
        web:web.status==='fulfilled'?web.value:null,
        native:native.status==='fulfilled'?native.value:null,
      });
    };
    void refresh();
    const timer=window.setInterval(() => { void refresh(); },25000);
    window.addEventListener('focus',refresh);
    window.addEventListener('mindcrafti-push-changed',refresh);
    return () => {
      active=false;
      clearInterval(timer);
      window.removeEventListener('focus',refresh);
      window.removeEventListener('mindcrafti-push-changed',refresh);
    };
  },[]);

  const nativeReady=Boolean(status?.native?.ready);
  const webReady=Boolean(status?.web?.ready);
  const ready=nativeReady||webReady;

  async function test() {
    if(testing)return;
    setTesting(true);setResult(null);
    try {
      if(nativeReady) await api.mobilePush.test();
      else await api.push.test();
      setResult(de ? 'Test wurde an den Benachrichtigungsdienst gesendet. Bitte am Telefon prüfen.'
        : 'Тест принят службой уведомлений. Проверьте телефон.');
    } catch {
      setResult(de ? 'Test fehlgeschlagen. Prüfe die Benachrichtigungserlaubnis und starte die App erneut.'
        : 'Тест не прошёл. Проверьте разрешение уведомлений и снова откройте приложение.');
    } finally {setTesting(false);}
  }

  if(!status || (compact&&ready))return null;
  if(compact) return <div className="parent-dashboard__notice" role="status">
    <span>{de ? 'Hausaufgabenbenachrichtigungen sind noch nicht verbunden.'
      : 'Уведомления о домашнем задании пока не подключены.'}</span>
    <Link to="/parent/settings">{de ? 'Einrichten':'Настроить'}</Link>
  </div>;

  return <section className="panel stack" aria-labelledby="parent-notification-status">
    <h2 id="parent-notification-status">{de ? 'Hausaufgaben-Erinnerungen':'Напоминания о домашней работе'}</h2>
    <p className="muted">{de
      ? '19:00 - heutige Hausaufgabe noch offen. 09:00 am Folgetag - gestrige Hausaufgabe fehlt und gilt als versäumt.'
      : 'В 19:00 - если сегодняшняя домашка ещё не сдана. В 09:00 следующего дня - если вчерашняя работа так и не сдана и считается пропущенной.'}
    </p>
    {ready ? <>
      <p><strong>{de ? 'Verbunden':'Подключено'}</strong></p>
      {nativeReady && <p className="muted">
        {de ? 'Mindcrafti App (iPhone/Android): ' : 'Приложение Mindcrafti (iPhone/Android): '}
        {status.native!.registeredDevices} {de?'Geräte':'устройств'}
      </p>}
      {webReady && <p className="muted">
        {de?'Browser / Home-Bildschirm: ':'Браузер / экран Домой: '}
        {status.web!.registeredDevices} {de?'Geräte':'устройств'}
      </p>}
      <button className="btn btn--secondary" type="button" disabled={testing} onClick={() => void test()}>
        {testing ? (de?'Test wird gesendet…':'Отправляем…')
          : (de?'Test-Push an mein Gerät':'Отправить тест на телефон')}
      </button>
      {result && <p role="status">{result}</p>}
    </> : <div className="muted" role="status">
      <p>{de?'Benachrichtigungen sind für dieses Konto noch nicht verbunden.'
        :'На этом аккаунте пока нет подключённого телефона для уведомлений.'}</p>
      <p>{nativeShell
        ? (de
          ? 'Öffne iOS Einstellungen > Mitteilungen > Mindcrafti und erlaube Mitteilungen. Danach die Mindcrafti App vollständig neu starten.'
          : 'Откройте «Настройки iPhone → Уведомления → Mindcrafti» и разрешите уведомления. Затем полностью закройте и снова откройте Mindcrafti из TestFlight.')
        : (de
          ? 'Öffnen Sie die Mindcrafti App aus TestFlight und erlauben Sie Mitteilungen bei der Anmeldung. Im Safari-Browser ist eine Home-Bildschirm-Installation erforderlich.'
          : 'Откройте приложение Mindcrafti из TestFlight и разрешите уведомления после входа. Только для версии Safari потребуется добавить сайт на экран Домой.')}</p>
      {!status.web?.emailAvailable && <p>
        {de?'Für dieses Konto ist keine E-Mail-Adresse für eine alternative Nachricht hinterlegt.'
          :'Для этого аккаунта не указан email для резервного сообщения.'}
      </p>}
    </div>}
  </section>;
}
