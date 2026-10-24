import { act, fireEvent, render } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { WhiteboardCanvas, type WhiteboardCanvasHandle } from './WhiteboardCanvas';
import type { CameraModule, DocumentRendererOptions, NotebookDocumentView } from '../notebook-camera/cameraModules';
import { createNotebookProjection, notebookRawToScreen, type NotebookCameraGeometry } from './notebookCameraGeometry';
import { DEFAULT_VIEW } from './boardView';

const mock = vi.hoisted(() => ({
  stageProps: {} as Record<string, any>, imageProps: {} as Record<string, any>, rectProps: {} as Record<string, any>,
  backgroundLayer: {}, stage: { toDataURL: vi.fn(() => 'data:image/jpeg;base64,/9j/2Q=='), draw: vi.fn(), getLayers: vi.fn(() => [] as any[]) },
  animations: [] as { layer: unknown; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }[],
  backend: 'pointer', nativeCallbacks: null as any, nativeConfig: null as any,
}));
vi.mock('../../lib/tabletInkInput', async () => {
  const actual = await vi.importActual<typeof import('../../lib/tabletInkInput')>('../../lib/tabletInkInput');
  return { ...actual, detectTabletInkBackend: () => mock.backend,
    attachTabletInkInput: vi.fn((_surface: HTMLElement, callbacks: import('../../lib/tabletInkInput').TabletInkCallbacks, config?: import('../../lib/tabletInkInput').TabletInkConfig) => {
      mock.nativeCallbacks = callbacks; mock.nativeConfig = config; return { destroy: vi.fn() };
    }),
  };
});
vi.mock('konva', () => ({ default: { Animation: class {
  start = vi.fn(); stop = vi.fn();
  constructor(_callback: () => void, public layer: unknown) { mock.animations.push(this); }
} } }));
vi.mock('react-konva', async () => {
  const { forwardRef, useImperativeHandle } = await import('react');
  const Node = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    Stage: forwardRef(({ children, ...props }: any, ref) => {
      mock.stageProps = props; useImperativeHandle(ref, () => mock.stage);
      return <div data-testid="stage">{children}</div>;
    }),
    Layer: forwardRef(({ children }: any, ref) => {
      useImperativeHandle(ref, () => mock.backgroundLayer);
      return <div data-testid={ref ? 'background-layer' : 'marks-layer'}>{children}</div>;
    }),
    Image: (props: any) => { mock.imageProps = props; return <div data-testid="camera-image" />; },
    Rect: (props: any) => { mock.rectProps = props; return <div data-testid="rectangle" />; },
    Arrow: Node, Circle: Node, Ellipse: Node, Line: Node, Shape: Node, Text: Node,
  };
});

class SizedObserver {
  constructor(private callback: ResizeObserverCallback) {}
  observe() { this.callback([{ contentRect: { width: 1000, height: 500 } } as ResizeObserverEntry], this as unknown as ResizeObserver); }
  disconnect() {}
}

const props = { shapes: [], tool: 'pen' as const, color: '#111111', strokeWidth: 0.004, sourceAspect: 1, onCommit: vi.fn() };
class TestPointerEvent extends MouseEvent {
  pointerId: number; pointerType: string; pressure: number; width: number; height: number;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init); this.pointerId = init.pointerId ?? 1; this.pointerType = init.pointerType ?? 'mouse';
    this.pressure = init.pressure ?? 0.5; this.width = init.width ?? 1; this.height = init.height ?? 1;
  }
}
beforeEach(() => {
  vi.clearAllMocks(); mock.animations.length = 0; mock.backend = 'pointer'; mock.nativeCallbacks = null; mock.nativeConfig = null;
  vi.stubGlobal('ResizeObserver', SizedObserver); vi.stubGlobal('PointerEvent', TestPointerEvent);
});
afterEach(() => { vi.unstubAllGlobals(); });

let cameraRuntime: CameraModule;
beforeAll(async () => {
  const path = '../../../public/notebook-camera/signal.mjs';
  cameraRuntime = await import(path);
});

