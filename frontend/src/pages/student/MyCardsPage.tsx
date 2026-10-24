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
    <div><h1>{t('nav.myCards')}</h1>
      {cardBatches.length === 0 ? <p className="muted">{t('cards.empty')}</p> : <div className="student-batches">
        {cardBatches.map(homework => <Link key={homework.id} className="panel student-batch" to={`/my-cards/${homework.id}`}>
          <h2>{homework.startDate}</h2>
          <div className="student-batch__stats">
            <div><strong>{homework.totalCards}</strong><small>{t('homeworks.total')}</small></div>
            <div><strong>{homework.notStarted}</strong><small>{t('homeworks.notStarted')}</small></div>
            <div><strong>{homework.inProgress}</strong><small>{t('homeworks.inProgress')}</small></div>
            <div><strong>{homework.learned}</strong><small>{t('homeworks.learned')}</small></div>
          </div>
          <span className="student-batch__open" aria-hidden="true">→</span>
        </Link>)}
      </div>}
    </div>
  );
}
