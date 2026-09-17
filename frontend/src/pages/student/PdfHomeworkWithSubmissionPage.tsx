import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { Homework } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import { toErrorMessage } from '../../lib/errors';
import { PdfHomeworkPage } from './PdfHomeworkPage';

const MAX_IMAGE_EDGE = 2200;
const JPEG_QUALITY = 0.86;
const MAX_SINGLE_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_UPLOAD_BYTES = 60 * 1024 * 1024;
const MAX_FILES = 12;

/** Student homework workspace: solve directly on the worksheet or hand in photos/PDFs of paper work. */
export function PdfHomeworkWithSubmissionPage() {
  const { homeworkId = '' } = useParams();
  const { language, t } = useI18n();
  const [homework, setHomework] = useState<Homework | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [preparingFile, setPreparingFile] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function refresh() {
    const current = (await api.study.homeworks()).find((item) => item.id === homeworkId) ?? null;
    setHomework(current);
    return current;
  }

  useEffect(() => {
    refresh().catch((e) => setError(toErrorMessage(e, t)));
    const timer = window.setInterval(() => {
      if (!homework?.submitted) refresh().catch(() => undefined);
    }, 3000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [homeworkId, homework?.submitted]);

  async function chooseFiles(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    setError(null);
    setMessage(null);
    if (selected.length === 0) return;

    if (files.length + selected.length > MAX_FILES) {
      setError(language === 'DE'
        ? `Du kannst höchstens ${MAX_FILES} Dateien abgeben.`
        : `Можно прикрепить максимум ${MAX_FILES} файлов.`);
      event.target.value = '';
      return;
    }

    setPreparingFile(true);
    try {
      const prepared: File[] = [];
      for (const selectedFile of selected) {
        if (selectedFile.type === 'application/pdf' || selectedFile.name.toLowerCase().endsWith('.pdf')) {
          if (selectedFile.size > MAX_SINGLE_UPLOAD_BYTES) {
            throw new Error(language === 'DE' ? 'Eine PDF-Datei ist größer als 25 MB.' : 'Один из PDF-файлов больше 25 МБ.');
          }
          prepared.push(selectedFile);
          continue;
        }

        if (!selectedFile.type.startsWith('image/') && !isImageFilename(selectedFile.name)) {
          throw new Error(language === 'DE'
            ? 'Bitte wähle nur Fotos oder PDF-Dateien.'
            : 'Можно выбрать только фотографии или PDF-файлы.');
        }

        const normalized = await normalizePhoto(selectedFile);
        if (normalized.size > MAX_SINGLE_UPLOAD_BYTES) {
          throw new Error(language === 'DE'
            ? 'Ein Foto ist auch nach der Verarbeitung zu groß.'
            : 'Одна из фотографий слишком большая даже после обработки.');
        }
        prepared.push(normalized);
      }

      const nextFiles = [...files, ...prepared];
      const totalBytes = nextFiles.reduce((sum, item) => sum + item.size, 0);
      if (totalBytes > MAX_TOTAL_UPLOAD_BYTES) {
        throw new Error(language === 'DE'
          ? 'Alle ausgewählten Dateien zusammen sind größer als 60 MB.'
          : 'Все выбранные файлы вместе больше 60 МБ. Удали несколько фотографий.');
      }
      setFiles(nextFiles);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPreparingFile(false);
      event.target.value = '';
    }
  }

  function removeFile(index: number) {
    setFiles((current) => current.filter((_, currentIndex) => currentIndex !== index));
  }

  async function submitFiles() {
    if (files.length === 0 || homework?.submitted || preparingFile) return;
    const confirmed = window.confirm(
      language === 'DE'
        ? `${files.length} Datei(en) als Hausaufgabe abgeben? Danach kann die Abgabe nicht mehr geändert werden.`
        : `Сдать ${files.length} файл(а) как домашнюю работу? После сдачи изменить ответ уже нельзя.`,
    );
    if (!confirmed) return;

    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await api.study.submitHomeworkFiles(homeworkId, files);
      await finishSuccessfulUpload();
    } catch (e) {
      try {
        const current = await refresh();
        if (current?.submitted) {
          await finishSuccessfulUpload(false);
          return;
        }
      } catch {
        // Preserve original upload error.
      }
      setError(toErrorMessage(e, t));
    } finally {
      setBusy(false);
    }
  }

  async function finishSuccessfulUpload(refreshFirst = true) {
    if (refreshFirst) await refresh();
    setFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setMessage(
      language === 'DE'
        ? 'Die Dateien wurden abgegeben. Der Lehrer erhält alles in einer PDF-Datei.'
        : 'Файлы сданы. Учитель получит все фотографии одним PDF-документом.',
    );
  }

  const totalSize = files.reduce((sum, item) => sum + item.size, 0);

  return (
    <>
      <PdfHomeworkPage />

      {!homework?.submitted && (
        <div className="panel" style={{ marginTop: 18, marginBottom: 32 }}>
          <div style={{ textAlign: 'center', marginBottom: 14 }}>
            <div className="muted" style={{ fontSize: 13, marginBottom: 6 }}>
              {language === 'DE' ? 'ODER' : 'ИЛИ'}
            </div>
            <h2 style={{ margin: 0 }}>
              {language === 'DE' ? 'Auf Papier gelöst?' : 'Решил на бумаге?'}
            </h2>
            <p className="muted" style={{ marginBottom: 0 }}>
              {language === 'DE'
                ? 'Wähle mehrere Fotos deiner Lösung oder PDF-Dateien aus.'
                : 'Выбери сразу несколько фотографий решения или PDF-файлов.'}
            </p>
          </div>

          {error && <div className="banner banner--error">{error}</div>}
          {message && <div className="banner banner--success">{message}</div>}

          <label className="field">
            <span className="field__label">
              {language === 'DE' ? 'Fotos oder PDFs auswählen' : 'Выбрать фото или PDF'}
            </span>
            <input
              ref={fileInputRef}
              className="input"
              type="file"
              accept="image/*,application/pdf,.pdf"
              multiple
              onChange={(event) => void chooseFiles(event)}
              disabled={busy || preparingFile}
            />
          </label>

          {preparingFile && (
            <div className="banner banner--info">
              {language === 'DE' ? 'Fotos werden vorbereitet…' : 'Подготавливаем фотографии для загрузки…'}
            </div>
          )}

          {files.length > 0 && (
            <div style={{ display: 'grid', gap: 8, marginBottom: 14 }}>
              <div className="muted" style={{ fontSize: 13 }}>
                {language === 'DE' ? 'Ausgewählt' : 'Выбрано'}: {files.length} · {formatMegabytes(totalSize)} MB
              </div>
              {files.map((item, index) => (
                <div key={`${item.name}-${item.lastModified}-${index}`} className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                  <span style={{ minWidth: 0, overflowWrap: 'anywhere', fontSize: 13 }}>{index + 1}. {item.name}</span>
                  <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => removeFile(index)}>
                    {language === 'DE' ? 'Entfernen' : 'Удалить'}
                  </button>
                </div>
              ))}
              {files.length < MAX_FILES && (
                <button type="button" className="btn btn--secondary btn--block" disabled={busy || preparingFile} onClick={() => fileInputRef.current?.click()}>
                  {language === 'DE' ? 'Weitere Fotos hinzufügen' : 'Добавить ещё фотографии'}
                </button>
              )}
            </div>
          )}

          <button
            className="btn btn--block"
            type="button"
            onClick={submitFiles}
            disabled={files.length === 0 || busy || preparingFile}
          >
            {busy
              ? (language === 'DE' ? 'Wird hochgeladen…' : 'Загружаем…')
              : (language === 'DE' ? `${files.length || ''} Datei(en) abgeben` : `Сдать ${files.length || ''} фото/файлов`)}
          </button>

          {busy && (
            <div className="banner banner--info" style={{ marginTop: 10 }}>
              {language === 'DE'
                ? 'Bitte diese Seite geöffnet lassen, bis die Abgabe bestätigt ist.'
                : 'Не закрывай страницу до подтверждения сдачи. Несколько фото могут загружаться немного дольше.'}
            </div>
          )}

          <p className="muted" style={{ marginBottom: 0, marginTop: 10, fontSize: 12 }}>
            {language === 'DE'
              ? `Bis zu ${MAX_FILES} Dateien. Handy-Fotos werden automatisch verkleinert. Alles wird zu einer PDF zusammengefügt.`
              : `До ${MAX_FILES} файлов. Фото с телефона автоматически уменьшаются. Все страницы будут объединены в один PDF.`}
          </p>
        </div>
      )}
    </>
  );
}

async function normalizePhoto(source: File): Promise<File> {
  const url = URL.createObjectURL(source);
  try {
    const image = await loadImage(url);
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Не удалось подготовить фотографию.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
    if (!blob) throw new Error('Не удалось преобразовать фотографию в JPEG.');
    const originalBase = source.name.replace(/\.[^.]+$/, '') || 'homework-photo';
    return new File([blob], `${originalBase}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
  } catch {
    throw new Error('Телефон выбрал формат фото, который браузер не смог обработать. Попробуй сделать обычное фото/скриншот или выбрать JPG.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not decode image'));
    image.src = url;
  });
}

function isImageFilename(name: string) {
  return /\.(jpe?g|png|heic|heif|webp)$/i.test(name);
}

function formatMegabytes(bytes: number) {
  return (bytes / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 ? 1 : 2);
}