function projectedNotebook(patch: Partial<NotebookDocumentView> = {}) {
  const context = { setTransform: vi.fn(), clearRect: vi.fn(), drawImage: vi.fn(), globalCompositeOperation: 'source-over' };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  const layers = ['camera', 'marks', 'selection'].map(name => {
    const canvas = document.createElement('canvas'); canvas.dataset.layer = name;
    const wrapper = { _canvas: canvas, getPixelRatio: () => 2, setPixelRatio: vi.fn() };
    return { getCanvas: () => wrapper };
  });
  mock.stage.getLayers.mockReturnValue(layers);
  const instances: { source: HTMLVideoElement; canvas: HTMLCanvasElement; setView: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }[] = [];
  const Renderer = class {
    gl = {};
    constructor(public source: HTMLVideoElement, public canvas: HTMLCanvasElement, private options: DocumentRendererOptions = {}) { instances.push(this); }
    setView = vi.fn((view: NotebookDocumentView) => {
      const map = cameraRuntime.makeDocumentMap(view, this.source.videoWidth, this.source.videoHeight);
      this.canvas.width = 960; this.canvas.height = Math.round(960 / map.aspect); this.render();
    });
    render = vi.fn(() => this.options.onFrame?.(this.canvas));
    start = vi.fn(); stop = vi.fn(); setMaxDimension = vi.fn();
  };
  const geometry: NotebookCameraGeometry = {
    rawWidth: 1920, rawHeight: 1080,
    view: { type: 'document-view', version: 1, corners: null, ratio: null, turn: 2, sourceAspect: 16 / 9, ...patch },
    renderer: { ...cameraRuntime, LiveDocumentRenderer: Renderer },
  };
  return { geometry, instances, context, layers };
}

