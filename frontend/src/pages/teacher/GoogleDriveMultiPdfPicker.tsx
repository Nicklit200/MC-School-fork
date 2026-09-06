import { useEffect, useState } from 'react';
import { driveApi, type DriveItem } from '../../api/drive';

type Props = {
  disabled?: boolean;
  maxFiles?: number;
  buttonLabel?: string;
  onSelect: (files: File[]) => void;
};

export function GoogleDriveMultiPdfPicker({
  disabled = false,
  maxFiles = 31,
  buttonLabel = 'Выбрать несколько PDF из Google Drive',
  onSelect,
}: Props) {
  const [open, setOpen] = useState(false);
  const [drives, setDrives] = useState<DriveItem[]>([]);
  const [driveId, setDriveId] = useState('');
  const [folders, setFolders] = useState<DriveItem[]>([]);
  const [files, setFiles] = useState<DriveItem[]>([]);
  const [path, setPath] = useState<DriveItem[]>([]);
  const [selected, setSelected] = useState<DriveItem[]>([]);
  const [loadingDrives, setLoadingDrives] = useState(false);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
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

  function openPicker() {
    setSelected([]);
    setError(null);
    setOpen(true);
  }

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
    setSelected([]);
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

  function toggleFile(item: DriveItem) {
    setSelected((current) => {
      const existingIndex = current.findIndex((selectedItem) => selectedItem.id === item.id);
      if (existingIndex >= 0) {
        return current.filter((selectedItem) => selectedItem.id !== item.id);
      }
      if (current.length >= maxFiles) {
        setError(`Можно выбрать максимум ${maxFiles} PDF.`);
        return current;
      }
      setError(null);
      return [...current, item];
    });
  }

  async function confirmSelection() {
    if (selected.length === 0 || downloading) return;
    setDownloading(true);
    setError(null);
    try {
      const downloaded: File[] = [];
      for (const item of selected) {
        setDownloadingId(item.id);
        downloaded.push(await driveApi.downloadPdf(item.id, item.name));
      }
      onSelect(downloaded);
      setOpen(false);
      setSelected([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDownloadingId(null);
      setDownloading(false);
    }
  }

  return (
    <>
      <button className="btn btn--secondary" type="button" disabled={disabled} onClick={openPicker}>
        {buttonLabel}
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => { if (!downloading) setOpen(false); }}
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
              width: 'min(900px, 100%)',
              maxHeight: '86vh',
              overflowY: 'auto',
              margin: 0,
              padding: 20,
              boxShadow: '0 24px 80px rgba(15, 23, 42, .2)',
            }}
          >
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <div>
                <strong style={{ fontSize: 18 }}>Выбрать несколько PDF из Google Drive</strong>
                <p className="muted" style={{ margin: '6px 0 0' }}>
                  Нажимайте PDF в нужном порядке: первый файл пойдёт на День 1, второй — на День 2 и так далее.
                </p>
              </div>
              <button className="btn btn--ghost" type="button" disabled={downloading} onClick={() => setOpen(false)}>Закрыть</button>
            </div>

            {error && <div className="banner banner--error" style={{ marginTop: 14 }}>{error}</div>}

            <label className="field" style={{ marginTop: 16 }}>
              <span className="field__label">Общий диск</span>
              <select
                className="select"
                value={driveId}
                onChange={(e) => void chooseDrive(e.target.value)}
                disabled={loadingDrives || downloading}
              >
                <option value="">{loadingDrives ? 'Загружаем диски…' : 'Выберите диск'}</option>
                {drives.map((drive) => <option key={drive.id} value={drive.id}>{drive.name}</option>)}
              </select>
            </label>

            {driveId && (
              <>
                <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                  <button className="btn btn--ghost" type="button" disabled={downloading} onClick={() => void jumpTo(-1)}>Корень</button>
                  {path.map((item, index) => (
                    <span key={item.id} className="row" style={{ gap: 6 }}>
                      <span className="muted">/</span>
                      <button className="btn btn--ghost" type="button" disabled={downloading} onClick={() => void jumpTo(index)}>{item.name}</button>
                    </span>
                  ))}
                </div>

                {loading ? <p className="muted">Загрузка папки…</p> : (
                  <div style={{ display: 'grid', gap: 8 }}>
                    {folders.map((folder) => (
                      <button
                        key={folder.id}
                        type="button"
                        className="list-row"
                        disabled={downloading}
                        onClick={() => void enterFolder(folder)}
                        style={{ width: '100%', textAlign: 'left', cursor: 'pointer' }}
                      >
                        <div className="list-row__title">📁 {folder.name}</div>
                      </button>
                    ))}
                    {files.map((file) => {
                      const selectedIndex = selected.findIndex((item) => item.id === file.id);
                      const isSelected = selectedIndex >= 0;
                      return (
                        <button
                          key={file.id}
                          type="button"
                          className="list-row"
                          disabled={downloading}
                          onClick={() => toggleFile(file)}
                          style={{
                            width: '100%',
                            textAlign: 'left',
                            cursor: 'pointer',
                            outline: isSelected ? '2px solid currentColor' : undefined,
                          }}
                        >
                          <div className="list-row__title">📄 {file.name}</div>
                          <div className="muted">
                            {downloadingId === file.id
                              ? 'Загружаю PDF…'
                              : isSelected
                                ? `Выбран №${selectedIndex + 1} — нажмите ещё раз, чтобы убрать`
                                : 'Нажмите, чтобы добавить в очередь'}
                          </div>
                        </button>
                      );
                    })}
                    {folders.length === 0 && files.length === 0 && <p className="muted">В этой папке нет PDF или подпапок.</p>}
                  </div>
                )}
              </>
            )}

            <div className="panel" style={{ margin: '18px 0 0', padding: 14 }}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0, flex: '1 1 420px' }}>
                  <strong>Очередь: {selected.length} PDF</strong>
                  {selected.length > 0 ? (
                    <div className="muted" style={{ marginTop: 6, overflowWrap: 'anywhere' }}>
                      {selected.map((item, index) => `${index + 1}. ${item.name}`).join('  ·  ')}
                    </div>
                  ) : (
                    <div className="muted" style={{ marginTop: 6 }}>Выберите PDF выше в нужном порядке.</div>
                  )}
                </div>
                <button className="btn" type="button" disabled={selected.length === 0 || downloading} onClick={() => void confirmSelection()}>
                  {downloading ? 'Загружаем выбранные PDF…' : `Добавить выбранные (${selected.length})`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
