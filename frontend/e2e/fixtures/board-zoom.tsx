// Development-only fixture: the real board, canvas and CSS, without external services.
// Vite's production entry does not include this page.
import { createRoot } from 'react-dom/client';
import { RoomContext } from '@livekit/components-react';
import { Room } from 'livekit-client';
import Konva from 'konva';
import { I18nProvider } from '../../src/i18n/I18nContext';
import { onlineClassesApi } from '../../src/api/onlineClasses';
import { WhiteboardPanel } from '../../src/features/online-classes/WhiteboardPanel';
import type { PdfDoc } from '../../src/features/online-classes/pdfDocument';
import '../../src/index.css';
import '../../src/online-classes.css';

localStorage.setItem('language', 'RU');
localStorage.setItem('mc.board.pageLayout:zoom-teacher', new URLSearchParams(location.search).get('layout') === 'paged' ? 'paged' : 'continuous');
const operations: unknown[] = [];
const wheelEvents: Array<{ trusted: boolean; ctrl: boolean; meta: boolean; deltaY: number }> = [];
window.addEventListener('wheel', event => {
  wheelEvents.push({ trusted: event.isTrusted, ctrl: event.ctrlKey, meta: event.metaKey, deltaY: event.deltaY });
}, { capture: true, passive: true });
onlineClassesApi.listParticipants = async () => [{ userId: 'zoom-teacher', classRole: 'HOST' } as never];
onlineClassesApi.listAnnotationDocuments = async () => [];
onlineClassesApi.openAnnotationDocument = async (classId, targetType, targetId, pageIndex = 0) => ({
  id: `page-${pageIndex}`, classId, targetType, targetId, pageIndex,
} as never);
onlineClassesApi.replayAnnotations = async () => [];
onlineClassesApi.appendAnnotation = async (_classId, documentId, operationId, operationType, payload) => {
  const operation = { documentId, operationId, operationType, payload, sequence: operations.length + 1, actorId: 'zoom-teacher' };
  operations.push(operation);
  return operation as never;
};
const document: PdfDoc = {
  pageCount: 3,
  destroy() {},
  async renderPage(index, width) {
    const canvas = window.document.createElement('canvas');
    canvas.width = Math.min(1600, Math.ceil(width));
    canvas.height = Math.round(canvas.width * Math.SQRT2);
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#fffefa'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = '#aab6c6'; context.lineWidth = 1;
    for (let fraction = .1; fraction < 1; fraction += .1) {
      context.beginPath(); context.moveTo(canvas.width * fraction, 0); context.lineTo(canvas.width * fraction, canvas.height); context.stroke();
      context.beginPath(); context.moveTo(0, canvas.height * fraction); context.lineTo(canvas.width, canvas.height * fraction); context.stroke();
    }
    context.fillStyle = '#263445'; context.font = `${canvas.width * .045}px sans-serif`;
    context.fillText(`Page ${index + 1}`, canvas.width * .08, canvas.height * .08);
    return { canvas, aspect: 1 / Math.SQRT2 };
  },
};
Object.assign(window, { boardZoomFixture: {
  operations,
  wheelEvents,
  stages: () => Konva.stages.filter(stage => stage.container().getClientRects().length).map(stage => ({
    x: stage.x(), y: stage.y(), scaleX: stage.scaleX(), scaleY: stage.scaleY(),
  })),
  paperBox: () => {
    const stage = Konva.stages.find(stage => stage.container().getClientRects().length);
    const image = stage?.findOne('Image');
    if (!stage || !image) return null;
    const container = stage.container().getBoundingClientRect(), box = image.getClientRect();
    return { x: container.x + box.x, y: container.y + box.y, width: box.width, height: box.height };
  },
} });
const room = new Room();
createRoot(window.document.getElementById('root')!).render(
  <RoomContext.Provider value={room}><I18nProvider>
    <div className="online-class-room online-class-room--original-v3" style={{ position: 'fixed', inset: 0 }}>
      <WhiteboardPanel classId="zoom-fixture" actorId="zoom-teacher" isHost document={document} />
    </div>
  </I18nProvider></RoomContext.Provider>,
);
