import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client';
import { driveApi, type DriveItem } from '../../api/drive';
import { useI18n } from '../../i18n/I18nContext';

type PathItem = DriveItem;

type Props = {
  studentId: string;
  savedFolderId?: string | null;
};

export function DriveFolderPicker({ studentId, savedFolderId }: Props) {
  const { language, t } = useI18n();
  const ru = language === 'RU';
  const [drives, setDrives] = useState<DriveItem[]>([]);
  const [selectedDriveId, setSelectedDriveId] = useState('');
  const [folders, setFolders] = useState<DriveItem[]>([]);
  const [path, setPath] = useState<PathItem[]>([]);
  const [loadingDrives, setLoadingDrives] = useState(true);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState(savedFolderId ?? '');
  const [savedMessage, setSavedMessage] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentFolderId = useMemo(() => {
    if (path.length > 0) return path[path.length - 1].id;
    return selectedDriveId;
  }, [path, selectedDriveId]);

  const currentPathName = useMemo(() => {
    if (!selectedDriveId) return '';
    const driveName = drives.find((drive) => drive.id === selectedDriveId)?.name ?? '';
    return [driveName, ...path.map((item) => item.name)].filter(Boolean).join(' / ');
  }, [drives, path, selectedDriveId]);

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
    setSavedMessage(false);
    if (!driveId) {
      setFolders([]);
      return;
    }
    await loadFolders(driveId);
  }

  async function enterFolder(folder: DriveItem) {
    setPath([...path, folder]);
    setSavedMessage(false);
    await loadFolders(selectedDriveId, folder.id);
  }

  async function jumpTo(index: number) {
    setSavedMessage(false);
    if (index < 0) {
      setPath([]);
      await loadFolders(selectedDriveId);
      return;
    }
    const nextPath = path.slice(0, index + 1);
    setPath(nextPath);
    await loadFolders(selectedDriveId, nextPath[nextPath.length - 1].id);
  }

  async function saveFolder() {
    if (!currentFolderId) return;
    setSaving(true);
    setSavedMessage(false);
    setError(null);
    try {
      await api.students.updateDriveFolder(studentId, currentFolderId);
      setSavedId(currentFolderId);
      setSavedMessage(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="panel">
      <h2 style={{ marginTop: 0 }}>Google Drive</h2>
      <p className="muted">
        {ru
          ? 'Выберите папку один раз. После завершения карточек таблица с результатами ученика будет сохраняться сюда автоматически.'
          : 'Wähle den Ordner einmal aus. Nach jeder abgeschlossenen Karten-Session wird die Ergebnistabelle automatisch hier gespeichert.'}
      </p>

      {error && <div className="banner banner--error">{error}</div>}
      {savedMessage && (
        <div className="banner banner--success">
          {ru ? `Папка сохранена: ${currentPathName}` : `Ordner gespeichert: ${currentPathName}`}
        </div>
      )}

      <label className="field">
        <span className="field__label">{ru ? 'Общий диск' : 'Geteilte Ablage'}</span>
        <select
          className="select"
          value={selectedDriveId}
          onChange={(e) => void onDriveChange(e.target.value)}
          disabled={loadingDrives}
        >
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

          <button
            className="btn"
            type="button"
            onClick={() => void saveFolder()}
            disabled={!currentFolderId || saving || currentFolderId === savedId}
          >
            {saving
              ? (ru ? 'Сохраняю…' : 'Speichern…')
              : currentFolderId === savedId
                ? (ru ? 'Эта папка уже выбрана' : 'Dieser Ordner ist bereits gewählt')
                : (ru ? 'Использовать эту папку' : 'Diesen Ordner verwenden')}
          </button>
        </>
      )}
    </div>
  );
}
