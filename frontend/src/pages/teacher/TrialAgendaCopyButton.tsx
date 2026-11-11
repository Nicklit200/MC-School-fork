import { useState } from 'react';
import { trialInvitationsApi } from '../../api/trialInvitations';

/** Copy the same lesson-scoped URL from the timetable without opening the lesson. */
export function TrialAgendaCopyButton({ eventId, de }: { eventId: string; de: boolean }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [fallback, setFallback] = useState('');

  async function copy() {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      const issued = await trialInvitationsApi.issue(eventId);
      const url = window.location.origin + '/trial/join/' + encodeURIComponent(issued.token);
      try {
        await navigator.clipboard.writeText(url);
        setFallback('');
        setMessage(de ? 'Link kopiert' : 'Ссылка скопирована');
      } catch {
        setFallback(url);
        setMessage(de ? 'Link unten manuell kopieren' : 'Скопируйте ссылку из поля ниже');
      }
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message :
        (de ? 'Link konnte nicht erstellt werden' : 'Не удалось получить ссылку'));
    } finally {
      setBusy(false);
    }
  }

  return <div className="lesson-trial-share" data-testid="trial-share">
    <button type="button" className="btn btn--secondary lesson-trial-share__button"
      disabled={busy} aria-label={de ? 'Einladungslink kopieren' : 'Скопировать ссылку на пробный урок'}
      onClick={() => void copy()}>
      {busy ? (de ? 'Wird kopiert...' : 'Копируем...') :
        (de ? 'Link kopieren' : 'Скопировать ссылку')}
    </button>
    {message && <span className="lesson-trial-share__status" role="status">{message}</span>}
    {fallback && <input className="input lesson-trial-share__fallback" aria-label={de ? 'Teilnahmelink' : 'Ссылка для ученика'} value={fallback}
      readOnly onFocus={e => e.currentTarget.select()}/>}
  </div>;
}
