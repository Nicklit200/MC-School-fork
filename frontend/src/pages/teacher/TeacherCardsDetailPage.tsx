import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { Card, Homework } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import { toErrorMessage } from '../../lib/errors';
import { CardCreator } from './CardCreator';
import { CardRow } from './CardRow';

/** Teacher view for one flashcard batch. PDF homework is intentionally not shown here. */
export function TeacherCardsDetailPage() {
  const { studentId = '', homeworkId = '' } = useParams();
  const { language, t } = useI18n();
  const [homeworks, setHomeworks] = useState<Homework[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const batch = useMemo(
    () => homeworks.find((item) => item.id === homeworkId) ?? null,
    [homeworks, homeworkId],
  );

  const reload = useCallback(async () => {
    const [homeworkList, cardList] = await Promise.all([
      api.homeworks.listForStudent(studentId),
      api.cards.listForHomework(homeworkId),
    ]);
    setHomeworks(homeworkList);
    setCards(cardList);
    setLoading(false);
  }, [studentId, homeworkId]);

  useEffect(() => {
    reload().catch((e) => {
      setError(toErrorMessage(e, t));
      setLoading(false);
    });
  }, [reload, t]);

  if (loading && !batch) {
    return <p className="muted">{t('common.loading')}</p>;
  }

  return (
    <div>
      <p>
        <Link to={`/students/${studentId}`} className="muted">
          ← {language === 'DE' ? 'Zurück zu den Karten' : 'Назад к карточкам'}
        </Link>
      </p>

      {error && <div className="banner banner--error">{error}</div>}
      {message && <div className="banner banner--success">{message}</div>}

      <h1>{batch ? formatDate(batch.startDate, language) : t('cards.title')}</h1>

      {batch && (
        <div className="panel row center" style={{ flexWrap: 'wrap', gap: 28 }}>
          <SummaryStat label={t('homeworks.total')} value={batch.totalCards} />
          <SummaryStat label={t('homeworks.notStarted')} value={batch.notStarted} />
          <SummaryStat label={t('homeworks.inProgress')} value={batch.inProgress} />
          <SummaryStat label={t('homeworks.learned')} value={batch.learned} />
        </div>
      )}

      <h2>{t('cards.add')}</h2>
      <CardCreator homeworkId={homeworkId} onChanged={reload} />

      <h2>{t('cards.title')}</h2>
      {loading ? (
        <p className="muted">{t('common.loading')}</p>
      ) : cards.length === 0 ? (
        <p className="muted">{t('cards.empty')}</p>
      ) : (
        cards.map((card) => (
          <CardRow
            key={card.id}
            card={card}
            onChanged={reload}
            onDeleted={() => setMessage(t('cards.deleted'))}
          />
        ))
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

function formatDate(date: string, language: 'DE' | 'RU') {
  return new Intl.DateTimeFormat(language === 'DE' ? 'de-DE' : 'ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(new Date(`${date}T00:00:00`));
}
