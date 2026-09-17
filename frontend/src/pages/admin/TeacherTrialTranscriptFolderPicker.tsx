import { useEffect, useMemo, useState } from 'react';
import type { User } from '../../api/types';
import { driveApi, type DriveItem } from '../../api/drive';
import { updateTeacherTrialTranscriptFolder } from '../../api/adminTeacherDrive';

export function TeacherTrialTranscriptFolderPicker({ teacher, onSaved }: { teacher: User; onSaved: (teacher: User) => void }) {
  const [drives, setDrives] = useState<DriveItem[]>([]);
  const [driveId, setDriveId] = useState('');
  const [folders, setFolders] = useState<DriveItem[]>([]);
  const [path, setPath] = useState<DriveItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const currentFolderId = useMemo(() => path.length ? path[path.length - 1].id : driveId, [path, driveId]);
  const currentPath = useMemo(() => {
    const driveName = drives.find((item) => item.id === driveId)?.name ?? '';
    return [driveName, ...path.map((item) => item.name)].filter(Boolean).join(' / ');
  }, [drives, driveId, path]);

  useEffect(() => {
    driveApi.listSharedDrives()
      .then(setDrives)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  async function loadFolders(selectedDriveId: string, parentId?: string) {
    setError(null);
    setFolders(await driveApi.listFolders(selectedDriveId, parentId));
  }

  async function chooseDrive(value: string) {
    setDriveId(value);
    setPath([]);
    setFolders([]);
    setMessage(null);
    if (value) await loadFolders(value);
  }

  async function enter(folder: DriveItem) {
    const next = [...path, folder];
    setPath(next);
    setMessage(null);
    await loadFolders(driveId, folder.id);
  }

  async function jumpTo(index: number) {
    setMessage(null);
    if (index < 0) {
      setPath([]);
      await loadFolders(driveId);
      return;
    }
    const next = path.slice(0, index + 1);
    setPath(next);
    await loadFolders(driveId, next[next.length - 1].id);
  }

  async function save() {
    if (!currentFolderId || saving) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const updated = await updateTeacherTrialTranscriptFolder(teacher.id, currentFolderId);
      onSaved(updated);
      setMessage(`Папка для пробных уроков сохранена: ${currentPath || 'выбранная папка'}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel" style={{ margin: '8px 0 16px', padding: 18, border: '1px solid #f0d8c8' }}>
      <h3 style={{ margin: 0 }}>Google Drive · пробные уроки</h3>
      <p className="muted" style={{ margin: '6px 0 12px' }}>
        Выберите папку для транскрипций пробных уроков преподавателя {teacher.fullName}. Сюда попадут транскрипции событий без привязанного ученика и без группы.
      </p>
      {teacher.googleDriveTrialTranscriptFolderId && <div className="banner banner--success" style={{ marginBottom: 10 }}>Папка уже настроена.</div>}
      {error && <div className="banner banner--error" style={{ marginBottom: 10 }}>{error}</div>}
      {message && <div className="banner banner--success" style={{ marginBottom: 10 }}>{message}</div>}
      {loading ? <p className="muted">Загружаем Google Drive…</p> : <div className="stack" style={{ gap: 10 }}>
        <label className="field" style={{ margin: 0 }}>
          <span className="field__label">Общий диск</span>
          <select className="select" value={driveId} onChange={(e) => void chooseDrive(e.target.value)}>
            <option value="">Выберите диск</option>
            {drives.map((drive) => <option key={drive.id} value={drive.id}>{drive.name}</option>)}
          </select>
        </label>
        {driveId && <>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <button className="btn btn--ghost" type="button" onClick={() => void jumpTo(-1)}>{drives.find((drive) => drive.id === driveId)?.name ?? 'Корень'}</button>
            {path.map((folder, index) => <span className="row" style={{ gap: 6 }} key={folder.id}><span className="muted">/</span><button className="btn btn--ghost" type="button" onClick={() => void jumpTo(index)}>{folder.name}</button></span>)}
          </div>
          <div className="stack" style={{ gap: 6 }}>
            {folders.length === 0 ? <div className="muted">В этой папке нет подпапок.</div> : folders.map((folder) => <button key={folder.id} className="list-row" type="button" onClick={() => void enter(folder)} style={{ width: '100%', textAlign: 'left', cursor: 'pointer' }}><div className="list-row__title">📁 {folder.name}</div></button>)}
          </div>
          <button className="btn" type="button" disabled={!currentFolderId || saving || currentFolderId === teacher.googleDriveTrialTranscriptFolderId} onClick={() => void save()} style={{ alignSelf: 'flex-start' }}>
            {saving ? 'Сохраняем…' : currentFolderId === teacher.googleDriveTrialTranscriptFolderId ? 'Эта папка уже выбрана' : 'Использовать для пробных уроков'}
          </button>
        </>}
      </div>}
    </section>
  );
}
