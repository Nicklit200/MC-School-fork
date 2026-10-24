import { describe, expect, it, vi } from 'vitest';
import { TabletBoardNavigation } from './tabletBoardNavigation';
import type { PageView } from './boardView';
import type { TabletInkContact } from '../../lib/tabletInkInput';

const board = { width: 800, height: 600 };
const view: PageView = { zoom: 1, panX: 0, panY: 0 };
const location = { left: 20, top: 40 };
const finger = (id: number, x: number, y: number): TabletInkContact =>
  ({ id, clientX: x + location.left, clientY: y + location.top });
const enabled = { locked: false, allowOneFingerPan: true };

describe('native iPad two-finger whiteboard navigation', () => {
  it('pans with two fingers even in finger-drawing mode, without drawing', () => {
    const gesture = new TabletBoardNavigation();
    const zoomed = { zoom: 2, panX: -300, panY: -150 };
    expect(gesture.update([finger(1, 100, 200), finger(2, 300, 200)],
      location, zoomed, board, { ...enabled, allowOneFingerPan: false })).toBeNull();
    const changed = gesture.update([finger(1, 160, 240), finger(2, 360, 240)],
      location, zoomed, board, { ...enabled, allowOneFingerPan: false })!;
    expect(changed.zoom).toBe(2);
    expect(changed.panX).toBe(-240);
    expect(changed.panY).toBe(-110);
  });

  it('pinch zooms around the midpoint while moving the fingers', () => {
    const gesture = new TabletBoardNavigation();
    gesture.update([finger(1, 300, 300), finger(2, 500, 300)], location, view, board, enabled);
    const changed = gesture.update([finger(1, 200, 300), finger(2, 600, 300)],
      location, view, board, enabled)!;
    expect(changed.zoom).toBe(2);
    expect(changed.panX).toBe(-400);
    expect(changed.panY).toBe(-300);
  });

  it('does not jump when WebKit reorders touch identifiers', () => {
    const gesture = new TabletBoardNavigation();
    gesture.update([finger(7, 300, 300), finger(9, 500, 300)], location, view, board, enabled);
    const changed = gesture.update([finger(9, 600, 300), finger(7, 200, 300)],
      location, view, board, enabled)!;
    expect(changed.zoom).toBe(2);
    expect(changed.panX).toBe(-400);
  });

  it('respects follow-teacher lock and does not leak gestures between pages', () => {
    const gesture = new TabletBoardNavigation();
    gesture.update([finger(1, 100, 200), finger(2, 300, 200)], location, view, board, enabled);
    expect(gesture.update([finger(1, 50, 200), finger(2, 350, 200)],
      location, view, board, { ...enabled, locked: true })).toBeNull();
    expect(gesture.update([finger(1, 50, 200), finger(2, 350, 200)],
      location, view, board, enabled)).toBeNull();
  });

  it('one finger pans in Pencil mode, and is ignored in finger-draw mode', () => {
    const gesture = new TabletBoardNavigation();
    const zoomed = { zoom: 2, panX: -300, panY: -150 };
    expect(gesture.update([finger(1, 100, 200)], location, zoomed, board, enabled)).toBeNull();
    const changed = gesture.update([finger(1, 150, 200)], location, zoomed, board, enabled)!;
    expect(changed.panX).toBe(-250);
    expect(gesture.update([finger(1, 170, 200)], location, zoomed, board,
      { ...enabled, allowOneFingerPan: false })).toBeNull();
  });

  it('resets pinch origin after a finger lifts', () => {
    const gesture = new TabletBoardNavigation();
    gesture.update([finger(1, 300, 300), finger(2, 500, 300)], location, view, board, enabled);
    expect(gesture.update([], location, view, board, enabled)).toBeNull();
    expect(gesture.update([finger(3, 300, 300), finger(4, 500, 300)],
      location, view, board, enabled)).toBeNull();
  });
});

