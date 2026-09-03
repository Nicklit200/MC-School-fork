import { useEffect, useState } from 'react';
import { driveApi, type DriveItem } from '../../api/drive';

type Props = {
  disabled?: boolean;
  onSelect: (file: File) => void;
};

export function GoogleDrivePdfPicker({ disabled = false, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const [drives, setDrives] = useState<DriveItem[]>([]);
  const [driveId, setDriveId] = useState('');
  const [folders, setFolders] = useState<DriveItem[]>([]);
  const [files, setFiles] = useState<DriveItem[]>([]);
  const [path, setPath] = useState<DriveItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || drives.length > 0) return;
    driveApi.listSharedDrives()
      .then(setDrives)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [open, drives.length]);

  async function load(drive: string, parentId?: string) {
    setLoading(true);
    setError(null);
    try {
      const [nextFolders, nextFiles] = await Promise.all([
        driveApi.listFolders(drive, parentId),
        driveApi.listPdfFiles(drive, parentId),
      ]);
      setFolders(nextFolders);
      setFiles(nextFiles);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function chooseDrive(nextDriveId: string) {
    setDriveId(nextDriveId);
    setPath([]);
    setFolders([]);
    setFiles([]);
    if (nextDriveId) await load(nextDriveId);
  }

  async function enterFolder(folder: DriveItem) {
    const nextPath = [...path, folder];
    setPath(nextPath);
    await load(driveId, folder.id);
  }

  async function jumpTo(index: number) {
    if (!driveId) return;
    if (index < 0) {
      setPath([]);
      await load(driveId);
      return;
    }
    const nextPath = path.slice(0, index + 1);
    setPath(nextPath);
    await load(driveId, nextPath[nextPath.length - 1].id);
  }

  async function selectFile(item: DriveItem) {
    setDownloadingId(item.id);
    setError(null);
    try {
      const file = await driveApi.downloadPdf(item.id, item.name);
      onSelect(file);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <div className="drive-homework-picker">
      <button className="btn btn--secondary" type="button" disabled={disabled} onClick={() => setOpen((value) => !value)}>
        Google Drive
      </button>

      {open && (
        <div className="panel" style={{ marginTop: 10, padding: 14 }}>
          <strong>Выбрать PDF из Google Drive</strong>
          <p className="muted" style={{ margin: '6px 0 12px' }}>Открой нужную папку и выбери PDF. Он будет использован как домашка для этого дня.</p>
          {error && <div className="banner banner--error">{error}</div>}

          <label className="field">
            <span className="field__label">Общий диск</span>
            <select className="select" value={driveId} onChange={(e) => void chooseDrive(e.target.value)}>
              <option value="">Выберите диск</option>
              {drives.map((drive) => <option key={drive.id} value={drive.id}>{drive.name}</option>)}
            </select>
          </label>

          {driveId && (
            <>
              <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                <button className="btn btn--ghost" type="button" onClick={() => void jumpTo(-1)}>Корень</button>
                {path.map((item, index) => (
                  <span key={item.id} className="row" style={{ gap: 6 }}>
                    <span className="muted">/</span>
                    <button className="btn btn--ghost" type="button" onClick={() => void jumpTo(index)}>{item.name}</button>
                  </span>
                ))}
              </div>

              {loading ? <p className="muted">Загрузка…</p> : (
                <div style={{ display: 'grid', gap: 6 }}>
                  {folders.map((folder) => (
                    <button key={folder.id} type="button" className="list-row" onClick={() => void enterFolder(folder)} style={{ width: '100%', textAlign: 'left', cursor: 'pointer' }}>
                      <div className="list-row__title">📁 {folder.name}</div>
                    </button>
                  ))}
                  {files.map((file) => (
                    <button key={file.id} type="button" className="list-row" onClick={() => void selectFile(file)} disabled={downloadingId === file.id} style={{ width: '100%', textAlign: 'left', cursor: 'pointer' }}>
                      <div className="list-row__title">📄 {file.name}</div>
                      <div className="muted">{downloadingId === file.id ? 'Загружаю…' : 'Выбрать этот PDF'}</div>
                    </button>
                  ))}
                  {folders.length === 0 && files.length === 0 && <p className="muted">В этой папке нет PDF или подпапок.</p>}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
