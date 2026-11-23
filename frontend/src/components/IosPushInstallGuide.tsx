import { useEffect, useRef } from 'react';
import './ios-push-install-guide.css';

type Props = { de: boolean; role: 'PARENT' | 'STUDENT' | 'TEACHER' | 'ADMIN'; onDismiss: () => void };

function ShareIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true">
      <path d="M12 15V3m0 0L7.5 7.5M12 3l4.5 4.5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>
    </svg>
  );
}

/**
 * iPhone Home Screen installation is a user-controlled Safari action.
 * Explain each physical tap immediately after the first sign-in, never
 * pretend that a website can install itself or grant push permission.
 */
export function IosPushInstallGuide({ de, role, onDismiss }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    function keydown(event: KeyboardEvent) {
      if (event.key === 'Escape') dismissRef.current();
    }
    window.addEventListener('keydown', keydown);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', keydown);
    };
  }, []);

  const steps = de ? [
    {
      icon: '🧭',
      title: 'Mindcrafti in Safari öffnen',
      detail: 'Falls du die Schule aus WhatsApp, Instagram oder einer anderen App geöffnet hast, öffne dieselbe Adresse direkt in Safari.',
    },
    {
      icon: <ShareIcon />,
      title: 'Auf „Teilen“ tippen',
      detail: 'Das Symbol zeigt ein Quadrat mit Pfeil nach oben. Falls es nicht sichtbar ist, öffne zuerst das Seitenmenü (⋯) und wähle „Teilen“.',
    },
    {
      icon: '＋',
      title: '„Zum Home-Bildschirm“ wählen',
      detail: 'Scrolle im Teilen-Menü nach unten. Aktiviere gegebenenfalls „Als Web-App öffnen“ und tippe oben auf „Hinzufügen“.',
    },
    {
      icon: '🔔',
      title: 'Mindcrafti über das neue Symbol starten',
      detail: 'Öffne die Schule vom iPhone-Home-Bildschirm. Tippe auf „Benachrichtigungen aktivieren“ und bestätige „Erlauben“.',
    },
  ] : [
    {
      icon: '🧭',
      title: 'Откройте Mindcrafti в Safari',
      detail: 'Если ссылка открылась из WhatsApp, Instagram или другого приложения, откройте тот же адрес непосредственно в Safari.',
    },
    {
      icon: <ShareIcon />,
      title: 'Нажмите «Поделиться»',
      detail: 'Ищите значок квадрата со стрелкой вверх. Если его не видно, откройте меню страницы (⋯), затем выберите «Поделиться».',
    },
    {
      icon: '＋',
      title: 'Выберите «На экран Домой»',
      detail: 'Прокрутите меню вниз. Если есть переключатель «Открыть как веб-приложение», включите его, затем нажмите «Добавить».',
    },
    {
      icon: '🔔',
      title: 'Откройте Mindcrafti с нового значка',
      detail: 'На главном экране iPhone нажмите значок Mindcrafti. В школе выберите «Включить уведомления», затем «Разрешить».',
    },
  ];

  return (
    <div className="ios-push-guide__overlay">
      <section className="ios-push-guide" role="dialog" aria-modal="true"
        aria-labelledby="ios-push-guide-title" aria-describedby="ios-push-guide-intro">
        <div className="ios-push-guide__header">
          <div className="ios-push-guide__logo" aria-hidden="true">M</div>
          <span className="ios-push-guide__brand">Mindcrafti School</span>
          <button ref={closeRef} type="button" className="ios-push-guide__close"
            onClick={onDismiss} aria-label={de ? 'Anleitung schließen' : 'Закрыть инструкцию'}>
            ×
          </button>
        </div>
        <div className="ios-push-guide__content">
          <span className="ios-push-guide__eyebrow">
            {de ? 'IPHONE · EINMALIGE EINRICHTUNG' : 'IPHONE · ПЕРВАЯ НАСТРОЙКА'}
          </span>
          <h2 id="ios-push-guide-title">
            {de ? 'Schul-Benachrichtigungen auf dem iPhone aktivieren'
              : 'Как включить уведомления Mindcrafti на iPhone'}
          </h2>
          <p id="ios-push-guide-intro">
            {role === 'PARENT'
              ? (de ? 'Damit du Erinnerungen zur Lernarbeit deines Kindes erhältst, füge die Schule zuerst als App auf deinem Home-Bildschirm hinzu.'
                : 'Чтобы получать напоминания о домашней работе ребёнка, сначала добавьте школу на экран iPhone.')
              : role === 'STUDENT'
                ? (de ? 'Damit du keine Hausaufgaben verpasst, füge die Schule zuerst als App auf deinem Home-Bildschirm hinzu.'
                    : 'Чтобы не пропускать домашку, сначала добавьте школу на главный экран iPhone.')
                : (de ? 'Für Warnungen über Workbook-Fehler installieren Sie Mindcrafti als App auf dem Home-Bildschirm.'
                    : 'Чтобы получать предупреждения об ошибках генератора, добавьте Mindcrafti на главный экран iPhone.')}
          </p>
          <ol className="ios-push-guide__steps">
            {steps.map((step, index) => (
              <li key={step.title} className="ios-push-guide__step">
                <span className="ios-push-guide__step-number">{index + 1}</span>
                <span className="ios-push-guide__step-icon" aria-hidden="true">{step.icon}</span>
                <div className="ios-push-guide__step-copy">
                  <strong>{step.title}</strong>
                  <p>{step.detail}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="ios-push-guide__hint">
            {de ? 'Die Zustimmung zu Benachrichtigungen erfolgt erst nach deinem Klick in der installierten App. Diesen Schritt kann die Schule nicht automatisch übernehmen.'
              : 'Разрешить уведомления можно только самостоятельно. Школа не запрашивает доступ без вашего нажатия.'}
          </p>
        </div>
        <div className="ios-push-guide__footer">
          <button type="button" className="ios-push-guide__primary" onClick={onDismiss}>
            {de ? 'Verstanden' : 'Понятно'}
          </button>
          <button type="button" className="ios-push-guide__secondary" onClick={onDismiss}>
            {de ? 'Später erinnern' : 'Напомнить позже'}
          </button>
        </div>
      </section>
    </div>
  );
}
