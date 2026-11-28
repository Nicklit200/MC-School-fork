import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import type { Homework } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import { toErrorMessage } from '../../lib/errors';
import { formatHomeworkDate, schoolHomeworkDate, splitStudentHomeworks } from '../../lib/studentHomeworkSections';

export function StudentHomeworksListPage() {
  const { language, t } = useI18n();
  const [items, setItems] = useState<Homework[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.study
      .homeworks()
      .then(setItems)
      .catch((e) => setError(toErrorMessage(e, t)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const today = schoolHomeworkDate();
  const sections = useMemo(() => splitStudentHomeworks(items ?? [], today, true), [items, today]);
  const groups = [
    { label: language === 'DE' ? 'Heute' : 'Сегодня', items: sections.today },
    { label: language === 'DE' ? 'Überfällige Hausaufgaben' : 'Просроченные задания', items: sections.overdue },
  ];

  if (error) return <div className="banner banner--error">{error}</div>;
  if (!items) return <p className="muted">{t('common.loading')}</p>;

  return (
    <div>
      <h1>{language === 'DE' ? 'Hausaufgaben' : 'Домашние задания'}</h1>
      {sections.today.length + sections.overdue.length === 0 ? (
        <p className="muted">
          {language === 'DE' ? 'Es gibt keine offenen Hausaufgaben.' : 'Нет невыполненной домашки.'}
        </p>
      ) : (
        <div className="stack">
          {groups.filter(group => group.items.length > 0).map(group => (
            <section className="panel stack" key={group.label} aria-label={group.label}>
              <h2 style={{ margin: 0 }}>{group.label}</h2>
              {group.items.map((homework) => (
            <Link
              key={homework.id}
              className="list-row"
              to={`/student/homeworks/${homework.id}/worksheet`}
              style={{ textDecoration: 'none' }}
            >
              <div>
                <div className="list-row__title">{formatHomeworkDate(homework.startDate, language)}</div>
                <div className="muted">
                  {homework.worksheetFilename ?? (language === 'DE' ? 'PDF-Hausaufgabe' : 'Домашка в PDF')}
                  {homework.worksheetPageCount
                    ? ` · ${homework.worksheetPageCount} ${language === 'DE' ? 'Seiten' : 'стр.'}`
                    : ''}
                </div>
              </div>
              <span className={`pill ${homework.overdue ? 'pill--danger' : homework.submitted ? 'pill--learned' : 'pill--active'}`}>
                {homework.overdue
                  ? (language === 'DE' ? 'Überfällig — trotzdem erledigen' : 'Просрочено — всё равно нужно сдать')
                  : homework.submitted
                    ? (language === 'DE' ? 'Abgegeben' : 'Сдано')
                    : (language === 'DE' ? 'Heute bis 19:00' : 'Сдать сегодня до 19:00')}
              </span>
            </Link>
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

