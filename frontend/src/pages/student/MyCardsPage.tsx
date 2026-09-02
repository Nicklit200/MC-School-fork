import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import type { Homework } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import { toErrorMessage } from '../../lib/errors';

/** The student's flashcard batches only. PDF homework has its own top-level page. */
export function MyCardsPage() {
  const { t } = useI18n();
  const [items, setItems] = useState<Homework[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.study
      .homeworks()
      .then(setItems)
      .catch((e) => setError(toErrorMessage(e, t)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cardBatches = useMemo(() => (items ?? []).filter((item) => item.totalCards > 0), [items]);

  if (error) return <div className="banner banner--error">{error}</div>;
  if (!items) return <p className="muted">{t('common.loading')}</p>;

  return (
    <div>
      <h1>{t('nav.myCards')}</h1>
      {cardBatches.length === 0 ? (
        <p className="muted">{t('cards.empty')}</p>
      ) : (
        <div className="panel stack">
          {cardBatches.map((homework) => (
            <Link
              key={homework.id}
              className="list-row"
              to={`/my-cards/${homework.id}`}
              style={{ textDecoration: 'none' }}
            >
              <div className="list-row__title">{homework.startDate}</div>
              <div className="muted">
                {t('homeworks.total')}: {homework.totalCards} · {t('homeworks.notStarted')}: {homework.notStarted} ·{' '}
                {t('homeworks.inProgress')}: {homework.inProgress} · {t('homeworks.learned')}: {homework.learned}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
