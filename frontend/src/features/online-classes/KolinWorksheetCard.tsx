import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { kolinApi, type KolinWorksheet } from '../../api/kolin';
import { openPdf, type PdfDoc } from './pdfDocument';
import { InteractiveDialog, InteractiveTemplate } from './InteractiveTemplate';

function recipientName(name: string) {
  const first = name.trim().split(/\s+/)[0];
  if (!/^[А-ЯЁа-яё]+$/.test(first)) return first;
  if (/ия$/i.test(first)) return `${first.slice(0, -1)}и`;
  if (/а$/i.test(first)) return `${first.slice(0, -1)}е`;
  if (/я$/i.test(first)) return `${first.slice(0, -1)}е`;
  if (/[йь]$/i.test(first)) return `${first.slice(0, -1)}ю`;
  if (/[бвгджзклмнпрстфхцчшщ]$/i.test(first)) return `${first}у`;
  return first;
}

function taskCountLabel(count: number, de: boolean) {
  if (de) return `${count} ${count === 1 ? 'Aufgabe' : 'Aufgaben'}`;
  const last = count % 10, lastTwo = count % 100;
  return `${count} ${lastTwo >= 11 && lastTwo <= 14 ? 'заданий' : last === 1 ? 'задание' : last >= 2 && last <= 4 ? 'задания' : 'заданий'}`;
}

