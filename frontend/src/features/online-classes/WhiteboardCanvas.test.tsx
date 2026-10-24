import { act, fireEvent, render } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WhiteboardCanvas, type WhiteboardCanvasHandle } from './WhiteboardCanvas';

const mock = vi.hoisted(() => ({
  stageProps: {} as Record<string, any>, imageProps: {} as Record<string, any>, rectProps: {} as Record<string, any>,
  backgroundLayer: {}, stage: { toDataURL: vi.fn(() => 'data:image/jpeg;base64,/9j/2Q==') },
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
