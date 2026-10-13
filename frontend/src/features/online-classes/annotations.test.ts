import { describe, expect, it } from 'vitest';
import {
  type Operation,
  foldOperations,
  letterbox,
  thinPoints,
  toNormalized,
  toPixels,
  undoableOperations,
} from './annotations';

const TEACHER = 'teacher-1';
const STUDENT = 'student-1';

let sequence = 0;
function op(
  operationType: Operation['operationType'],
  layerOwnerId: string,
  payload: string,
  operationId = `op-${++sequence}`,
): Operation {
  return {
    operationId,
    sequence: ++sequence,
    actorId: layerOwnerId,
    layerOwnerId,
    operationType,
    payload,
  };
}

const pen = (label: string) =>
  JSON.stringify({ kind: 'pen', width: 0.004, points: [[0.1, 0.2]], text: label });

describe('coordinate mapping', () => {
  it('maps pixels to the normalized surface and back', () => {
    const viewport = { width: 800, height: 600 };

    const normalized = toNormalized({ x: 400, y: 300 }, viewport, null);
    expect(normalized).toEqual({ x: 0.5, y: 0.5 });

    expect(toPixels(normalized, viewport, null)).toEqual({ x: 400, y: 300 });
  });

  it('letterboxes a wide source inside a narrow viewport', () => {
    // A 16:9 share inside a 4:3 panel: strokes must land on the content, not
    // in the bars, or two viewers would see them in different places.
    const box = letterbox({ width: 800, height: 600 }, 16 / 9);

    expect(box.width).toBe(800);
    expect(box.height).toBeCloseTo(450);
    expect(box.top).toBeCloseTo(75);
    expect(box.left).toBe(0);
  });

  it('letterboxes a tall source inside a wide viewport', () => {
    const box = letterbox({ width: 1600, height: 600 }, 4 / 3);

    expect(box.height).toBe(600);
    expect(box.width).toBeCloseTo(800);
    expect(box.left).toBeCloseTo(400);
  });

  it('round-trips a point through a letterboxed surface', () => {
    const viewport = { width: 800, height: 600 };
    const point = { x: 0.25, y: 0.75 };

    const pixels = toPixels(point, viewport, 16 / 9);
    const back = toNormalized(pixels, viewport, 16 / 9);

    expect(back.x).toBeCloseTo(point.x);
    expect(back.y).toBeCloseTo(point.y);
  });

  it('clamps a pointer dragged outside the surface', () => {
    const viewport = { width: 800, height: 600 };

    expect(toNormalized({ x: -50, y: -50 }, viewport, null)).toEqual({ x: 0, y: 0 });
    expect(toNormalized({ x: 5000, y: 5000 }, viewport, null)).toEqual({ x: 1, y: 1 });
  });

  it('falls back to the full viewport for an unknown aspect ratio', () => {
    expect(letterbox({ width: 800, height: 600 }, null).width).toBe(800);
    expect(letterbox({ width: 800, height: 600 }, 0).height).toBe(600);
    expect(letterbox({ width: 800, height: 600 }, Number.NaN).width).toBe(800);
  });
});

describe('point thinning', () => {
  it('drops points too close together but keeps the endpoints', () => {
    const dense: [number, number][] = Array.from({ length: 100 }, (_, i) => [i * 0.0001, 0]);

    const thinned = thinPoints(dense);

    expect(thinned.length).toBeLessThan(dense.length);
    expect(thinned[0]).toEqual(dense[0]);
    expect(thinned[thinned.length - 1]).toEqual(dense[dense.length - 1]);
  });

  it('leaves a short stroke untouched', () => {
    const short: [number, number][] = [
      [0, 0],
      [1, 1],
    ];

    expect(thinPoints(short)).toEqual(short);
  });
});

