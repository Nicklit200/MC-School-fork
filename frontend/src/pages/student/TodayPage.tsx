import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import type { Homework, SessionType, Today } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import { toErrorMessage } from '../../lib/errors';

/** Student home: today's card review and today's PDF homework are separate tasks. */
export function TodayPage() {
  const { language, t } = useI18n();
  const navigate = useNavigate();
  const [today, setToday] = useState<Today | null>(null);
  const [homeworks, setHomeworks] = useState<Homework[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([api.study.today(), api.study.homeworks()])
      .then(([todayPayload, homeworkPayload]) => {
        setToday(todayPayload);
        setHomeworks(homeworkPayload);
      })
      .catch((e) => setError(toErrorMessage(e, t)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const todayHomeworks = useMemo(() => {
    const todayDate = localDateString(new Date());
    return homeworks.filter(
      (homework) => homework.hasWorksheet && homework.startDate === todayDate && !homework.submitted,
    );
  }, [homeworks]);

  async function start(type: SessionType) {
    setError(null);
    setBusy(true);
    try {
      const session = await api.study.startSession(type);
      navigate(`/session/${session.id}`);
    } catch (e) {
      setError(toErrorMessage(e, t));
      setBusy(false);
    }
  }

  if (!today) {
    return <p className="muted">{error ?? t('common.loading')}</p>;
  }

  const notEnoughCards = today.totalCards < today.minCardsToStart;

  return (
    <div className="stack">
      <h1>{t('today.title')}</h1>
      {error && <div className="banner banner--error">{error}</div>}

      <h2 style={{ marginBottom: 0 }}>{language === 'DE' ? 'Karten heute' : 'Карточки сегодня'}</h2>
      <div className="panel center">
        <div className="result__stat">{today.dueCardCount}</div>
        <div className="muted">{t('today.due')}</div>
      </div>

      {today.inProgressSessionId && (
        <button
          className="btn btn--block"
          type="button"
          onClick={() => navigate(`/session/${today.inProgressSessionId}`)}
        >
          {t('today.resume')}
        </button>
      )}

      {notEnoughCards ? (
        <div className="banner banner--info">
          {t('today.needMoreCards', { min: today.minCardsToStart })}
        </div>
      ) : (
        <>
          {today.canStartScheduled ? (
            <button className="btn btn--block" type="button" disabled={busy} onClick={() => start('SCHEDULED')}>
              {t('today.start')}
            </button>
          ) : (
            !today.inProgressSessionId && <div className="banner banner--success">{t('today.nothingDue')}</div>
          )}
          {today.canPractice && (
            <button
              className="btn btn--secondary btn--block"
              type="button"
              disabled={busy}
              onClick={() => start('PRACTICE')}
            >
              {t('today.practice')}
            </button>
          )}
        </>
      )}

      <p className="muted center">
        {t('today.learned')}: {today.learnedCount}
      </p>

      <h2 style={{ marginBottom: 0 }}>{language === 'DE' ? 'Hausaufgabe heute' : 'Домашка сегодня'}</h2>
      {todayHomeworks.length === 0 ? (
        <div className="banner banner--success">
          {language === 'DE' ? 'Für heute gibt es keine offene Hausaufgabe 🎉' : 'На сегодня невыполненной домашки нет 🎉'}
        </div>
      ) : (
        <div className="panel stack">
          <div className="center">
            <div className="result__stat">{todayHomeworks.length}</div>
            <div className="muted">
              {language === 'DE' ? 'Offene Hausaufgaben für heute' : 'Домашних заданий осталось на сегодня'}
            </div>
          </div>
          {todayHomeworks.map((homework) => (
            <Link
              key={homework.id}
              className="list-row"
              to={`/student/homeworks/${homework.id}/worksheet`}
              style={{ textDecoration: 'none' }}
            >
              <div>
                <div className="list-row__title">
                  {homework.worksheetFilename ?? (language === 'DE' ? 'PDF-Hausaufgabe' : 'Домашка в PDF')}
                </div>
                <div className="muted">
                  {homework.worksheetPageCount
                    ? `${homework.worksheetPageCount} ${language === 'DE' ? 'Seiten' : 'стр.'}`
                    : ''}
                </div>
              </div>
              <span className="pill pill--pending">
                {language === 'DE' ? 'Zu erledigen' : 'Нужно сделать'}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function localDateString(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
