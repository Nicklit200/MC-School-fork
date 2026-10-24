import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { onlineClassesApi } from '../../api/onlineClasses';
import { I18nProvider } from '../../i18n/I18nContext';
import { ApiRequestError } from '../../api/client';
import type { CameraModule } from '../notebook-camera/cameraModules';
import type { NotebookCameraGeometry } from './notebookCameraGeometry';
import { DEFAULT_VIEW } from './boardView';
import {
  ANNOTATION_TOPIC,
  NOTEBOOK_STROKE_TOPIC,
  STROKE_TOPIC,
  VIEW_TOPIC,
  annotationEvent,
  strokeEvent,
  viewEvent,
  type ClassEvent,
} from './events';

// Konva needs a real canvas, which jsdom does not have. The canvas is replaced
// by a stub that exposes the props the panel gives it; its own behaviour is
// covered by the gesture, hit-test and geometry unit tests.
type CanvasProps = Record<string, any>;
let canvasProps: CanvasProps = {};
const pageCanvasProps = new Map<string, CanvasProps>();
const canvasDocumentNavigation = new Map<string, ReturnType<typeof vi.fn>>();
const canvasSnapshot = vi.fn((mimeType?: string) => mimeType === 'image/jpeg' ? 'data:image/jpeg;base64,/9j/2Q==' : 'data:image/png;base64,AAA');
vi.mock('./WhiteboardCanvas', () => ({
  WhiteboardCanvas: forwardRef((props: CanvasProps, ref) => {
    const documentNavigation = useRef(vi.fn());
    canvasDocumentNavigation.set(props.pageKey, documentNavigation.current);
    if (props.active !== false || !canvasProps.pageKey) canvasProps = props;
    pageCanvasProps.set(props.pageKey, props);
    useImperativeHandle(ref, () => ({
      toDataURL: canvasSnapshot,
      getSize: () => ({ width: 1000, height: 500 }),
      setDocumentNavigation: documentNavigation.current,
    }));
    return <div data-testid="canvas" data-page-key={props.pageKey} data-locked={String(props.navigationLocked)} />;
  }),
}));

const publish = vi.fn().mockResolvedValue(undefined);
const handlers: Record<string, (received: { event: ClassEvent; senderIdentity?: string }) => void> = {};
const subscriptions = new Map<string, Set<(typeof handlers)[string]>>();
vi.mock('./useClassEvents', () => ({
  useClassEvents: (_classId: string, topic: string, onEvent: (typeof handlers)[string]) => {
    const current = useRef(onEvent);
    current.current = onEvent;
    useEffect(() => {
      const listener: (typeof handlers)[string] = received => current.current(received);
      const listeners = subscriptions.get(topic) ?? new Set();
      subscriptions.set(topic, listeners); listeners.add(listener);
      handlers[topic] = received => subscriptions.get(topic)?.forEach(callback => callback(received));
      return () => { listeners.delete(listener); };
    }, [topic]);
    return { publish };
  },
}));

const renderPdfPage = vi.fn((_document: unknown, _page: number, _width: number) => null as { canvas: HTMLCanvasElement; aspect: number } | null);
vi.mock('./usePdf', () => ({ usePdfPage: (...args: [unknown, number, number]) => renderPdfPage(...args), usePdf: vi.fn() }));

const exportBoardPdf = vi.fn();
const downloadBlob = vi.fn();
vi.mock('./boardExport', () => ({
  exportBoardPdf: (...args: unknown[]) => exportBoardPdf(...args),
  downloadBlob: (...args: unknown[]) => downloadBlob(...args),
}));

vi.mock('../../api/onlineClasses', async () => {
  const actual = await vi.importActual<typeof import('../../api/onlineClasses')>('../../api/onlineClasses');
  return {
    ...actual,
    onlineClassesApi: {
      openAnnotationDocument: vi.fn(),
      replayAnnotations: vi.fn(),
      appendAnnotation: vi.fn(),
      listAnnotationDocuments: vi.fn(),
      listParticipants: vi.fn(),
      saveAnnotationSnapshot: vi.fn(),
    },
  };
});

import { WhiteboardPanel } from './WhiteboardPanel';

const api = vi.mocked(onlineClassesApi);

class FakeResizeObserver {
  observe() {}
  disconnect() {}
}

function mount(role: 'host' | 'student', extra: Partial<React.ComponentProps<typeof WhiteboardPanel>> = {}) {
  return render(
    <I18nProvider>
      <WhiteboardPanel
        classId="c1"
        actorId={role === 'host' ? 'teacher' : 'student'}
        isHost={role === 'host'}
        {...extra}
      />
    </I18nProvider>,
  );
}

async function additionalAction(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('button', { name: 'Другие инструменты' }));
  await user.click(screen.getByRole('button', { name }));
}

const hostView = (patch = {}) =>
  viewEvent('c1', {
    boardId: 'board-1', page: 1, pageCount: 3, zoom: 2, panX: -0.5, panY: -0.25, follow: true, ...patch,
  });

function chooseLayout(actorId: string, layout: 'continuous' | 'paged') {
  const key = `mc.board.pageLayout:${actorId}`;
  localStorage.setItem(key, layout);
  window.dispatchEvent(new StorageEvent('storage', { key, newValue: layout, storageArea: localStorage }));
}

function documentObservers() {
  let notify!: IntersectionObserverCallback;
  let resize = () => {};
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { notify = callback; }
    observe() {} disconnect() {} unobserve() {}
  });
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: ResizeObserverCallback) {}
    observe(element: Element) {
      if (element.classList.contains('whiteboard__pages')) resize = () => this.callback([], this as unknown as ResizeObserver);
    }
    disconnect() {}
  });
  return {
    resize: () => resize(),
    reveal: (list: HTMLElement) => notify(Array.from(list.querySelectorAll('article'), target => ({ target, isIntersecting: true })) as unknown as IntersectionObserverEntry[], {} as IntersectionObserver),
  };
}

// jsdom has no layout engine. These measurements follow the actual article
// styles, so a changed document zoom also changes page and scroll geometry.
function documentGeometry(list: HTMLElement) {
  const rail = list.querySelector<HTMLElement>('.whiteboard__document')!;
  const pages = Array.from(rail.querySelectorAll<HTMLElement>('article'));
  list.style.padding = '100px 20px 80px';
  Object.defineProperties(list, { clientWidth: { configurable: true, value: 840 }, clientHeight: { configurable: true, value: 680 } });
  vi.spyOn(list, 'getBoundingClientRect').mockReturnValue({ left: 100, top: 50, right: 940, bottom: 730, width: 840, height: 680, x: 100, y: 50, toJSON() {} });
  pages.forEach((page, index) => Object.defineProperties(page, {
    offsetWidth: { configurable: true, get: () => parseFloat(page.style.width) || 0 },
    offsetHeight: { configurable: true, get: () => parseFloat(page.style.height) || 0 },
    clientWidth: { configurable: true, get: () => parseFloat(page.style.width) || 0 },
    clientHeight: { configurable: true, get: () => parseFloat(page.style.height) || 0 },
    offsetLeft: { configurable: true, get: () => 20 + ((parseFloat(rail.style.width) || 0) - (parseFloat(page.style.width) || 0)) / 2 },
    offsetTop: { configurable: true, get: () => 100 + pages.slice(0, index).reduce((sum, previous) => sum + (parseFloat(previous.style.height) || 0) + (parseFloat(rail.style.gap) || 0), 0) },
  }));
  return { rail, pages };
}

function documentPointer(target: HTMLElement, type: 'pointerdown' | 'pointermove' | 'pointerup', init: {
  pointerId: number; pointerType?: string; clientX: number; clientY: number; width?: number; height?: number;
}) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: init.clientX, clientY: init.clientY });
  Object.defineProperties(event, { pointerId: { value: init.pointerId }, pointerType: { value: init.pointerType ?? 'touch' },
    width: { value: init.width ?? 8 }, height: { value: init.height ?? 8 } });
  fireEvent(target, event); return event;
}

