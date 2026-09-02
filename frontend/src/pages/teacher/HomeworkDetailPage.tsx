import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { Homework } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import { toErrorMessage } from '../../lib/errors';

/** Teacher view of one PDF homework. Flashcards are managed separately. */
export function HomeworkDetailPage() {
  const { studentId = '', homeworkId = '' } = useParams();
  const navigate = useNavigate();
  const { language, t } = useI18n();
  const [homeworks, setHomeworks] = useState<Homework[]>([]);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [creatingAnother, setCreatingAnother] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const homework = useMemo(
    () => homeworks.find((item) => item.id === homeworkId) ?? null,
    [homeworks, homeworkId],
  );

  const reload = useCallback(async () => {
    const homeworkList = await api.homeworks.listForStudent(studentId);
    setHomeworks(homeworkList);
    setLoading(false);
  }, [studentId]);

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

  async function createAnotherHomework() {
    if (!homework) return;
    setCreatingAnother(true);
    setError(null);
    try {
      const created = await api.homeworks.create(studentId, homework.startDate);
      navigate(`/teacher/students/${studentId}/homeworks/${created.id}`);
    } catch (e) {
      setError(toErrorMessage(e, t));
      setCreatingAnother(false);
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

  if (loading && !homework) {
    return <p className="muted">{t('common.loading')}</p>;
  }

  return (
    <div>
      <p><Link to={`/students/${studentId}/homeworks`} className="muted">← {language === 'DE' ? 'Zu den Hausaufgaben' : 'Назад к домашкам'}</Link></p>

      {error && <div className="banner banner--error">{error}</div>}
      {message && <div className="banner banner--success">{message}</div>}

      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ marginBottom: 0 }}>{homework ? formatHomeworkDate(homework.startDate, language) : t('homeworks.title')}</h1>
        {homework && (
          <button className="btn btn--secondary" type="button" onClick={createAnotherHomework} disabled={creatingAnother}>
            {creatingAnother
              ? (language === 'DE' ? 'Wird erstellt…' : 'Создаём…')
              : (language === 'DE' ? 'Weitere Hausaufgabe für diesen Tag' : '+ Ещё домашка на этот день')}
          </button>
        )}
      </div>

      {homework && (
        <div className="panel row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
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
      )}

      <h2>{language === 'DE' ? 'PDF-Hausaufgabe' : 'PDF-домашка'}</h2>
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
              ? (language === 'DE' ? 'Vorhandenes PDF ersetzen' : 'Заменить текущий PDF')
              : (language === 'DE' ? 'PDF hochladen' : 'Загрузить PDF'))}
        </button>

        {homework?.hasWorksheet && (
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            {language === 'DE'
              ? 'Für eine zweite Hausaufgabe am selben Tag nutze oben „Weitere Hausaufgabe für diesen Tag“.'
              : 'Если нужна вторая домашка на эту же дату, нажми сверху «+ Ещё домашка на этот день».'}
          </p>
        )}

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
