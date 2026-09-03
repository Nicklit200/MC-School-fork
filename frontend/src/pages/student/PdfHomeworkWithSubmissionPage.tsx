import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { Homework } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import { toErrorMessage } from '../../lib/errors';
import { PdfHomeworkPage } from './PdfHomeworkPage';

/**
 * Student homework workspace: solve directly on the worksheet or hand in a
 * photo/PDF of work completed on paper. Both paths end up as one downloadable
 * PDF submission for the teacher.
 */
export function PdfHomeworkWithSubmissionPage() {
  const { homeworkId = '' } = useParams();
  const { language, t } = useI18n();
  const [homework, setHomework] = useState<Homework | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function refresh() {
    const current = (await api.study.homeworks()).find((item) => item.id === homeworkId) ?? null;
    setHomework(current);
  }

  useEffect(() => {
    refresh().catch((e) => setError(toErrorMessage(e, t)));
    // The drawing page owns its own submit state. A lightweight refresh keeps
    // this second submission option in sync when the student submits drawings.
    const timer = window.setInterval(() => {
      if (!homework?.submitted) refresh().catch(() => undefined);
    }, 3000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [homeworkId, homework?.submitted]);

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    setError(null);
    setMessage(null);
    setFile(event.target.files?.[0] ?? null);
  }

  async function submitFile() {
    if (!file || homework?.submitted) return;
    const confirmed = window.confirm(
      language === 'DE'
        ? 'Diese Datei als Hausaufgabe abgeben? Danach kann die Abgabe nicht mehr geändert werden.'
        : 'Сдать этот файл как домашнюю работу? После сдачи изменить ответ уже нельзя.',
    );
    if (!confirmed) return;

    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await api.study.submitHomeworkFile(homeworkId, file);
      await refresh();
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setMessage(
        language === 'DE'
          ? 'Datei wurde abgegeben. Der Lehrer erhält sie als PDF.'
          : 'Файл сдан. Учитель получит его как PDF.',
      );
    } catch (e) {
      setError(toErrorMessage(e, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PdfHomeworkPage />

      {!homework?.submitted && (
        <div className="panel" style={{ marginTop: 18 }}>
          <div style={{ textAlign: 'center', marginBottom: 14 }}>
            <div className="muted" style={{ fontSize: 13, marginBottom: 6 }}>
              {language === 'DE' ? 'ODER' : 'ИЛИ'}
            </div>
            <h2 style={{ margin: 0 }}>
              {language === 'DE' ? 'Auf Papier gelöst?' : 'Решил на бумаге?'}
            </h2>
            <p className="muted" style={{ marginBottom: 0 }}>
              {language === 'DE'
                ? 'Lade ein Foto deiner Lösung oder eine fertige PDF-Datei hoch.'
                : 'Загрузи фотографию своего решения или готовый PDF-файл.'}
            </p>
          </div>

          {error && <div className="banner banner--error">{error}</div>}
          {message && <div className="banner banner--success">{message}</div>}

          <label className="field">
            <span className="field__label">
              {language === 'DE' ? 'Foto oder PDF auswählen' : 'Выбрать фото или PDF'}
            </span>
            <input
              ref={fileInputRef}
              className="input"
              type="file"
              accept="image/jpeg,image/png,application/pdf,.jpg,.jpeg,.png,.pdf"
              onChange={chooseFile}
              disabled={busy}
            />
          </label>

          {file && (
            <div className="muted" style={{ fontSize: 13, marginBottom: 12, overflowWrap: 'anywhere' }}>
              {language === 'DE' ? 'Ausgewählt:' : 'Выбрано:'} {file.name}
            </div>
          )}

          <button
            className="btn btn--block"
            type="button"
            onClick={submitFile}
            disabled={!file || busy}
          >
            {busy
              ? (language === 'DE' ? 'Wird hochgeladen…' : 'Загружаем…')
              : (language === 'DE' ? 'Datei abgeben' : 'Сдать файл')}
          </button>

          <p className="muted" style={{ marginBottom: 0, marginTop: 10, fontSize: 12 }}>
            {language === 'DE'
              ? 'Unterstützt: JPG, PNG oder PDF bis 25 MB. Fotos werden automatisch in PDF umgewandelt.'
              : 'Поддерживаются JPG, PNG и PDF до 25 МБ. Фотография автоматически превратится в PDF для учителя.'}
          </p>
        </div>
      )}
    </>
  );
}
