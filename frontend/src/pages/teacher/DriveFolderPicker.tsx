import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client';
import { driveApi, type DriveItem } from '../../api/drive';
import { useI18n } from '../../i18n/I18nContext';

type PathItem = DriveItem;
type FolderKind = 'cards' | 'homework';

type Props = {
  studentId: string;
  savedFolderId?: string | null;
  kind: FolderKind;
};

export function DriveFolderPicker({ studentId, savedFolderId, kind }: Props) {
  const { language, t } = useI18n();
  const ru = language === 'RU';
  const [drives, setDrives] = useState<DriveItem[]>([]);
  const [selectedDriveId, setSelectedDriveId] = useState('');
  const [folders, setFolders] = useState<DriveItem[]>([]);
  const [path, setPath] = useState<PathItem[]>([]);
  const [loadingDrives, setLoadingDrives] = useState(true);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [savedId, setSavedId] = useState(savedFolderId ?? '');
  const [savedMessage, setSavedMessage] = useState(false);
  const [testMessage, setTestMessage] = useState<string | null>(null);
  const [testFileUrl, setTestFileUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSavedId(savedFolderId ?? '');
  }, [savedFolderId]);

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
    clearMessages();
    if (!driveId) {
      setFolders([]);
      return;
    }
    await loadFolders(driveId);
  }

  async function enterFolder(folder: DriveItem) {
    setPath([...path, folder]);
    clearMessages();
    await loadFolders(selectedDriveId, folder.id);
  }

  async function jumpTo(index: number) {
    clearMessages();
    if (index < 0) {
      setPath([]);
      await loadFolders(selectedDriveId);
      return;
    }
    const nextPath = path.slice(0, index + 1);
    setPath(nextPath);
    await loadFolders(selectedDriveId, nextPath[nextPath.length - 1].id);
  }

  function clearMessages() {
    setSavedMessage(false);
    setTestMessage(null);
    setTestFileUrl(null);
  }

  async function saveFolder() {
    if (!currentFolderId) return;
    setSaving(true);
    clearMessages();
    setError(null);
    try {
      if (kind === 'cards') {
        await api.students.updateDriveFolder(studentId, currentFolderId);
      } else {
        await api.students.updateHomeworkDriveFolder(studentId, currentFolderId);
      }
      setSavedId(currentFolderId);
      setSavedMessage(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function testFolder() {
    setTesting(true);
    setTestMessage(null);
    setTestFileUrl(null);
    setError(null);
    try {
      if (kind === 'cards') {
        const result = await api.students.testAutomaticExport(studentId);
        if (result.status === 'error') {
          setError(result.message || (ru ? 'Не удалось создать тестовую таблицу' : 'Testtabelle konnte nicht erstellt werden'));
          return;
        }
        setTestMessage(ru ? `Тестовая таблица создана: ${result.fileName ?? ''}` : `Testtabelle erstellt: ${result.fileName ?? ''}`);
        setTestFileUrl(result.fileUrl ?? null);
      } else {
        const result = await api.students.testHomeworkDriveFolder(studentId);
        if (result.status === 'error') {
          setError(result.message || (ru ? 'Не удалось проверить папку' : 'Ordner konnte nicht geprüft werden'));
          return;
        }
        setTestMessage(ru ? 'Папка для выполненных домашних работ доступна.' : 'Ordner für abgegebene Hausaufgaben ist verfügbar.');
        setTestFileUrl(result.fileUrl ?? null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  }

  const title = kind === 'cards'
    ? (ru ? 'Карточки → Google Drive' : 'Karten → Google Drive')
    : (ru ? 'Сделанные домашки → Google Drive' : 'Abgegebene Hausaufgaben → Google Drive');

  const description = kind === 'cards'
    ? (ru
      ? 'Выберите папку, куда после завершения карточек автоматически сохраняется таблица с результатами ученика.'
      : 'Wähle den Ordner, in dem nach abgeschlossenen Karten-Sessions die Ergebnistabelle gespeichert wird.')
    : (ru
      ? 'Выберите отдельную папку, куда после сдачи домашки автоматически сохраняется готовый PDF ученика с его пометками.'
      : 'Wähle einen separaten Ordner, in dem nach der Abgabe automatisch das fertige PDF mit den Notizen des Schülers gespeichert wird.');

  return (
    <div className="panel">
      <h2 style={{ marginTop: 0 }}>{title}</h2>
      <p className="muted">{description}</p>

      {savedId && (
        <div className="banner banner--info">
          {ru ? 'Папка уже настроена для этого типа файлов.' : 'Für diesen Dateityp ist bereits ein Ordner eingerichtet.'}
        </div>
      )}
      {error && <div className="banner banner--error">{error}</div>}
      {savedMessage && (
        <div className="banner banner--success">
          {ru ? `Папка сохранена: ${currentPathName}` : `Ordner gespeichert: ${currentPathName}`}
        </div>
      )}
      {testMessage && (
        <div className="banner banner--success">
          {testMessage}
          {testFileUrl && <> · <a href={testFileUrl} target="_blank" rel="noreferrer">{ru ? 'Открыть файл' : 'Datei öffnen'}</a></>}
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

          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
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

            <button
              className="btn btn--secondary"
              type="button"
              onClick={() => void testFolder()}
              disabled={!savedId || testing}
            >
              {testing
                ? (ru ? 'Проверяю…' : 'Prüfen…')
                : kind === 'cards'
                  ? (ru ? 'Создать тестовую таблицу' : 'Testtabelle erstellen')
                  : (ru ? 'Проверить папку' : 'Ordner prüfen')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
