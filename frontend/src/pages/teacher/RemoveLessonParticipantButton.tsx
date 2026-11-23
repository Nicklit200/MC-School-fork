import { useEffect, useId, useState } from 'react';

/** A lesson membership is not a group membership. Always confirm a one-off removal. */
export function RemoveLessonParticipantButton({
  studentName, disabled = false, de = false, onRemove,
}: {
  studentName: string;
  disabled?: boolean;
  de?: boolean;
  onRemove: () => Promise<boolean>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const headingId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!confirming) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) setConfirming(false);
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [confirming, busy]);

  const close = () => {
    if (!busy) { setConfirming(false); setError(false); }
  };
  async function confirmRemove() {
    if (busy) return;
    setBusy(true);
    setError(false);
    try {
      const removed = await onRemove();
      if (removed) setConfirming(false);
      else setError(true);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return <>
    <button
      type="button"
      disabled={disabled || busy}
      aria-label={de ? `${studentName} nur aus dieser Stunde entfernen` : `Убрать ${studentName} только из этого урока`}
      title={de ? 'Nur aus dieser Stunde entfernen' : 'Убрать только из этого урока'}
      onClick={() => { setError(false); setConfirming(true); }}
      style={{
        width: 34, height: 34, minWidth: 34, borderRadius: 10, display: 'inline-flex',
        alignItems: 'center', justifyContent: 'center', fontSize: 23, lineHeight: 1,
        background: '#fff7f7', color: '#b91c1c', border: '1px solid #fecaca',
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    ><span aria-hidden="true">−</span></button>
    {confirming && <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1400, background: 'rgba(15, 23, 42, 0.4)',
        padding: 16, display: 'grid', placeItems: 'center',
      }}
    >
      <div role="alertdialog" aria-modal="true" aria-labelledby={headingId} aria-describedby={descriptionId}
        style={{
          maxWidth: 440, width: '100%', borderRadius: 18, padding: 24,
          background: 'var(--surface, #fff)', color: 'var(--text, #0f172a)',
          boxShadow: '0 20px 60px rgba(15, 23, 42, 0.2)',
        }}
      >
        <h3 id={headingId} style={{ margin: '0 0 12px' }}>
          {de ? `${studentName} aus dieser Stunde entfernen?` : `Убрать ${studentName} из этого урока?`}
        </h3>
        <p id={descriptionId} style={{ margin: '0 0 18px', lineHeight: 1.55 }}>
          {de
            ? 'Der Schüler wird nur aus dieser einzelnen Stunde entfernt. Die feste Gruppe, andere Termine und gespeicherte Arbeitsblätter bleiben unverändert.'
            : 'Ученик будет удалён только из этого занятия. Основная группа, остальные уроки и сохранённые тетради не изменятся.'}
        </p>
        {error && <p role="alert" style={{ color: '#b91c1c' }}>
          {de ? 'Entfernen fehlgeschlagen. Bitte erneut versuchen.' : 'Не удалось убрать ученика. Попробуйте ещё раз.'}
        </p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 10 }}>
          <button type="button" className="btn btn--secondary" disabled={busy} onClick={close}>
            {de ? 'Abbrechen' : 'Отмена'}
          </button>
          <button type="button" className="btn" disabled={busy}
            style={{ background: '#b91c1c', color: '#fff' }}
            onClick={() => void confirmRemove()}>
            {busy ? (de ? 'Entfernen…' : 'Удаляем…')
              : (de ? 'Nur aus dieser Stunde entfernen' : 'Да, убрать только из этого урока')}
          </button>
        </div>
      </div>
    </div>}
  </>;
}
