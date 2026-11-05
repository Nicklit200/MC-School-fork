// Development-only participant fixture. REST is supplied by the browser test;
// a local transport delivers the real encoded LiveKit packets between tabs.
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { RoomContext } from '@livekit/components-react';
import { Room, RoomEvent } from 'livekit-client';
import Konva from 'konva';
import { I18nProvider } from '../../src/i18n/I18nContext';
import { WhiteboardPanel } from '../../src/features/online-classes/WhiteboardPanel';
import { DocumentWhiteboardPanel } from '../../src/features/online-classes/DocumentWhiteboardPanel';
import { BoardSwitcher } from '../../src/features/online-classes/BoardSwitcher';
import { personalBoardId } from '../../src/features/online-classes/boards';
import { PersonalWorkbooksPanel } from '../../src/pages/teacher/PersonalWorkbooksPanel';
import type { PdfDoc } from '../../src/features/online-classes/pdfDocument';
import '../../src/index.css';
import '../../src/online-classes.css';

const params = new URLSearchParams(location.search);
const ids: Record<string, string> = { teacher: '33333333-3333-4333-8333-333333333333', owner: '11111111-1111-4111-8111-111111111111', peer: '22222222-2222-4222-8222-222222222222',
  ...(params.get('trio') === '1' ? { third: '44444444-4444-4444-8444-444444444444' } : {}) };
const selectedRole = params.get('role') ?? 'teacher';
const role = ids[selectedRole] ? selectedRole : 'teacher';
const actorId = ids[role], identity = `${actorId}|browser`;
const targetId = `personal-workbook-${role === 'teacher' ? ids.owner : actorId}`;
localStorage.setItem('language', 'RU');
localStorage.setItem(`mc.board.pageLayout:${actorId}`, params.get('layout') === 'continuous' ? 'continuous' : 'paged');
const room = new Room();
for (const id of Object.values(ids)) if (id !== actorId) room.remoteParticipants.set(`${id}|browser`, { identity: `${id}|browser` } as never);
const channel = new BroadcastChannel('worksheet-page-sync');
const outgoing: unknown[] = [];
type TestPacket = { sender: string; bytes: number[]; topic?: string; destinations?: string[] };
const qaTransport = window as Window & {
  group1QaPublish?: (packet: TestPacket) => Promise<void>;
  group1QaReceive?: (packet: TestPacket) => void;
};
qaTransport.group1QaReceive = data => {
  if (data.sender === identity || (data.destinations && !data.destinations.includes(identity))) return;
  room.emit(RoomEvent.DataReceived, new Uint8Array(data.bytes), { identity: data.sender } as never, undefined, data.topic);
};
room.localParticipant.publishData = async (bytes, options) => {
  const packet = { sender: identity, bytes: Array.from(bytes), topic: options?.topic, destinations: options?.destinationIdentities };
  outgoing.push({ ...packet, event: JSON.parse(new TextDecoder().decode(bytes)) });
  if (params.get('packets') !== 'off') {
    if (qaTransport.group1QaPublish) await qaTransport.group1QaPublish(packet);
    else channel.postMessage(packet);
  }
};
channel.onmessage = ({ data }) => {
  qaTransport.group1QaReceive?.(data);
};
const pdf: PdfDoc = {
  pageCount: 1, destroy() {},
  async renderPage(_index, width) {
    const canvas = window.document.createElement('canvas');
    canvas.width = Math.min(1200, Math.ceil(width)); canvas.height = Math.round(canvas.width * Math.SQRT2);
    const context = canvas.getContext('2d')!;
    context.fillStyle = params.get('unified') === '1' ? '#ddeeff' : '#fffefa'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#253345'; context.font = `${canvas.width * .05}px sans-serif`;
    context.fillText('Personal worksheet', canvas.width * .1, canvas.height * .1);
    return { canvas, aspect: 1 / Math.SQRT2 };
  },
};
const visibleStages = () => Konva.stages.filter(stage => stage.container().getClientRects().length > 0);
const backgroundColor = () => {
  const image = visibleStages()[0]?.getChildren()[0]?.findOne('Image')?.getAttr('image') as HTMLCanvasElement | undefined;
  return image?.getContext('2d') ? Array.from(image.getContext('2d')!.getImageData(1, 1, 1, 1).data).slice(0, 3) : null;
};
const frames: Array<number[] | null> = [];
const sample = () => { if (frames.length < 600) frames.push(backgroundColor()); window.requestAnimationFrame(sample); };
if (params.get('unified') === '1') window.requestAnimationFrame(sample);
Object.assign(window, { boardPagesFixture: {
  outgoing,
  frames,
  backgroundColor,
  visibleStages: () => visibleStages().length,
  visibleInkCount: (page: number) => visibleStages()
    .filter(stage => Number(stage.container().closest('[data-page-index]')?.getAttribute('data-page-index')) === page)
    .reduce((sum, stage) => sum + (stage.getChildren()[1]?.getChildren().length ?? 0), 0),
  savedInkCount: (page: number) => Konva.stages
    .filter(stage => Number(stage.container().closest('[data-page-index]')?.getAttribute('data-page-index')) === page)
    .reduce((sum, stage) => sum + (stage.getChildren()[1]?.getChildren().length ?? 0), 0),
} });

function UnifiedBoards() {
  const mine = personalBoardId(role === 'teacher' ? ids.owner : actorId);
  const [activeId, setActiveId] = useState(params.get('initial') === 'shared' ? 'board-1' : mine);
  const common = params.get('common') === 'none' ? null : pdf;
  return <>
    <div id="source-switcher" style={{ position: 'fixed', top: 8, left: 8, zIndex: 40 }}>
      <BoardSwitcher isHost={role === 'teacher'} currentUserId={actorId} students={[
        { userId: ids.owner, displayName: 'Owner' }, { userId: ids.peer, displayName: 'Peer' },
        ...(ids.third ? [{ userId: ids.third, displayName: 'Third' }] : []),
      ]} activeId={activeId} onChange={setActiveId} />
    </div>
    <div className="online-class-room__board" style={{ position: 'absolute', inset: 0 }} hidden={activeId !== 'board-1'}>
      <DocumentWhiteboardPanel classId="page-sync-fixture" actorId={actorId} isHost={role === 'teacher'} targetId="board-1" sharedDocument={common} active={activeId === 'board-1'} />
    </div>
    <div className="online-class-room__board" style={{ position: 'absolute', inset: 0 }} hidden={activeId === 'board-1'}>
      <DocumentWhiteboardPanel classId="page-sync-fixture" actorId={actorId} isHost={role === 'teacher'}
        targetId={activeId === 'board-1' ? mine : activeId} sharedDocument={common} active={activeId !== 'board-1'}
        personalWorkbooksEnabled={role === 'teacher' ? true : undefined}
        observedPages={params.get('observed') === '1' ? { [personalBoardId(ids.owner)]: 8, [targetId]: 2 } : undefined} />
    </div>
  </>;
}
createRoot(window.document.getElementById('root')!).render(
  <RoomContext.Provider value={room}><I18nProvider>
    <div className="online-class-room online-class-room--original-v3" style={{ position: 'fixed', inset: 0 }}>
      {params.get('prep') === '1' ? <PersonalWorkbooksPanel eventId="group1-qa-lesson" />
        : params.get('unified') === '1' ? <UnifiedBoards />
        : <WhiteboardPanel classId="page-sync-fixture" actorId={actorId} isHost={role === 'teacher'} targetId={targetId} document={pdf} />}
    </div>
  </I18nProvider></RoomContext.Provider>,
);
