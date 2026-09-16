import { useState, type FormEvent } from 'react';
import { api } from '../../api/client';
import type { ImportPreview } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import { toErrorMessage } from '../../lib/errors';

type Tab = 'manual' | 'import';

/** Add cards to a student, either one by one or by pasting "question → answer" text. */
export function CardCreator({ homeworkId, onChanged }: { homeworkId: string | null; onChanged: () => void }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('manual');

  if (!homeworkId) {
    return <div className="panel muted">{t('homeworks.selectFirst')}</div>;
  }

  return (
    <div className="panel">
      <div className="row" style={{ marginBottom: 16 }}>
        <button
          type="button"
          className={`btn ${tab === 'manual' ? '' : 'btn--ghost'}`}
          onClick={() => setTab('manual')}
        >
          {t('createCards.manual')}
        </button>
        <button
          type="button"
          className={`btn ${tab === 'import' ? '' : 'btn--ghost'}`}
          onClick={() => setTab('import')}
        >
          {t('createCards.import')}
        </button>
      </div>
      {tab === 'manual' ? (
        <ManualForm homeworkId={homeworkId} onChanged={onChanged} />
      ) : (
        <ImportForm homeworkId={homeworkId} onChanged={onChanged} />
      )}
    </div>
  );
}

function ManualForm({ homeworkId, onChanged }: { homeworkId: string; onChanged: () => void }) {
  const { t } = useI18n();
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [timeLimit, setTimeLimit] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    try {
      const seconds = timeLimit.trim() === '' ? null : Number(timeLimit);
      await api.cards.createInHomework(homeworkId, question.trim(), answer.trim(), seconds);
      setQuestion('');
      setAnswer('');
      setTimeLimit('');
      setSaved(true);
      onChanged();
    } catch (e) {
      setError(toErrorMessage(e, t));
    }
  }

  return (
    <form onSubmit={onSubmit}>
      {error && <div className="banner banner--error">{error}</div>}
      {saved && <div className="banner banner--success">{t('createCards.saved')}</div>}
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
      <button className="btn" type="submit">{t('createCards.addOne')}</button>
    </form>
  );
}

function ImportForm({ homeworkId, onChanged }: { homeworkId: string; onChanged: () => void }) {
  const { t } = useI18n();
  const [rawText, setRawText] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [imported, setImported] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onPreview(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setImported(false);
    try {
      setPreview(await api.cards.importPreview(rawText, '->', '\n'));
    } catch (e) {
      setError(toErrorMessage(e, t));
    }
  }

  async function onConfirm() {
    if (!preview || preview.cards.length === 0) {
      return;
    }
    setError(null);
    try {
      await api.cards.importConfirmInHomework(homeworkId, preview.cards);
      setPreview(null);
      setRawText('');
      setImported(true);
      onChanged();
    } catch (e) {
      setError(toErrorMessage(e, t));
    }
  }

  return (
    <div>
      {error && <div className="banner banner--error">{error}</div>}
      {imported && <div className="banner banner--success">{t('createCards.imported')}</div>}
      <form onSubmit={onPreview}>
        <label className="field">
          <span className="field__label">{t('createCards.rawText')}</span>
          <textarea
            className="textarea"
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder={'2 + 2 -> 4 | 3 | 5 | 6\n3 + 3 -> 6 | 5 | 7 | 9'}
            required
          />
        </label>
        <button className="btn btn--secondary" type="submit">{t('createCards.preview')}</button>
      </form>

      {preview && (
        <div style={{ marginTop: 16 }}>
          <h2>
            {t('createCards.previewCount')}: {preview.cards.length}
          </h2>
          {preview.cards.map((card, index) => (
            <div key={index} className="list-row">
              <div>
                <div className="list-row__title">{card.question}</div>
                <div className="muted">{t('cards.answer')}: {card.correctAnswer}</div>
                <div className="muted">
                  {t('createCards.wrongAnswers')}: {card.wrongAnswer1} · {card.wrongAnswer2} · {card.wrongAnswer3}
                </div>
              </div>
            </div>
          ))}
          {preview.warnings.length > 0 && (
            <div className="banner banner--info">
              <strong>{t('createCards.warnings')}:</strong>
              <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                {preview.warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            </div>
          )}
          <button className="btn" type="button" onClick={onConfirm} disabled={preview.cards.length === 0}>
            {t('createCards.confirmImport')} ({preview.cards.length})
          </button>
        </div>
      )}
    </div>
  );
}