describe('WhiteboardPanel', () => {
  let sequence = 0;
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    sequence = 0;
    canvasProps = {};
    pageCanvasProps.clear(); canvasDocumentNavigation.clear(); subscriptions.clear();
    chooseLayout('teacher', 'paged'); chooseLayout('student', 'paged');
    renderPdfPage.mockReturnValue(null);
    api.openAnnotationDocument.mockImplementation(async (_c, t, id, page = 0) => ({
      id: `doc-${page}`, targetType: t, targetId: id, pageIndex: page,
      sourceWidth: null, sourceHeight: null, revision: 0, snapshotSavedAt: null,
    }));
    api.replayAnnotations.mockResolvedValue([]);
    api.listAnnotationDocuments.mockResolvedValue([]);
    api.listParticipants.mockResolvedValue([
      { userId: 'teacher', classRole: 'HOST' } as never,
    ]);
    api.appendAnnotation.mockImplementation(
      async (_c, _d, operationId, operationType, payload) =>
        ({
          id: `r${++sequence}`, operationId, sequence, actorId: 'teacher', layerOwnerId: 'teacher',
          operationType, payload, createdAt: '',
        }) as never,
    );
  });

  it('opens an ordinary blank whiteboard as a white portrait A4 page', async () => {
    mount('host');
    await screen.findByTestId('canvas');
    expect(canvasProps.sourceAspect).toBe(210 / 297);
    expect(canvasProps.paperColor).toBe('#ffffff');
    expect(canvasProps.background).toBeNull();
    expect(canvasProps.readOnly).toBe(false);
  });

  it('starts with a continuous page list and changes layout in More without replacing its canvas', async () => {
    const user = userEvent.setup();
    mount('host', { actorId: 'continuous-default', document: { pageCount: 3 } as never });
    const list = await screen.findByRole('region', { name: 'Страницы доски' });
    await waitFor(() => expect(list.querySelectorAll('article')).toHaveLength(3));
    const firstCanvas = screen.getAllByTestId('canvas')[0];
    expect(screen.queryByRole('button', { name: 'Следующая страница' })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Страницы документа' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Добавить страницу' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Другие инструменты' }));
    const toggle = screen.getByRole('switch', { name: 'Непрерывная прокрутка' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await user.click(toggle);
    expect(screen.queryByRole('region', { name: 'Страницы доски' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Следующая страница' })).toBeEnabled();
    expect(screen.getAllByTestId('canvas')[0]).toBe(firstCanvas);
    expect(localStorage.getItem('mc.board.pageLayout:continuous-default')).toBe('paged');
    expect(screen.getByRole('button', { name: 'Другие инструменты' })).toHaveFocus();
  });

  it('keeps ink and undo bound to each page while switching layouts', async () => {
    chooseLayout('teacher', 'continuous');
    const user = userEvent.setup();
    mount('host');
    await waitFor(() => expect(api.openAnnotationDocument).toHaveBeenCalled());
    await act(async () => { await pageCanvasProps.get('WHITEBOARD:board-1:0')!.onCommit({ kind: 'pen', points: [[.1, .2]] }); });
    const firstCanvas = screen.getAllByTestId('canvas')[0];
    await user.click(screen.getByRole('button', { name: 'Добавить' }));
    await user.click(screen.getByRole('menuitem', { name: 'Добавить пустую страницу' }));
    await waitFor(() => expect(api.openAnnotationDocument).toHaveBeenCalledWith('c1', 'WHITEBOARD', 'board-1', 1, undefined, undefined));
    await act(async () => { await pageCanvasProps.get('WHITEBOARD:board-1:1')!.onCommit({ kind: 'pen', points: [[.7, .8]] }); });
    expect(api.appendAnnotation.mock.calls.filter(call => call[3] === 'ADD').map(call => call[1])).toEqual(['doc-0', 'doc-1']);
    await user.click(screen.getByRole('button', { name: 'Другие инструменты' }));
    await user.click(screen.getByRole('switch', { name: 'Непрерывная прокрутка' }));
    await user.click(screen.getByRole('button', { name: 'Предыдущая страница' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Отменить' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Отменить' }));
    await waitFor(() => expect(api.appendAnnotation.mock.calls.some(call => call[1] === 'doc-0' && call[3] === 'UNDO')).toBe(true));
    expect(pageCanvasProps.get('WHITEBOARD:board-1:1')!.shapes).toHaveLength(1);
    expect(screen.getAllByTestId('canvas')[0]).toBe(firstCanvas);
    await user.click(screen.getByRole('button', { name: 'Другие инструменты' }));
    await user.click(screen.getByRole('switch', { name: 'Непрерывная прокрутка' }));
    expect(screen.getByRole('region', { name: 'Страницы доски' })).toBeInTheDocument();
    expect(screen.getAllByTestId('canvas')[0]).toBe(firstCanvas);
  });

  it('fits a wide PDF page without adding empty vertical space before the next A4 page', async () => {
    chooseLayout('teacher', 'continuous');
    renderPdfPage.mockImplementation((_doc, index) => index === 0 ? { canvas: document.createElement('canvas'), aspect: 4 } : null);
    mount('host', { document: { pageCount: 1 } as never });
    const list = await screen.findByRole('region', { name: 'Страницы доски' });
    await waitFor(() => expect((list.querySelector('article') as HTMLElement).style.height).toBe('200px'));
    await userEvent.click(screen.getByRole('button', { name: 'Добавить' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Добавить пустую страницу' }));
    const second = list.querySelectorAll('article')[1] as HTMLElement;
    expect(second.style.height).toBe('500px');
    expect(pageCanvasProps.get('WHITEBOARD:board-1:1')!.sourceAspect).toBe(210 / 297);
  });

  it('zooms every document sheet and gap while preserving default canvas views, page keys and ink', async () => {
    chooseLayout('teacher', 'continuous');
    const observers = documentObservers();
    try {
      renderPdfPage.mockReturnValue({ canvas: document.createElement('canvas'), aspect: 210 / 297 });
      mount('host', { document: { pageCount: 3 } as never });
      const list = await screen.findByRole('region', { name: 'Страницы доски' });
      await waitFor(() => expect(list.querySelectorAll('article')).toHaveLength(3));
      const { rail, pages } = documentGeometry(list);
      act(() => { observers.resize(); observers.reveal(list); });
      await waitFor(() => expect(api.openAnnotationDocument).toHaveBeenCalledWith('c1', 'WHITEBOARD', 'board-1', 2, undefined, undefined));
      const canvases = screen.getAllByTestId('canvas');
      const sizes = pages.map(page => ({ width: page.offsetWidth, height: page.offsetHeight }));
      const keys = canvases.map(canvas => canvas.getAttribute('data-page-key'));
      const stroke = { kind: 'pen', color: '#112233', width: .004, points: [[.1, .2], [.7, .8]] };
      await act(async () => { await pageCanvasProps.get('WHITEBOARD:board-1:0')!.onCommit(stroke); });
      const ink = pageCanvasProps.get('WHITEBOARD:board-1:0')!.shapes;
      const openCount = api.openAnnotationDocument.mock.calls.length;
      act(() => pageCanvasProps.get('WHITEBOARD:board-1:1')!.onDocumentGesture({ scale: 2, anchor: { x: 500, y: 350 }, pan: { x: 0, y: 0 } }));
      pages.forEach((page, index) => {
        expect(page.offsetWidth).toBeCloseTo(sizes[index].width * 2);
        expect(page.offsetHeight).toBeCloseTo(sizes[index].height * 2);
        expect(page.style.transform).toBe('');
      });
      expect(parseFloat(rail.style.gap)).toBe(48);
      await userEvent.click(screen.getByRole('button', { name: 'Увеличить' }));
      expect(screen.getByText('250%')).toBeInTheDocument();
      expect(parseFloat(rail.style.gap)).toBe(60);
      pages.forEach((page, index) => expect(page.offsetWidth).toBeCloseTo(sizes[index].width * 2.5));
      screen.getAllByTestId('canvas').forEach((canvas, index) => {
        expect(canvas).toBe(canvases[index]); expect(canvas.getAttribute('data-page-key')).toBe(keys[index]);
        expect(pageCanvasProps.get(keys[index]!)!.view).toBe(DEFAULT_VIEW);
      });
      expect(pageCanvasProps.get('WHITEBOARD:board-1:0')!.shapes).toEqual(ink);
      expect(api.openAnnotationDocument).toHaveBeenCalledTimes(openCount);
      expect(api.appendAnnotation).toHaveBeenCalledTimes(1);
    } finally { vi.unstubAllGlobals(); }
  });

  it('keeps the same document point under a zoom anchor and pans the rail through the canvas bridge', async () => {
    chooseLayout('teacher', 'continuous');
    const observers = documentObservers();
    try {
      mount('host', { document: { pageCount: 2 } as never });
      const list = await screen.findByRole('region', { name: 'Страницы доски' });
      await waitFor(() => expect(list.querySelectorAll('article')).toHaveLength(2));
      const { rail } = documentGeometry(list);
      act(() => observers.resize());
      list.scrollTop = 200;
      const anchor = { x: 500, y: 350 };
      const before = { x: list.scrollLeft + 400 - 20 - parseFloat(rail.style.width) / 2, y: list.scrollTop + 300 - 100 };
      act(() => pageCanvasProps.get('WHITEBOARD:board-1:0')!.onDocumentGesture({ scale: 3, anchor, pan: { x: 0, y: 0 } }));
      expect((list.scrollLeft + 400 - 20 - parseFloat(rail.style.width) / 2) / 3).toBeCloseTo(before.x);
      expect((list.scrollTop + 300 - 100) / 3).toBeCloseTo(before.y);
      const scroll = { left: list.scrollLeft, top: list.scrollTop };
      act(() => pageCanvasProps.get('WHITEBOARD:board-1:0')!.onDocumentGesture({ scale: 1, anchor, pan: { x: -75, y: -120 } }));
      expect(list.scrollLeft).toBeCloseTo(scroll.left + 75); expect(list.scrollTop).toBeCloseTo(scroll.top + 120);
      expect(pageCanvasProps.get('WHITEBOARD:board-1:0')!.view).toBe(DEFAULT_VIEW);
    } finally { vi.unstubAllGlobals(); }
  });

  it.each([false, true])('routes a gap pinch-wheel once and respects teacher navigation locking: %s', async locked => {
    chooseLayout(locked ? 'student' : 'teacher', 'continuous');
    const observers = documentObservers();
    try {
      mount(locked ? 'student' : 'host', { document: { pageCount: 2 } as never });
      const list = await screen.findByRole('region', { name: 'Страницы доски' });
      await waitFor(() => expect(list.querySelectorAll('article')).toHaveLength(2));
      const { pages, rail } = documentGeometry(list);
      act(() => observers.resize());
      if (locked) await act(async () => handlers[VIEW_TOPIC]({ event: hostView({ page: 0, documentView: { zoom: 1, x: .5, y: .5 } }), senderIdentity: 'teacher|tab' }));
      const width = pages[0].offsetWidth;
      const ordinaryWheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 80, clientX: 500, clientY: 350 });
      fireEvent(rail, ordinaryWheel);
      expect(ordinaryWheel.defaultPrevented).toBe(false);
      const pageWheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -25, clientX: 500, clientY: 350 });
      fireEvent(screen.getAllByTestId('canvas')[0], pageWheel);
      expect(pageWheel.defaultPrevented).toBe(false);
      expect(pages[0].offsetWidth).toBe(width);
      const gapWheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -Math.log(1.25) / .01, clientX: 500, clientY: 350 });
      fireEvent(rail, gapWheel);
      expect(gapWheel.defaultPrevented).toBe(true);
      expect(pages[0].offsetWidth).toBeCloseTo(width * (locked ? 1 : 1.25));
      expect(parseFloat(rail.style.gap)).toBeCloseTo(locked ? 24 : 30);
      expect(pageCanvasProps.get('WHITEBOARD:board-1:0')!.view).toBe(DEFAULT_VIEW);
    } finally { vi.unstubAllGlobals(); }
  });

  it('takes over an existing page contact when the second finger lands in a gap, then releases every canvas', async () => {
    chooseLayout('teacher', 'continuous');
    const observers = documentObservers();
    try {
      mount('host', { document: { pageCount: 2 } as never });
      const list = await screen.findByRole('region', { name: 'Страницы доски' });
      await waitFor(() => expect(list.querySelectorAll('article')).toHaveLength(2));
      const { pages, rail } = documentGeometry(list);
      act(() => { observers.resize(); observers.reveal(list); });
      await waitFor(() => expect(pageCanvasProps.has('WHITEBOARD:board-1:1')).toBe(true));
      const firstCanvas = screen.getAllByTestId('canvas')[0], width = pages[0].offsetWidth;
      documentPointer(firstCanvas, 'pointerdown', { pointerId: 1, clientX: 300, clientY: 300 });
      for (const navigate of canvasDocumentNavigation.values()) expect(navigate).not.toHaveBeenCalledWith(true);
      const second = documentPointer(rail, 'pointerdown', { pointerId: 2, clientX: 400, clientY: 300 });
      expect(second.defaultPrevented).toBe(true);
      for (const navigate of canvasDocumentNavigation.values()) expect(navigate).toHaveBeenLastCalledWith(true);
      documentPointer(rail, 'pointermove', { pointerId: 2, clientX: 500, clientY: 300 });
      pages.forEach(page => expect(page.offsetWidth).toBeCloseTo(width * 2));
      expect(parseFloat(rail.style.gap)).toBe(48);
      documentPointer(firstCanvas, 'pointermove', { pointerId: 1, clientX: 250, clientY: 300 });
      pages.forEach(page => expect(page.offsetWidth).toBeCloseTo(width * 2.5));
      documentPointer(rail, 'pointerup', { pointerId: 2, clientX: 500, clientY: 300 });
      for (const navigate of canvasDocumentNavigation.values()) expect(navigate).toHaveBeenLastCalledWith(true);
      documentPointer(firstCanvas, 'pointerup', { pointerId: 1, clientX: 250, clientY: 300 });
      for (const navigate of canvasDocumentNavigation.values()) expect(navigate).toHaveBeenLastCalledWith(false);
      expect(api.appendAnnotation).not.toHaveBeenCalled();
      expect(pageCanvasProps.get('WHITEBOARD:board-1:0')!.view).toBe(DEFAULT_VIEW);
    } finally { vi.unstubAllGlobals(); }
  });

  it.each(['locked', 'palm', 'pen-grace'] as const)('ignores document pinch takeover for a %s contact', async reason => {
    chooseLayout(reason === 'locked' ? 'student' : 'teacher', 'continuous');
    const observers = documentObservers();
    try {
      mount(reason === 'locked' ? 'student' : 'host', { document: { pageCount: 2 } as never });
      const list = await screen.findByRole('region', { name: 'Страницы доски' });
      await waitFor(() => expect(list.querySelectorAll('article')).toHaveLength(2));
      const { pages, rail } = documentGeometry(list);
      act(() => observers.resize());
      if (reason === 'locked') await act(async () => handlers[VIEW_TOPIC]({ event: hostView({ page: 0, documentView: { zoom: 1, x: .5, y: .5 } }), senderIdentity: 'teacher|tab' }));
      const canvas = screen.getAllByTestId('canvas')[0], width = pages[0].offsetWidth;
      if (reason === 'pen-grace') {
        documentPointer(canvas, 'pointerdown', { pointerId: 7, pointerType: 'pen', clientX: 300, clientY: 300 });
        documentPointer(canvas, 'pointerup', { pointerId: 7, pointerType: 'pen', clientX: 300, clientY: 300 });
      }
      documentPointer(canvas, 'pointerdown', { pointerId: 1, clientX: 300, clientY: 300, width: reason === 'palm' ? 80 : 8 });
      documentPointer(rail, 'pointerdown', { pointerId: 2, clientX: 400, clientY: 300 });
      documentPointer(rail, 'pointermove', { pointerId: 2, clientX: 600, clientY: 300 });
      documentPointer(canvas, 'pointerup', { pointerId: 1, clientX: 300, clientY: 300 });
      documentPointer(rail, 'pointerup', { pointerId: 2, clientX: 600, clientY: 300 });
      expect(pages[0].offsetWidth).toBe(width); expect(parseFloat(rail.style.gap)).toBe(24);
      for (const navigate of canvasDocumentNavigation.values()) expect(navigate).not.toHaveBeenCalledWith(true);
      expect(api.appendAnnotation).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });

  it('blocks pinch for an active native Pencil beyond pointer grace and resumes after pen release plus grace', async () => {
    chooseLayout('teacher', 'continuous');
    const observers = documentObservers();
    let now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      mount('host', { document: { pageCount: 2 } as never });
      const list = await screen.findByRole('region', { name: 'Страницы доски' });
      await waitFor(() => expect(list.querySelectorAll('article')).toHaveLength(2));
      const { pages, rail } = documentGeometry(list);
      act(() => observers.resize());
      const canvas = screen.getAllByTestId('canvas')[0], width = pages[0].offsetWidth;
      expect(pageCanvasProps.get('WHITEBOARD:board-1:0')!.onDocumentPenContact).toEqual(expect.any(Function));
      const pinch = (firstId: number) => {
        documentPointer(canvas, 'pointerdown', { pointerId: firstId, clientX: 300, clientY: 300 });
        documentPointer(rail, 'pointerdown', { pointerId: firstId + 1, clientX: 400, clientY: 300 });
        documentPointer(rail, 'pointermove', { pointerId: firstId + 1, clientX: 500, clientY: 300 });
        documentPointer(canvas, 'pointerup', { pointerId: firstId, clientX: 300, clientY: 300 });
        documentPointer(rail, 'pointerup', { pointerId: firstId + 1, clientX: 500, clientY: 300 });
      };
      // The native ink adapter reports the Pencil even when iOS emits no pen PointerEvents.
      act(() => pageCanvasProps.get('WHITEBOARD:board-1:0')!.onDocumentPenContact(true));
      now += 1000; pinch(1);
      expect(pages[0].offsetWidth).toBe(width);
      for (const navigate of canvasDocumentNavigation.values()) expect(navigate).not.toHaveBeenCalledWith(true);
      act(() => pageCanvasProps.get('WHITEBOARD:board-1:0')!.onDocumentPenContact(false));
      now += 349; pinch(3);
      expect(pages[0].offsetWidth).toBe(width);
      for (const navigate of canvasDocumentNavigation.values()) expect(navigate).not.toHaveBeenCalledWith(true);
      now += 2; pinch(5);
      expect(pages[0].offsetWidth).toBeCloseTo(width * 2);
      expect(parseFloat(rail.style.gap)).toBe(48);
      for (const navigate of canvasDocumentNavigation.values()) {
        expect(navigate).toHaveBeenCalledWith(true); expect(navigate).toHaveBeenLastCalledWith(false);
      }
      expect(api.appendAnnotation).not.toHaveBeenCalled();
    } finally { clock.mockRestore(); vi.unstubAllGlobals(); }
  });

  it('publishes the host’s global document zoom and selected-page viewport after scrolling', async () => {
    chooseLayout('teacher', 'continuous');
    const observers = documentObservers();
    try {
      mount('host', { document: { pageCount: 3 } as never });
      const list = await screen.findByRole('region', { name: 'Страницы доски' });
      await waitFor(() => expect(list.querySelectorAll('article')).toHaveLength(3));
      const { pages } = documentGeometry(list);
      act(() => { observers.resize(); observers.reveal(list); });
      await additionalAction(userEvent.setup(), 'Следовать за учителем');
      publish.mockClear();
      act(() => pageCanvasProps.get('WHITEBOARD:board-1:0')!.onDocumentGesture({ scale: 2, anchor: { x: 500, y: 350 }, pan: { x: 0, y: 0 } }));
      fireEvent.scroll(list, { target: { scrollTop: pages[1].offsetTop + pages[1].offsetHeight / 2 - 100 - 250 } });
      await waitFor(() => expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'view', follow: true, page: 1,
        documentView: expect.objectContaining({ zoom: 2, y: expect.any(Number) }),
      })));
      const event = publish.mock.calls.map(([value]) => value).filter(value => value.type === 'view' && value.follow && value.page === 1).at(-1);
      expect(event.documentView.x).toBeCloseTo((list.scrollLeft + 20 + 400 - pages[1].offsetLeft) / pages[1].offsetWidth);
      expect(event.documentView.y).toBeCloseTo(.5);
      expect(event.zoom).toBe(1);
      expect(pageCanvasProps.get('WHITEBOARD:board-1:1')!.view).toBe(DEFAULT_VIEW);
    } finally { vi.unstubAllGlobals(); }
  });

  it('follows a continuous host from local paged mode and locks the global gesture bridge without changing the saved layout', async () => {
    documentObservers();
    try {
      const { container } = mount('student', { document: { pageCount: 3 } as never });
      await waitFor(() => expect(api.listParticipants).toHaveBeenCalled());
      const list = container.querySelector<HTMLElement>('.whiteboard__pages')!;
      await waitFor(() => expect(list.querySelectorAll('article')).toHaveLength(3));
      const { pages, rail } = documentGeometry(list);
      await act(async () => handlers[VIEW_TOPIC]({ event: hostView({ page: 1, documentView: { zoom: 2, x: .5, y: .6 } }), senderIdentity: 'teacher|tab' }));
      expect(screen.getByRole('region', { name: 'Страницы доски' })).toBe(list);
      expect(list).toHaveClass('whiteboard__pages--locked');
      expect(screen.getByRole('button', { name: 'Увеличить' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Уменьшить' })).toBeDisabled();
      expect(localStorage.getItem('mc.board.pageLayout:student')).toBe('paged');
      expect(pageCanvasProps.get('WHITEBOARD:board-1:1')!.view).toBe(DEFAULT_VIEW);
      expect(pageCanvasProps.get('WHITEBOARD:board-1:1')!.navigationLocked).toBe(true);
      expect(parseFloat(rail.style.gap)).toBe(48);
      expect((list.scrollLeft + 20 + 400 - pages[1].offsetLeft) / pages[1].offsetWidth).toBeCloseTo(.5);
      expect((list.scrollTop + 100 + 250 - pages[1].offsetTop) / pages[1].offsetHeight).toBeCloseTo(.6);
      const scroll = { left: list.scrollLeft, top: list.scrollTop }, width = pages[1].style.width;
      act(() => pageCanvasProps.get('WHITEBOARD:board-1:1')!.onDocumentGesture({ scale: 2, anchor: { x: 500, y: 350 }, pan: { x: -50, y: -50 } }));
      expect(pages[1].style.width).toBe(width); expect(list.scrollLeft).toBe(scroll.left); expect(list.scrollTop).toBe(scroll.top);
      await act(async () => handlers[VIEW_TOPIC]({ event: hostView({ follow: false }), senderIdentity: 'teacher|tab' }));
      expect(screen.queryByRole('region', { name: 'Страницы доски' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Следующая страница' })).toBeEnabled();
      expect(localStorage.getItem('mc.board.pageLayout:student')).toBe('paged');
    } finally { vi.unstubAllGlobals(); }
  });

  it('temporarily follows a legacy host in paged mode and restores the student’s continuous layout with its ink', async () => {
    chooseLayout('student', 'continuous');
    mount('student');
    const list = await screen.findByRole('region', { name: 'Страницы доски' });
    const canvas = screen.getByTestId('canvas');
    await waitFor(() => expect(api.openAnnotationDocument).toHaveBeenCalled());
    await act(async () => { await canvasProps.onCommit({ kind: 'pen', points: [[.25, .3]] }); });
    const ink = pageCanvasProps.get('WHITEBOARD:board-1:0')!.shapes;
    await act(async () => handlers[VIEW_TOPIC]({ event: hostView({ page: 0 }), senderIdentity: 'teacher|tab' }));
    expect(screen.queryByRole('region', { name: 'Страницы доски' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Следующая страница' })).toBeDisabled();
    expect(canvasProps.view).toEqual({ zoom: 2, panX: -500, panY: -125 });
    expect(localStorage.getItem('mc.board.pageLayout:student')).toBe('continuous');
    expect(screen.getAllByTestId('canvas')[0]).toBe(canvas);
    await act(async () => handlers[VIEW_TOPIC]({ event: hostView({ page: 0, follow: false }), senderIdentity: 'teacher|tab' }));
    expect(screen.getByRole('region', { name: 'Страницы доски' })).toBe(list);
    expect(pageCanvasProps.get('WHITEBOARD:board-1:0')!.view).toBe(DEFAULT_VIEW);
    expect(pageCanvasProps.get('WHITEBOARD:board-1:0')!.shapes).toEqual(ink);
    expect(screen.getAllByTestId('canvas')[0]).toBe(canvas);
  });

  it('selects the scrolled page and sends its drawing and undo to that page document', async () => {
    chooseLayout('teacher', 'continuous');
    let notify!: IntersectionObserverCallback;
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback) { notify = callback; }
      observe() {} disconnect() {} unobserve() {}
    });
    try {
      renderPdfPage.mockReturnValue({ canvas: document.createElement('canvas'), aspect: 210 / 297 });
      mount('host', { document: { pageCount: 3 } as never });
      const list = await screen.findByRole('region', { name: 'Страницы доски' });
      await waitFor(() => expect(list.querySelectorAll('article')).toHaveLength(3));
      const elements = Array.from(list.querySelectorAll<HTMLElement>('article'));
      Object.defineProperty(list, 'clientHeight', { configurable: true, value: 600 });
      elements.forEach((element, index) => {
        Object.defineProperty(element, 'offsetTop', { configurable: true, value: index * 500 });
        Object.defineProperty(element, 'offsetHeight', { configurable: true, value: 460 });
      });
      act(() => notify(elements.map(target => ({ target, isIntersecting: true })) as unknown as IntersectionObserverEntry[], {} as IntersectionObserver));
      await waitFor(() => expect(api.openAnnotationDocument).toHaveBeenCalledWith('c1', 'WHITEBOARD', 'board-1', 1, undefined, undefined));
      fireEvent.scroll(list, { target: { scrollTop: 550 } });
      expect(screen.getByRole('article', { name: 'Страница 2 из 3' })).toHaveAttribute('aria-current', 'page');
      await act(async () => { await pageCanvasProps.get('WHITEBOARD:board-1:1')!.onCommit({ kind: 'pen', points: [[.4, .5]] }); });
      expect(api.appendAnnotation.mock.calls.find(call => call[3] === 'ADD')?.[1]).toBe('doc-1');
      await userEvent.click(screen.getByRole('button', { name: 'Отменить' }));
      await waitFor(() => expect(api.appendAnnotation.mock.calls.some(call => call[1] === 'doc-1' && call[3] === 'UNDO')).toBe(true));
      fireEvent.pointerDown(elements[1], { pointerId: 1, pointerType: 'touch' });
      fireEvent.scroll(list, { target: { scrollTop: 1100 } });
      expect(screen.getByRole('article', { name: 'Страница 2 из 3' })).toHaveAttribute('aria-current', 'page');
      fireEvent.pointerUp(elements[1], { pointerId: 1, pointerType: 'touch' });
      expect(screen.getByRole('article', { name: 'Страница 3 из 3' })).toHaveAttribute('aria-current', 'page');
    } finally { vi.unstubAllGlobals(); vi.stubGlobal('ResizeObserver', FakeResizeObserver); }
  });

  it('selects and follows pages inside the area left uncovered by floating toolbar and footer', async () => {
    chooseLayout('student', 'continuous');
    let resizeList = () => {};
    vi.stubGlobal('ResizeObserver', class {
      constructor(private callback: ResizeObserverCallback) {}
      observe(element: Element) {
        if (element.classList.contains('whiteboard__pages')) {
          resizeList = () => this.callback([], this as unknown as ResizeObserver);
        }
      }
      disconnect() {}
    });
    try {
      mount('student', { document: { pageCount: 3 } as never });
      const list = await screen.findByRole('region', { name: 'Страницы доски' });
      await waitFor(() => expect(list.querySelectorAll('article')).toHaveLength(3));
      const elements = Array.from(list.querySelectorAll<HTMLElement>('article'));
      list.style.padding = '160px 10px 120px';
      Object.defineProperties(list, {
        clientHeight: { configurable: true, value: 600 },
        clientWidth: { configurable: true, value: 800 },
      });
      elements.forEach((element, index) => Object.defineProperties(element, {
        offsetTop: { configurable: true, value: 160 + index * 318 },
        offsetHeight: { configurable: true, value: 294 },
        offsetWidth: { configurable: true, value: 208 },
        offsetLeft: { configurable: true, value: 296 },
        clientHeight: { configurable: true, value: 294 },
        clientWidth: { configurable: true, value: 208 },
      }));
      await act(async () => { resizeList(); });
      // The page fits the 320px unobscured area, rather than the full screen.
      expect(parseFloat(elements[0].style.height)).toBeLessThanOrEqual(320);
      // More of page one exists in the physical viewport, but page two has
      // more content visible between the toolbar and dock.
      await act(async () => { fireEvent.scroll(list, { target: { scrollTop: 150 } }); });
      expect(screen.getByRole('article', { name: 'Страница 2 из 3' })).toHaveAttribute('aria-current', 'page');
      await waitFor(() => expect(api.openAnnotationDocument).toHaveBeenCalledWith('c1', 'WHITEBOARD', 'board-1', 1, undefined, undefined));
      await act(async () => { await Promise.resolve(); });
      await act(async () => { handlers[VIEW_TOPIC]({ event: hostView({ page: 2, documentView: { zoom: 1, x: .5, y: .5 } }), senderIdentity: 'teacher|tab' }); });
      expect(screen.getByRole('article', { name: 'Страница 3 из 3' })).toHaveAttribute('aria-current', 'page');
      const visibleTop = list.scrollTop + 160, visibleBottom = list.scrollTop + 600 - 120;
      expect(elements[2].offsetTop).toBeGreaterThanOrEqual(visibleTop);
      expect(elements[2].offsetTop + elements[2].offsetHeight).toBeLessThanOrEqual(visibleBottom);
      expect(pageCanvasProps.get('WHITEBOARD:board-1:2')!.navigationLocked).toBe(true);
      expect(pageCanvasProps.get('WHITEBOARD:board-1:2')!.sourceAspect).toBeNull();
    } finally { vi.stubGlobal('ResizeObserver', FakeResizeObserver); }
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('uses the blank A4 default when an explicit source aspect is invalid: %s', async sourceAspect => {
    mount('host', { sourceAspect });
    await screen.findByTestId('canvas');
    expect(canvasProps.sourceAspect).toBe(210 / 297);
  });

  it('prevents drawing on a loading PDF page until its actual geometry is ready', async () => {
    const pdf = { pageCount: 1 } as never;
    const { rerender } = mount('host', { document: pdf });
    await screen.findByTestId('canvas');
    expect(canvasProps.readOnly).toBe(true);
    expect(canvasProps.sourceAspect).toBeNull();
    expect(screen.getByText('Загрузка…')).toBeInTheDocument();
    const pageCanvas = document.createElement('canvas');
    renderPdfPage.mockReturnValue({ canvas: pageCanvas, aspect: 1.6 });
    rerender(<I18nProvider><WhiteboardPanel classId="c1" actorId="teacher" isHost document={pdf} /></I18nProvider>);
    expect(canvasProps.readOnly).toBe(false);
    expect(canvasProps.sourceAspect).toBe(1.6);
    expect(canvasProps.background).toBe(pageCanvas);
    expect(screen.queryByText('Загрузка…')).not.toBeInTheDocument();
  });

  it('preserves the PDF page format and uses portrait A4 for a blank page added after it', async () => {
    const user = userEvent.setup();
    const pdf = { pageCount: 1 } as never;
    const pageCanvas = document.createElement('canvas');
    renderPdfPage.mockImplementation((_doc, page) => page === 0 ? { canvas: pageCanvas, aspect: 1.6 } : null);
    mount('host', { document: pdf });
    await screen.findByTestId('canvas');
    expect(canvasProps.sourceAspect).toBe(1.6);
    expect(canvasProps.background).toBe(pageCanvas);
    await user.click(screen.getByRole('button', { name: 'Добавить' }));
    await user.click(screen.getByRole('menuitem', { name: 'Добавить пустую страницу' }));
    await waitFor(() => expect(api.openAnnotationDocument).toHaveBeenCalledWith('c1', 'WHITEBOARD', 'board-1', 1, undefined, undefined));
    expect(canvasProps.sourceAspect).toBe(210 / 297);
    expect(canvasProps.background).toBeNull();
    expect(canvasProps.readOnly).toBe(false);
    expect(screen.queryByText('Загрузка…')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Предыдущая страница' }));
    expect(canvasProps.sourceAspect).toBe(1.6);
    expect(canvasProps.background).toBe(pageCanvas);
  });

  it('preserves explicit source geometry and non-whiteboard projection defaults', async () => {
    const { unmount } = mount('host', { sourceAspect: 16 / 9 });
    await screen.findByTestId('canvas');
    expect(canvasProps.sourceAspect).toBe(16 / 9);
    unmount();
    mount('host', { targetType: 'SCREEN_SHARE' });
    await screen.findByTestId('canvas');
    expect(canvasProps.sourceAspect).toBeNull();
    expect(canvasProps.paperColor).toBe('#fffefa');
  });

  it('gives a student the board and page switcher but no teacher-only controls', async () => {
    mount('student');
    await screen.findByTestId('canvas');
    expect(screen.queryByRole('button', { name: 'Очистить всё' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Следовать за учителем' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ответы' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Добавить страницу' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Следующая страница' })).toBeInTheDocument();
  });

  it('gives the teacher clear-all, follow and the answers slot, and lets them add a page', async () => {
    const user = userEvent.setup();
    mount('host', { hostActions: <button type="button">Ответы</button> });
    await screen.findByTestId('canvas');
    await user.click(screen.getByRole('button', { name: 'Другие инструменты' }));
    expect(screen.getByRole('button', { name: 'Очистить всё' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Следовать за учителем' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ответы' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Добавить страницу' }));
    expect(screen.getAllByRole('status').some((node) => node.textContent === '2 / 2')).toBe(true);
  });

  it('opens a separate annotation document for each page', async () => {
    const user = userEvent.setup();
    mount('host');
    await waitFor(() => expect(api.openAnnotationDocument).toHaveBeenCalledWith('c1', 'WHITEBOARD', 'board-1', 0, undefined, undefined));
    await user.click(screen.getByRole('button', { name: 'Добавить страницу' }));
    await waitFor(() => expect(api.openAnnotationDocument).toHaveBeenCalledWith('c1', 'WHITEBOARD', 'board-1', 1, undefined, undefined));
  });

  it('saves a stroke, then tells the room about it', async () => {
    mount('host');
    await waitFor(() => expect(api.openAnnotationDocument).toHaveBeenCalled());
    await act(async () => {
      canvasProps.onCommit({ kind: 'pen', width: 0.004, points: [[0.1, 0.2]] });
    });
    await waitFor(() => expect(api.appendAnnotation).toHaveBeenCalled());
    await waitFor(() =>
      expect(publish).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'annotation', documentId: 'doc-0', op: 'ADD', sequence: 1 }),
      ),
    );
  });

  describe('live strokes and feedback', () => {
    const pen = { kind: 'pen', color: '#111111', width: 0.004, points: [[0.1, 0.1], [0.2, 0.2]] };

    it('shows others a stroke while it is still being drawn, and says when the pen is up', async () => {
      mount('host');
      await screen.findByTestId('canvas');
      act(() => canvasProps.onDraftChange(pen));
      await waitFor(() =>
        expect(publish).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'stroke', active: true, targetId: 'board-1', page: 0 }),
          false,
          undefined,
        ),
      );
      act(() => canvasProps.onDraftChange(pen, '11111111-1111-4111-8111-111111111111', true));
      expect(publish).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'stroke', active: false, shape: expect.objectContaining({ kind: 'pen' }) }),
        true,
        undefined,
      );
    });

    it('does not preview the eraser', async () => {
      mount('host');
      await screen.findByTestId('canvas');
      act(() => canvasProps.onDraftChange({ ...pen, kind: 'erase' }));
      expect(publish).not.toHaveBeenCalled();
    });

    it("draws someone else's in-progress stroke on the board, on the right page only", async () => {
      mount('student');
      await screen.findByTestId('canvas');
      act(() =>
        handlers[STROKE_TOPIC]({
          event: strokeEvent('c1', 'board-1', 0, true, pen as never),
          senderIdentity: 'teacher|1',
        }),
      );
      await waitFor(() => expect(canvasProps.remoteDrafts).toHaveLength(1));
      act(() =>
        handlers[STROKE_TOPIC]({
          event: strokeEvent('c1', 'board-1', 3, true, pen as never),
          senderIdentity: 'other|1',
        }),
      );
      expect(canvasProps.remoteDrafts).toHaveLength(1);
    });

    it('says why saving the board did nothing when the server has no file storage', async () => {
      const user = userEvent.setup();
      api.saveAnnotationSnapshot.mockRejectedValue(new ApiRequestError(409, 'CONFLICT', 'Artifact storage is not configured'));
      mount('host');
      await screen.findByTestId('canvas');
      await waitFor(() => expect(api.openAnnotationDocument).toHaveBeenCalled());
      await user.click(screen.getByRole('button', { name: 'Сохранить как материал урока' }));
      expect(await screen.findByText(/хранилище файлов/)).toBeInTheDocument();
    });

    it('confirms a successful save', async () => {
      const user = userEvent.setup();
      api.saveAnnotationSnapshot.mockResolvedValue({} as never);
      mount('host');
      await screen.findByTestId('canvas');
      await waitFor(() => expect(api.openAnnotationDocument).toHaveBeenCalled());
      await user.click(screen.getByRole('button', { name: 'Сохранить как материал урока' }));
      expect(await screen.findByText('Сохранено')).toBeInTheDocument();
    });

    it('gives everyone a PDF of the whole board, built from every page', async () => {
      const user = userEvent.setup();
      const pdf = new Blob(['%PDF'], { type: 'application/pdf' });
      exportBoardPdf.mockResolvedValue(pdf);
      mount('student');
      await screen.findByTestId('canvas');
      await additionalAction(user, 'Скачать PDF');

      await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1));
      expect(exportBoardPdf).toHaveBeenCalledWith(
        expect.objectContaining({ classId: 'c1', targetId: 'board-1', targetType: 'WHITEBOARD', pageCount: 1 }),
      );
      expect(downloadBlob.mock.calls[0][0]).toBe(pdf);
      expect(downloadBlob.mock.calls[0][1]).toMatch(/^class-board-\d{4}-\d{2}-\d{2}\.pdf$/);
    });

    it('names a personal board’s file differently', async () => {
      const user = userEvent.setup();
      exportBoardPdf.mockResolvedValue(new Blob(['%PDF']));
      mount('student', { targetId: 'personal-student' });
      await screen.findByTestId('canvas');
      await additionalAction(user, 'Скачать PDF');
      await waitFor(() => expect(downloadBlob).toHaveBeenCalled());
      expect(downloadBlob.mock.calls[0][1]).toMatch(/^my-board-/);
    });

    it('says so when the PDF cannot be made, and can be tried again', async () => {
      const user = userEvent.setup();
      exportBoardPdf.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(new Blob(['%PDF']));
      mount('host');
      await screen.findByTestId('canvas');
      await additionalAction(user, 'Скачать PDF');
      expect(await screen.findByText('Не удалось подготовить PDF')).toBeInTheDocument();
      expect(downloadBlob).not.toHaveBeenCalled();

      await additionalAction(user, 'Скачать PDF');
      await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1));
      expect(screen.queryByText('Не удалось подготовить PDF')).not.toBeInTheDocument();
    });

    it('tells the teacher that students are following', async () => {
      const user = userEvent.setup();
      mount('host');
      await screen.findByTestId('canvas');
      await additionalAction(user, 'Следовать за учителем');
      expect(screen.getByText('Ученики следуют за вашим экраном')).toBeInTheDocument();
    });
  });

  it('fetches from the server when told something was saved, and shows what it finds', async () => {
    mount('student');
    await waitFor(() => expect(api.openAnnotationDocument).toHaveBeenCalled());
    await waitFor(() => expect(canvasProps.shapes).toEqual([]));
    api.replayAnnotations.mockResolvedValue([
      {
        id: 'r1', operationId: 'op-1', sequence: 4, actorId: 'teacher', layerOwnerId: 'teacher',
        operationType: 'ADD', payload: JSON.stringify({ kind: 'pen', points: [[0.1, 0.1]] }), createdAt: '',
      },
    ] as never);
    await act(async () => {
      handlers[ANNOTATION_TOPIC]({
        event: annotationEvent('c1', {
          documentId: 'doc-0', operationId: 'op-1', sequence: 4, op: 'ADD', layerOwnerId: 'teacher',
        }),
        senderIdentity: 'teacher|tab',
      });
    });
    await waitFor(() => expect(canvasProps.shapes).toHaveLength(1));
  });

  it('never applies the contents of a packet — a forged "clear all" does nothing', async () => {
    mount('student');
    await waitFor(() => expect(api.openAnnotationDocument).toHaveBeenCalled());
    api.replayAnnotations.mockResolvedValue([
      {
        id: 'r1', operationId: 'op-1', sequence: 1, actorId: 'teacher', layerOwnerId: 'teacher',
        operationType: 'ADD', payload: JSON.stringify({ kind: 'pen', points: [[0.1, 0.1]] }), createdAt: '',
      },
    ] as never);
    await act(async () => {
      handlers[ANNOTATION_TOPIC]({
        event: annotationEvent('c1', {
          documentId: 'doc-0', operationId: 'forged', sequence: 99, op: 'CLEAR_ALL', layerOwnerId: 'teacher',
        }),
        senderIdentity: 'student-2|tab',
      });
    });
    // The real stroke from the server is what is shown; the forged operation is not.
    await waitFor(() => expect(canvasProps.shapes).toHaveLength(1));
  });

  it('locks a student to the teacher when follow is on, and unlocks when it is off', async () => {
    mount('student');
    await screen.findByTestId('canvas');
    await waitFor(() => expect(api.listParticipants).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      handlers[VIEW_TOPIC]({ event: hostView(), senderIdentity: 'teacher|tab' });
    });
    expect(screen.getAllByTestId('canvas').every(node => node.getAttribute('data-locked') === 'true')).toBe(true);
    expect(screen.getByRole('button', { name: 'Следующая страница' })).toBeDisabled();
    expect(screen.getByText(/Вы следуете за учителем/)).toBeInTheDocument();
    expect(canvasProps.view).toEqual({ zoom: 2, panX: -500, panY: -125 });

    await act(async () => {
      handlers[VIEW_TOPIC]({ event: hostView({ follow: false }), senderIdentity: 'teacher|tab' });
    });
    expect(screen.getAllByTestId('canvas').every(node => node.getAttribute('data-locked') === 'false')).toBe(true);
    expect(screen.getByRole('button', { name: 'Следующая страница' })).toBeEnabled();
  });

  it('does not let another student drag everyone around', async () => {
    mount('student');
    await screen.findByTestId('canvas');
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      handlers[VIEW_TOPIC]({ event: hostView(), senderIdentity: 'student-2|tab' });
    });
    expect(screen.getByTestId('canvas')).toHaveAttribute('data-locked', 'false');
  });

  it('keeps the viewer’s read-only state when they may not annotate', async () => {
    mount('student', { canAnnotate: false });
    await screen.findByTestId('canvas');
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
    expect(canvasProps.readOnly).toBe(true);
  });

  describe('notebook camera board', () => {
    const notebook = { targetType: 'NOTEBOOK_CAMERA' as const, targetId: 'personal-student' };
    const background = () => ({ source: document.createElement('video'), width: 1920, height: 1080 });

    it('uses an isolated camera target and its live geometry without the paper PDF or observed paper page', async () => {
      const liveBackground = background();
      const paper = { pageCount: 8 } as never;
      renderPdfPage.mockReturnValue({ canvas: document.createElement('canvas'), aspect: 0.7 });
      mount('host', { ...notebook, liveBackground, document: paper, observedPage: 6 });
      await waitFor(() => expect(api.openAnnotationDocument).toHaveBeenCalledWith('c1', 'NOTEBOOK_CAMERA', 'personal-student', 0, 1920, 1080));
      expect(api.openAnnotationDocument.mock.calls.every(call => call[1] === 'NOTEBOOK_CAMERA')).toBe(true);
      expect(renderPdfPage).toHaveBeenCalledWith(null, 0, 0);
      expect(canvasProps.background).toBe(liveBackground.source);
      expect(canvasProps.backgroundLive).toBe(true);
      expect(canvasProps.sourceAspect).toBe(1920 / 1080);
      expect(canvasProps.pageKey).toBe('NOTEBOOK_CAMERA:personal-student:0');
      expect(screen.getByTestId('canvas').closest('section')).toHaveClass('whiteboard--camera');
      expect(screen.getAllByRole('status').some(node => node.textContent === '1 / 1')).toBe(true);
      expect(screen.queryByRole('button', { name: 'Следовать за учителем' })).not.toBeInTheDocument();
    });

    it('persists raw camera coordinates and forwards the processed geometry without reopening or replacing its annotation surface', async () => {
      const rawVideo = document.createElement('video');
      const geometry: NotebookCameraGeometry = {
        rawWidth: 1920, rawHeight: 1080, renderer: {} as CameraModule,
        view: { type: 'document-view', version: 1, turn: 1, sourceAspect: 16 / 9, ratio: 0.5,
          corners: [{ x: 0.2, y: 0.1 }, { x: 0.8, y: 0.1 }, { x: 0.8, y: 0.9 }, { x: 0.2, y: 0.9 }] },
      };
      const content = (notebookView: NotebookCameraGeometry) => <I18nProvider><WhiteboardPanel classId="c1" actorId="teacher" isHost
        {...notebook} liveBackground={{ source: rawVideo, width: 1920, height: 1080, notebookView }} /></I18nProvider>;
      const { rerender } = render(content(geometry));
      await waitFor(() => expect(api.openAnnotationDocument).toHaveBeenCalledWith('c1', 'NOTEBOOK_CAMERA', 'personal-student', 0, 1920, 1080));
      const canvas = screen.getByTestId('canvas'), pageKey = canvasProps.pageKey;
      expect(canvasProps.background).toBe(rawVideo);
      expect(canvasProps.sourceAspect).toBe(16 / 9);
      expect(canvasProps.notebookView).toBe(geometry);
      const stroke = { kind: 'pen', color: '#ff3344', width: 0.004, points: [[0.15, 0.25], [0.4, 0.7]] };
      await act(async () => { await canvasProps.onCommit(stroke); });
      expect(api.appendAnnotation).toHaveBeenCalledWith('c1', 'doc-0', expect.any(String), 'ADD', JSON.stringify(stroke));
      expect(canvasProps.shapes).toHaveLength(1);
      const savedShapes = canvasProps.shapes;
      const rotated: NotebookCameraGeometry = { ...geometry, view: { ...geometry.view, turn: 3, ratio: 1 } };
      rerender(content(rotated));
      expect(canvasProps.notebookView).toBe(rotated);
      expect(canvasProps.background).toBe(rawVideo); expect(canvasProps.sourceAspect).toBe(16 / 9);
      expect(canvasProps.pageKey).toBe(pageKey); expect(screen.getByTestId('canvas')).toBe(canvas);
      expect(canvasProps.shapes).toEqual(savedShapes);
      expect(api.openAnnotationDocument).toHaveBeenCalledTimes(1);
      expect(api.appendAnnotation).toHaveBeenCalledTimes(1);
    });

    it('keeps the ordinary tools, undo and independent camera pages backed by the annotation engine', async () => {
      const user = userEvent.setup();
      mount('host', { ...notebook, liveBackground: background() });
      await waitFor(() => expect(api.openAnnotationDocument).toHaveBeenCalled());
      await additionalAction(user, 'Линия');
      expect(canvasProps.tool).toBe('line');
      await act(async () => { await canvasProps.onCommit({ kind: 'line', x1: 0.1, y1: 0.2, x2: 0.8, y2: 0.7 }); });
      expect(api.appendAnnotation).toHaveBeenCalledWith('c1', 'doc-0', expect.any(String), 'ADD', expect.stringContaining('"kind":"line"'));
      await user.click(screen.getByRole('button', { name: 'Отменить' }));
      await waitFor(() => expect(api.appendAnnotation).toHaveBeenCalledWith('c1', 'doc-0', expect.any(String), 'UNDO', expect.any(String)));
      await user.click(screen.getByRole('button', { name: 'Добавить страницу' }));
      await waitFor(() => expect(api.openAnnotationDocument).toHaveBeenCalledWith('c1', 'NOTEBOOK_CAMERA', 'personal-student', 1, 1920, 1080));
      expect(canvasProps.backgroundLive).toBe(true);
    });

    it('sends notebook ink privately on its own channel and ignores paper-board strokes and views', async () => {
      mount('student', { ...notebook, liveBackground: background() });
      await waitFor(() => expect(api.openAnnotationDocument).toHaveBeenCalled());
      await act(async () => {
        canvasProps.onDraftChange({ kind: 'pen', color: '#111111', width: 0.004, points: [[0.1, 0.2]] }, 'stroke-camera');
        await canvasProps.onCommit({ kind: 'pen', points: [[0.1, 0.2]] });
        handlers[STROKE_TOPIC]({ event: strokeEvent('c1', 'personal-student', 0, true, { kind: 'pen', color: '#111111', width: 0.004, points: [[0.3, 0.4]] }), senderIdentity: 'student|tab' });
      });
      expect(api.appendAnnotation).toHaveBeenCalled();
      expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'stroke', targetId: 'personal-student' }), false, ['student', 'teacher']);
      expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'annotation' }), true, ['student', 'teacher']);
      expect(publish).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'view' }), expect.anything());
      expect(canvasProps.remoteDrafts).toEqual([]);
      act(() => handlers[NOTEBOOK_STROKE_TOPIC]({ event: strokeEvent('c1', 'personal-student', 0, true,
        { kind: 'pen', color: '#111111', width: 0.004, points: [[0.3, 0.4]] }), senderIdentity: 'teacher|tab' }));
      expect(canvasProps.remoteDrafts).toHaveLength(1);
    });

    it('exports the current composited camera frame as a one-page PDF', async () => {
      const user = userEvent.setup();
      mount('host', { ...notebook, liveBackground: background() });
      await additionalAction(user, 'Скачать кадр PDF');
      await waitFor(() => expect(downloadBlob).toHaveBeenCalledOnce());
      expect(canvasSnapshot).toHaveBeenCalledWith('image/jpeg');
      expect(exportBoardPdf).not.toHaveBeenCalled();
      const [blob, filename] = downloadBlob.mock.calls[0];
      expect(blob.type).toBe('application/pdf'); expect(filename).toMatch(/^notebook-frame-.*\.pdf$/);
      const text = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsText(blob);
      });
      expect(text).toContain('/Count 1'); expect(text).toContain('/Width 1000 /Height 500'); expect(text).toContain('/DCTDecode');
    });

    it('pauses live drawing when hidden and keeps paper boards on their original PDF path', async () => {
      const liveBackground = background();
      const { unmount } = mount('host', { ...notebook, liveBackground, active: false });
      await act(async () => { await Promise.resolve(); });
      expect(canvasProps.active).toBe(false); unmount();
      const paper = { pageCount: 2 } as never, rendered = document.createElement('canvas');
      renderPdfPage.mockReturnValue({ canvas: rendered, aspect: 0.7 });
      mount('host', { document: paper, liveBackground });
      await act(async () => { await Promise.resolve(); });
      expect(canvasProps.background).toBe(rendered); expect(canvasProps.sourceAspect).toBe(0.7); expect(canvasProps.backgroundLive).toBe(false);
      expect(renderPdfPage).toHaveBeenCalledWith(paper, 0, 0);
    });
  });

  describe('personal board', () => {
    const personal = { targetId: 'personal-student' };

    it('never announces strokes to the room', async () => {
      mount('student', personal);
      await waitFor(() => expect(api.openAnnotationDocument).toHaveBeenCalledWith('c1', 'WHITEBOARD', 'personal-student', 0, undefined, undefined));
      await act(async () => {
        canvasProps.onCommit({ kind: 'pen', width: 0.004, points: [[0.1, 0.2]] });
      });
      await waitFor(() => expect(api.appendAnnotation).toHaveBeenCalled());
      expect(publish).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'annotation' }));
    });

    it('has no follow control for the teacher, and is not moved by the teacher', async () => {
      const { unmount } = mount('host', personal);
      await screen.findByTestId('canvas');
      expect(screen.queryByRole('button', { name: 'Следовать за учителем' })).not.toBeInTheDocument();
      unmount();

      mount('student', personal);
      await screen.findByTestId('canvas');
      await act(async () => {
        await Promise.resolve();
      });
      await act(async () => {
        handlers[VIEW_TOPIC]({ event: hostView({ boardId: 'personal-student' }), senderIdentity: 'teacher|tab' });
      });
      expect(screen.getByTestId('canvas')).toHaveAttribute('data-locked', 'false');
    });

    it('lets the owner add pages to their own board', async () => {
      mount('student', personal);
      await screen.findByTestId('canvas');
      expect(screen.getByRole('button', { name: 'Добавить страницу' })).toBeInTheDocument();
    });

    it('re-reads the board while it is on screen, and stops when it is not', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        const { rerender } = mount('host', personal);
        await act(async () => {
          await vi.advanceTimersByTimeAsync(10);
        });
        api.replayAnnotations.mockClear();
        await act(async () => {
          await vi.advanceTimersByTimeAsync(4100);
        });
        const whileActive = api.replayAnnotations.mock.calls.length;
        expect(whileActive).toBeGreaterThanOrEqual(1);

        rerender(
          <I18nProvider>
            <WhiteboardPanel classId="c1" actorId="teacher" isHost targetId="personal-student" active={false} />
          </I18nProvider>,
        );
        api.replayAnnotations.mockClear();
        await act(async () => {
          await vi.advanceTimersByTimeAsync(6000);
        });
        expect(api.replayAnnotations).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
