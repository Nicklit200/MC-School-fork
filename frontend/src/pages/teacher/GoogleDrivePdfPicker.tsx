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
  const [loadingDrives, setLoadingDrives] = useState(false);
  const [loading, setLoading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || drives.length > 0 || loadingDrives) return;
    setLoadingDrives(true);
    setError(null);
    driveApi.listSharedDrives()
      .then((items) => {
        setDrives(items);
        if (items.length === 0) {
          setError('Google Drive подключён, но общие диски не найдены.');
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoadingDrives(false));
  }, [open, drives.length, loadingDrives]);

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
    <>
      <button className="btn btn--secondary" type="button" disabled={disabled} onClick={() => setOpen(true)}>
        Google Drive
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(15, 23, 42, .35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
          }}
        >
          <div
            className="panel"
            onClick={(event) => event.stopPropagation()}
            style={{
              width: 'min(820px, 100%)',
              maxHeight: '82vh',
              overflowY: 'auto',
              margin: 0,
              padding: 20,
              boxShadow: '0 24px 80px rgba(15, 23, 42, .2)',
            }}
          >
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <div>
                <strong style={{ fontSize: 18 }}>Выбрать PDF из Google Drive</strong>
                <p className="muted" style={{ margin: '6px 0 0' }}>Открой нужную папку и нажми на PDF.</p>
              </div>
              <button className="btn btn--ghost" type="button" onClick={() => setOpen(false)}>Закрыть</button>
            </div>

            {error && <div className="banner banner--error" style={{ marginTop: 14 }}>{error}</div>}

            <label className="field" style={{ marginTop: 16 }}>
              <span className="field__label">Общий диск</span>
              <select
                className="select"
                value={driveId}
                onChange={(e) => void chooseDrive(e.target.value)}
                disabled={loadingDrives}
              >
                <option value="">{loadingDrives ? 'Загружаем диски…' : 'Выберите диск'}</option>
                {drives.map((drive) => <option key={drive.id} value={drive.id}>{drive.name}</option>)}
              </select>
            </label>

            {driveId && (
              <>
                <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                  <button className="btn btn--ghost" type="button" onClick={() => void jumpTo(-1)}>Корень</button>
                  {path.map((item, index) => (
                    <span key={item.id} className="row" style={{ gap: 6 }}>
                      <span className="muted">/</span>
                      <button className="btn btn--ghost" type="button" onClick={() => void jumpTo(index)}>{item.name}</button>
                    </span>
                  ))}
                </div>

                {loading ? <p className="muted">Загрузка папки…</p> : (
                  <div style={{ display: 'grid', gap: 8 }}>
                    {folders.map((folder) => (
                      <button key={folder.id} type="button" className="list-row" onClick={() => void enterFolder(folder)} style={{ width: '100%', textAlign: 'left', cursor: 'pointer' }}>
                        <div className="list-row__title">📁 {folder.name}</div>
                      </button>
                    ))}
                    {files.map((file) => (
                      <button key={file.id} type="button" className="list-row" onClick={() => void selectFile(file)} disabled={downloadingId === file.id} style={{ width: '100%', textAlign: 'left', cursor: 'pointer' }}>
                        <div className="list-row__title">📄 {file.name}</div>
                        <div className="muted">{downloadingId === file.id ? 'Загружаю PDF…' : 'Выбрать этот PDF'}</div>
                      </button>
                    ))}
                    {folders.length === 0 && files.length === 0 && <p className="muted">В этой папке нет PDF или подпапок.</p>}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
