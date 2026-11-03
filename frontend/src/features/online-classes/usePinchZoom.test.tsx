import { useRef } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePinchZoom } from './usePinchZoom';

let frames: Map<number, FrameRequestCallback>, sequence: number;
function flushFrame() {
  act(() => {
    const pending = [...frames.values()]; frames.clear();
    pending.forEach(callback => callback(0));
  });
}
function Harness({ zoom = 1, scope = 'a', onZoom }: { zoom?: number; scope?: string; onZoom: ReturnType<typeof vi.fn> }) {
  const ref = useRef<HTMLDivElement>(null);
  usePinchZoom(ref, zoom, onZoom, 1, 3, scope);
  return <div ref={ref} data-testid="scroll" />;
}
function touch(type: string, x: number, y: number, distance: number, count = 2) {
  const points = count ? [{ clientX: x - distance / 2, clientY: y }, { clientX: x + distance / 2, clientY: y }].slice(0, count) : [];
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', { value: { length: points.length, item: (index: number) => points[index] } });
  fireEvent(screen.getByTestId('scroll'), event);
  return event;
}
function safari(type: string, scale: number, x = 170, y = 220) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { scale, clientX: x, clientY: y });
  fireEvent(screen.getByTestId('scroll'), event);
  return event;
}

describe('PDF pinch gestures', () => {
  beforeEach(() => {
    frames = new Map(); sequence = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++sequence, callback); return sequence; });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('composes continuous touch zoom and moving midpoint into one frame without rounding', () => {
    const onZoom = vi.fn(); render(<Harness onZoom={onZoom} />);
    expect(touch('touchstart', 150, 200, 100).defaultPrevented).toBe(true);
    touch('touchmove', 160, 210, 123);
    touch('touchmove', 180, 240, 137);
    expect(onZoom).not.toHaveBeenCalled();
    flushFrame();
    expect(onZoom).toHaveBeenCalledExactlyOnceWith(1.37, {
      from: { clientX: 150, clientY: 200 }, to: { clientX: 180, clientY: 240 },
    });
    touch('touchmove', 200, 250, 137); flushFrame();
    expect(onZoom).toHaveBeenLastCalledWith(1.37, {
      from: { clientX: 180, clientY: 240 }, to: { clientX: 200, clientY: 250 },
    });
  });

  it('still pans at the maximum zoom, flushes the last move on touch end and leaves one finger native', () => {
    const onZoom = vi.fn(); render(<Harness zoom={3} onZoom={onZoom} />);
    expect(touch('touchstart', 100, 200, 100, 1).defaultPrevented).toBe(false);
    touch('touchstart', 100, 200, 100);
    touch('touchmove', 120, 230, 200);
    touch('touchend', 0, 0, 0, 0);
    expect(onZoom).toHaveBeenCalledExactlyOnceWith(3, {
      from: { clientX: 100, clientY: 200 }, to: { clientX: 120, clientY: 230 },
    });
    expect(touch('touchmove', 110, 210, 100, 1).defaultPrevented).toBe(false);
    expect(frames.size).toBe(0);
  });

  it('composes trackpad deltas before a React commit and ignores ordinary scrolling', () => {
    const onZoom = vi.fn(); render(<Harness onZoom={onZoom} />);
    const scroll = screen.getByTestId('scroll');
    const ordinary = new WheelEvent('wheel', { deltaY: 60, bubbles: true, cancelable: true });
    fireEvent(scroll, ordinary); expect(ordinary.defaultPrevented).toBe(false);
    const first = new WheelEvent('wheel', { deltaY: -10, ctrlKey: true, clientX: 150, clientY: 220, bubbles: true, cancelable: true });
    fireEvent(scroll, first); expect(first.defaultPrevented).toBe(true);
    fireEvent.wheel(scroll, { deltaY: -10, ctrlKey: true, clientX: 150, clientY: 220 });
    flushFrame();
    expect(onZoom.mock.calls[0][0]).toBeCloseTo(Math.exp(.04), 10);
    expect(onZoom.mock.calls[0][1]).toEqual({ from: { clientX: 150, clientY: 220 }, to: { clientX: 150, clientY: 220 } });
  });

  it('keeps pending wheel intent when a previous frame commits during the next burst', () => {
    const onZoom = vi.fn(), view = render(<Harness onZoom={onZoom} />);
    fireEvent.wheel(screen.getByTestId('scroll'), { deltaY: -10, ctrlKey: true }); flushFrame();
    fireEvent.wheel(screen.getByTestId('scroll'), { deltaY: -10, ctrlKey: true });
    view.rerender(<Harness zoom={Math.exp(.02)} onZoom={onZoom} />);
    fireEvent.wheel(screen.getByTestId('scroll'), { deltaY: -10, ctrlKey: true }); flushFrame();
    expect(onZoom.mock.lastCall![0]).toBeCloseTo(Math.exp(.06), 10);
  });

  it.each(['touch', 'safari'])('starts %s from the latest wheel intent while an older React frame commits', mode => {
    const onZoom = vi.fn(), view = render(<Harness onZoom={onZoom} />);
    fireEvent.wheel(screen.getByTestId('scroll'), { deltaY: -10, ctrlKey: true }); flushFrame();
    fireEvent.wheel(screen.getByTestId('scroll'), { deltaY: -10, ctrlKey: true });
    view.rerender(<Harness zoom={Math.exp(.02)} onZoom={onZoom} />);
    if (mode === 'touch') {
      touch('touchstart', 150, 220, 100); touch('touchmove', 150, 220, 125);
    } else {
      safari('gesturestart', 1, 150, 220); safari('gesturechange', 1.25, 150, 220);
    }
    flushFrame();
    expect(onZoom.mock.lastCall![0]).toBeCloseTo(Math.exp(.04) * 1.25, 10);
    expect(onZoom.mock.lastCall![1]).toEqual({ from: { clientX: 150, clientY: 220 }, to: { clientX: 150, clientY: 220 } });
  });

  it('normalizes line-mode wheel and respects bounds', () => {
    const onZoom = vi.fn(); render(<Harness onZoom={onZoom} />);
    fireEvent.wheel(screen.getByTestId('scroll'), { deltaY: -1, deltaMode: 1, ctrlKey: true }); flushFrame();
    expect(onZoom.mock.lastCall![0]).toBeCloseTo(Math.exp(.032), 10);
    for (let index = 0; index < 20; index++) fireEvent.wheel(screen.getByTestId('scroll'), { deltaY: -1000, ctrlKey: true });
    flushFrame(); expect(onZoom.mock.lastCall![0]).toBe(3);
  });

  it('supports Safari scale and centroid while suppressing duplicate touch gestures', () => {
    const onZoom = vi.fn(); render(<Harness zoom={2} onZoom={onZoom} />);
    expect(safari('gesturestart', 1).defaultPrevented).toBe(true);
    safari('gesturechange', 1.25, 190, 250); safari('gestureend', 1.25);
    expect(onZoom).toHaveBeenCalledExactlyOnceWith(2.5, {
      from: { clientX: 170, clientY: 220 }, to: { clientX: 190, clientY: 250 },
    });
    onZoom.mockClear();
    touch('touchstart', 100, 200, 100); safari('gesturestart', 1);
    touch('touchmove', 100, 200, 125); safari('gesturechange', 1.25); flushFrame();
    expect(onZoom).toHaveBeenCalledTimes(1);
    expect(onZoom.mock.lastCall![0]).toBe(3);
  });

  it('cancels a queued old page or document gesture and releases listeners on unmount', () => {
    const onZoom = vi.fn(), view = render(<Harness onZoom={onZoom} />);
    const old = screen.getByTestId('scroll');
    touch('touchstart', 100, 200, 100); touch('touchmove', 100, 200, 150);
    view.rerender(<Harness scope="another-document-page" onZoom={onZoom} />); flushFrame();
    expect(onZoom).not.toHaveBeenCalled();
    touch('touchstart', 100, 200, 100); touch('touchmove', 100, 200, 150);
    view.unmount(); flushFrame();
    expect(onZoom).not.toHaveBeenCalled();
    expect(old.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, cancelable: true }))).toBe(true);
  });
});
