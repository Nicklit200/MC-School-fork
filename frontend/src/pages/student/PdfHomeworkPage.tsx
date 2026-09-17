import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { Homework } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import { toErrorMessage } from '../../lib/errors';

type Tool = 'pen' | 'eraser';
type PenColor = '#111111' | '#2563eb' | '#dc2626' | '#16a34a';
type ViewportState = { scale: number; offsetLeft: number; offsetTop: number; width: number; height: number };
type StrokeGeometry = { left: number; top: number; width: number; height: number; canvasWidth: number; canvasHeight: number };

const PEN_COLORS: Array<{ value: PenColor; labelRu: string; labelDe: string }> = [
  { value: '#2563eb', labelRu: 'Синий', labelDe: 'Blau' },
  { value: '#111111', labelRu: 'Чёрный', labelDe: 'Schwarz' },
  { value: '#dc2626', labelRu: 'Красный', labelDe: 'Rot' },
  { value: '#16a34a', labelRu: 'Зелёный', labelDe: 'Grün' },
];
const PEN_SIZES = [3, 5, 8, 12];

export function PdfHomeworkPage() {
  const { homeworkId = '' } = useParams();
  const { language, t } = useI18n();
  const [homework, setHomework] = useState<Homework | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageUrls, setPageUrls] = useState<Record<number, string>>({});
  const [drawings, setDrawings] = useState<Record<number, string>>({});
  const [tool, setTool] = useState<Tool>('pen');
  const [penColor, setPenColor] = useState<PenColor>('#2563eb');
  const [penSize, setPenSize] = useState(5);
  const [desktopZoom, setDesktopZoom] = useState(100);
  const [desktopControls, setDesktopControls] = useState(false);
  const [viewport, setViewport] = useState<ViewportState>({ scale: 1, offsetLeft: 0, offsetTop: 0, width: typeof window === 'undefined' ? 1024 : window.innerWidth, height: typeof window === 'undefined' ? 768 : window.innerHeight });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const media = window.matchMedia('(pointer: fine)');
    const update = () => setDesktopControls(media.matches);
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);

  useEffect(() => {
    const visual = window.visualViewport;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (visual) setViewport({ scale: visual.scale || 1, offsetLeft: visual.offsetLeft || 0, offsetTop: visual.offsetTop || 0, width: visual.width || window.innerWidth, height: visual.height || window.innerHeight });
        else setViewport({ scale: 1, offsetLeft: 0, offsetTop: 0, width: window.innerWidth, height: window.innerHeight });
      });
    };
    update();
    visual?.addEventListener('resize', update);
    visual?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => { cancelAnimationFrame(frame); visual?.removeEventListener('resize', update); visual?.removeEventListener('scroll', update); window.removeEventListener('resize', update); };
  }, []);

  useEffect(() => {
    api.study.homeworks().then((items) => setHomework(items.find((item) => item.id === homeworkId) ?? null)).catch((e) => setError(toErrorMessage(e, t)));
  }, [homeworkId, t]);

  useEffect(() => {
    if (!homework?.hasWorksheet || pageUrls[pageIndex]) return;
    let cancelled = false;
    api.study.worksheetPageDataUrl(homeworkId, pageIndex)
      .then((dataUrl) => { if (!cancelled) setPageUrls((current) => ({ ...current, [pageIndex]: dataUrl.trim() })); })
      .catch((e) => setError(toErrorMessage(e, t)));
    return () => { cancelled = true; };
  }, [homework, homeworkId, pageIndex, pageUrls, t]);

  const pageCount = homework?.worksheetPageCount ?? 0;
  const pageUrl = pageUrls[pageIndex];
  const submittedText = useMemo(() => {
    if (!homework?.submittedAt) return null;
    return new Intl.DateTimeFormat(language === 'DE' ? 'de-DE' : 'ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(homework.submittedAt));
  }, [homework?.submittedAt, language]);

  async function submitHomework() {
    if (!homework?.hasWorksheet || homework.pdfUploaded) return;
    if (!window.confirm(language === 'DE' ? 'Hausaufgabe jetzt abgeben?' : 'Сдать домашнюю работу сейчас?')) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const overlays = Object.entries(drawings).map(([index, imageBase64]) => ({ pageIndex: Number(index), imageBase64 }));
      await api.study.submitPdfHomework(homeworkId, overlays);
      setPageUrls({});
      const updated = (await api.study.homeworks()).find((item) => item.id === homeworkId) ?? null;
      setHomework(updated);
      setMessage(language === 'DE' ? 'PDF gespeichert. Jetzt trage unten die Antworten ein.' : 'PDF сохранён. Теперь впиши ответы ниже.');
    } catch (e) { setError(toErrorMessage(e, t)); } finally { setBusy(false); }
  }

  if (!homework) return <div>{error ? <div className="banner banner--error">{error}</div> : t('common.loading')}</div>;
  if (!homework.hasWorksheet) return <div><Link to={`/student/homeworks/${homeworkId}`} className="muted">← {t('common.back')}</Link><div className="panel" style={{ marginTop: 16 }}>{language === 'DE' ? 'Für diese Hausaufgabe wurde noch kein PDF hochgeladen.' : 'Для этой домашки PDF пока не загружен.'}</div></div>;

  const documentWidth = desktopControls ? `${desktopZoom}%` : '100%';
  const toolbarScale = desktopControls ? 1 : 1 / Math.max(viewport.scale, 0.5);

  return (
    <div className="pdf-homework-page" style={{ paddingLeft: desktopControls ? 0 : 72 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ minWidth: 0 }}>
          <Link to={`/student/homeworks/${homeworkId}`} className="muted">← {t('common.back')}</Link>
          <h1 style={{ margin: '8px 0 2px' }}>{language === 'DE' ? 'Hausaufgabe' : 'Домашка'}</h1>
          <div className="muted" style={{ overflowWrap: 'anywhere' }}>{homework.worksheetFilename}</div>
        </div>
        {homework.pdfUploaded && <span className="pill pill--learned">{language === 'DE' ? 'PDF gespeichert' : 'PDF сохранён'}</span>}
      </div>

      {error && <div className="banner banner--error">{error}</div>}
      {message && <div className="banner banner--success">{message}</div>}
      {submittedText && <div className="banner banner--info">{language === 'DE' ? 'PDF gespeichert:' : 'PDF сохранён:'} {submittedText}. {homework.submitted ? (language === 'DE' ? 'Die Hausaufgabe ist vollständig abgegeben.' : 'Домашка полностью сдана.') : (language === 'DE' ? 'Unten fehlen noch die Antworten.' : 'Ниже ещё нужно вписать ответы.')}</div>}

      {desktopControls && (
        <div className="panel" style={{ position: 'sticky', top: 8, zIndex: 5, marginBottom: 12 }}>
          <div className="row" style={{ alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            {!homework.pdfUploaded && <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}><button type="button" className={`btn ${tool === 'pen' ? '' : 'btn--secondary'}`} onClick={() => setTool('pen')}>{language === 'DE' ? 'Stift' : 'Ручка'}</button><button type="button" className={`btn ${tool === 'eraser' ? '' : 'btn--secondary'}`} onClick={() => setTool('eraser')}>{language === 'DE' ? 'Radierer' : 'Ластик'}</button><ColorPicker language={language} value={penColor} onChange={(color) => { setPenColor(color); setTool('pen'); }} /><SizePicker language={language} value={penSize} onChange={(size) => { setPenSize(size); setTool('pen'); }} /></div>}
            <div className="row" style={{ gap: 8, alignItems: 'center' }}><button className="btn btn--secondary" type="button" disabled={pageIndex === 0} onClick={() => setPageIndex((p) => p - 1)}>←</button><strong>{pageIndex + 1} / {pageCount}</strong><button className="btn btn--secondary" type="button" disabled={pageIndex >= pageCount - 1} onClick={() => setPageIndex((p) => p + 1)}>→</button></div>
          </div>
        </div>
      )}

      {!pageUrl ? <div className="panel">{t('common.loading')}</div> : homework.pdfUploaded ? (
        <div style={{ position: 'relative', overflow: desktopControls ? 'auto' : 'visible', width: '100%' }}>
          {desktopControls && <DesktopZoomControls zoom={desktopZoom} onChange={setDesktopZoom} />}
          <div style={{ width: documentWidth, maxWidth: desktopControls ? 1500 : 1000, margin: '0 auto', background: '#fff' }}><img src={pageUrl} alt="Submitted homework PDF page" style={{ display: 'block', width: '100%', height: 'auto' }} /></div>
        </div>
      ) : (
        <WorksheetCanvas key={pageIndex} pageUrl={pageUrl} initialDrawing={drawings[pageIndex]} tool={tool} setTool={setTool} penColor={penColor} setPenColor={setPenColor} penSize={penSize} setPenSize={setPenSize} language={language} desktopControls={desktopControls} desktopZoom={desktopZoom} viewport={viewport} toolbarScale={toolbarScale} pageIndex={pageIndex} pageCount={pageCount} setPageIndex={setPageIndex} onDesktopZoomChange={setDesktopZoom} onChange={(dataUrl) => setDrawings((current) => ({ ...current, [pageIndex]: dataUrl }))} />
      )}

      {!homework.pdfUploaded && <div className="panel" style={{ marginTop: 12 }}><button className="btn btn--block" type="button" onClick={submitHomework} disabled={busy}>{busy ? (language === 'DE' ? 'Wird gespeichert…' : 'Сохраняем…') : (language === 'DE' ? 'PDF speichern' : 'Сдать PDF')}</button><p className="muted" style={{ marginBottom: 0, fontSize: 13 }}>{language === 'DE' ? 'Apple Pencil schreibt. Mit zwei Fingern zoomst du die Seite; Farbe und Stiftbreite kannst du in der Werkzeugleiste ändern.' : 'Apple Pencil пишет. Двумя пальцами масштабируется страница. Цвет и толщину ручки можно менять в панели инструментов.'}</p></div>}
    </div>
  );
}

