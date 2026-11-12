import { useState } from 'react';
import { trialInvitationsApi } from '../../api/trialInvitations';

export function TrialInvitationPanel({ eventId, de }: { eventId: string; de: boolean }) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function issue() {
    if (busy) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const invited = await trialInvitationsApi.issue(eventId);
      const link = window.location.origin + '/trial/join/' + encodeURIComponent(invited.token);
      setUrl(link);
      try {
        await navigator.clipboard.writeText(link);
        setMessage(de ? 'Einladungslink kopiert.' : 'Ссылка создана и скопирована.');
      } catch {
        setMessage(de ? 'Link erstellt. Bitte unten manuell kopieren.' : 'Ссылка создана. Скопируйте её из поля ниже.');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (de ? 'Link konnte nicht erstellt werden.' : 'Не удалось создать ссылку.'));
    } finally { setBusy(false); }
  }

  async function revoke() {
    if (busy || !window.confirm(de ? 'Einladung widerrufen?' : 'Отозвать приглашение?')) return;
    setBusy(true); setError('');
    try {
      await trialInvitationsApi.revoke(eventId);
      setUrl('');
      setMessage(de ? 'Einladung widerrufen.' : 'Ссылка отозвана.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось отозвать ссылку.');
    } finally { setBusy(false); }
  }

  return <section className="panel stack" aria-label={de ? 'Einladung zum Probeunterricht' : 'Приглашение на пробный урок'} style={{ marginTop: 16 }}>
    <h2 style={{ margin: 0 }}>{de ? 'Link zum Probeunterricht' : 'Ссылка на пробный урок'}</h2>
    <p className="muted">
      {de ? 'Bereite zuerst das Arbeitsheft vor. Der Schüler öffnet den Link, gibt seinen Namen ein und gelangt direkt zum normalen Unterrichtsraum. Kein Passwort notwendig.'
        : 'Подготовьте тетрадь как обычно. Ученик откроет ссылку, введёт имя и попадёт на нашу обычную онлайн-доску без регистрации.'}
    </p>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      <button className="btn" type="button" disabled={busy} onClick={() => void issue()}>
        {busy ? '...' : (de ? 'Link kopieren' : 'Скопировать ссылку')}
      </button>
      {url && <button className="btn btn--secondary" type="button" disabled={busy}
        onClick={() => void navigator.clipboard.writeText(url).then(() => setMessage('Ссылка скопирована')).catch(() => setMessage('Скопируйте ссылку из поля ниже'))}>
        {de ? 'Link kopieren' : 'Копировать'}
      </button>}
      <button className="btn btn--ghost" type="button" disabled={busy} onClick={() => void revoke()}>
        {de ? 'Link widerrufen' : 'Отозвать ссылку'}
      </button>
    </div>
    {url && <input className="input" aria-label={de ? 'Teilnahmelink' : 'Ссылка для ученика'} readOnly value={url}
      onFocus={event => event.currentTarget.select()} />}
    {message && <p role="status" className="muted">{message}</p>}
    {error && <p role="alert" className="banner banner--error">{error}</p>}
    <p className="muted" style={{ fontSize: 12 }}>
      {de ? 'Der Einladungslink bleibt fuer diesen Unterricht gleich. Bei Verbindungsproblemen kann der Schueler ihn erneut benutzen.'
        : 'Ссылка для этого урока постоянная. Ученик может открыть её повторно после обрыва соединения. Доступ можно отозвать.'}
    </p>
  </section>;
}
