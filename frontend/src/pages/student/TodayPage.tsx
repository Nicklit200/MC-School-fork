import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import type { Homework, SessionType, Today } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import { toErrorMessage } from '../../lib/errors';
import { formatHomeworkDate, schoolHomeworkDate, splitStudentHomeworks } from '../../lib/studentHomeworkSections';

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

  const todayDate = schoolHomeworkDate();
  const homeworkSections = useMemo(() => splitStudentHomeworks(homeworks, todayDate), [homeworks, todayDate]);
  const openHomeworkCount = homeworkSections.today.length + homeworkSections.overdue.length;
  const homeworkGroups = [
    { label: language === 'DE' ? 'Heute' : 'Сегодня', items: homeworkSections.today },
    { label: language === 'DE' ? 'Überfällige Hausaufgaben' : 'Просроченные задания', items: homeworkSections.overdue },
  ];

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
    <div className="student-today">
      <h1>{t('today.title')}</h1>
      {error && <div className="banner banner--error">{error}</div>}
      <div className="student-today__grid">
        <section className="panel student-today__review">
          <h2>{language === 'DE' ? 'Karten heute' : 'Карточки сегодня'}</h2>
          <div className="result__stat">{today.dueCardCount}</div>
          <div className="muted">{t('today.due')}</div>
          <div className="student-today__actions">
            {today.inProgressSessionId && <button className="btn btn--block" type="button"
              onClick={() => navigate(`/session/${today.inProgressSessionId}`)}>{t('today.resume')}</button>}
            {notEnoughCards ? <div className="banner banner--info">{today.minCardsToStart === 1
              ? t('today.needFirstCard') : t('today.needMoreCards', { min: today.minCardsToStart })}</div> : <>
              {today.canStartScheduled ? <button className="btn btn--block" type="button" disabled={busy} onClick={() => start('SCHEDULED')}>{t('today.start')}</button>
                : !today.inProgressSessionId && <div className="banner banner--success">{t('today.nothingDue')}</div>}
              {today.canPractice && <button className="btn btn--secondary btn--block" type="button" disabled={busy} onClick={() => start('PRACTICE')}>{t('today.practice')}</button>}
            </>}
          </div>
          <p className="muted">{t('today.learned')}: {today.learnedCount}</p>
        </section>
        <section className="panel student-today__homework">
          <h2>{language === 'DE' ? 'Hausaufgabe heute' : 'Домашка сегодня'}</h2>
          {openHomeworkCount === 0 ? <div className="banner banner--success">{language === 'DE' ? 'Keine offene Hausaufgabe 🎉' : 'Невыполненной домашки нет 🎉'}</div> : <>
            <div className="center"><div className="result__stat">{openHomeworkCount}</div><div className="muted">{language === 'DE' ? 'Offene Hausaufgaben' : 'Невыполненных домашних заданий'}</div></div>
            {homeworkGroups.filter(group => group.items.length > 0).map(group => (
              <section key={group.label} aria-label={group.label}>
                <h3>{group.label}</h3>
                {group.items.map(homework => <Link key={homework.id} className="list-row" to={`/student/homeworks/${homework.id}/worksheet`}>
              <div><div className="list-row__title">{homework.worksheetFilename ?? (language === 'DE' ? 'PDF-Hausaufgabe' : 'Домашка в PDF')}</div>
                <div className="muted">{formatHomeworkDate(homework.startDate, language)}{homework.worksheetPageCount ? ` · ${homework.worksheetPageCount} ${language === 'DE' ? 'Seiten' : 'стр.'}` : ''}</div></div>
              <span className={`pill ${homework.overdue ? 'pill--danger' : 'pill--pending'}`}>{homework.overdue ? (language === 'DE' ? 'Überfällig — trotzdem erledigen' : 'Просрочено — всё равно нужно сделать') : (language === 'DE' ? 'Zu erledigen' : 'Нужно сделать')}</span>
                </Link>)}
              </section>
            ))}
          </>}
        </section>
      </div>
    </div>
  );
}

