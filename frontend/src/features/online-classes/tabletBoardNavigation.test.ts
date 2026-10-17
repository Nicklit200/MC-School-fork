import { describe, expect, it } from 'vitest';
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
