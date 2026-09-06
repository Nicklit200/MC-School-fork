import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { Homework } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import { toErrorMessage } from '../../lib/errors';
import { GoogleDrivePdfPicker } from './GoogleDrivePdfPicker';

/** Teacher view of one PDF homework. Flashcards are managed on separate card pages. */
export function HomeworkDetailPage() {
  const { studentId = '', homeworkId = '' } = useParams();
  const { language, t } = useI18n();
  const [homeworks, setHomeworks] = useState<Homework[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [openingChatGpt, setOpeningChatGpt] = useState(false);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewUrlsRef = useRef<string[]>([]);

  const homework = useMemo(
    () => homeworks.find((item) => item.id === homeworkId) ?? null,
    [homeworks, homeworkId],
  );

  const reload = useCallback(async () => {
    const homeworkList = await api.homeworks.listForStudent(studentId);
    setHomeworks(homeworkList);
    setLoading(false);
  }, [studentId]);

  const clearPreviewUrls = useCallback(() => {
    previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    previewUrlsRef.current = [];
    setPreviewUrls([]);
  }, []);

  const loadWorksheetPreview = useCallback(async (pageCount: number) => {
    setPreviewLoading(true);
    try {
      const blobs = await Promise.all(
        Array.from({ length: pageCount }, (_, pageIndex) => api.homeworks.worksheetPage(homeworkId, pageIndex)),
      );
      const nextUrls = blobs.map((blob) => URL.createObjectURL(blob));
      previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      previewUrlsRef.current = nextUrls;
      setPreviewUrls(nextUrls);
    } catch (e) {
      setError(toErrorMessage(e, t));
    } finally {
      setPreviewLoading(false);
    }
  }, [homeworkId, t]);

  useEffect(() => {
    reload().catch((e) => {
      setError(toErrorMessage(e, t));
      setLoading(false);
    });
  }, [reload, t]);

  useEffect(() => {
    if (homework?.hasWorksheet && homework.worksheetPageCount) {
      void loadWorksheetPreview(homework.worksheetPageCount);
    } else {
      clearPreviewUrls();
    }
  }, [homework?.hasWorksheet, homework?.worksheetPageCount, loadWorksheetPreview, clearPreviewUrls]);

  useEffect(() => () => {
    previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function downloadSubmission() {
    setError(null);
    try {
      const blob = await api.homeworks.submission(homeworkId);
      downloadBlob(blob, `${homework?.worksheetFilename?.replace(/\.pdf$/i, '') ?? 'homework'}-submitted.pdf`);
    } catch (e) {
      setError(toErrorMessage(e, t));
    }
  }

  async function downloadWorksheet() {
    setError(null);
    try {
      const blob = await api.homeworks.worksheet(homeworkId);
      downloadBlob(blob, homework?.worksheetFilename ?? 'worksheet.pdf');
    } catch (e) {
      setError(toErrorMessage(e, t));
    }
  }

  async function editInChatGpt() {
    if (!homework?.hasWorksheet || openingChatGpt) return;
    setOpeningChatGpt(true);
    setError(null);
    setMessage(null);

    const chatTab = window.open('https://chatgpt.com/', '_blank');
    if (chatTab) chatTab.opener = null;

    try {
      const blob = await api.homeworks.worksheet(homeworkId);
      downloadBlob(blob, homework.worksheetFilename ?? 'worksheet.pdf');

      const instruction = language === 'DE'
        ? 'Bearbeite die angehängte PDF-Hausaufgabe für den Schüler. Ändere nur das, was ich dir im Chat sage. Behalte Seitenformat und Arbeitsblatt-Struktur bei und gib das Ergebnis wieder als PDF zurück.'
        : 'Отредактируй прикреплённую PDF-домашку для ученика. Меняй только то, что я попрошу в чате. Сохрани формат страниц и структуру рабочей тетради и верни результат снова PDF-файлом.';

      try {
        await navigator.clipboard.writeText(instruction);
      } catch {
        // Clipboard permission may be unavailable. The workflow still works without it.
      }

      setMessage(language === 'DE'
        ? 'PDF wurde heruntergeladen und ChatGPT geöffnet. Wähle dort das Schüler-Projekt, hänge die heruntergeladene PDF an und füge die kopierte Anweisung ein. Danach lade die bearbeitete PDF hier wieder hoch.'
        : 'PDF скачан и ChatGPT открыт. Там выбери проект ученика, прикрепи скачанный PDF и вставь скопированную инструкцию. После редактирования загрузи готовый PDF обратно сюда.');
    } catch (e) {
      if (chatTab) chatTab.close();
      setError(toErrorMessage(e, t));
    } finally {
      setOpeningChatGpt(false);
    }
  }

  async function replaceWorksheet(file: File | null) {
    if (!file || !homework || homework.submitted || replacing) return;
    setReplacing(true);
    setError(null);
    setMessage(null);
    try {
      await api.homeworks.uploadWorksheet(homeworkId, file);
      await reload();
      const updatedList = await api.homeworks.listForStudent(studentId);
      setHomeworks(updatedList);
      const updatedHomework = updatedList.find((item) => item.id === homeworkId);
      if (updatedHomework?.worksheetPageCount) {
        await loadWorksheetPreview(updatedHomework.worksheetPageCount);
      }
      setMessage(language === 'DE'
        ? 'Die bearbeitete PDF wurde hochgeladen und hat die bisherige Datei ersetzt. Oben siehst du jetzt die aktuelle Version.'
        : 'Готово: отредактированный PDF заменил предыдущий файл. Сверху уже показана текущая версия домашки.');
    } catch (e) {
      setError(toErrorMessage(e, t));
    } finally {
      setReplacing(false);
    }
  }

  if (loading && !homework) {
    return <p className="muted">{t('common.loading')}</p>;
  }

  return (
    <div>
      <p>
        <Link to={`/students/${studentId}/homeworks`} className="muted">
          ← {language === 'DE' ? 'Zu den Hausaufgaben' : 'Назад к домашкам'}
        </Link>
      </p>

      {error && <div className="banner banner--error">{error}</div>}
      {message && <div className="banner banner--success">{message}</div>}

      <h1>{homework ? formatHomeworkDate(homework.startDate, language) : t('homeworks.title')}</h1>

      {homework && (
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

        {homework?.hasWorksheet && (
          <div className="panel" style={{ margin: 0, padding: 16 }}>
            <div className="row" style={{ justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
              <div>
                <strong>{language === 'DE' ? 'Aktuelle Hausaufgabe' : 'Текущая домашка'}</strong>
                <div className="muted" style={{ marginTop: 4, fontSize: 13 }}>
                  {language === 'DE'
                    ? 'Das ist genau die PDF-Version, die der Schüler sieht.'
                    : 'Это именно та версия PDF, которую сейчас видит ученик.'}
                </div>
              </div>
              <button className="btn btn--secondary" type="button" onClick={downloadWorksheet}>
                {language === 'DE' ? 'PDF öffnen / herunterladen' : 'Открыть / скачать PDF'}
              </button>
            </div>

            {previewLoading && previewUrls.length === 0 ? (
              <div className="muted" style={{ padding: '40px 0', textAlign: 'center' }}>
                {language === 'DE' ? 'Vorschau wird geladen…' : 'Загружаем предпросмотр…'}
              </div>
            ) : previewUrls.length > 0 ? (
              <div style={{ display: 'grid', gap: 16, justifyItems: 'center' }}>
                {previewUrls.map((url, index) => (
                  <div key={url} style={{ width: '100%', maxWidth: 1100 }}>
                    {previewUrls.length > 1 && (
                      <div className="muted" style={{ marginBottom: 6, fontSize: 13 }}>
                        {language === 'DE' ? `Seite ${index + 1}` : `Страница ${index + 1}`}
                      </div>
                    )}
                    <img
                      src={url}
                      alt={language === 'DE' ? `Hausaufgabe Seite ${index + 1}` : `Домашка, страница ${index + 1}`}
                      style={{
                        display: 'block',
                        width: '100%',
                        height: 'auto',
                        border: '1px solid var(--border-color, #ddd)',
                        borderRadius: 12,
                        background: '#fff',
                      }}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="banner banner--info">
                {language === 'DE' ? 'Die Vorschau konnte nicht geladen werden.' : 'Не удалось загрузить предпросмотр.'}
              </div>
            )}
          </div>
        )}

        {homework?.hasWorksheet && (
          <div className="panel" style={{ margin: 0, padding: 16 }}>
            {!homework.submitted ? (
              <div>
                <strong>{language === 'DE' ? 'Bearbeitete PDF zurückladen' : 'Загрузить отредактированный PDF обратно'}</strong>
                <p className="muted" style={{ margin: '6px 0 10px' }}>
                  {language === 'DE'
                    ? 'Die neue Datei ersetzt die aktuelle Hausaufgaben-PDF für den Schüler.'
                    : 'Новый файл заменит текущий PDF домашки у ученика.'}
                </p>
                <div className="row" style={{ alignItems: 'end', gap: 10, flexWrap: 'wrap' }}>
                  <label className="field" style={{ flex: '1 1 360px', margin: 0 }}>
                    <span className="field__label">{language === 'DE' ? 'Bearbeitete PDF vom Computer' : 'Отредактированный PDF с компьютера'}</span>
                    <input
                      className="input"
                      type="file"
                      accept="application/pdf,.pdf"
                      disabled={replacing}
                      onChange={(event) => {
                        const file = event.target.files?.[0] ?? null;
                        void replaceWorksheet(file);
                        event.currentTarget.value = '';
                      }}
                    />
                  </label>
                  <div style={{ paddingBottom: 1 }}>
                    <GoogleDrivePdfPicker disabled={replacing} onSelect={(file) => void replaceWorksheet(file)} />
                  </div>
                </div>
                {replacing && <div className="muted" style={{ marginTop: 8 }}>{language === 'DE' ? 'PDF wird ersetzt…' : 'Заменяем PDF…'}</div>}
              </div>
            ) : (
              <div className="banner banner--info">
                {language === 'DE'
                  ? 'Diese Hausaufgabe wurde bereits abgegeben. Die Aufgaben-PDF kann hier nicht mehr ersetzt werden, damit die Abgabehistorie erhalten bleibt.'
                  : 'Эта домашка уже сдана. Замену исходного PDF здесь отключили, чтобы не ломать историю выполненной работы.'}
              </div>
            )}

            <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border-color, #ddd)' }}>
              <div className="row" style={{ justifyContent: 'space-between', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 420px' }}>
                  <strong>{language === 'DE' ? 'Mit ChatGPT bearbeiten' : 'Редактировать в ChatGPT'}</strong>
                  <p className="muted" style={{ margin: '6px 0 0' }}>
                    {language === 'DE'
                      ? 'Die PDF wird heruntergeladen und ChatGPT wird geöffnet. Dort kannst du das passende Schüler-Projekt wählen und die Datei anhängen.'
                      : 'PDF скачается, и откроется ChatGPT. Там можно выбрать нужный проект ученика и прикрепить скачанный файл.'}
                  </p>
                </div>
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <button className="btn btn--secondary" type="button" onClick={downloadWorksheet}>
                    {language === 'DE' ? 'Original-PDF herunterladen' : 'Скачать исходный PDF'}
                  </button>
                  <button className="btn" type="button" onClick={editInChatGpt} disabled={openingChatGpt}>
                    {openingChatGpt
                      ? (language === 'DE' ? 'Öffnen…' : 'Открываем…')
                      : (language === 'DE' ? 'In ChatGPT bearbeiten' : 'Редактировать в ChatGPT')}
                  </button>
                </div>
              </div>
            </div>
          </div>
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