describe('WhiteboardCanvas canonical notebook projection', () => {
  it.each([false, true])('commits pen input in raw coordinates through 180-degree or perspective projection (crop=%s)', async crop => {
    const fixture = projectedNotebook(crop ? { turn: 1, ratio: 210 / 297,
      corners: [{ x: .1, y: .1 }, { x: .9, y: .2 }, { x: .8, y: .9 }, { x: .2, y: .8 }] } : {});
    const onCommit = vi.fn().mockResolvedValue(true), view = { zoom: 2, panX: -120, panY: -80 };
    const { container } = render(<WhiteboardCanvas {...props} sourceAspect={16 / 9} notebookView={fixture.geometry} active={false}
      background={document.createElement('video')} onCommit={onCommit} view={view} />);
    const surface = container.querySelector('.whiteboard__surface')!;
    const projection = createNotebookProjection(fixture.geometry)!;
    const start = notebookRawToScreen({ x: .3, y: .4 }, projection, { width: 1000, height: 500 }, view);
    const end = notebookRawToScreen({ x: .5, y: .6 }, projection, { width: 1000, height: 500 }, view);
    await act(async () => {
      fireEvent.pointerDown(surface, { pointerType: 'pen', clientX: start.x, clientY: start.y });
      fireEvent.pointerUp(surface, { pointerType: 'pen', clientX: end.x, clientY: end.y });
    });
    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit.mock.calls[0][0]).toMatchObject({ kind: 'pen', points: [[.3, .4], [.5, .6]] });
    expect(mock.stageProps).toMatchObject({ width: 1920, height: 1080, x: 0, y: 0, scaleX: 1, scaleY: 1 });
    expect(fixture.context.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, -120, -80);
  });

  it('keeps legacy shapes on the same raw paper and warps the complete camera/marks/selection composite', () => {
    const fixture = projectedNotebook();
    const legacy = { operationId: 'legacy', layerOwnerId: 'teacher', sequence: 1,
      shape: { kind: 'rect' as const, x: .2, y: .3, w: .1, h: .1 } };
    const { getByTestId, rerender } = render(<WhiteboardCanvas {...props} sourceAspect={16 / 9} notebookView={fixture.geometry} active={false} shapes={[legacy]} />);
    const stage = getByTestId('stage');
    expect(mock.rectProps).toMatchObject({ x: 384, y: 324, width: 192, height: 108 });
    const composites = fixture.context.drawImage.mock.calls.filter(call => (call[0] as HTMLCanvasElement)?.dataset?.layer);
    expect(composites.slice(-3).map(call => (call[0] as HTMLCanvasElement).dataset.layer)).toEqual(['camera', 'marks', 'selection']);
    rerender(<WhiteboardCanvas {...props} sourceAspect={16 / 9} notebookView={{ ...fixture.geometry, view: { ...fixture.geometry.view, turn: 1 } }} active={false} shapes={[legacy]} />);
    expect(getByTestId('stage')).toBe(stage); expect(fixture.instances).toHaveLength(1);
    expect(mock.rectProps).toMatchObject({ x: 384, y: 324, width: 192, height: 108 });
    expect(fixture.instances[0].setView).toHaveBeenLastCalledWith(expect.objectContaining({ turn: 1 }));
    expect(legacy.shape).toEqual({ kind: 'rect', x: .2, y: .3, w: .1, h: .1 });
  });

  it('erases the correct owned raw stroke through perspective without touching another owner or the video layer', () => {
    const fixture = projectedNotebook({ turn: 2, ratio: 210 / 297,
      corners: [{ x: .1, y: .1 }, { x: .9, y: .2 }, { x: .8, y: .9 }, { x: .2, y: .8 }] });
    const onEraseShape = vi.fn(), onCommit = vi.fn();
    const shapes = [{ operationId: 'own', layerOwnerId: 'teacher', sequence: 1, shape: { kind: 'pen' as const, width: .02, points: [[.3, .4], [.5, .4]] as [number, number][] } },
      { operationId: 'other', layerOwnerId: 'student', sequence: 2, shape: { kind: 'pen' as const, width: .02, points: [[.3, .6], [.5, .6]] as [number, number][] } }];
    const { container } = render(<WhiteboardCanvas {...props} actorId="teacher" tool="erase" eraserMode="stroke" sourceAspect={16 / 9}
      notebookView={fixture.geometry} active={false} shapes={shapes} onEraseShape={onEraseShape} onCommit={onCommit} />);
    const projection = createNotebookProjection(fixture.geometry)!, surface = container.querySelector('.whiteboard__surface')!;
    for (const point of [{ x: .4, y: .4 }, { x: .4, y: .6 }]) {
      const at = notebookRawToScreen(point, projection, { width: 1000, height: 500 }, DEFAULT_VIEW);
      fireEvent.pointerDown(surface, { pointerId: point.y * 100, pointerType: 'pen', clientX: at.x, clientY: at.y });
      fireEvent.pointerUp(surface, { pointerId: point.y * 100, pointerType: 'pen', clientX: at.x, clientY: at.y });
    }
    expect(onEraseShape).toHaveBeenCalledExactlyOnceWith('own'); expect(onCommit).not.toHaveBeenCalled();
    expect(fixture.context.globalCompositeOperation).toBe('source-over');
  });

  it('keeps text editing anchored in presentation space but commits canonical raw text', async () => {
    const fixture = projectedNotebook({ turn: 1 }), onCommit = vi.fn().mockResolvedValue(true);
    const { container, getByRole } = render(<WhiteboardCanvas {...props} tool="text" sourceAspect={16 / 9} notebookView={fixture.geometry} active={false} onCommit={onCommit} />);
    const projection = createNotebookProjection(fixture.geometry)!;
    const at = notebookRawToScreen({ x: .3, y: .4 }, projection, { width: 1000, height: 500 }, DEFAULT_VIEW);
    fireEvent.pointerDown(container.querySelector('.whiteboard__surface')!, { pointerType: 'pen', clientX: at.x, clientY: at.y });
    const input = getByRole('textbox') as HTMLTextAreaElement;
    expect(parseFloat(input.style.left)).toBeCloseTo(at.x); expect(parseFloat(input.style.top)).toBeCloseTo(at.y);
    fireEvent.change(input, { target: { value: 'Проверка' } });
    await act(async () => { fireEvent.blur(input); });
    expect(onCommit.mock.calls[0][0]).toMatchObject({ kind: 'text', x: .3, y: .4, text: 'Проверка' });
  });

  it('exports the fully composited projected viewport and stops its sampler without losing the raw stage', () => {
    const fixture = projectedNotebook(), ref = createRef<WhiteboardCanvasHandle>();
    const snapshot = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,projected');
    const { container, unmount } = render(<WhiteboardCanvas {...props} ref={ref} sourceAspect={16 / 9} notebookView={fixture.geometry} active={false} />);
    expect(ref.current?.toDataURL('image/jpeg')).toBe('data:image/jpeg;base64,projected');
    expect(snapshot).toHaveBeenCalledWith('image/jpeg', .9); expect(mock.stage.toDataURL).not.toHaveBeenCalled();
    const output = container.querySelector<HTMLCanvasElement>('[data-notebook-projection]')!;
    expect(output.width).toBe(1000); expect(output.height).toBe(500);
    expect(ref.current?.getSize()).toEqual({ width: 1000, height: 500 });
    unmount(); expect(fixture.instances[0].stop).toHaveBeenCalledOnce();
  });
});

