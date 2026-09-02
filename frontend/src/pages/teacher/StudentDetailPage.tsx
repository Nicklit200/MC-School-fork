import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { Card, CardSummary } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import { toErrorMessage } from '../../lib/errors';
import { CardCreator } from './CardCreator';
import { CardRow } from './CardRow';
import { DriveFolderPicker } from './DriveFolderPicker';

/** Minimum cards a student needs before any session can start (mirrors the backend). */
const MIN_CARDS_TO_START = 4;

/** A single student's cards: status summary, add-cards panel, and the editable card list. */
export function StudentDetailPage() {
  const { studentId = '' } = useParams();
  const { t } = useI18n();
  const [cards, setCards] = useState<Card[]>([]);
  const [summary, setSummary] = useState<CardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const [cardList, cardSummary] = await Promise.all([
      api.cards.listForStudent(studentId),
      api.cards.summaryForStudent(studentId),
    ]);
    setCards(cardList);
    setSummary(cardSummary);
    setLoading(false);
  }, [studentId]);

  useEffect(() => {
    reload().catch((e) => setError(toErrorMessage(e, t)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload]);

  return (
    <div>
      <p>
        <Link to="/students" className="muted">← {t('common.back')}</Link>
      </p>
      <h1>{t('cards.title')}</h1>
      {error && <div className="banner banner--error">{error}</div>}

      {summary && (
        <>
          <div className="panel row center">
            <SummaryStat label={t('cards.summary.total')} value={summary.total} />
            <SummaryStat label={t('cards.summary.dueNow')} value={summary.dueNow} />
            <SummaryStat label={t('cards.summary.awaiting')} value={summary.awaitingRepetition} />
            <SummaryStat label={t('cards.summary.learned')} value={summary.learned} />
          </div>
          {summary.total < MIN_CARDS_TO_START && (
            <div className="banner banner--info">{t('cards.tooFew', { min: MIN_CARDS_TO_START })}</div>
          )}
        </>
      )}

      <h2>{t('cards.add')}</h2>
      <CardCreator studentId={studentId} onChanged={reload} />

      <div style={{ marginTop: 24 }}>
        <DriveFolderPicker />
      </div>

      <h2>{t('cards.title')}</h2>
      {loading ? (
        <p className="muted">{t('common.loading')}</p>
      ) : cards.length === 0 ? (
        <p className="muted">{t('cards.empty')}</p>
      ) : (
        cards.map((card) => <CardRow key={card.id} card={card} onChanged={reload} />)
      )}
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div style={{ fontSize: 28, fontWeight: 700 }}>{value}</div>
      <div className="muted" style={{ fontSize: 13 }}>{label}</div>
    </div>
  );
}