describe('folding the operation stream', () => {
  it('renders shapes in sequence order', () => {
    const shapes = foldOperations([
      op('ADD', TEACHER, pen('a')),
      op('ADD', STUDENT, pen('b')),
    ]);

    expect(shapes).toHaveLength(2);
    expect(shapes[0].sequence).toBeLessThan(shapes[1].sequence);
  });

  it('is order-independent, so a replay agrees with the live view', () => {
    const first = op('ADD', TEACHER, pen('a'));
    const second = op('ADD', STUDENT, pen('b'));

    const inOrder = foldOperations([first, second]);
    const shuffled = foldOperations([second, first]);

    expect(shuffled.map((s) => s.operationId)).toEqual(inOrder.map((s) => s.operationId));
  });

  it('clears only the actor’s own layer', () => {
    const mine = op('ADD', TEACHER, pen('a'));
    const theirs = op('ADD', STUDENT, pen('b'));

    const shapes = foldOperations([mine, theirs, op('CLEAR_LAYER', TEACHER, '{}')]);

    expect(shapes).toHaveLength(1);
    expect(shapes[0].layerOwnerId).toBe(STUDENT);
  });

  it('clears everything for a clear-all', () => {
    const shapes = foldOperations([
      op('ADD', TEACHER, pen('a')),
      op('ADD', STUDENT, pen('b')),
      op('CLEAR_ALL', TEACHER, '{}'),
    ]);

    expect(shapes).toEqual([]);
  });

  it('undoes the actor’s own operation', () => {
    const mine = op('ADD', TEACHER, pen('a'), 'op-mine');

    const shapes = foldOperations([
      mine,
      op('UNDO', TEACHER, JSON.stringify({ targetOperationId: 'op-mine' })),
    ]);

    expect(shapes).toEqual([]);
  });

  it('refuses to undo another participant’s work', () => {
    const theirs = op('ADD', STUDENT, pen('b'), 'op-theirs');

    // Even though the payload names their operation, the undo is attributed to
    // the teacher's layer and must not take effect.
    const shapes = foldOperations([
      theirs,
      op('UNDO', TEACHER, JSON.stringify({ targetOperationId: 'op-theirs' })),
    ]);

    expect(shapes).toHaveLength(1);
    expect(shapes[0].operationId).toBe('op-theirs');
  });

  it('redoes a previously undone operation', () => {
    const mine = op('ADD', TEACHER, pen('a'), 'op-mine');

    const shapes = foldOperations([
      mine,
      op('UNDO', TEACHER, JSON.stringify({ targetOperationId: 'op-mine' })),
      op('REDO', TEACHER, JSON.stringify({ targetOperationId: 'op-mine' })),
    ]);

    expect(shapes).toHaveLength(1);
    expect(shapes[0].operationId).toBe('op-mine');
  });

  it('ignores a redo for something that was never undone', () => {
    const shapes = foldOperations([
      op('ADD', TEACHER, pen('a'), 'op-mine'),
      op('REDO', TEACHER, JSON.stringify({ targetOperationId: 'op-mine' })),
    ]);

    expect(shapes).toHaveLength(1);
  });

  it('ignores malformed payloads rather than breaking the board', () => {
    const shapes = foldOperations([
      op('ADD', TEACHER, '{not json'),
      op('UNDO', TEACHER, '{not json'),
      op('ADD', TEACHER, pen('a')),
    ]);

    expect(shapes).toHaveLength(1);
  });
});

describe('undoable operations', () => {
  it('offers only the actor’s own visible operations', () => {
    const mine = op('ADD', TEACHER, pen('a'), 'op-mine');
    const theirs = op('ADD', STUDENT, pen('b'), 'op-theirs');

    const undoable = undoableOperations([mine, theirs], TEACHER);

    expect(undoable.map((o) => o.operationId)).toEqual(['op-mine']);
  });

  it('does not offer an already-undone operation again', () => {
    const mine = op('ADD', TEACHER, pen('a'), 'op-mine');
    const undo = op('UNDO', TEACHER, JSON.stringify({ targetOperationId: 'op-mine' }));

    expect(undoableOperations([mine, undo], TEACHER)).toEqual([]);
  });
});

