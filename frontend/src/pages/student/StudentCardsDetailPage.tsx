import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { Card, Homework } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import { toErrorMessage } from '../../lib/errors';

export function StudentCardsDetailPage() {
  const { homeworkId = '' } = useParams();
  const navigate = useNavigate();
  const { language, t } = useI18n();
  const [homeworks, setHomeworks] = useState<Homework[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const homework = useMemo(
    () => homeworks.find((item) => item.id === homeworkId) ?? null,
    [homeworks, homeworkId],
  );

  const reload = useCallback(async () => {
    const [homeworkPayload, cardPayload] = await Promise.all([
      api.study.homeworks(),
      api.study.homeworkCards(homeworkId),
    ]);
    setHomeworks(homeworkPayload);
    setCards(cardPayload);
    setLoading(false);
  }, [homeworkId]);

  useEffect(() => {
    reload().catch((e) => {
      setError(toErrorMessage(e, t));
      setLoading(false);
    });
  }, [reload, t]);

  async function startPractice() {
    setBusy(true);
    setError(null);
    try {
      const session = await api.study.startSession('PRACTICE', homeworkId);
      navigate(`/session/${session.id}`);
    } catch (e) {
      setError(toErrorMessage(e, t));
      setBusy(false);
    }
  }

  return (
    <div>
      <p><Link to="/my-cards" className="muted">← {t('common.back')}</Link></p>
      {error && <div className="banner banner--error">{error}</div>}

      <h1>{homework ? formatDate(homework.startDate, language) : t('nav.myCards')}</h1>

      {homework && (
        <div className="panel row center">
          <SummaryStat label={t('homeworks.total')} value={homework.totalCards} />
          <SummaryStat label={t('homeworks.notStarted')} value={homework.notStarted} />
          <SummaryStat label={t('homeworks.inProgress')} value={homework.inProgress} />
          <SummaryStat label={t('homeworks.learned')} value={homework.learned} />
        </div>
      )}

      <button className="btn btn--block" type="button" onClick={startPractice} disabled={busy || cards.length === 0}>
        {t('homeworks.practice')}
      </button>

      <h2>{t('cards.title')}</h2>
      {loading ? (
        <p className="muted">{t('common.loading')}</p>
      ) : cards.length === 0 ? (
        <p className="muted">{t('cards.empty')}</p>
      ) : (
        <div className="panel stack">
          {cards.map((card) => (
            <div key={card.id} className="list-row">
              <div>
                <div className="list-row__title">{card.question}</div>
                <div className="muted">{card.correctAnswer}</div>
              </div>
              <span className={`pill ${card.status === 'LEARNED' ? 'pill--learned' : 'pill--active'}`}>
                {t(`cards.status.${card.status}`)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatDate(date: string, language: 'DE' | 'RU') {
  return new Intl.DateTimeFormat(language === 'DE' ? 'de-DE' : 'ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(new Date(`${date}T00:00:00`));
}

function SummaryStat({ label, value }: { label: string; value: number }) {
  return <div><div style={{ fontSize: 28, fontWeight: 700 }}>{value}</div><div className="muted" style={{ fontSize: 13 }}>{label}</div></div>;
}
