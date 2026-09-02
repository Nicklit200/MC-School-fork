import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { Card, Homework } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import { toErrorMessage } from '../../lib/errors';
import { CardCreator } from './CardCreator';
import { CardRow } from './CardRow';

/** Teacher view of one assigned homework. Cards can be managed here; new PDF homework is created only from the list page. */
export function HomeworkDetailPage() {
  const { studentId = '', homeworkId = '' } = useParams();
  const { language, t } = useI18n();
  const [homeworks, setHomeworks] = useState<Homework[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const homework = useMemo(
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

  async function downloadSubmission() {
    setError(null);
    try {
      const blob = await api.homeworks.submission(homeworkId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${homework?.worksheetFilename?.replace(/\.pdf$/i, '') ?? 'homework'}-submitted.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(toErrorMessage(e, t));
    }
  }

  if (loading && !homework) {
    return <p className="muted">{t('common.loading')}</p>;
  }

  return (
    <div>
      <p><Link to={`/students/${studentId}/homeworks`} className="muted">← {language === 'DE' ? 'Zu den Hausaufgaben' : 'Назад к домашкам'}</Link></p>

      {error && <div className="banner banner--error">{error}</div>}
      {message && <div className="banner banner--success">{message}</div>}

      <h1>{homework ? formatHomeworkDate(homework.startDate, language) : t('homeworks.title')}</h1>

      {homework && (
        <>
          <div className="panel row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 20 }}>
            <div>
              <div className="muted" style={{ fontSize: 13 }}>{language === 'DE' ? 'Status' : 'Статус'}</div>
              <strong>
                {homework.submitted
                  ? (language === 'DE' ? 'Abgegeben' : 'Сдано')
                  : homework.startDate < localDateString(new Date())
                    ? (language === 'DE' ? 'Nicht erledigt' : 'Не сделано')
                    : homework.startDate === localDateString(new Date())
                      ? (language === 'DE' ? 'Heute zu erledigen' : 'Нужно сделать сегодня')
                      : (language === 'DE' ? 'Geplant' : 'Запланировано')}
              </strong>
            </div>
            {homework.submittedAt && (
              <div style={{ textAlign: 'right' }}>
                <div className="muted" style={{ fontSize: 13 }}>{language === 'DE' ? 'Abgegeben am' : 'Сдано'}</div>
                <strong>{new Date(homework.submittedAt).toLocaleString(language === 'DE' ? 'de-DE' : 'ru-RU')}</strong>
              </div>
            )}
          </div>

          <div className="panel row center" style={{ flexWrap: 'wrap', gap: 28 }}>
            <SummaryStat label={t('homeworks.total')} value={homework.totalCards} />
            <SummaryStat label={t('homeworks.notStarted')} value={homework.notStarted} />
            <SummaryStat label={t('homeworks.inProgress')} value={homework.inProgress} />
            <SummaryStat label={t('homeworks.learned')} value={homework.learned} />
          </div>
        </>
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

      <h2>{language === 'DE' ? 'PDF-Hausaufgabe' : 'PDF-домашка'}</h2>
      <div className="panel stack">
        {homework?.hasWorksheet ? (
          <div className="banner banner--info">
            <strong>{homework.worksheetFilename}</strong>
            {homework.worksheetPageCount ? ` · ${homework.worksheetPageCount} ${language === 'DE' ? 'Seiten' : 'стр.'}` : ''}
          </div>
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            {language === 'DE' ? 'Kein PDF hinterlegt.' : 'PDF для этой домашки не загружен.'}
          </p>
        )}

        {homework?.submitted ? (
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <strong>{language === 'DE' ? 'Hausaufgabe abgegeben' : 'Домашка сдана'}</strong>
              {homework.submittedAt && (
                <div className="muted">{new Date(homework.submittedAt).toLocaleString(language === 'DE' ? 'de-DE' : 'ru-RU')}</div>
              )}
            </div>
            <button className="btn btn--secondary" type="button" onClick={downloadSubmission}>
              {language === 'DE' ? 'Abgegebenes PDF herunterladen' : 'Скачать выполненную домашку'}
            </button>
          </div>
        ) : homework?.hasWorksheet ? (
          <p className="muted" style={{ margin: 0 }}>
            {language === 'DE' ? 'Noch nicht abgegeben.' : 'Ученик пока не сдал эту домашку.'}
          </p>
        ) : null}
      </div>
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

function formatHomeworkDate(date: string, language: 'DE' | 'RU') {
  return new Intl.DateTimeFormat(language === 'DE' ? 'de-DE' : 'ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(new Date(`${date}T00:00:00`));
}

function localDateString(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
