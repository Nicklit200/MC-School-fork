import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createRef, forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { onlineClassesApi } from '../../api/onlineClasses';
import type { Shape } from './annotations';
import { DEFAULT_TOOL_SETTINGS } from './boardTools';
import { DEFAULT_VIEW } from './boardView';
import { ANNOTATION_TOPIC, NOTEBOOK_STROKE_TOPIC, STROKE_TOPIC, annotationEvent, strokeEvent } from './events';
import type { PdfDoc } from './pdfDocument';
import type { ReceivedEvent } from './useClassEvents';
import type { WhiteboardCanvas } from './WhiteboardCanvas';

type CanvasProps = React.ComponentProps<typeof WhiteboardCanvas>;
const canvases = new Map<string, CanvasProps>();
const mounted = vi.fn();
const unmounted = vi.fn();
vi.mock('./WhiteboardCanvas', () => ({
  WhiteboardCanvas: forwardRef((props: CanvasProps, ref) => {
    canvases.set(props.pageKey!, props);
    useEffect(() => {
      mounted(props.pageKey);
      return () => { unmounted(props.pageKey); canvases.delete(props.pageKey!); };
    }, []);
    useImperativeHandle(ref, () => ({
      toDataURL: () => `data:image/png;base64,${props.pageKey}`,
      getSize: () => ({ width: 1000, height: 500 }),
    }));
    return <div data-testid={props.pageKey} tabIndex={0} />;
  }),
}));

const publish = vi.fn().mockResolvedValue(undefined);
const listeners = new Map<string, Set<(event: ReceivedEvent) => void>>();
vi.mock('./useClassEvents', () => ({
  useClassEvents: (_classId: string, topic: string, onEvent: (received: ReceivedEvent) => void) => {
    const handler = useRef(onEvent);
    handler.current = onEvent;
    useEffect(() => {
      const receive = (event: ReceivedEvent) => handler.current(event);
      const topicListeners = listeners.get(topic) ?? new Set();
      listeners.set(topic, topicListeners);
      topicListeners.add(receive);
      return () => { topicListeners.delete(receive); };
    }, [topic]);
    return { publish };
  },
}));

vi.mock('../../api/onlineClasses', async () => {
  const actual = await vi.importActual<typeof import('../../api/onlineClasses')>('../../api/onlineClasses');
  return {
    ...actual,
    onlineClassesApi: {
      openAnnotationDocument: vi.fn(),
      replayAnnotations: vi.fn(),
      appendAnnotation: vi.fn(),
      listParticipants: vi.fn(),
    },
  };
});

import { WhiteboardPageSurface, type PageSurfaceHandle, type WhiteboardPageSurfaceProps } from './WhiteboardPageSurface';

const api = vi.mocked(onlineClassesApi);
const pen: Shape = { kind: 'pen', color: '#111111', width: 0.004, points: [[0.1, 0.2], [0.4, 0.6]] };
const baseProps: WhiteboardPageSurfaceProps = {
  classId: 'c1', actorId: 'teacher', isHost: true, targetType: 'WHITEBOARD', targetId: 'board-1', pageIndex: 0,
  pdfDocument: null, sourceAspect: null, liveBackground: null, tool: 'pen',
  settings: DEFAULT_TOOL_SETTINGS.pen, textSettings: DEFAULT_TOOL_SETTINGS.text, eraserMode: 'partial', inputMode: 'finger',
  view: DEFAULT_VIEW, onViewChange: vi.fn(), canAnnotate: true, navigationLocked: false,
  active: true, selected: true, lasers: [], continuous: true,
};
const key = (page: number, target = 'board-1', type = 'WHITEBOARD') => `${type}:${target}:${page}`;
const canvas = (page = 0, target = 'board-1', type = 'WHITEBOARD') => canvases.get(key(page, target, type))!;

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  constructor(private callback: ResizeObserverCallback) { FakeResizeObserver.instances.push(this); }
  observe() {}
  disconnect() { FakeResizeObserver.instances = FakeResizeObserver.instances.filter(item => item !== this); }
  static resize(width: number) {
    for (const observer of this.instances) {
      observer.callback([{ contentRect: { width } } as ResizeObserverEntry], observer as unknown as ResizeObserver);
    }
  }
}

