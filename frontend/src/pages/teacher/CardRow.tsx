import { useState, type FormEvent } from 'react';
import { api } from '../../api/client';
import type { Card } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import { toErrorMessage } from '../../lib/errors';

/** One card in the teacher's list, with inline edit and delete. */
export function CardRow({
  card,
  onChanged,
  onDeleted,
}: {
  card: Card;
  onChanged: () => void;
  onDeleted?: () => void;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [question, setQuestion] = useState(card.question);
  const [answer, setAnswer] = useState(card.correctAnswer);
  const [timeLimit, setTimeLimit] = useState(
    card.timeLimitSeconds != null ? String(card.timeLimitSeconds) : '',
  );
  const [error, setError] = useState<string | null>(null);

  async function onSave(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const seconds = timeLimit.trim() === '' ? null : Number(timeLimit);
      await api.cards.update(card.id, question.trim(), answer.trim(), seconds);
      setEditing(false);
      onChanged();
    } catch (e) {
      setError(toErrorMessage(e, t));
    }
  }

  async function onDelete() {
    setError(null);
    try {
      await api.cards.remove(card.id);
      setConfirmingDelete(false);
      onDeleted?.();
      onChanged();
    } catch (e) {
      setError(toErrorMessage(e, t));
    }
  }

  if (editing) {
    return (
      <form className="panel" onSubmit={onSave}>
        {error && <div className="banner banner--error">{error}</div>}
        <label className="field">
          <span className="field__label">{t('cards.question')}</span>
          <input className="input" value={question} onChange={(e) => setQuestion(e.target.value)} required />
        </label>
        <label className="field">
          <span className="field__label">{t('cards.answer')}</span>
          <input className="input" value={answer} onChange={(e) => setAnswer(e.target.value)} required />
        </label>
        <label className="field">
          <span className="field__label">{t('cards.timeLimit')}</span>
          <input
            className="input"
            type="number"
            min={1}
            max={3600}
            value={timeLimit}
            onChange={(e) => setTimeLimit(e.target.value)}
            placeholder={t('cards.noLimit')}
          />
        </label>
        <div className="row">
          <button className="btn" type="submit">{t('common.save')}</button>
          <button className="btn btn--ghost" type="button" onClick={() => setEditing(false)}>
            {t('common.cancel')}
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="list-row">
      <div>
        <div className="list-row__title">{card.question}</div>
        <div className="muted">
          {card.correctAnswer}
          {card.timeLimitSeconds != null && ` · ⏱ ${card.timeLimitSeconds}${t('cards.secondsShort')}`}
        </div>
      </div>
      <div className="row" style={{ alignItems: 'center', flex: '0 0 auto' }}>
        <span className={`pill ${card.status === 'LEARNED' ? 'pill--learned' : 'pill--active'}`}>
          {t(`cards.status.${card.status}`)}
        </span>
        <button className="btn btn--ghost" type="button" onClick={() => setEditing(true)}>
          {t('common.edit')}
        </button>
        {confirmingDelete ? (
          <div className="row" style={{ alignItems: 'center' }}>
            <span className="muted">{t('cards.deletePrompt')}</span>
            <button className="btn btn--danger" type="button" onClick={onDelete}>
              {t('common.yes')}
            </button>
            <button className="btn btn--ghost" type="button" onClick={() => setConfirmingDelete(false)}>
              {t('common.cancel')}
            </button>
          </div>
        ) : (
          <button className="btn btn--danger" type="button" onClick={() => setConfirmingDelete(true)}>
            {t('common.delete')}
          </button>
        )}
      </div>
      {error && <div className="banner banner--error">{error}</div>}
    </div>
  );
}