describe('WhiteboardCanvas live background', () => {

  it('renders video and normalized ink under the same stage zoom and pan in separate layers', () => {
    const video = document.createElement('video');
    const { getByTestId } = render(<WhiteboardCanvas {...props} background={video} backgroundLive view={{ zoom: 2, panX: -100, panY: -50 }}
      shapes={[{ operationId: 'rect', layerOwnerId: 'teacher', sequence: 1, shape: { kind: 'rect', x: 0.2, y: 0.3, w: 0.2, h: 0.1 } }]} />);
    expect(mock.stageProps).toMatchObject({ width: 1000, height: 500, x: -100, y: -50, scaleX: 2, scaleY: 2 });
    expect(mock.imageProps).toMatchObject({ image: video, x: 250, y: 0, width: 500, height: 500 });
    expect(mock.rectProps).toMatchObject({ x: 350, y: 150, width: 100, height: 50 });
    expect(getByTestId('camera-image').parentElement).toBe(getByTestId('background-layer'));
    expect(getByTestId('rectangle').parentElement).not.toBe(getByTestId('background-layer'));
    expect(mock.animations[0].layer).toBe(mock.backgroundLayer); expect(mock.animations[0].start).toHaveBeenCalledOnce();
  });

  it('stops live redraw while hidden, restarts on show/source change and releases animation on unmount', () => {
    const video = document.createElement('video'), canvas = document.createElement('canvas');
    const { rerender, unmount } = render(<WhiteboardCanvas {...props} background={video} backgroundLive />);
    const first = mock.animations[0];
    rerender(<WhiteboardCanvas {...props} background={video} backgroundLive active={false} />);
    expect(first.stop).toHaveBeenCalledOnce(); expect(mock.animations).toHaveLength(1);
    rerender(<WhiteboardCanvas {...props} background={video} backgroundLive />);
    const second = mock.animations[1]; expect(second.start).toHaveBeenCalledOnce();
    rerender(<WhiteboardCanvas {...props} background={canvas} backgroundLive />);
    expect(second.stop).toHaveBeenCalledOnce(); expect(mock.animations[2].start).toHaveBeenCalledOnce();
    unmount(); expect(mock.animations[2].stop).toHaveBeenCalledOnce();
  });

  it('keeps static PDF backgrounds still and exports the whole stage in the requested format', () => {
    const ref = createRef<WhiteboardCanvasHandle>();
    render(<WhiteboardCanvas {...props} ref={ref} background={document.createElement('canvas')} />);
    expect(mock.animations).toHaveLength(0);
    expect(ref.current?.toDataURL('image/jpeg')).toContain('data:image/jpeg');
    expect(mock.stage.toDataURL).toHaveBeenCalledWith({ pixelRatio: 1, mimeType: 'image/jpeg', quality: 0.9 });
    expect(ref.current?.getSize()).toEqual({ width: 1000, height: 500 });
  });

  it('fills the paper in the background layer using the same page geometry as its marks', () => {
    const { getByTestId } = render(<WhiteboardCanvas {...props} paperColor="#fffefa" view={{ zoom: 2, panX: -100, panY: -50 }} />);
    expect(mock.rectProps).toMatchObject({ x: 250, y: 0, width: 500, height: 500, fill: '#fffefa', listening: false });
    expect(getByTestId('rectangle').parentElement).toBe(getByTestId('background-layer'));
    expect(mock.stageProps).toMatchObject({ x: -100, y: -50, scaleX: 2, scaleY: 2 });
  });
});