function receive(topic: string, received: ReceivedEvent) {
  for (const listener of listeners.get(topic) ?? []) listener(received);
}

function savedPen(operationId: string, sequence = 1) {
  return { id: `saved-${operationId}`, operationId, sequence, actorId: 'teacher', layerOwnerId: 'teacher', operationType: 'ADD' as const, payload: JSON.stringify(pen), createdAt: '' };
}

async function ready(page = 0, target = 'board-1', type = 'WHITEBOARD') {
  await waitFor(() => expect(api.replayAnnotations).toHaveBeenCalledWith('c1', `doc-${target}-${page}`, 0));
  expect(canvases.has(key(page, target, type))).toBe(true);
}

describe('WhiteboardPageSurface', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canvases.clear();
    listeners.clear();
    FakeResizeObserver.instances = [];
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    api.openAnnotationDocument.mockImplementation(async (_classId, targetType, targetId, pageIndex = 0) => ({
      id: `doc-${targetId}-${pageIndex}`, targetType, targetId, pageIndex, sourceWidth: null, sourceHeight: null,
      revision: 0, snapshotSavedAt: null,
    }));
    api.replayAnnotations.mockResolvedValue([]);
    api.listParticipants.mockResolvedValue([{ userId: 'teacher', classRole: 'HOST' } as never]);
    let sequence = 0;
    api.appendAnnotation.mockImplementation(async (_classId, _doc, operationId, operationType, payload) => ({
      id: `saved-${++sequence}`, operationId, sequence, actorId: 'teacher', layerOwnerId: 'teacher', operationType, payload, createdAt: '',
    }));
  });

  it('keeps documents, marks and undo bound to their fixed pages', async () => {
    const first = createRef<PageSurfaceHandle>();
    const second = createRef<PageSurfaceHandle>();
    render(<><WhiteboardPageSurface {...baseProps} ref={first} /><WhiteboardPageSurface {...baseProps} pageIndex={1} ref={second} /></>);
    await ready(0); await ready(1);
    await act(async () => { await canvas(0).onCommit(pen, 'first-stroke'); });
    expect(api.appendAnnotation).toHaveBeenCalledWith('c1', 'doc-board-1-0', 'first-stroke', 'ADD', JSON.stringify(pen));
    expect(canvas(0).shapes).toHaveLength(1);
    expect(canvas(1).shapes).toHaveLength(0);
    await act(async () => { await canvas(1).onCommit({ kind: 'rect', x: 0.2, y: 0.3, w: 0.4, h: 0.2 }, 'second-stroke'); });
    expect(second.current?.board.document?.pageIndex).toBe(1);
    expect(first.current?.board.document?.pageIndex).toBe(0);
    await act(async () => { await second.current?.board.undo(); });
    expect(api.appendAnnotation).toHaveBeenLastCalledWith('c1', 'doc-board-1-1', expect.any(String), 'UNDO', JSON.stringify({ targetOperationId: 'second-stroke' }));
    expect(first.current?.board.canUndo).toBe(true);
    expect(second.current?.board.canUndo).toBe(false);
    expect(second.current?.canvas()?.getSize()).toEqual({ width: 1000, height: 500 });
  });

  it('retains its canvas, document, marks and redo while layout and selection change', async () => {
    const ref = createRef<PageSurfaceHandle>();
    const { rerender } = render(<WhiteboardPageSurface {...baseProps} ref={ref} />);
    await ready();
    const element = screen.getByTestId(key(0));
    await act(async () => { await canvas().onCommit(pen, 'stable-stroke'); });
    await act(async () => { await ref.current?.board.undo(); });
    expect(ref.current?.board.canRedo).toBe(true);
    rerender(<WhiteboardPageSurface {...baseProps} ref={ref} continuous={false} selected={false} active={false} onViewChange={vi.fn()} onStatusChange={vi.fn()} />);
    expect(screen.getByTestId(key(0))).toBe(element);
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(unmounted).not.toHaveBeenCalled();
    expect(api.openAnnotationDocument).toHaveBeenCalledTimes(1);
    expect(ref.current?.board.canRedo).toBe(true);
    await act(async () => { await ref.current?.board.redo(); });
    expect(canvas().shapes).toHaveLength(1);
  });

  it('returns failed persistence to the canvas and retries the same operation on the same page after a layout change', async () => {
    const { rerender } = render(<WhiteboardPageSurface {...baseProps} pageIndex={1} />);
    await ready(1);
    api.appendAnnotation.mockRejectedValueOnce(new Error('Temporary network failure'));
    let saved: boolean | void = true;
    await act(async () => { saved = await canvas(1).onCommit(pen, 'retry-stroke'); });
    expect(saved).toBe(false); expect(canvas(1).shapes).toHaveLength(0);
    rerender(<WhiteboardPageSurface {...baseProps} pageIndex={1} continuous={false} />);
    await act(async () => { saved = await canvas(1).onCommit(pen, 'retry-stroke'); });
    expect(saved).toBe(true); expect(canvas(1).shapes).toHaveLength(1);
    expect(api.appendAnnotation.mock.calls.map(call => [call[1], call[2]])).toEqual([
      ['doc-board-1-1', 'retry-stroke'], ['doc-board-1-1', 'retry-stroke'],
    ]);
    expect(mounted).toHaveBeenCalledTimes(1);
  });

  it('notifies status only when booleans change and activates the exact page on pointer or focus', async () => {
    const onStatusChange = vi.fn(), replacement = vi.fn(), onActivate = vi.fn();
    const { rerender } = render(<WhiteboardPageSurface {...baseProps} pageIndex={2} onStatusChange={onStatusChange} onActivate={onActivate} />);
    await ready(2);
    expect(onStatusChange).toHaveBeenCalledExactlyOnceWith(2, { canUndo: false, canRedo: false, loadingPdfPage: false });
    rerender(<WhiteboardPageSurface {...baseProps} pageIndex={2} onStatusChange={replacement} onActivate={onActivate} />);
    expect(replacement).not.toHaveBeenCalled();
    fireEvent.pointerDown(screen.getByTestId(key(2)));
    fireEvent.focus(screen.getByTestId(key(2)));
    expect(onActivate.mock.calls).toEqual([[2], [2]]);
    await act(async () => { await canvas(2).onCommit(pen, 'changed-status'); });
    expect(replacement).toHaveBeenCalledExactlyOnceWith(2, { canUndo: true, canRedo: false, loadingPdfPage: false });
  });

  it('reports page aspect without repeating notifications for new callback identities', async () => {
    const onAspectChange = vi.fn(), replacement = vi.fn();
    const { rerender } = render(<WhiteboardPageSurface {...baseProps} pageIndex={2} onAspectChange={onAspectChange} />);
    await ready(2);
    expect(onAspectChange).toHaveBeenCalledExactlyOnceWith(2, 210 / 297);
    rerender(<WhiteboardPageSurface {...baseProps} pageIndex={2} onAspectChange={replacement} sourceAspect={Number.POSITIVE_INFINITY} />);
    expect(replacement).not.toHaveBeenCalled();
    rerender(<WhiteboardPageSurface {...baseProps} pageIndex={2} onAspectChange={replacement} sourceAspect={1.6} />);
    expect(replacement).toHaveBeenCalledExactlyOnceWith(2, 1.6);
    expect(mounted).toHaveBeenCalledTimes(1);
  });

  it('refreshes only a matching document and reads geometry from REST instead of the hint', async () => {
    render(<><WhiteboardPageSurface {...baseProps} /><WhiteboardPageSurface {...baseProps} pageIndex={1} /></>);
    await ready(0); await ready(1);
    api.replayAnnotations.mockClear();
    await act(async () => { receive(ANNOTATION_TOPIC, { senderIdentity: 'other|tab', event: annotationEvent('c1', { documentId: 'unknown-document', operationId: 'forged', sequence: 99, op: 'CLEAR_ALL', layerOwnerId: 'other' }) }); });
    expect(api.replayAnnotations).not.toHaveBeenCalled();
    api.replayAnnotations.mockResolvedValue([savedPen('real-server-mark')]);
    await act(async () => { receive(ANNOTATION_TOPIC, { senderIdentity: 'other|tab', event: annotationEvent('c1', { documentId: 'doc-board-1-1', operationId: 'forged', sequence: 99, op: 'CLEAR_ALL', layerOwnerId: 'other' }) }); });
    expect(api.replayAnnotations).toHaveBeenCalledExactlyOnceWith('c1', 'doc-board-1-1', 0);
    expect(canvas(0).shapes).toHaveLength(0);
    expect(canvas(1).shapes[0].operationId).toBe('real-server-mark');
  });

  it('keeps a completed live preview until its matching durable shape actually arrives', async () => {
    render(<><WhiteboardPageSurface {...baseProps} /><WhiteboardPageSurface {...baseProps} pageIndex={1} /></>);
    await ready(0); await ready(1);
    const strokeId = '11111111-1111-4111-8111-111111111111';
    act(() => receive(STROKE_TOPIC, { event: strokeEvent('c1', 'board-1', 1, false, pen as never, strokeId), senderIdentity: 'teacher|other' }));
    expect(canvas(0).remoteDrafts).toHaveLength(0);
    expect(canvas(1).remoteDrafts).toHaveLength(1);
    let resolveReplay!: (operations: ReturnType<typeof savedPen>[]) => void;
    api.replayAnnotations.mockImplementation(() => new Promise(resolve => { resolveReplay = resolve; }));
    act(() => receive(ANNOTATION_TOPIC, { event: annotationEvent('c1', { documentId: 'doc-board-1-1', operationId: strokeId, sequence: 1, op: 'ADD', layerOwnerId: 'teacher' }), senderIdentity: 'teacher|other' }));
    expect(canvas(1).remoteDrafts).toHaveLength(1);
    await act(async () => { resolveReplay([savedPen(strokeId)]); });
    expect(canvas(1).shapes).toHaveLength(1);
    expect(canvas(1).remoteDrafts).toHaveLength(0);
  });

  it('restricts personal previews to owner and host and never broadcasts saved operations or laser', async () => {
    render(<WhiteboardPageSurface {...baseProps} actorId="student" isHost={false} targetId="personal-student" lasers={[{ id: 'someone', x: 0.2, y: 0.3 }]} onLaser={vi.fn()} />);
    await ready(0, 'personal-student');
    const props = canvas(0, 'personal-student');
    await act(async () => { props.onDraftChange?.(pen, 'private-stroke', true); await props.onCommit(pen, 'private-stroke'); });
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'stroke', page: 0 }), true, ['student', 'teacher']);
    expect(publish).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'annotation' }));
    expect(props.lasers).toEqual([]); expect(props.onLaserMove).toBeUndefined();
    act(() => receive(STROKE_TOPIC, { event: strokeEvent('c1', 'personal-student', 0, true, pen as never), senderIdentity: 'unrelated-student|tab' }));
    expect(canvas(0, 'personal-student').remoteDrafts).toEqual([]);
    api.replayAnnotations.mockClear();
    act(() => receive(ANNOTATION_TOPIC, { event: annotationEvent('c1', { documentId: 'doc-personal-student-0', operationId: 'x', sequence: 2, op: 'ADD', layerOwnerId: 'teacher' }), senderIdentity: 'teacher|tab' }));
    expect(api.replayAnnotations).not.toHaveBeenCalled();
  });

  it('polls the fixed private document only while visible and cancels polling on unmount', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const props = { ...baseProps, targetId: 'personal-student', pageIndex: 3 };
      const { rerender, unmount } = render(<WhiteboardPageSurface {...props} />);
      await ready(3, 'personal-student');
      api.replayAnnotations.mockClear();
      await act(async () => { await vi.advanceTimersByTimeAsync(4100); });
      expect(api.replayAnnotations).toHaveBeenCalledTimes(2);
      expect(api.replayAnnotations.mock.calls.every(call => call[1] === 'doc-personal-student-3')).toBe(true);
      rerender(<WhiteboardPageSurface {...props} active={false} />);
      api.replayAnnotations.mockClear();
      await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
      expect(api.replayAnnotations).not.toHaveBeenCalled();
      unmount();
      await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
      expect(api.replayAnnotations).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it('loads the correct PDF page using its own width, blocks placeholder ink, and keeps added blank pages A4', async () => {
    const rendered = document.createElement('canvas');
    const pdf: PdfDoc = { pageCount: 1, renderPage: vi.fn().mockResolvedValue({ canvas: rendered, aspect: 1.6 }), destroy: vi.fn() };
    const onStatusChange = vi.fn(), onAspectChange = vi.fn();
    render(<><WhiteboardPageSurface {...baseProps} pdfDocument={pdf} onStatusChange={onStatusChange} onAspectChange={onAspectChange} /><WhiteboardPageSurface {...baseProps} pageIndex={1} pdfDocument={pdf} /></>);
    await ready(0); await ready(1);
    expect(canvas(0).readOnly).toBe(true);
    expect(onAspectChange).toHaveBeenCalledExactlyOnceWith(0, null);
    expect(canvas(1).readOnly).toBe(false); expect(canvas(1).sourceAspect).toBe(210 / 297);
    act(() => FakeResizeObserver.resize(720));
    await waitFor(() => expect(canvas(0).background).toBe(rendered));
    expect(pdf.renderPage).toHaveBeenCalledExactlyOnceWith(0, 800);
    expect(canvas(0).sourceAspect).toBe(1.6); expect(canvas(0).readOnly).toBe(false);
    expect(onAspectChange).toHaveBeenLastCalledWith(0, 1.6);
    expect(canvas(1).sourceAspect).toBe(210 / 297); expect(canvas(1).background).toBeNull();
    expect(onStatusChange).toHaveBeenLastCalledWith(0, { canUndo: false, canRedo: false, loadingPdfPage: false });
    act(() => FakeResizeObserver.resize(0));
    expect(pdf.renderPage).toHaveBeenCalledTimes(1);
  });

  it('keeps camera geometry separate from PDF and targets camera drafts and save hints only to owner and host', async () => {
    const video = document.createElement('video');
    const pdf: PdfDoc = { pageCount: 5, renderPage: vi.fn(), destroy: vi.fn() };
    render(<WhiteboardPageSurface {...baseProps} targetType="NOTEBOOK_CAMERA" targetId="personal-student" pdfDocument={pdf}
      liveBackground={{ source: video, width: 1920, height: 1080 }} active={false} />);
    await ready(0, 'personal-student', 'NOTEBOOK_CAMERA');
    expect(api.openAnnotationDocument).toHaveBeenCalledWith('c1', 'NOTEBOOK_CAMERA', 'personal-student', 0, 1920, 1080);
    const props = canvas(0, 'personal-student', 'NOTEBOOK_CAMERA');
    expect(props.background).toBe(video); expect(props.sourceAspect).toBe(1920 / 1080);
    expect(props.paperColor).toBeNull(); expect(props.backgroundLive).toBe(true); expect(props.active).toBe(false); expect(props.readOnly).toBe(false);
    act(() => FakeResizeObserver.resize(600));
    expect(pdf.renderPage).not.toHaveBeenCalled();
    await act(async () => { props.onDraftChange?.(pen, 'camera-stroke', true); await props.onCommit(pen, 'camera-stroke'); });
    expect(api.appendAnnotation).toHaveBeenCalledWith('c1', 'doc-personal-student-0', 'camera-stroke', 'ADD', JSON.stringify(pen));
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'stroke', targetId: 'personal-student' }), true, ['student', 'teacher']);
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'annotation', operationId: 'camera-stroke' }), true, ['student', 'teacher']);
    expect(props.remoteDrafts).toEqual([]);
  });

  it.each(['teacher', 'student'])('shows camera ink to %s before saving or polling, then replaces the preview without a blank gap', async (actorId) => {
    render(<><WhiteboardPageSurface {...baseProps} actorId={actorId} isHost={actorId === 'teacher'}
      targetType="NOTEBOOK_CAMERA" targetId="personal-student" />
      <WhiteboardPageSurface {...baseProps} actorId={actorId} isHost={actorId === 'teacher'} targetId="personal-student" /></>);
    await ready(0, 'personal-student', 'NOTEBOOK_CAMERA');
    await ready(0, 'personal-student');
    const sender = actorId === 'teacher' ? 'student' : 'teacher';
    const strokeId = '11111111-1111-4111-8111-111111111111';
    const event = strokeEvent('c1', 'personal-student', 0, true, pen as never, strokeId, 1);
    api.replayAnnotations.mockClear();
    act(() => {
      receive(STROKE_TOPIC, { event, senderIdentity: `${sender}|tab` });
      receive(NOTEBOOK_STROKE_TOPIC, { event, senderIdentity: 'unrelated-student|tab' });
    });
    expect(canvas(0, 'personal-student', 'NOTEBOOK_CAMERA').remoteDrafts).toEqual([]);
    act(() => receive(NOTEBOOK_STROKE_TOPIC, { event, senderIdentity: `${sender}|tab` }));
    expect(canvas(0, 'personal-student', 'NOTEBOOK_CAMERA').remoteDrafts?.[0].shape).toEqual(pen);
    // Only the paper packet appeared on the ordinary board; camera geometry
    // must never be interpreted as ink on the underlying personal A4 page.
    const paperDrafts = canvas(0, 'personal-student').remoteDrafts;
    expect(paperDrafts).toHaveLength(1);
    expect(api.replayAnnotations).not.toHaveBeenCalled();
    let resolveReplay!: (operations: ReturnType<typeof savedPen>[]) => void;
    api.replayAnnotations.mockImplementation(() => new Promise(resolve => { resolveReplay = resolve; }));
    act(() => {
      receive(NOTEBOOK_STROKE_TOPIC, { event: { ...event, active: false, revision: 2 }, senderIdentity: `${sender}|tab` });
      receive(ANNOTATION_TOPIC, { event: annotationEvent('c1', { documentId: 'doc-personal-student-0', operationId: strokeId,
        sequence: 1, op: 'ADD', layerOwnerId: sender }), senderIdentity: `${sender}|tab` });
    });
    expect(api.replayAnnotations).toHaveBeenCalledExactlyOnceWith('c1', 'doc-personal-student-0', 0);
    expect(canvas(0, 'personal-student', 'NOTEBOOK_CAMERA').remoteDrafts).toHaveLength(1);
    expect(canvas(0, 'personal-student').remoteDrafts).toEqual(paperDrafts);
    await act(async () => { resolveReplay([{ ...savedPen(strokeId), actorId: sender, layerOwnerId: sender }]); });
    expect(canvas(0, 'personal-student', 'NOTEBOOK_CAMERA').shapes).toHaveLength(1);
    expect(canvas(0, 'personal-student', 'NOTEBOOK_CAMERA').remoteDrafts).toEqual([]);
  });

  it('rejects untrusted camera save hints and immediately refreshes an authorized undo from REST', async () => {
    api.replayAnnotations.mockResolvedValueOnce([savedPen('prior')]);
    render(<WhiteboardPageSurface {...baseProps} actorId="student" isHost={false} targetType="NOTEBOOK_CAMERA" targetId="personal-student" />);
    await ready(0, 'personal-student', 'NOTEBOOK_CAMERA');
    expect(canvas(0, 'personal-student', 'NOTEBOOK_CAMERA').shapes).toHaveLength(1);
    api.replayAnnotations.mockClear();
    api.replayAnnotations.mockResolvedValue([{ ...savedPen('undo-id', 2), operationType: 'UNDO', payload: JSON.stringify({ targetOperationId: 'prior' }) }]);
    const event = annotationEvent('c1', { documentId: 'doc-personal-student-0', operationId: 'undo-id', sequence: 2, op: 'UNDO', layerOwnerId: 'teacher' });
    act(() => {
      receive(ANNOTATION_TOPIC, { event, senderIdentity: 'unrelated-student|tab' });
      receive(ANNOTATION_TOPIC, { event, senderIdentity: undefined });
      receive(ANNOTATION_TOPIC, { event: { ...event, documentId: 'other-camera-document' }, senderIdentity: 'teacher|tab' });
    });
    expect(api.replayAnnotations).not.toHaveBeenCalled();
    await act(async () => { receive(ANNOTATION_TOPIC, { event, senderIdentity: 'teacher|tab' }); });
    expect(api.replayAnnotations).toHaveBeenCalledExactlyOnceWith('c1', 'doc-personal-student-0', 1);
    expect(canvas(0, 'personal-student', 'NOTEBOOK_CAMERA').shapes).toEqual([]);
  });

  it.each(['UNDO', 'CLEAR_LAYER', 'CLEAR_ALL'] as const)('does not leave a ghost camera preview when %s arrives in the same replay as its ADD', async (operationType) => {
    render(<WhiteboardPageSurface {...baseProps} actorId="student" isHost={false} targetType="NOTEBOOK_CAMERA" targetId="personal-student" />);
    await ready(0, 'personal-student', 'NOTEBOOK_CAMERA');
    const strokeId = '22222222-2222-4222-8222-222222222222';
    act(() => receive(NOTEBOOK_STROKE_TOPIC, { event: strokeEvent('c1', 'personal-student', 0, false, pen as never, strokeId, 2), senderIdentity: 'teacher|tab' }));
    expect(canvas(0, 'personal-student', 'NOTEBOOK_CAMERA').remoteDrafts).toHaveLength(1);
    api.replayAnnotations.mockResolvedValue([savedPen(strokeId), { ...savedPen('remove-id', 2), operationType,
      payload: operationType === 'UNDO' ? JSON.stringify({ targetOperationId: strokeId }) : '{}' }]);
    await act(async () => { receive(ANNOTATION_TOPIC, { event: annotationEvent('c1', {
      documentId: 'doc-personal-student-0', operationId: 'remove-id', sequence: 2, op: operationType, layerOwnerId: 'teacher',
    }), senderIdentity: 'teacher|tab' }); });
    expect(canvas(0, 'personal-student', 'NOTEBOOK_CAMERA').shapes).toEqual([]);
    expect(canvas(0, 'personal-student', 'NOTEBOOK_CAMERA').remoteDrafts).toEqual([]);
  });

  it('sends scroll gestures only in continuous mode and shows lasers only on the selected page', async () => {
    const lasers = [{ id: 'teacher', x: 0.2, y: 0.3 }], onLaser = vi.fn(), onScrollGesture = vi.fn();
    const { rerender } = render(<WhiteboardPageSurface {...baseProps} lasers={lasers} onLaser={onLaser} onScrollGesture={onScrollGesture} />);
    await ready();
    expect(canvas().lasers).toBe(lasers); expect(canvas().onLaserMove).toBe(onLaser); expect(canvas().onScrollGesture).toBe(onScrollGesture);
    rerender(<WhiteboardPageSurface {...baseProps} selected={false} continuous={false} lasers={lasers} onLaser={onLaser} onScrollGesture={onScrollGesture} canAnnotate={false} navigationLocked />);
    expect(canvas().lasers).toEqual([]); expect(canvas().onLaserMove).toBeUndefined(); expect(canvas().onScrollGesture).toBeUndefined();
    expect(canvas().readOnly).toBe(true); expect(canvas().navigationLocked).toBe(true);
  });

  it('routes document zoom only for continuous WHITEBOARD pages and keeps large PDF raster requests bounded', async () => {
    const onDocumentGesture = vi.fn(), onDocumentPenContact = vi.fn(), texture = document.createElement('canvas');
    const pdf: PdfDoc = { pageCount: 1, renderPage: vi.fn().mockResolvedValue({ canvas: texture, aspect: 1.6 }), destroy: vi.fn() };
    const { rerender } = render(<WhiteboardPageSurface {...baseProps} onDocumentGesture={onDocumentGesture} onDocumentPenContact={onDocumentPenContact} pdfDocument={pdf} />);
    await ready();
    expect(canvas().onDocumentGesture).toBe(onDocumentGesture);
    expect(canvas().onDocumentPenContact).toBe(onDocumentPenContact);
    act(() => FakeResizeObserver.resize(9000));
    await waitFor(() => expect(canvas().background).toBe(texture));
    expect(pdf.renderPage).toHaveBeenCalledExactlyOnceWith(0, 4096);
    rerender(<WhiteboardPageSurface {...baseProps} onDocumentGesture={onDocumentGesture} onDocumentPenContact={onDocumentPenContact} continuous={false} />);
    expect(canvas().onDocumentGesture).toBeUndefined();
    expect(canvas().onDocumentPenContact).toBeUndefined();
    rerender(<WhiteboardPageSurface {...baseProps} targetType="NOTEBOOK_CAMERA" targetId="personal-student" onDocumentGesture={onDocumentGesture} onDocumentPenContact={onDocumentPenContact} />);
    await ready(0, 'personal-student', 'NOTEBOOK_CAMERA');
    expect(canvas(0, 'personal-student', 'NOTEBOOK_CAMERA').onDocumentGesture).toBeUndefined();
    expect(canvas(0, 'personal-student', 'NOTEBOOK_CAMERA').onDocumentPenContact).toBeUndefined();
  });
});
