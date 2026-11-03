// Development-only two-participant fixture. REST is supplied by the browser test;
// a local transport delivers the real encoded LiveKit packets between tabs.
import { createRoot } from 'react-dom/client';
import { RoomContext } from '@livekit/components-react';
import { Room, RoomEvent } from 'livekit-client';
import Konva from 'konva';
import { I18nProvider } from '../../src/i18n/I18nContext';
import { WhiteboardPanel } from '../../src/features/online-classes/WhiteboardPanel';
import type { PdfDoc } from '../../src/features/online-classes/pdfDocument';
import '../../src/index.css';
import '../../src/online-classes.css';

const ids = { teacher: '33333333-3333-4333-8333-333333333333', owner: '11111111-1111-4111-8111-111111111111', peer: '22222222-2222-4222-8222-222222222222' };
const params = new URLSearchParams(location.search);
const role = params.get('role') === 'owner' ? 'owner' : params.get('role') === 'peer' ? 'peer' : 'teacher';
const actorId = ids[role], identity = `${actorId}|browser`;
const targetId = `personal-workbook-${role === 'peer' ? ids.peer : ids.owner}`;
localStorage.setItem('language', 'RU');
localStorage.setItem(`mc.board.pageLayout:${actorId}`, 'paged');
const room = new Room();
for (const id of Object.values(ids)) if (id !== actorId) room.remoteParticipants.set(`${id}|browser`, { identity: `${id}|browser` } as never);
const channel = new BroadcastChannel('worksheet-page-sync');
const outgoing: unknown[] = [];
room.localParticipant.publishData = async (bytes, options) => {
  const packet = { sender: identity, bytes: Array.from(bytes), topic: options?.topic, destinations: options?.destinationIdentities };
  outgoing.push({ ...packet, event: JSON.parse(new TextDecoder().decode(bytes)) });
  if (params.get('packets') !== 'off') channel.postMessage(packet);
};
channel.onmessage = ({ data }) => {
  if (data.sender === identity || (data.destinations && !data.destinations.includes(identity))) return;
  room.emit(RoomEvent.DataReceived, new Uint8Array(data.bytes), { identity: data.sender } as never, undefined, data.topic);
};
const pdf: PdfDoc = {
  pageCount: 1, destroy() {},
  async renderPage(_index, width) {
    const canvas = window.document.createElement('canvas');
    canvas.width = Math.min(1200, Math.ceil(width)); canvas.height = Math.round(canvas.width * Math.SQRT2);
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#fffefa'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#253345'; context.font = `${canvas.width * .05}px sans-serif`;
    context.fillText('Personal worksheet', canvas.width * .1, canvas.height * .1);
    return { canvas, aspect: 1 / Math.SQRT2 };
  },
};
Object.assign(window, { boardPagesFixture: {
  outgoing,
  savedInkCount: (page: number) => Konva.stages
    .filter(stage => Number(stage.container().closest('[data-page-index]')?.getAttribute('data-page-index')) === page)
    .reduce((sum, stage) => sum + (stage.getChildren()[1]?.getChildren().length ?? 0), 0),
} });
createRoot(window.document.getElementById('root')!).render(
  <RoomContext.Provider value={room}><I18nProvider>
    <div className="online-class-room online-class-room--original-v3" style={{ position: 'fixed', inset: 0 }}>
      <WhiteboardPanel classId="page-sync-fixture" actorId={actorId} isHost={role === 'teacher'} targetId={targetId} document={pdf} />
    </div>
  </I18nProvider></RoomContext.Provider>,
);