function ColorPicker({ language, value, onChange }: { language: 'DE' | 'RU'; value: PenColor; onChange: (value: PenColor) => void }) { return <div className="row" style={{ gap: 6, alignItems: 'center' }}>{PEN_COLORS.map((color) => <button key={color.value} type="button" onClick={() => onChange(color.value)} title={language === 'DE' ? color.labelDe : color.labelRu} style={{ width: 30, height: 30, borderRadius: '50%', background: color.value, border: value === color.value ? '3px solid #fff' : '2px solid rgba(0,0,0,.18)', boxShadow: value === color.value ? '0 0 0 2px #111827' : 'none', cursor: 'pointer', padding: 0 }} />)}</div>; }
function SizePicker({ language, value, onChange }: { language: 'DE' | 'RU'; value: number; onChange: (value: number) => void }) { return <div className="row" style={{ gap: 5, alignItems: 'center' }}>{PEN_SIZES.map((size) => <button key={size} type="button" className={`btn ${value === size ? '' : 'btn--secondary'}`} onClick={() => onChange(size)} title={`${language === 'DE' ? 'Breite' : 'Толщина'}: ${size}`} style={{ minWidth: 38, padding: '6px 8px' }}><span style={{ display: 'inline-block', width: 20, height: Math.max(2, size / 2), borderRadius: 999, background: 'currentColor', verticalAlign: 'middle' }} /></button>)}</div>; }
function DesktopZoomControls({ zoom, onChange }: { zoom: number; onChange: (value: number) => void }) { return <div style={{ position: 'absolute', right: 12, top: 12, zIndex: 4, display: 'flex', flexDirection: 'column', gap: 6 }}><button className="btn btn--secondary" type="button" onClick={() => onChange(Math.min(200, zoom + 20))} disabled={zoom >= 200}>+</button><button className="btn btn--secondary" type="button" onClick={() => onChange(Math.max(60, zoom - 20))} disabled={zoom <= 60}>−</button></div>; }