describe('WhiteboardCanvas continuous scrolling', () => {
  it('reports native Pencil before new ink and releases its parent contact on end, cancellation and unmount', async () => {
    mock.backend = 'ios-touch';
    const ref = createRef<WhiteboardCanvasHandle>(), order: string[] = [];
    const onCommit = vi.fn(() => { order.push('commit'); });
    const onDraftChange = vi.fn((shape: unknown) => { if (shape) order.push('draft'); });
    const onDocumentPenContact = vi.fn((active: boolean) => {
      order.push(`pen:${active}`);
      // The parent releases its central finger gesture before this new pen
      // starts, including iPads where no pointerdown reached the parent.
      if (active) ref.current!.setDocumentNavigation!(false);
    });
    const { unmount } = render(<WhiteboardCanvas {...props} ref={ref} onDocumentGesture={vi.fn()}
      onDocumentPenContact={onDocumentPenContact} onCommit={onCommit} onDraftChange={onDraftChange} />);
    const pen = { source: 'touch', device: 'pen', inputId: 9 };
    const point = { clientX: 300, clientY: 200, pressure: .5, timeStamp: 1 };
    act(() => { ref.current!.setDocumentNavigation!(true); });
    order.length = 0;
    act(() => { mock.nativeCallbacks.onStart(point, pen); });
    expect(order).toEqual(['pen:true', 'draft']);
    await act(async () => { mock.nativeCallbacks.onEnd({ ...point, clientX: 340 }, pen, false); });
    expect(order.slice(-2)).toEqual(['commit', 'pen:false']);
    expect(onCommit).toHaveBeenCalledOnce();
    act(() => { mock.nativeCallbacks.onStart(point, pen); mock.nativeCallbacks.onEnd(point, pen, true); });
    expect(onDocumentPenContact.mock.calls.map(([active]) => active)).toEqual([true, false, true, false]);
    expect(onCommit).toHaveBeenCalledOnce();
    act(() => { mock.nativeCallbacks.onStart(point, pen); });
    unmount();
    expect(onDocumentPenContact.mock.calls.map(([active]) => active)).toEqual([true, false, true, false, true, false]);
  });

  it.each(['pointer', 'ios-touch'])('synchronously cancels %s finger ink when a cross-page document gesture takes ownership', async backend => {
    mock.backend = backend;
    const ref = createRef<WhiteboardCanvasHandle>(), onCommit = vi.fn(), onDraftChange = vi.fn(), onDocumentGesture = vi.fn();
    const { container } = render(<WhiteboardCanvas {...props} ref={ref} inputMode="finger" onCommit={onCommit}
      onDraftChange={onDraftChange} onDocumentGesture={onDocumentGesture} />);
    const surface = container.querySelector('.whiteboard__surface')!;
    const point = (x: number) => ({ clientX: x, clientY: 200, pressure: .5, timeStamp: 1 });
    const finger = { source: 'touch', device: 'finger', inputId: 1 };
    if (backend === 'pointer') fireEvent.pointerDown(surface, { pointerId: 1, pointerType: 'touch', clientX: 300, clientY: 200 });
    else act(() => mock.nativeCallbacks.onStart(point(300), finger));
    expect(onDraftChange).toHaveBeenCalledWith(expect.objectContaining({ kind: 'pen' }), expect.any(String));
    act(() => {
      ref.current!.setDocumentNavigation!(true);
      // Events in the same stack must already be blocked, without waiting for
      // the draft cancellation's React state update to render.
      fireEvent.pointerMove(surface, { pointerId: 1, pointerType: 'touch', clientX: 350, clientY: 200 });
      fireEvent.pointerUp(surface, { pointerId: 1, pointerType: 'touch', clientX: 350, clientY: 200 });
      if (backend === 'ios-touch') {
        mock.nativeCallbacks.onMove(point(350), finger);
        mock.nativeCallbacks.onEnd(point(350), finger, false);
        mock.nativeCallbacks.onStart(point(400), { ...finger, inputId: 2 });
        mock.nativeCallbacks.onGesture([{ id: 1, clientX: 300, clientY: 200 }, { id: 2, clientX: 500, clientY: 200 }]);
        mock.nativeCallbacks.onGesture([{ id: 1, clientX: 200, clientY: 200 }, { id: 2, clientX: 600, clientY: 200 }]);
      }
    });
    expect(onCommit).not.toHaveBeenCalled(); expect(onDocumentGesture).not.toHaveBeenCalled();
    expect(onDraftChange.mock.calls.at(-1)?.[0]).toBeNull();
    const cancelledCalls = onDraftChange.mock.calls.length;
    act(() => ref.current!.setDocumentNavigation!(true));
    expect(onDraftChange).toHaveBeenCalledTimes(cancelledCalls);
    await act(async () => {
      ref.current!.setDocumentNavigation!(false);
      if (backend === 'pointer') {
        fireEvent.pointerDown(surface, { pointerId: 3, pointerType: 'pen', clientX: 320, clientY: 200 });
        fireEvent.pointerUp(surface, { pointerId: 3, pointerType: 'pen', clientX: 340, clientY: 220 });
      } else {
        const pen = { source: 'touch', device: 'pen', inputId: 3 };
        mock.nativeCallbacks.onStart(point(320), pen); mock.nativeCallbacks.onEnd(point(340), pen, false);
      }
      fireEvent.pointerDown(surface, { pointerId: 4, pointerType: 'mouse', clientX: 340, clientY: 220 });
      fireEvent.pointerUp(surface, { pointerId: 4, pointerType: 'mouse', clientX: 360, clientY: 240 });
    });
    expect(onCommit).toHaveBeenCalledTimes(2);
    expect(onCommit.mock.calls.every(([shape]) => shape.kind === 'pen')).toBe(true);
  });

  it('routes Ctrl/trackpad zoom once to document coordinates and never changes the local page view', () => {
    const onDocumentGesture = vi.fn(), onScrollGesture = vi.fn(), onViewChange = vi.fn(), outerWheel = vi.fn();
    const { container } = render(<div onWheel={outerWheel}><WhiteboardCanvas {...props} onDocumentGesture={onDocumentGesture}
      onScrollGesture={onScrollGesture} onViewChange={onViewChange} /></div>);
    const surface = container.querySelector('.whiteboard__surface')!;
    const wheel = new WheelEvent('wheel', { deltaY: -20, ctrlKey: true, clientX: 300, clientY: 200, bubbles: true, cancelable: true });
    act(() => { surface.dispatchEvent(wheel); });
    expect(onDocumentGesture).toHaveBeenCalledExactlyOnceWith({ scale: Math.exp(0.2), anchor: { x: 300, y: 200 }, pan: { x: 0, y: 0 } });
    expect(wheel.defaultPrevented).toBe(true); expect(outerWheel).not.toHaveBeenCalled();
    expect(onViewChange).not.toHaveBeenCalled(); expect(onScrollGesture).not.toHaveBeenCalled();
    expect(mock.stageProps).toMatchObject({ scaleX: 1, scaleY: 1, x: 0, y: 0 });
  });

  it('keeps pointer document pinch client coordinates stable while the parent resizes and scrolls the sheet', () => {
    const onDocumentGesture = vi.fn(), onCommit = vi.fn(), onViewChange = vi.fn();
    const { container } = render(<WhiteboardCanvas {...props} onDocumentGesture={onDocumentGesture} onViewChange={onViewChange} onCommit={onCommit} />);
    const surface = container.querySelector('.whiteboard__surface')!;
    let left = 20, top = 40;
    vi.spyOn(surface, 'getBoundingClientRect').mockImplementation(() => ({ left, top, width: 1000, height: 500 } as DOMRect));
    fireEvent.pointerDown(surface, { pointerId: 1, pointerType: 'touch', clientX: 120, clientY: 240 });
    fireEvent.pointerDown(surface, { pointerId: 2, pointerType: 'touch', clientX: 320, clientY: 240 });
    fireEvent.pointerMove(surface, { pointerId: 2, pointerType: 'touch', clientX: 520, clientY: 240 });
    expect(onDocumentGesture).toHaveBeenLastCalledWith({ scale: 2, anchor: { x: 220, y: 240 }, pan: { x: 100, y: 0 } });
    left = -180; top = -60;
    fireEvent.pointerMove(surface, { pointerId: 1, pointerType: 'touch', clientX: 220, clientY: 240 });
    expect(onDocumentGesture).toHaveBeenLastCalledWith({ scale: 0.75, anchor: { x: 320, y: 240 }, pan: { x: 50, y: 0 } });
    fireEvent.pointerUp(surface, { pointerId: 2, pointerType: 'touch' }); fireEvent.pointerUp(surface, { pointerId: 1, pointerType: 'touch' });
    expect(onCommit).not.toHaveBeenCalled(); expect(onViewChange).not.toHaveBeenCalled();
  });

  it('uses the same document gesture bridge for native iPad pinch without a second page zoom', () => {
    mock.backend = 'ios-touch'; const onDocumentGesture = vi.fn(), onViewChange = vi.fn();
    render(<WhiteboardCanvas {...props} onDocumentGesture={onDocumentGesture} onViewChange={onViewChange} />);
    act(() => {
      mock.nativeCallbacks.onGesture([{ id: 1, clientX: 100, clientY: 200 }, { id: 2, clientX: 300, clientY: 200 }]);
      mock.nativeCallbacks.onGesture([{ id: 1, clientX: 100, clientY: 220 }, { id: 2, clientX: 500, clientY: 220 }]);
    });
    expect(onDocumentGesture).toHaveBeenCalledExactlyOnceWith({ scale: 2, anchor: { x: 200, y: 200 }, pan: { x: 100, y: 20 } });
    expect(onViewChange).not.toHaveBeenCalled();
  });

  it('bounds every scene and hit canvas while retaining full logical dimensions and releases hidden page backing', () => {
    const scene = { getPixelRatio: () => 2, setPixelRatio: vi.fn() }, hit = { getPixelRatio: () => 1, setPixelRatio: vi.fn() };
    const batchDraw = vi.fn();
    mock.stage.getLayers.mockReturnValue([{ getCanvas: () => scene, getHitCanvas: () => hit, batchDraw }]);
    class ZoomedObserver {
      constructor(private callback: ResizeObserverCallback) {}
      observe() { this.callback([{ contentRect: { width: 7000, height: 9900 } } as ResizeObserverEntry], this as unknown as ResizeObserver); }
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', ZoomedObserver);
    const onDocumentGesture = vi.fn(), ref = createRef<WhiteboardCanvasHandle>();
    const { rerender } = render(<WhiteboardCanvas {...props} ref={ref} onDocumentGesture={onDocumentGesture} />);
    expect(mock.stageProps).toMatchObject({ width: 7000, height: 9900, scaleX: 1, scaleY: 1 });
    const visible = scene.setPixelRatio.mock.calls.at(-1)![0];
    expect(7000 * 9900 * visible * visible).toBeLessThanOrEqual(8_000_001);
    expect(hit.setPixelRatio).toHaveBeenLastCalledWith(visible);
    ref.current!.toDataURL();
    expect(mock.stage.toDataURL).toHaveBeenLastCalledWith({ pixelRatio: visible, mimeType: 'image/png', quality: 0.9 });
    rerender(<WhiteboardCanvas {...props} ref={ref} onDocumentGesture={onDocumentGesture} active={false} />);
    const dormant = scene.setPixelRatio.mock.calls.at(-1)![0];
    expect(9900 * dormant).toBeLessThanOrEqual(512); expect(dormant).toBeLessThan(visible);
    batchDraw.mockClear();
    rerender(<WhiteboardCanvas {...props} ref={ref} onDocumentGesture={onDocumentGesture} active />);
    expect(scene.setPixelRatio).toHaveBeenLastCalledWith(visible);
    expect(batchDraw).toHaveBeenCalledOnce();
  });

  it('normalizes new ink against actual enlarged DOM dimensions after document zoom without a second page transform', async () => {
    let resize!: ResizeObserverCallback;
    class DocumentResizeObserver {
      constructor(callback: ResizeObserverCallback) { resize = callback; }
      observe() { resize([{ contentRect: { width: 1000, height: 500 } } as ResizeObserverEntry], this as unknown as ResizeObserver); }
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', DocumentResizeObserver);
    const onCommit = vi.fn(), onViewChange = vi.fn();
    const { container } = render(<WhiteboardCanvas {...props} sourceAspect={null} onDocumentGesture={vi.fn()} onCommit={onCommit} onViewChange={onViewChange} />);
    const surface = container.querySelector('.whiteboard__surface')!;
    vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({ left: 20, top: 40, width: 2000, height: 1000 } as DOMRect);
    act(() => resize([{ contentRect: { width: 2000, height: 1000 } } as ResizeObserverEntry], {} as ResizeObserver));
    await act(async () => {
      fireEvent.pointerDown(surface, { pointerId: 7, pointerType: 'pen', clientX: 620, clientY: 440 });
      fireEvent.pointerUp(surface, { pointerId: 7, pointerType: 'pen', clientX: 820, clientY: 540 });
    });
    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit.mock.calls[0][0].points[0].slice(0, 2)).toEqual([0.3, 0.4]);
    expect(onCommit.mock.calls[0][0].points.at(-1).slice(0, 2)).toEqual([0.4, 0.5]);
    expect(onViewChange).not.toHaveBeenCalled();
    expect(mock.stageProps).toMatchObject({ width: 2000, height: 1000, scaleX: 1, scaleY: 1 });
  });

  it('forwards plain wheel once, prevents native duplicate scroll and keeps Ctrl/meta wheel as page zoom', () => {
    const onScrollGesture = vi.fn(), onViewChange = vi.fn(), outerWheel = vi.fn();
    const { container } = render(<div onWheel={outerWheel}><WhiteboardCanvas {...props} onScrollGesture={onScrollGesture} onViewChange={onViewChange} /></div>);
    const surface = container.querySelector('.whiteboard__surface')!;
    const wheel = new WheelEvent('wheel', { deltaX: 4, deltaY: 60, bubbles: true, cancelable: true });
    act(() => { surface.dispatchEvent(wheel); });
    expect(onScrollGesture).toHaveBeenCalledExactlyOnceWith(4, 60); expect(wheel.defaultPrevented).toBe(true); expect(outerWheel).not.toHaveBeenCalled();
    fireEvent.wheel(surface, { deltaY: -20, ctrlKey: true, clientX: 300, clientY: 200 });
    fireEvent.wheel(surface, { deltaY: -20, metaKey: true, clientX: 300, clientY: 200 });
    expect(onScrollGesture).toHaveBeenCalledTimes(1); expect(onViewChange).toHaveBeenCalledTimes(2);
    expect(onViewChange.mock.calls[0][0].zoom).toBeGreaterThan(1);
  });

  it.each(['hand', 'middle', 'space'])('scrolls with %s mouse dragging at fit size without drawing', (mode) => {
    const onScrollGesture = vi.fn(), onCommit = vi.fn();
    const { container } = render(<WhiteboardCanvas {...props} tool={mode === 'hand' ? 'pan' : 'pen'} onCommit={onCommit} onScrollGesture={onScrollGesture} />);
    const surface = container.querySelector('.whiteboard__surface')!;
    let top = 0;
    vi.spyOn(surface, 'getBoundingClientRect').mockImplementation(() => ({ left: 0, top, width: 1000, height: 500 } as DOMRect));
    onScrollGesture.mockImplementation((_dx, dy) => { top -= dy; });
    if (mode === 'space') fireEvent.keyDown(surface, { key: ' ' });
    fireEvent.pointerDown(surface, { pointerId: 1, pointerType: 'mouse', clientX: 100, clientY: 200, button: mode === 'middle' ? 1 : 0 });
    fireEvent.pointerMove(surface, { pointerId: 1, pointerType: 'mouse', clientX: 100, clientY: 180, buttons: 1 });
    fireEvent.pointerMove(surface, { pointerId: 1, pointerType: 'mouse', clientX: 100, clientY: 160, buttons: 1 });
    fireEvent.pointerUp(surface, { pointerId: 1, pointerType: 'mouse', clientX: 100, clientY: 160 });
    expect(onScrollGesture.mock.calls).toEqual([[0, 20], [0, 20]]); expect(onCommit).not.toHaveBeenCalled();
  });

  it('uses a finger to scroll in stylus mode while a pen still commits ink', async () => {
    const onScrollGesture = vi.fn(), onCommit = vi.fn();
    const { container } = render(<WhiteboardCanvas {...props} inputMode="stylus" onCommit={onCommit} onScrollGesture={onScrollGesture} />);
    const surface = container.querySelector('.whiteboard__surface')!;
    fireEvent.pointerDown(surface, { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 200 });
    fireEvent.pointerMove(surface, { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 150 });
    fireEvent.pointerUp(surface, { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 150 });
    expect(onScrollGesture).toHaveBeenCalledExactlyOnceWith(0, 50); expect(onCommit).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.pointerDown(surface, { pointerId: 2, pointerType: 'pen', clientX: 300, clientY: 200 });
      fireEvent.pointerMove(surface, { pointerId: 2, pointerType: 'pen', clientX: 320, clientY: 220 });
      fireEvent.pointerUp(surface, { pointerId: 2, pointerType: 'pen', clientX: 320, clientY: 220 });
    });
    expect(onCommit).toHaveBeenCalledOnce(); expect(onCommit.mock.calls[0][0].kind).toBe('pen'); expect(onScrollGesture).toHaveBeenCalledTimes(1);
  });

  it('keeps one-finger drawing in finger mode and blocks navigation under follow lock', async () => {
    const onScrollGesture = vi.fn(), onCommit = vi.fn();
    const { container, rerender } = render(<WhiteboardCanvas {...props} inputMode="finger" onCommit={onCommit} onScrollGesture={onScrollGesture} />);
    const surface = container.querySelector('.whiteboard__surface')!;
    await act(async () => {
      fireEvent.pointerDown(surface, { pointerId: 1, pointerType: 'touch', clientX: 300, clientY: 200 });
      fireEvent.pointerUp(surface, { pointerId: 1, pointerType: 'touch', clientX: 310, clientY: 210 });
    });
    expect(onCommit).toHaveBeenCalledOnce(); expect(onScrollGesture).not.toHaveBeenCalled();
    rerender(<WhiteboardCanvas {...props} inputMode="stylus" navigationLocked onScrollGesture={onScrollGesture} />);
    fireEvent.wheel(surface, { deltaY: 50 });
    fireEvent.pointerDown(surface, { pointerId: 2, pointerType: 'touch', clientX: 300, clientY: 200 });
    fireEvent.pointerMove(surface, { pointerId: 2, pointerType: 'touch', clientX: 300, clientY: 100 });
    expect(onScrollGesture).not.toHaveBeenCalled();
  });

  it('routes native iOS contact translation and pinch through the same scroll/zoom API', () => {
    mock.backend = 'ios-touch'; const onScrollGesture = vi.fn(), onViewChange = vi.fn();
    render(<WhiteboardCanvas {...props} inputMode="finger" onScrollGesture={onScrollGesture} onViewChange={onViewChange} />);
    const fingers = (y: number, spread = 200) => [{ id: 1, clientX: 300, clientY: y }, { id: 2, clientX: 300 + spread, clientY: y }];
    act(() => { mock.nativeCallbacks.onGesture(fingers(300)); mock.nativeCallbacks.onGesture(fingers(260)); });
    expect(onScrollGesture).toHaveBeenCalledExactlyOnceWith(0, 40);
    act(() => { mock.nativeCallbacks.onGesture(fingers(260, 400)); });
    expect(onViewChange.mock.calls.at(-1)?.[0].zoom).toBe(2);
  });
});