function WorksheetPdfPreview({ classId, worksheet, de, onClose }: {
  classId: string; worksheet: KolinWorksheet; de: boolean; onClose: () => void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const pages = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  useEffect(() => {
    const previousFocus = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => {
      document.body.style.overflow = overflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    let pdf: PdfDoc | undefined;
    pages.current?.replaceChildren();
    setStatus('loading');
    const load = async () => {
      try {
        const blob = await kolinApi.worksheetPdf(classId, worksheet.id);
        const loaded = await openPdf(await blob.arrayBuffer());
        if (cancelled) { loaded.destroy(); return; }
        pdf = loaded;
        for (let index = 0; index < loaded.pageCount; index++) {
          const { canvas } = await loaded.renderPage(index, 720);
          if (cancelled) return;
          canvas.setAttribute('role', 'img');
          canvas.setAttribute('aria-label', `${de ? 'Seite' : 'Страница'} ${index + 1}`);
          pages.current?.appendChild(canvas);
        }
        if (!cancelled) setStatus('ready');
      } catch {
        if (!cancelled) setStatus('error');
      }
    };
    void load();
    return () => { cancelled = true; pdf?.destroy(); };
  }, [classId, worksheet.id, de]);
  return createPortal(<div className="kolin-pdf-preview" data-testid="kolin-pdf-overlay"
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-label={`${de ? 'PDF-Vorschau für' : 'Предпросмотр PDF для'} ${worksheet.studentName}`}
      className="kolin-pdf-preview__dialog" onKeyDown={event => {
        event.stopPropagation();
        if (event.key === 'Escape') { event.preventDefault(); onClose(); }
        // The close control is the only focusable element in this read-only preview.
        if (event.key === 'Tab') { event.preventDefault(); dialog.current?.querySelector<HTMLButtonElement>('button')?.focus(); }
      }}>
      <header><strong>{worksheet.studentName} · PDF</strong><button type="button" onClick={onClose}
        aria-label={de ? 'Vorschau schließen' : 'Закрыть предпросмотр'}>×</button></header>
      <div className="kolin-pdf-preview__pages" ref={pages} aria-busy={status === 'loading'} />
      {status === 'loading' && <p role="status">{de ? 'PDF wird geladen…' : 'Загружаем PDF…'}</p>}
      {status === 'error' && <p role="alert">{de ? 'Die PDF-Vorschau konnte nicht geladen werden.' : 'Не удалось загрузить предпросмотр PDF.'}</p>}
    </div>
  </div>, document.body);
}

export function KolinWorksheetCard({ classId, worksheet, appendStatus, de, onAdd }: {
  classId: string; worksheet: KolinWorksheet; appendStatus?: 'pending' | 'failed'; de: boolean; onAdd: () => void;
}) {
  const [thumbnail, setThumbnail] = useState<string>();
  const [preview, setPreview] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let url: string | undefined;
    setThumbnail(undefined);
    if (worksheet.interactive) return;
    void kolinApi.worksheetPreview(classId, worksheet.id).then(blob => {
      if (cancelled) return;
      url = URL.createObjectURL(blob);
      setThumbnail(url);
    }).catch(() => { /* The clickable PDF fallback still opens the authorized full preview. */ });
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [classId, worksheet.id]);
  if (worksheet.interactive) return <div className="kolin-worksheet" data-worksheet-id={worksheet.id}>
    <button type="button" className="kolin-worksheet__interactive-thumbnail" onClick={()=>setPreview(true)} aria-label={`${de?'Vorschau für':'Предпросмотр для'} ${worksheet.studentName}`}>
      <InteractiveTemplate spec={worksheet.interactive[0]} disabled/>
    </button>
    <strong>{worksheet.studentName}</strong><p>{worksheet.interactive.length} {de?'interaktive Objekte':'интерактивных объектов'}</p>
    <button type="button" className="kolin-worksheet__add" disabled={worksheet.state==='ADDED'||appendStatus==='pending'} onClick={onAdd}>
      {worksheet.state==='ADDED'?de?'Hinzugefügt ✓':'Добавлено ✓':appendStatus==='pending'?de?'Wird hinzugefügt…':'Добавляем…':de?`Für ${worksheet.studentName} hinzufügen`:`Добавить ${recipientName(worksheet.studentName)}`}
    </button>
    {appendStatus==='failed'&&<p role="alert">{de?'Hinzufügen fehlgeschlagen. Bitte erneut versuchen.':'Не удалось подтвердить добавление. Повторите нажатие.'}</p>}
    {preview&&<InteractiveDialog title={worksheet.studentName} onClose={()=>setPreview(false)}>
      {worksheet.interactive.map((spec,index)=><InteractiveTemplate key={index} spec={spec} disabled/>)}
    </InteractiveDialog>}
  </div>;
  const added = worksheet.state === 'ADDED';
  return <div className="kolin-worksheet" data-worksheet-id={worksheet.id}>
    <div className="kolin-worksheet__summary">
      <button type="button" className="kolin-worksheet__thumbnail" onClick={() => setPreview(true)}
        aria-label={`${de ? 'PDF-Vorschau für' : 'Предпросмотр PDF для'} ${worksheet.studentName}`}>
        {thumbnail ? <img src={thumbnail} alt={de ? 'Erste PDF-Seite' : 'Первая страница PDF'} /> : <span aria-hidden="true">PDF</span>}
      </button>
      <div><strong>{worksheet.studentName}</strong><span>{taskCountLabel(worksheet.taskCount, de)} · {worksheet.pageCount} {de ? worksheet.pageCount === 1 ? 'Seite' : 'Seiten' : 'стр.'}</span></div>
    </div>
    <button type="button" className="kolin-worksheet__add" disabled={added || appendStatus === 'pending'} onClick={onAdd}>
      {added ? de ? 'Hinzugefügt ✓' : 'Добавлено ✓' : appendStatus === 'pending' ? de ? 'Wird hinzugefügt…' : 'Добавляем…'
        : de ? `Für ${worksheet.studentName} hinzufügen` : `Добавить ${recipientName(worksheet.studentName)}`}
    </button>
    {appendStatus === 'failed' && <p className="kolin-worksheet__error" role="alert">{de
      ? 'Hinzufügen nicht bestätigt. Drücken Sie die Taste erneut, um es sicher zu wiederholen.'
      : 'Добавление не подтверждено. Нажмите кнопку ещё раз, чтобы безопасно повторить.'}</p>}
    {preview && <WorksheetPdfPreview classId={classId} worksheet={worksheet} de={de} onClose={() => setPreview(false)} />}
  </div>;
}
