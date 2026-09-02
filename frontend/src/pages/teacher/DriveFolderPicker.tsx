import { useEffect, useMemo, useState } from 'react';
import { driveApi, type DriveItem, type DriveUploadResult } from '../../api/drive';
import { useI18n } from '../../i18n/I18nContext';

type PathItem = DriveItem;

export function DriveFolderPicker() {
  const { language, t } = useI18n();
  const ru = language === 'RU';
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
    driveApi.listSharedDrives()
      .then(setDrives)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoadingDrives(false));
  }, []);

  async function loadFolders(driveId: string, parentId?: string) {
    setLoadingFolders(true);
    setError(null);
    try {
      setFolders(await driveApi.listFolders(driveId, parentId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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
    setPath([...path, folder]);
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
      setUploaded(await driveApi.upload(currentFolderId, file));
      setFile(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="panel">
      <h2 style={{ marginTop: 0 }}>Google Drive</h2>
      <p className="muted">{ru ? 'Выберите общий диск и папку. Ссылку вставлять не нужно.' : 'Wähle eine geteilte Ablage und einen Ordner. Kein Link nötig.'}</p>
      {error && <div className="banner banner--error">{error}</div>}
      {uploaded && (
        <div className="banner banner--success">
          {ru ? 'Файл загружен' : 'Datei hochgeladen'}: <strong>{uploaded.name}</strong>
          {uploaded.webViewLink && <> · <a href={uploaded.webViewLink} target="_blank" rel="noreferrer">{ru ? 'Открыть' : 'Öffnen'}</a></>}
        </div>
      )}

      <label className="field">
        <span className="field__label">{ru ? 'Общий диск' : 'Geteilte Ablage'}</span>
        <select className="select" value={selectedDriveId} onChange={(e) => void onDriveChange(e.target.value)} disabled={loadingDrives}>
          <option value="">{loadingDrives ? t('common.loading') : (ru ? 'Выберите диск' : 'Ablage auswählen')}</option>
          {drives.map((drive) => <option key={drive.id} value={drive.id}>{drive.name}</option>)}
        </select>
      </label>

      {selectedDriveId && (
        <>
          <div className="field">
            <span className="field__label">{ru ? 'Текущая папка' : 'Aktueller Ordner'}</span>
            <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
              <button type="button" className="btn btn--ghost" onClick={() => void jumpTo(-1)}>
                {drives.find((drive) => drive.id === selectedDriveId)?.name ?? (ru ? 'Корень диска' : 'Stammordner')}
              </button>
              {path.map((item, index) => (
                <span key={item.id} className="row" style={{ gap: 6 }}>
                  <span className="muted">/</span>
                  <button type="button" className="btn btn--ghost" onClick={() => void jumpTo(index)}>{item.name}</button>
                </span>
              ))}
            </div>
          </div>

          <div className="field">
            <span className="field__label">{ru ? 'Подпапки' : 'Unterordner'}</span>
            {loadingFolders ? <p className="muted">{t('common.loading')}</p> : folders.length === 0 ? (
              <p className="muted">{ru ? 'В этой папке нет подпапок.' : 'Keine Unterordner.'}</p>
            ) : folders.map((folder) => (
              <button type="button" key={folder.id} className="list-row" onClick={() => void enterFolder(folder)} style={{ width: '100%', textAlign: 'left', cursor: 'pointer' }}>
                <div className="list-row__title">📁 {folder.name}</div>
              </button>
            ))}
          </div>

          <label className="field">
            <span className="field__label">{ru ? 'Таблица' : 'Tabelle'}</span>
            <input className="input" type="file" accept=".xlsx,.xls,.csv,.ods,.tsv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>

          <button className="btn" type="button" onClick={() => void upload()} disabled={!file || uploading}>
            {uploading ? (ru ? 'Загрузка…' : 'Wird hochgeladen…') : (ru ? 'Загрузить в эту папку' : 'In diesen Ordner hochladen')}
          </button>
        </>
      )}
    </div>
  );
}
