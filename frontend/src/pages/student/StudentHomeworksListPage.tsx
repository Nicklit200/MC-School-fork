import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import type { Homework } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import { toErrorMessage } from '../../lib/errors';

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

  const today = localDateString(new Date());
  const homeworks = useMemo(
    () => (items ?? [])
      .filter((item) => item.hasWorksheet && item.startDate === today)
      .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '')),
    [items, today],
  );

  if (error) return <div className="banner banner--error">{error}</div>;
  if (!items) return <p className="muted">{t('common.loading')}</p>;

  return (
    <div>
      <h1>{language === 'DE' ? 'Hausaufgaben für heute' : 'Домашка на сегодня'}</h1>
      {homeworks.length === 0 ? (
        <p className="muted">
          {language === 'DE' ? 'Für heute gibt es keine Hausaufgabe.' : 'На сегодня домашки нет.'}
        </p>
      ) : (
        <div className="panel stack">
          {homeworks.map((homework) => (
            <Link
              key={homework.id}
              className="list-row"
              to={`/student/homeworks/${homework.id}/worksheet`}
              style={{ textDecoration: 'none' }}
            >
              <div>
                <div className="list-row__title">{formatDate(homework.startDate, language)}</div>
                <div className="muted">
                  {homework.worksheetFilename ?? (language === 'DE' ? 'PDF-Hausaufgabe' : 'Домашка в PDF')}
                  {homework.worksheetPageCount
                    ? ` · ${homework.worksheetPageCount} ${language === 'DE' ? 'Seiten' : 'стр.'}`
                    : ''}
                </div>
              </div>
              <span className={`pill ${homework.submitted ? 'pill--learned' : 'pill--active'}`}>
                {homework.submitted
                  ? (language === 'DE' ? 'Abgegeben' : 'Сдано')
                  : (language === 'DE' ? 'Heute erledigen' : 'Сделать сегодня')}
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

function formatDate(date: string, language: 'DE' | 'RU') {
  return new Intl.DateTimeFormat(language === 'DE' ? 'de-DE' : 'ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(`${date}T00:00:00`));
}
