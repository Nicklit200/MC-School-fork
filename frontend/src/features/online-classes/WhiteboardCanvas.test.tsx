import { render } from '@testing-library/react';
import { createRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WhiteboardCanvas, type WhiteboardCanvasHandle } from './WhiteboardCanvas';

const mock = vi.hoisted(() => ({
  stageProps: {} as Record<string, any>, imageProps: {} as Record<string, any>, rectProps: {} as Record<string, any>,
  backgroundLayer: {}, stage: { toDataURL: vi.fn(() => 'data:image/jpeg;base64,/9j/2Q==') },
  animations: [] as { layer: unknown; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }[],
}));
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
describe('WhiteboardCanvas live background', () => {
  beforeEach(() => { vi.clearAllMocks(); mock.animations.length = 0; vi.stubGlobal('ResizeObserver', SizedObserver); });

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