function WorksheetCanvas(props: any) {
  const { pageUrl, initialDrawing, tool, penColor, penSize, language, desktopControls, desktopZoom, viewport, toolbarScale, pageIndex, pageCount, setPageIndex, onDesktopZoomChange, onChange } = props;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => { const canvas = canvasRef.current; const image = imageRef.current; if (!canvas || !image) return; const drawInitial = () => { canvas.width = image.naturalWidth; canvas.height = image.naturalHeight; const ctx = canvas.getContext('2d'); if (!ctx) return; ctx.clearRect(0, 0, canvas.width, canvas.height); if (initialDrawing) { const overlay = new Image(); overlay.onload = () => ctx.drawImage(overlay, 0, 0, canvas.width, canvas.height); overlay.src = initialDrawing; } }; if (image.complete) drawInitial(); else image.onload = drawInitial; }, [pageUrl, initialDrawing]);
  const pointer = (event: React.PointerEvent<HTMLCanvasElement>) => { const canvas = canvasRef.current!; const rect = canvas.getBoundingClientRect(); return { x: (event.clientX - rect.left) * (canvas.width / rect.width), y: (event.clientY - rect.top) * (canvas.height / rect.height) }; };
  const move = (event: React.PointerEvent<HTMLCanvasElement>) => { if (!drawing.current || !last.current) return; const canvas = canvasRef.current!; const ctx = canvas.getContext('2d'); if (!ctx) return; const next = pointer(event); ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over'; ctx.strokeStyle = penColor; ctx.lineWidth = tool === 'eraser' ? penSize * 5 : penSize; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath(); ctx.moveTo(last.current.x, last.current.y); ctx.lineTo(next.x, next.y); ctx.stroke(); last.current = next; onChange(canvas.toDataURL('image/png')); };
  const styleWidth = desktopControls ? `${desktopZoom}%` : '100%';
  return <div style={{ position: 'relative', width: styleWidth, maxWidth: desktopControls ? 1500 : 1000, margin: '0 auto', background: '#fff' }}><img ref={imageRef} src={pageUrl} alt="Homework PDF page" style={{ display: 'block', width: '100%', height: 'auto', userSelect: 'none' }} /><canvas ref={canvasRef} onPointerDown={(e) => { drawing.current = true; last.current = pointer(e); e.currentTarget.setPointerCapture(e.pointerId); }} onPointerMove={move} onPointerUp={(e) => { drawing.current = false; last.current = null; e.currentTarget.releasePointerCapture(e.pointerId); }} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />{!desktopControls && <div style={{ position: 'fixed', left: Math.max(4, viewport.offsetLeft + 4), top: Math.max(90, viewport.offsetTop + 90), transform: `scale(${toolbarScale})`, transformOrigin: 'top left', zIndex: 20, display: 'grid', gap: 8 }}><button className="btn" type="button" onClick={() => props.setTool('pen')}>✎</button><button className="btn btn--secondary" type="button" onClick={() => props.setTool('eraser')}>⌫</button><button className="btn btn--secondary" type="button" disabled={pageIndex === 0} onClick={() => setPageIndex((p: number) => p - 1)}>←</button><button className="btn btn--secondary" type="button" disabled={pageIndex >= pageCount - 1} onClick={() => setPageIndex((p: number) => p + 1)}>→</button></div>}{desktopControls && <DesktopZoomControls zoom={desktopZoom} onChange={onDesktopZoomChange} />}</div>;
}
