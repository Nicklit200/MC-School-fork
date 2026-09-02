import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client';
import type { DriveItem, DriveUploadResult } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import { toErrorMessage } from '../../lib/errors';

type PathItem = DriveItem;

const copy = {
  RU: {
    title: 'Google Drive',
    subtitle: 'Выберите общий диск и папку, куда сохранить таблицу.',
    drive: 'Общий диск',
    chooseDrive: 'Выберите диск',
    folder: 'Текущая папка',
    subfolders: 'Подпапки',
    noFolders: 'В этой папке нет подпапок.',
    file: 'Таблица',
    upload: 'Загрузить в эту папку',
    uploading: 'Загрузка…',
    uploaded: 'Файл загружен',
    open: 'Открыть в Google Drive',
    root: 'Корень диска',
  },
  DE: {
    title: 'Google Drive',
    subtitle: 'Wähle eine geteilte Ablage und den Ordner für die Tabelle.',
    drive: 'Geteilte Ablage',
    chooseDrive: 'Ablage auswählen',
    folder: 'Aktueller Ordner',
    subfolders: 'Unterordner',
    noFolders: 'In diesem Ordner gibt es keine Unterordner.',
    file: 'Tabelle',
    upload: 'In diesen Ordner hochladen',
    uploading: 'Wird hochgeladen…',
    uploaded: 'Datei hochgeladen',
    open: 'In Google Drive öffnen',
    root: 'Ablage-Stammordner',
  },
} as const;

export function DriveFolderPicker() {
  const { language, t } = useI18n();
  const text = copy[language];
  const [drives, setDrives] = useState<DriveItem[]>([]);
  const [selectedDriveId, setSelectedDriveId] = useState('');
  const [folders, setFolders] = useState<DriveItem[]>([]);
  const [path, setPath] = useState<PathItem[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [loadingDrives, setLoadingDrives] = useState(true);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState<DriveUploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currentFolderId = useMemo(() => {
    if (path.length > 0) return path[path.length - 1].id;
    return selectedDriveId;
  }, [path, selectedDriveId]);

  useEffect(() => {
    api.drive.listSharedDrives()
      .then(setDrives)
      .catch((e) => setError(toErrorMessage(e, t)))
      .finally(() => setLoadingDrives(false));
  }, [t]);

  async function loadFolders(driveId: string, parentId?: string) {
    setLoadingFolders(true);
    setError(null);
    try {
      setFolders(await api.drive.listFolders(driveId, parentId));
    } catch (e) {
      setError(toErrorMessage(e, t));
    } finally {
      setLoadingFolders(false);
    }
  }

  async function onDriveChange(driveId: string) {
    setSelectedDriveId(driveId);
    setPath([]);
    setUploaded(null);
    if (!driveId) {
      setFolders([]);
      return;
    }
    await loadFolders(driveId);
  }

  async function enterFolder(folder: DriveItem) {
    const nextPath = [...path, folder];
    setPath(nextPath);
    setUploaded(null);
    await loadFolders(selectedDriveId, folder.id);
  }

  async function jumpTo(index: number) {
    if (index < 0) {
      setPath([]);
      setUploaded(null);
      await loadFolders(selectedDriveId);
      return;
    }
    const nextPath = path.slice(0, index + 1);
    setPath(nextPath);
    setUploaded(null);
    await loadFolders(selectedDriveId, nextPath[nextPath.length - 1].id);
  }

  async function upload() {
    if (!file || !currentFolderId) return;
    setUploading(true);
    setUploaded(null);
    setError(null);
    try {
      setUploaded(await api.drive.upload(currentFolderId, file));
      setFile(null);
    } catch (e) {
      setError(toErrorMessage(e, t));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="panel">
      <h2 style={{ marginTop: 0 }}>{text.title}</h2>
      <p className="muted">{text.subtitle}</p>
      {error && <div className="banner banner--error">{error}</div>}
      {uploaded && (
        <div className="banner banner--success">
          {text.uploaded}: <strong>{uploaded.name}</strong>
          {uploaded.webViewLink && (
            <> · <a href={uploaded.webViewLink} target="_blank" rel="noreferrer">{text.open}</a></>
          )}
        </div>
      )}

      <label className="field">
        <span className="field__label">{text.drive}</span>
        <select
          className="select"
          value={selectedDriveId}
          onChange={(e) => void onDriveChange(e.target.value)}
          disabled={loadingDrives}
        >
          <option value="">{loadingDrives ? t('common.loading') : text.chooseDrive}</option>
          {drives.map((drive) => (
            <option key={drive.id} value={drive.id}>{drive.name}</option>
          ))}
        </select>
      </label>

      {selectedDriveId && (
        <>
          <div className="field">
            <span className="field__label">{text.folder}</span>
            <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
              <button type="button" className="btn btn--ghost" onClick={() => void jumpTo(-1)}>
                {drives.find((drive) => drive.id === selectedDriveId)?.name ?? text.root}
              </button>
              {path.map((item, index) => (
                <span key={item.id} className="row" style={{ gap: 6 }}>
                  <span className="muted">/</span>
                  <button type="button" className="btn btn--ghost" onClick={() => void jumpTo(index)}>
                    {item.name}
                  </button>
                </span>
              ))}
            </div>
          </div>

          <div className="field">
            <span className="field__label">{text.subfolders}</span>
            {loadingFolders ? (
              <p className="muted">{t('common.loading')}</p>
            ) : folders.length === 0 ? (
              <p className="muted">{text.noFolders}</p>
            ) : (
              <div>
                {folders.map((folder) => (
                  <button
                    type="button"
                    key={folder.id}
                    className="list-row"
                    onClick={() => void enterFolder(folder)}
                    style={{ width: '100%', textAlign: 'left', cursor: 'pointer' }}
                  >
                    <div className="list-row__title">📁 {folder.name}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <label className="field">
            <span className="field__label">{text.file}</span>
            <input
              className="input"
              type="file"
              accept=".xlsx,.xls,.csv,.ods,.tsv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>

          <button className="btn" type="button" onClick={() => void upload()} disabled={!file || uploading}>
            {uploading ? text.uploading : text.upload}
          </button>
        </>
      )}
    </div>
  );
}
