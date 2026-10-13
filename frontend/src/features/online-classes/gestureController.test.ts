import { beforeEach, describe, expect, it } from 'vitest';
import type { PageView } from './boardView';
import { GestureController } from './gestureController';
import type { InputMode } from './inputPolicy';

const board = { width: 800, height: 600 };

function setup(mode: InputMode = 'stylus', locked = false) {
  const state = { mode, locked, view: { zoom: 1, panX: 0, panY: 0 } as PageView };
  const controller = new GestureController({
    mode: () => state.mode,
    view: () => state.view,
    board: () => board,
    locked: () => state.locked,
  });
  return { controller, state };
}

const types = (intents: { type: string }[]) => intents.map((intent) => intent.type);

describe('stylus mode', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup('stylus');
  });

  it('draws with the pen', () => {
    expect(types(ctx.controller.down(1, 'pen', { x: 10, y: 10 }))).toEqual(['stroke-start']);
    expect(types(ctx.controller.move(1, { x: 20, y: 20 }))).toEqual(['stroke-move']);
    expect(types(ctx.controller.up(1))).toEqual(['stroke-end']);
  });

  it('never draws with a finger — it pans the canvas instead', () => {
    ctx.state.view = { zoom: 2, panX: -100, panY: -100 };
    expect(ctx.controller.down(1, 'touch', { x: 100, y: 100 })).toEqual([]);
    const moved = ctx.controller.move(1, { x: 130, y: 120 });
    expect(types(moved)).toEqual(['view']);
    expect(moved[0]).toMatchObject({ view: { zoom: 2, panX: -70, panY: -80 } });
  });

  it('ignores a palm that lands while the pen is writing', () => {
    ctx.controller.down(1, 'pen', { x: 10, y: 10 });
    expect(ctx.controller.down(2, 'touch', { x: 300, y: 300 })).toEqual([]);
    expect(ctx.controller.move(2, { x: 310, y: 310 })).toEqual([]);
    // The pen stroke is untouched.
    expect(types(ctx.controller.move(1, { x: 12, y: 12 }))).toEqual(['stroke-move']);
    expect(types(ctx.controller.up(1))).toEqual(['stroke-end']);
  });

  it('ignores a contact the browser reports as a palm', () => {
    expect(ctx.controller.down(1, 'touch', { x: 5, y: 5 }, true)).toEqual([]);
    expect(ctx.controller.move(1, { x: 50, y: 50 })).toEqual([]);
  });
});

describe('finger mode', () => {
  it('draws with one finger', () => {
    const { controller } = setup('finger');
    expect(types(controller.down(1, 'touch', { x: 10, y: 10 }))).toEqual(['stroke-start']);
    expect(types(controller.move(1, { x: 20, y: 20 }))).toEqual(['stroke-move']);
    expect(types(controller.up(1))).toEqual(['stroke-end']);
  });

  it('cancels the stroke when a second finger lands and zooms instead', () => {
    const { controller } = setup('finger');
    controller.down(1, 'touch', { x: 300, y: 300 });
    controller.move(1, { x: 305, y: 300 });
    const second = controller.down(2, 'touch', { x: 500, y: 300 });
    expect(types(second)).toEqual(['stroke-cancel']);

    const moved = controller.move(2, { x: 600, y: 300 });
    expect(types(moved)).toEqual(['view']);
    expect((moved[0] as { view: PageView }).view.zoom).toBeGreaterThan(1);
  });

  it('does not start drawing with the leftover finger after a pinch', () => {
    const { controller } = setup('finger');
    controller.down(1, 'touch', { x: 300, y: 300 });
    controller.down(2, 'touch', { x: 500, y: 300 });
    controller.up(2);
    expect(types(controller.move(1, { x: 320, y: 300 }))).toEqual(['view']);
    expect(controller.isDrawing).toBe(false);
    controller.up(1);
    // After everything lifts, a fresh finger draws again.
    expect(types(controller.down(3, 'touch', { x: 10, y: 10 }))).toEqual(['stroke-start']);
  });
});

describe('mouse and cancellation', () => {
  it('a mouse draws in either mode', () => {
    for (const mode of ['stylus', 'finger'] as const) {
      const { controller } = setup(mode);
      expect(types(controller.down(1, 'mouse', { x: 1, y: 1 }))).toEqual(['stroke-start']);
      controller.up(1);
    }
  });

  it('turns a browser pointercancel into a stroke-cancel', () => {
    const { controller } = setup('stylus');
    controller.down(1, 'pen', { x: 1, y: 1 });
    expect(types(controller.up(1, true))).toEqual(['stroke-cancel']);
  });
});

describe('locked navigation (student following the teacher)', () => {
  it('emits no view changes while locked', () => {
    const { controller } = setup('stylus', true);
    controller.down(1, 'touch', { x: 100, y: 100 });
    controller.down(2, 'touch', { x: 200, y: 100 });
    expect(controller.move(2, { x: 400, y: 100 })).toEqual([]);
  });

  it('still lets the pen draw while locked', () => {
    const { controller } = setup('stylus', true);
    expect(types(controller.down(1, 'pen', { x: 1, y: 1 }))).toEqual(['stroke-start']);
  });
});

describe('mouse navigation (middle button / space)', () => {
  it('pans instead of drawing when navigation is forced', () => {
    const { controller, state } = setup('stylus');
    state.view = { zoom: 2, panX: -100, panY: -100 };
    expect(controller.down(1, 'mouse', { x: 200, y: 200 }, false, true)).toEqual([]);
    const moved = controller.move(1, { x: 230, y: 210 });
    expect(types(moved)).toEqual(['view']);
    expect(moved[0]).toMatchObject({ view: { panX: -70, panY: -90 } });
    expect(controller.up(1)).toEqual([]);
    expect(types(controller.down(2, 'mouse', { x: 1, y: 1 }))).toEqual(['stroke-start']);
  });

  it('respects the navigation lock', () => {
    const { controller } = setup('stylus', true);
    controller.down(1, 'mouse', { x: 200, y: 200 }, false, true);
    expect(controller.move(1, { x: 300, y: 300 })).toEqual([]);
  });
});

describe('pen versus a moving finger', () => {
  it('starts inking even while a finger is panning the canvas', () => {
    const { controller } = setup('stylus');
    controller.down(1, 'touch', { x: 100, y: 100 });
    controller.move(1, { x: 120, y: 120 });
    expect(types(controller.down(2, 'pen', { x: 50, y: 50 }))).toEqual(['stroke-start']);
    // The finger no longer moves the canvas while the pen is writing.
    expect(controller.move(1, { x: 160, y: 160 })).toEqual([]);
    expect(types(controller.up(2))).toEqual(['stroke-end']);
  });

  it('also pre-empts a two-finger pinch', () => {
    const { controller } = setup('stylus');
    controller.down(1, 'touch', { x: 100, y: 100 });
    controller.down(2, 'touch', { x: 300, y: 100 });
    expect(types(controller.down(3, 'pen', { x: 50, y: 50 }))).toEqual(['stroke-start']);
  });
});
