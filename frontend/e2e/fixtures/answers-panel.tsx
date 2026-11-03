// Development-only fixture: real answers panel/resizer and production classroom
// CSS. No signaling, camera, microphone, provider or backend is involved.
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { RoomContext } from '@livekit/components-react';
import { Room } from 'livekit-client';
import { I18nProvider } from '../../src/i18n/I18nContext';
import { onlineClassesApi } from '../../src/api/onlineClasses';
import { AnswersPanel } from '../../src/features/online-classes/AnswersPanel';
import { AnswersPanelResizer } from '../../src/features/online-classes/AnswersPanelResizer';
import { WhiteboardPanel } from '../../src/features/online-classes/WhiteboardPanel';
import { openPdf, type PdfDoc } from '../../src/features/online-classes/pdfDocument';
import type { PdfState } from '../../src/features/online-classes/usePdf';
import type { AnswersView } from '../../src/features/online-classes/useAnswersPanel';
import '../../src/index.css';
import '../../src/online-classes.css';
import '../../src/styles/whiteboard-original-v3.css';

const teacherId = '33333333-3333-4333-8333-333333333333';
const withPdf = new URLSearchParams(location.search).get('pdf') === '1';
localStorage.setItem('language', 'RU');
if (withPdf) {
  localStorage.setItem(`mindcrafti:answers-panel-width:v1:${teacherId}`, '560');
  localStorage.setItem(`mc.board.pageLayout:${teacherId}`, 'paged');
}
const room = new Room();
room.localParticipant.publishData = async () => {};
onlineClassesApi.listParticipants = async () => [{ userId: teacherId, classRole: 'HOST' } as never];
onlineClassesApi.listAnnotationDocuments = async () => [];
onlineClassesApi.openAnnotationDocument = async (classId, targetType, targetId, pageIndex = 0) => ({
  id: `answers-board-${pageIndex}`, classId, targetType, targetId, pageIndex, revision: 0,
} as never);
onlineClassesApi.replayAnnotations = async () => [];

// A real PDF document, with a grid that makes visual anchoring easy to inspect.
function referencePdf(): ArrayBuffer {
  let stream = '0.97 0.96 0.9 rg 0 0 595 1200 re f\n0.3 0.4 0.5 RG 1 w\n';
  for (let x = 0; x <= 595; x += 40) stream += `${x} 0 m ${x} 1200 l S\n`;
  for (let y = 0; y <= 1200; y += 40) stream += `0 ${y} m 595 ${y} l S\n`;
  stream += '0.9 0.2 0.1 rg 270 580 55 40 re f\n';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 1200] /Resources << >> /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}endstream`,
  ];
  let result = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((body, index) => { offsets.push(result.length); result += `${index + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = result.length;
  result += `xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(result).buffer;
}

let blocked = false;
const waiters: Array<() => void> = [];
const renders = {
  pending: 0, completed: 0,
  hold() { blocked = true; },
  release() { blocked = false; waiters.splice(0).forEach(resolve => resolve()); },
};
Object.assign(window, { answersPanelFixture: renders });

function delayedRaster(doc: PdfDoc): PdfDoc {
  return { ...doc, async renderPage(index, width) {
    renders.pending++;
    try {
      if (blocked) await new Promise<void>(resolve => waiters.push(resolve));
      return await doc.renderPage(index, width);
    } finally { renders.pending--; renders.completed++; }
  } };
}

function Fixture() {
  const [open, setOpen] = useState(false);
  const [videosOpen, setVideosOpen] = useState(false);
  const [view, setView] = useState<AnswersView>({ page: 0, zoom: withPdf ? 2 : 1, scrollTop: 0, scrollLeft: 0 });
  const [pdf, setPdf] = useState<PdfState>({ status: withPdf ? 'loading' : 'idle' });
  useEffect(() => {
    if (!withPdf) return;
    let active = true;
    let document: PdfDoc | undefined;
    void openPdf(referencePdf()).then(value => {
      document = value;
      if (active) setPdf({ status: 'ready', doc: delayedRaster(value) });
      else value.destroy();
    }).catch(error => { if (active) setPdf({ status: 'error', message: String(error) }); });
    return () => { active = false; document?.destroy(); };
  }, []);
  return <div className="online-class-room lk-room-container online-class-room--original-v3" data-lk-theme="default">
    <header className="online-class-room__topbar">
      <strong>Пробный урок без ученика</strong>
      <button type="button" onClick={() => setOpen(value => !value)}>Ответы</button>
      <button type="button" className="online-class-room__videos-toggle" onClick={() => setVideosOpen(value => !value)}>Видео</button>
    </header>
    <div className="online-class-room__stage">
      {open && <>
        <AnswersPanel pdf={pdf} view={view} getView={() => view}
          onViewChange={patch => setView(previous => ({ ...previous, ...patch }))}
          onScroll={(scrollTop, scrollLeft) => setView(previous => ({ ...previous, scrollTop, scrollLeft }))}
          onClose={() => setOpen(false)} onUpload={() => {}} />
        <AnswersPanelResizer storageKey={teacherId} videosOpen={videosOpen} />
      </>}
      <main className="online-class-room__main" style={{ background: '#eaf1f7' }}>
        <div className="online-class-room__board">{withPdf && <WhiteboardPanel
          classId="answers-board-fixture" actorId={teacherId} isHost document={null} />}</div>
      </main>
      <div id="online-class-videos" className={`online-class-room__videos-drawer${videosOpen ? ' is-open' : ''}`} aria-hidden={!videosOpen}>
        <ul className="camera-column">
          <li className="camera-card" data-host="true" data-camera="off">
            <div className="camera-card__avatar">BT</div>
            <div className="camera-card__bar"><span className="camera-card__name">Browser Teacher</span></div>
          </li>
        </ul>
      </div>
    </div>
  </div>;
}

createRoot(document.getElementById('root')!).render(
  <RoomContext.Provider value={room}><I18nProvider><Fixture /></I18nProvider></RoomContext.Provider>,
);
