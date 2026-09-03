import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { Homework } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import { toErrorMessage } from '../../lib/errors';
import { PdfHomeworkPage } from './PdfHomeworkPage';

const MAX_IMAGE_EDGE = 2200;
const JPEG_QUALITY = 0.86;
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * Student homework workspace: solve directly on the worksheet or hand in a
 * photo/PDF of work completed on paper. Mobile photos are normalized to JPEG
 * before upload so HEIC/WebP/very large camera images do not fail on the server.
 */
export function PdfHomeworkWithSubmissionPage() {
  const { homeworkId = '' } = useParams();
  const { language, t } = useI18n();
  const [homework, setHomework] = useState<Homework | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [preparingFile, setPreparingFile] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function refresh() {
    const current = (await api.study.homeworks()).find((item) => item.id === homeworkId) ?? null;
    setHomework(current);
  }

  useEffect(() => {
    refresh().catch((e) => setError(toErrorMessage(e, t)));
    const timer = window.setInterval(() => {
      if (!homework?.submitted) refresh().catch(() => undefined);
    }, 3000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [homeworkId, homework?.submitted]);

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    setError(null);
    setMessage(null);
    setFile(null);
    if (!selected) return;

    if (selected.type === 'application/pdf' || selected.name.toLowerCase().endsWith('.pdf')) {
      if (selected.size > MAX_UPLOAD_BYTES) {
        setError(language === 'DE' ? 'Die PDF-Datei ist größer als 25 MB.' : 'PDF больше 25 МБ. Выбери файл поменьше.');
        event.target.value = '';
        return;
      }
      setFile(selected);
      return;
    }

    if (!selected.type.startsWith('image/') && !isImageFilename(selected.name)) {
      setError(language === 'DE'
        ? 'Bitte wähle ein Foto oder eine PDF-Datei.'
        : 'Выбери фотографию или PDF-файл.');
      event.target.value = '';
      return;
    }

    setPreparingFile(true);
    try {
      const normalized = await normalizePhoto(selected);
      if (normalized.size > MAX_UPLOAD_BYTES) {
        throw new Error(language === 'DE'
          ? 'Das Foto ist auch nach der Verarbeitung zu groß.'
          : 'Фотография слишком большая даже после обработки.');
      }
      setFile(normalized);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      event.target.value = '';
    } finally {
      setPreparingFile(false);
    }
  }

  async function submitFile() {
    if (!file || homework?.submitted || preparingFile) return;
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
              accept="image/*,application/pdf,.pdf"
              onChange={(event) => void chooseFile(event)}
              disabled={busy || preparingFile}
            />
          </label>

          {preparingFile && (
            <div className="banner banner--info">
              {language === 'DE' ? 'Foto wird für den Upload vorbereitet…' : 'Подготавливаем фотографию для загрузки…'}
            </div>
          )}

          {file && (
            <div className="muted" style={{ fontSize: 13, marginBottom: 12, overflowWrap: 'anywhere' }}>
              {language === 'DE' ? 'Ausgewählt:' : 'Выбрано:'} {file.name} · {formatMegabytes(file.size)} MB
            </div>
          )}

          <button
            className="btn btn--block"
            type="button"
            onClick={submitFile}
            disabled={!file || busy || preparingFile}
          >
            {busy
              ? (language === 'DE' ? 'Wird hochgeladen…' : 'Загружаем…')
              : (language === 'DE' ? 'Datei abgeben' : 'Сдать файл')}
          </button>

          <p className="muted" style={{ marginBottom: 0, marginTop: 10, fontSize: 12 }}>
            {language === 'DE'
              ? 'Fotos vom Handy werden automatisch verkleinert und in JPEG umgewandelt. PDF bis 25 MB.'
              : 'Фото с телефона автоматически уменьшается и переводится в JPEG. PDF — до 25 МБ.'}
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