describe('native iPad continuous document navigation', () => {
  it('reports incremental document pinch around client coordinates despite reordered touches and a moving sheet', () => {
    const gesture = new TabletBoardNavigation(), onDocumentGesture = vi.fn(), onScrollGesture = vi.fn();
    const options = { ...enabled, onDocumentGesture, onScrollGesture };
    gesture.update([finger(1, 100, 200), finger(2, 300, 200)], location, view, board, options);
    expect(gesture.update([finger(2, 500, 200), finger(1, 100, 200)], location, view, board, options)).toBeNull();
    expect(onDocumentGesture).toHaveBeenLastCalledWith({ scale: 2, anchor: { x: 220, y: 240 }, pan: { x: 100, y: 0 } });
    expect(gesture.update([finger(1, 200, 200), finger(2, 500, 200)], { left: -180, top: -60 }, view, board, options)).toBeNull();
    expect(onDocumentGesture).toHaveBeenLastCalledWith({ scale: 0.75, anchor: { x: 320, y: 240 }, pan: { x: 50, y: 0 } });
    expect(onScrollGesture).not.toHaveBeenCalled();
    gesture.update([], location, view, board, options);
    gesture.update([finger(3, 100, 200)], location, { zoom: 3, panX: -200, panY: -100 }, board, options);
    expect(gesture.update([finger(3, 100, 170)], location, view, board, options)).toBeNull();
    expect(onScrollGesture).toHaveBeenCalledExactlyOnceWith(0, 30);
  });

  it('does not emit document gestures under follow lock or continue stale pinch after unlock', () => {
    const gesture = new TabletBoardNavigation(), onDocumentGesture = vi.fn();
    const options = { ...enabled, onDocumentGesture };
    gesture.update([finger(1, 100, 200), finger(2, 300, 200)], location, view, board, options);
    gesture.update([finger(1, 0, 200), finger(2, 400, 200)], location, view, board, { ...options, locked: true });
    gesture.update([finger(1, 0, 200), finger(2, 400, 200)], location, view, board, options);
    expect(onDocumentGesture).not.toHaveBeenCalled();
  });

  it('scrolls at fit size and does not amplify movement when the sheet moves under the finger', () => {
    const gesture = new TabletBoardNavigation(), onScrollGesture = vi.fn();
    const options = { ...enabled, onScrollGesture };
    gesture.update([finger(1, 100, 200)], location, view, board, options);
    gesture.update([finger(1, 100, 170)], location, view, board, options);
    gesture.update([finger(1, 100, 150)], { ...location, top: location.top - 30 }, view, board, options);
    expect(onScrollGesture.mock.calls).toEqual([[0, 30], [0, 20]]);
  });

  it('uses two fingers to scroll in finger mode and preserves pinch zoom', () => {
    const gesture = new TabletBoardNavigation(), onScrollGesture = vi.fn();
    const options = { locked: false, allowOneFingerPan: false, onScrollGesture };
    gesture.update([finger(1, 300, 300), finger(2, 500, 300)], location, view, board, options);
    expect(gesture.update([finger(1, 300, 260), finger(2, 500, 260)], location, view, board, options)?.zoom).toBe(1);
    expect(onScrollGesture).toHaveBeenCalledExactlyOnceWith(0, 40);
    const zoomed = gesture.update([finger(1, 200, 260), finger(2, 600, 260)], location, view, board, options)!;
    expect(zoomed.zoom).toBe(2);
  });

  it('blocks scrolling while locked and starts a fresh contact origin after release', () => {
    const gesture = new TabletBoardNavigation(), onScrollGesture = vi.fn();
    const options = { ...enabled, onScrollGesture };
    gesture.update([finger(1, 100, 200)], location, view, board, options);
    gesture.update([finger(1, 100, 150)], location, view, board, { ...options, locked: true });
    expect(onScrollGesture).not.toHaveBeenCalled();
    expect(gesture.update([finger(1, 100, 150)], location, view, board, options)).toBeNull();
  });
});
