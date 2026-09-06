import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client';
import { driveApi, type DriveItem } from '../../api/drive';

export function GroupTranscriptFolderPicker({ groupId }: { groupId: string }) {
  const [groupName, setGroupName] = useState('');
  const [savedFolderId, setSavedFolderId] = useState('');
  const [drives, setDrives] = useState<DriveItem[]>([]);
  const [selectedDriveId, setSelectedDriveId] = useState('');
  const [folders, setFolders] = useState<DriveItem[]>([]);
  const [path, setPath] = useState<DriveItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currentFolderId = useMemo(() => {
    if (path.length > 0) return path[path.length - 1].id;
    return selectedDriveId;
  }, [path, selectedDriveId]);

  const currentPath = useMemo(() => {
    const driveName = drives.find((drive) => drive.id === selectedDriveId)?.name ?? '';
    return [driveName, ...path.map((folder) => folder.name)].filter(Boolean).join(' / ');
  }, [drives, path, selectedDriveId]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [group, sharedDrives] = await Promise.all([
          api.groups.get(groupId),
          driveApi.listSharedDrives(),
        ]);
        if (cancelled) return;
        setGroupName(group.name);
        setSavedFolderId(group.googleDriveTranscriptFolderId ?? '');
        setDrives(sharedDrives);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [groupId]);

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

  async function chooseDrive(driveId: string) {
    setSelectedDriveId(driveId);
    setPath([]);
    setFolders([]);
    setMessage(null);
    if (driveId) await loadFolders(driveId);
  }

  async function enterFolder(folder: DriveItem) {
    setPath((current) => [...current, folder]);
    setMessage(null);
    await loadFolders(selectedDriveId, folder.id);
  }

  async function jumpTo(index: number) {
    setMessage(null);
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
    if (!currentFolderId || saving) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const updated = await api.groups.updateTranscriptFolder(groupId, currentFolderId);
      setSavedFolderId(updated.googleDriveTranscriptFolderId ?? currentFolderId);
      setMessage(`Папка для транскрипций группы «${updated.name}» сохранена: ${currentPath || 'выбранная папка'}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel" style={{ margin: '16px 0 20px', padding: 20, border: '1px solid #f0d8c8' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0 }}>Транскрипции уроков</h2>
          <p className="muted" style={{ margin: '6px 0 0' }}>
            Выберите папку Google Drive, куда после уроков группы {groupName ? `«${groupName}»` : ''} будут сохраняться транскрипции Soniox.
          </p>
        </div>
        {savedFolderId && (
          <div className="banner banner--success" style={{ margin: 0, padding: '8px 12px' }}>
            Папка настроена
          </div>
        )}
      </div>

      {error && <div className="banner banner--error" style={{ marginTop: 12 }}>{error}</div>}
      {message && <div className="banner banner--success" style={{ marginTop: 12 }}>{message}</div>}

      {loading ? (
        <p className="muted" style={{ marginTop: 14 }}>Загружаем Google Drive…</p>
      ) : (
        <div className="stack" style={{ gap: 10, marginTop: 14 }}>
          <label className="field" style={{ margin: 0 }}>
            <span className="field__label">Общий диск</span>
            <select className="select" value={selectedDriveId} onChange={(e) => void chooseDrive(e.target.value)}>
              <option value="">Выберите диск</option>
              {drives.map((drive) => <option key={drive.id} value={drive.id}>{drive.name}</option>)}
            </select>
          </label>

          {selectedDriveId && (
            <>
              <div className="field" style={{ margin: 0 }}>
                <span className="field__label">Текущая папка</span>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  <button className="btn btn--ghost" type="button" onClick={() => void jumpTo(-1)}>
                    {drives.find((drive) => drive.id === selectedDriveId)?.name ?? 'Корень диска'}
                  </button>
                  {path.map((folder, index) => (
                    <span className="row" style={{ gap: 6 }} key={folder.id}>
                      <span className="muted">/</span>
                      <button className="btn btn--ghost" type="button" onClick={() => void jumpTo(index)}>{folder.name}</button>
                    </span>
                  ))}
                </div>
              </div>

              <div className="field" style={{ margin: 0 }}>
                <span className="field__label">Подпапки</span>
                {loadingFolders ? (
                  <p className="muted">Загружаем…</p>
                ) : folders.length === 0 ? (
                  <p className="muted">В этой папке нет подпапок.</p>
                ) : (
                  <div className="stack" style={{ gap: 6 }}>
                    {folders.map((folder) => (
                      <button
                        key={folder.id}
                        className="list-row"
                        type="button"
                        onClick={() => void enterFolder(folder)}
                        style={{ width: '100%', textAlign: 'left', cursor: 'pointer' }}
                      >
                        <div className="list-row__title">{folder.name}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button
                className="btn"
                type="button"
                onClick={() => void saveFolder()}
                disabled={!currentFolderId || saving || currentFolderId === savedFolderId}
                style={{ alignSelf: 'flex-start' }}
              >
                {saving
                  ? 'Сохраняем…'
                  : currentFolderId === savedFolderId
                    ? 'Эта папка уже выбрана'
                    : 'Использовать эту папку для транскрипций'}
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