describe('UPDATE that targets an existing shape', () => {
  const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

  it('moves the shape in place, keeping its z-order', () => {
    const ops = [
      op('ADD', TEACHER, JSON.stringify({ kind: 'rect', x: 0.1, y: 0.1, w: 0.2, h: 0.2 }), id(1)),
      op('ADD', TEACHER, JSON.stringify({ kind: 'rect', x: 0.5, y: 0.5, w: 0.1, h: 0.1 }), id(2)),
      op(
        'UPDATE',
        TEACHER,
        JSON.stringify({ kind: 'rect', x: 0.3, y: 0.3, w: 0.2, h: 0.2, targetOperationId: id(1) }),
      ),
    ];
    const shapes = foldOperations(ops);
    expect(shapes.map((entry) => entry.operationId)).toEqual([id(1), id(2)]);
    expect(shapes[0].shape.x).toBe(0.3);
  });

  it('cannot move another participant\'s shape', () => {
    const ops = [
      op('ADD', STUDENT, JSON.stringify({ kind: 'rect', x: 0.1, y: 0.1, w: 0.2, h: 0.2 }), id(1)),
      op(
        'UPDATE',
        TEACHER,
        JSON.stringify({ kind: 'rect', x: 0.9, y: 0.9, w: 0.05, h: 0.05, targetOperationId: id(1) }),
      ),
    ];
    expect(foldOperations(ops)[0].shape.x).toBe(0.1);
  });

  it('ignores a target that does not exist', () => {
    const ops = [
      op('UPDATE', TEACHER, JSON.stringify({ kind: 'rect', x: 0.3, y: 0.3, w: 0.1, h: 0.1, targetOperationId: id(9) })),
    ];
    expect(foldOperations(ops)).toEqual([]);
  });

  it('still behaves as an add when no target is named', () => {
    const ops = [op('UPDATE', TEACHER, JSON.stringify({ kind: 'rect', x: 0.3, y: 0.3, w: 0.1, h: 0.1 }))];
    expect(foldOperations(ops)).toHaveLength(1);
  });

  it('redo after undo restores the moved geometry, not the original', () => {
    const ops = [
      op('ADD', TEACHER, JSON.stringify({ kind: 'rect', x: 0.1, y: 0.1, w: 0.2, h: 0.2 }), id(1)),
      op('UPDATE', TEACHER, JSON.stringify({ kind: 'rect', x: 0.4, y: 0.4, w: 0.2, h: 0.2, targetOperationId: id(1) })),
      op('UNDO', TEACHER, JSON.stringify({ targetOperationId: id(1) })),
      op('REDO', TEACHER, JSON.stringify({ targetOperationId: id(1) })),
    ];
    expect(foldOperations(ops)[0].shape.x).toBe(0.4);
  });
});

describe('undoing a move', () => {
  const id = (n: number) => `00000000-0000-4000-8000-00000000010${n}`;
  const rect = (x: number) => JSON.stringify({ kind: 'rect', x, y: 0.1, w: 0.1, h: 0.1 });
  const moved = (x: number, target: string) =>
    JSON.stringify({ kind: 'rect', x, y: 0.1, w: 0.1, h: 0.1, targetOperationId: target });

  it('offers the move as the newest undoable step', () => {
    const add = op('ADD', TEACHER, rect(0.1), id(1));
    const move = op('UPDATE', TEACHER, moved(0.5, id(1)), id(2));
    const steps = undoableOperations([add, move], TEACHER);
    expect(steps[steps.length - 1].operationId).toBe(id(2));
  });

  it('puts the shape back instead of deleting it', () => {
    const ops = [
      op('ADD', TEACHER, rect(0.1), id(1)),
      op('UPDATE', TEACHER, moved(0.5, id(1)), id(2)),
      op('UNDO', TEACHER, JSON.stringify({ targetOperationId: id(2) })),
    ];
    const shapes = foldOperations(ops);
    expect(shapes).toHaveLength(1);
    expect(shapes[0].shape.x).toBe(0.1);
  });

  it('undoes several moves one at a time, newest first', () => {
    const ops = [
      op('ADD', TEACHER, rect(0.1), id(1)),
      op('UPDATE', TEACHER, moved(0.3, id(1)), id(2)),
      op('UPDATE', TEACHER, moved(0.6, id(1)), id(3)),
      op('UNDO', TEACHER, JSON.stringify({ targetOperationId: id(3) })),
    ];
    expect(foldOperations(ops)[0].shape.x).toBe(0.3);
    ops.push(op('UNDO', TEACHER, JSON.stringify({ targetOperationId: id(2) })));
    expect(foldOperations(ops)[0].shape.x).toBe(0.1);
    // Nothing of that shape's moves remains to undo; the drawing itself still can be.
    expect(undoableOperations(ops, TEACHER).map((o) => o.operationId)).toEqual([id(1)]);
  });

  it('redo re-applies an undone move', () => {
    const ops = [
      op('ADD', TEACHER, rect(0.1), id(1)),
      op('UPDATE', TEACHER, moved(0.5, id(1)), id(2)),
      op('UNDO', TEACHER, JSON.stringify({ targetOperationId: id(2) })),
      op('REDO', TEACHER, JSON.stringify({ targetOperationId: id(2) })),
    ];
    expect(foldOperations(ops)[0].shape.x).toBe(0.5);
  });

  it('cannot undo someone else’s move', () => {
    const ops = [
      op('ADD', STUDENT, rect(0.1), id(1)),
      op('UPDATE', STUDENT, moved(0.5, id(1)), id(2)),
      op('UNDO', TEACHER, JSON.stringify({ targetOperationId: id(2) })),
    ];
    expect(foldOperations(ops)[0].shape.x).toBe(0.5);
  });
});
