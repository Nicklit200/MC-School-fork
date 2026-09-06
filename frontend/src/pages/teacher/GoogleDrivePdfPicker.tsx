import { useEffect, useState } from 'react';
import { driveApi, type DriveItem } from '../../api/drive';

type Props = {
  disabled?: boolean;
  onSelect: (file: File) => void;
  onSelectMany?: (files: File[]) => void;
  maxFiles?: number;
};

export function GoogleDrivePdfPicker({ disabled = false, onSelect, onSelectMany, maxFiles = 1 }: Props) {
  const [open, setOpen] = useState(false);
  const [drives, setDrives] = useState<DriveItem[]>([]);
  const [driveId, setDriveId] = useState('');
  const [folders, setFolders] = useState<DriveItem[]>([]);
  const [files, setFiles] = useState<DriveItem[]>([]);
  const [path, setPath] = useState<DriveItem[]>([]);
  const [loadingDrives, setLoadingDrives] = useState(false);
  const [loading, setLoading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadingMany, setDownloadingMany] = useState(false);
  const [selected, setSelected] = useState<DriveItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const multi = Boolean(onSelectMany) && maxFiles > 1;

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
    setError(null);
    setSelected((current) => {
      const existingIndex = current.findIndex((selectedFile) => selectedFile.id === item.id);
      if (existingIndex >= 0) {
        return current.filter((selectedFile) => selectedFile.id !== item.id);
      }
      if (current.length >= maxFiles) {
        setError(`Можно выбрать максимум ${maxFiles} PDF.`);
        return current;
      }
      return [...current, item];
    });
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

  async function confirmMany() {
    if (!onSelectMany || selected.length === 0 || downloadingMany) return;
    setDownloadingMany(true);
    setError(null);
    try {
      const downloaded: File[] = [];
      for (const item of selected) {
        downloaded.push(await driveApi.downloadPdf(item.id, item.name));
      }
      onSelectMany(downloaded);
      setSelected([]);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDownloadingMany(false);
    }
  }

  function close() {
    if (downloadingMany) return;
    setSelected([]);
    setOpen(false);
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
          onClick={close}
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
                <strong style={{ fontSize: 18 }}>{multi ? 'Выбрать несколько PDF из Google Drive' : 'Выбрать PDF из Google Drive'}</strong>
                <p className="muted" style={{ margin: '6px 0 0' }}>
                  {multi
                    ? `Нажимай на PDF по очереди. Номер показывает, на какой день он попадёт. Можно выбрать до ${maxFiles}.`
                    : 'Открой нужную папку и нажми на PDF.'}
                </p>
              </div>
              <button className="btn btn--ghost" type="button" disabled={downloadingMany} onClick={close}>Закрыть</button>
            </div>

            {error && <div className="banner banner--error" style={{ marginTop: 14 }}>{error}</div>}

            <label className="field" style={{ marginTop: 16 }}>
              <span className="field__label">Общий диск</span>
              <select
                className="select"
                value={driveId}
                onChange={(e) => void chooseDrive(e.target.value)}
                disabled={loadingDrives || downloadingMany}
              >
                <option value="">{loadingDrives ? 'Загружаем диски…' : 'Выберите диск'}</option>
                {drives.map((drive) => <option key={drive.id} value={drive.id}>{drive.name}</option>)}
              </select>
            </label>

            {multi && selected.length > 0 && (
              <div className="banner banner--info" style={{ marginBottom: 14 }}>
                Выбрано {selected.length} из {maxFiles}: {selected.map((item, index) => `${index + 1}. ${item.name}`).join(' · ')}
              </div>
            )}

            {driveId && (
              <>
                <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                  <button className="btn btn--ghost" type="button" disabled={downloadingMany} onClick={() => void jumpTo(-1)}>Корень</button>
                  {path.map((item, index) => (
                    <span key={item.id} className="row" style={{ gap: 6 }}>
                      <span className="muted">/</span>
                      <button className="btn btn--ghost" type="button" disabled={downloadingMany} onClick={() => void jumpTo(index)}>{item.name}</button>
                    </span>
                  ))}
                </div>

                {loading ? <p className="muted">Загрузка папки…</p> : (
                  <div style={{ display: 'grid', gap: 8 }}>
                    {folders.map((folder) => (
                      <button key={folder.id} type="button" className="list-row" disabled={downloadingMany} onClick={() => void enterFolder(folder)} style={{ width: '100%', textAlign: 'left', cursor: 'pointer' }}>
                        <div className="list-row__title">📁 {folder.name}</div>
                      </button>
                    ))}
                    {files.map((file) => {
                      const selectedIndex = selected.findIndex((item) => item.id === file.id);
                      return (
                        <button
                          key={file.id}
                          type="button"
                          className="list-row"
                          onClick={() => multi ? toggleFile(file) : void selectFile(file)}
                          disabled={downloadingMany || (!multi && downloadingId === file.id)}
                          style={{ width: '100%', textAlign: 'left', cursor: 'pointer', borderColor: selectedIndex >= 0 ? '#ff9f6a' : undefined }}
                        >
                          <div className="list-row__title">📄 {file.name}</div>
                          <div className="muted">
                            {multi
                              ? (selectedIndex >= 0 ? `Выбран ${selectedIndex + 1}-м` : 'Нажать, чтобы добавить в очередь')
                              : (downloadingId === file.id ? 'Загружаю PDF…' : 'Выбрать этот PDF')}
                          </div>
                        </button>
                      );
                    })}
                    {folders.length === 0 && files.length === 0 && <p className="muted">В этой папке нет PDF или подпапок.</p>}
                  </div>
                )}
              </>
            )}

            {multi && (
              <div className="row" style={{ justifyContent: 'flex-end', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
                <button className="btn btn--ghost" type="button" disabled={selected.length === 0 || downloadingMany} onClick={() => setSelected([])}>Очистить</button>
                <button className="btn" type="button" disabled={selected.length === 0 || downloadingMany} onClick={() => void confirmMany()}>
                  {downloadingMany ? 'Загружаем PDF…' : `Добавить ${selected.length || ''} PDF`}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
