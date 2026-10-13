import { describe, expect, it } from 'vitest';
import { mergeCameraOrder, sameOrder, sortByOrder } from './cameraOrder';

const teacher = { identity: 't', isHost: true };
const student = (id: string) => ({ identity: id, isHost: false });

describe('mergeCameraOrder', () => {
  it('puts the teacher first and keeps arrival order below', () => {
    expect(mergeCameraOrder([], [student('a'), teacher, student('b')])).toEqual(['t', 'a', 'b']);
  });

  it('keeps existing order when someone new joins', () => {
    const first = mergeCameraOrder([], [teacher, student('a'), student('b')]);
    const next = mergeCameraOrder(first, [student('c'), teacher, student('b'), student('a')]);
    expect(next).toEqual(['t', 'a', 'b', 'c']);
  });

  it('removes a leaver and closes the gap without reordering the rest', () => {
    const first = mergeCameraOrder([], [teacher, student('a'), student('b'), student('c')]);
    expect(mergeCameraOrder(first, [teacher, student('c'), student('a')])).toEqual(['t', 'a', 'c']);
  });

  it('puts a late-arriving teacher first', () => {
    const first = mergeCameraOrder([], [student('a'), student('b')]);
    expect(mergeCameraOrder(first, [student('b'), teacher, student('a')])).toEqual(['t', 'a', 'b']);
  });

  it('does not depend on who is speaking', () => {
    const order = mergeCameraOrder([], [teacher, student('a'), student('b')]);
    // Speaking state is not an input at all: the same present set yields the same order.
    expect(mergeCameraOrder(order, [teacher, student('b'), student('a')])).toEqual(order);
  });
});

describe('helpers', () => {
  it('detects equal orders', () => {
    expect(sameOrder(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(sameOrder(['a', 'b'], ['b', 'a'])).toBe(false);
    expect(sameOrder(['a'], ['a', 'b'])).toBe(false);
  });

  it('sorts items by order and puts unknown ones last', () => {
    const items = [{ id: 'x' }, { id: 'b' }, { id: 'a' }];
    expect(sortByOrder(items, ['a', 'b'], (item) => item.id).map((item) => item.id)).toEqual([
      'a',
      'b',
      'x',
    ]);
  });
});
