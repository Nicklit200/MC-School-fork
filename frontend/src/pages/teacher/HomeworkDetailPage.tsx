import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { Card, Homework } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import { toErrorMessage } from '../../lib/errors';
import { CardCreator } from './CardCreator';
import { CardRow } from './CardRow';

/** One homework folder: cards plus an optional PDF worksheet the student can write on. */
export function HomeworkDetailPage() {
  const { studentId = '', homeworkId = '' } = useParams();
  const { language, t } = useI18n();
  const [homeworks, setHomeworks] = useState<Homework[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
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

  async function uploadWorksheet() {
    if (!pdfFile) return;
    setPdfBusy(true);
    setError(null);
    setMessage(null);
    try {
      await api.homeworks.uploadWorksheet(homeworkId, pdfFile);
      setPdfFile(null);
      setMessage(language === 'DE' ? 'PDF-Arbeitsblatt wurde gespeichert.' : 'PDF для домашки загружен.');
      await reload();
    } catch (e) {
      setError(toErrorMessage(e, t));
    } finally {
      setPdfBusy(false);
    }
  }

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

  return (
    <div>
      <p><Link to={`/students/${studentId}`} className="muted">← {t('homeworks.backToStudent')}</Link></p>

      {error && <div className="banner banner--error">{error}</div>}
      {message && <div className="banner banner--success">{message}</div>}

      <h1>{homework ? formatHomeworkDate(homework.startDate, language) : t('homeworks.title')}</h1>

      {homework && (
        <div className="panel row center">
          <span className={`pill ${homeworkStatusClass(homework.status)}`}>{t(`homeworks.status.${homework.status}`)}</span>
          <SummaryStat label={t('homeworks.total')} value={homework.totalCards} />
          <SummaryStat label={t('homeworks.notStarted')} value={homework.notStarted} />
          <SummaryStat label={t('homeworks.inProgress')} value={homework.inProgress} />
          <SummaryStat label={t('homeworks.learned')} value={homework.learned} />
        </div>
      )}

      <h2>{language === 'DE' ? 'PDF-Arbeitsblatt' : 'PDF-домашка'}</h2>
      <div className="panel stack">
        {homework?.hasWorksheet ? (
          <div className="banner banner--info">
            <strong>{homework.worksheetFilename}</strong>
            {homework.worksheetPageCount ? ` · ${homework.worksheetPageCount} ${language === 'DE' ? 'Seiten' : 'стр.'}` : ''}
          </div>
        ) : (
          <p className="muted" style={{ marginTop: 0 }}>
            {language === 'DE'
              ? 'Lade ein PDF hoch. Der Schüler kann direkt mit Apple Pencil oder Stylus darauf schreiben.'
              : 'Загрузи готовый PDF. Ученик сможет открыть его на сайте и писать прямо по нему Apple Pencil или стилусом.'}
          </p>
        )}
        <input
          className="input"
          type="file"
          accept="application/pdf,.pdf"
          onChange={(event) => setPdfFile(event.target.files?.[0] ?? null)}
        />
        <button className="btn" type="button" disabled={!pdfFile || pdfBusy} onClick={uploadWorksheet}>
          {pdfBusy
            ? (language === 'DE' ? 'Wird hochgeladen…' : 'Загружаем…')
            : (homework?.hasWorksheet
              ? (language === 'DE' ? 'PDF ersetzen' : 'Заменить PDF')
              : (language === 'DE' ? 'PDF hochladen' : 'Загрузить PDF'))}
        </button>

        {homework?.submitted && (
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <strong>{language === 'DE' ? 'Hausaufgabe abgegeben' : 'Домашка сдана'}</strong>
              {homework.submittedAt && (
                <div className="muted">{new Date(homework.submittedAt).toLocaleString(language === 'DE' ? 'de-DE' : 'ru-RU')}</div>
              )}
            </div>
            <button className="btn btn--secondary" type="button" onClick={downloadSubmission}>
              {language === 'DE' ? 'Abgegebenes PDF herunterladen' : 'Скачать сданный PDF'}
            </button>
          </div>
        )}
      </div>

      <h2>{t('cards.add')}</h2>
      <CardCreator homeworkId={homeworkId} onChanged={reload} />

      <h2>{t('cards.title')}</h2>
      {loading ? (
        <p className="muted">{t('common.loading')}</p>
      ) : cards.length === 0 ? (
        <p className="muted">{t('cards.empty')}</p>
      ) : (
        cards.map((card) => (
          <CardRow key={card.id} card={card} onChanged={reload} onDeleted={() => setMessage(t('cards.deleted'))} />
        ))
      )}
    </div>
  );
}

function formatHomeworkDate(date: string, language: 'DE' | 'RU') {
  return new Intl.DateTimeFormat(language === 'DE' ? 'de-DE' : 'ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(new Date(`${date}T00:00:00`));
}

function SummaryStat({ label, value }: { label: string; value: number }) {
  return <div><div style={{ fontSize: 28, fontWeight: 700 }}>{value}</div><div className="muted" style={{ fontSize: 13 }}>{label}</div></div>;
}

function homeworkStatusClass(status: Homework['status']) {
  if (status === 'COMPLETED') return 'pill--learned';
  if (status === 'ACTIVE') return 'pill--active';
  return 'pill--pending';
}
