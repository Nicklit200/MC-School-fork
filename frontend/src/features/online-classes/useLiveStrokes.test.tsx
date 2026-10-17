import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_LIVE_POINTS, type ClassEvent, parseClassEvent, strokeEvent, encodeEvent } from './events';
import { capPoints, toLiveShape, useLiveStrokes } from './useLiveStrokes';

const publish = vi.fn().mockResolvedValue(undefined);
let handler: (received: { event: ClassEvent; senderIdentity: string | undefined }) => void = () => {};

vi.mock('./useClassEvents', () => ({
  useClassEvents: (_c: string, _t: string, onEvent: typeof handler) => {
    handler = onEvent;
    return { publish };
  },
}));

const line = { kind: 'pen' as const, color: '#111111', width: 0.004, points: [[0.1, 0.1], [0.2, 0.2]] as [number, number][] };

function mount(page = 0, enabled = true) {
  return renderHook(() => useLiveStrokes({ classId: 'c1', targetId: 'board-1', page, enabled }));
}

describe('live stroke packets', () => {
  it('round-trips a valid stroke', () => {
    const parsed = parseClassEvent(encodeEvent(strokeEvent('c1', 'board-1', 0, true, line)), 'c1');
    expect(parsed).toMatchObject({ type: 'stroke', active: true, page: 0 });
  });

  it('accepts a pen-up packet with no shape', () => {
    const parsed = parseClassEvent(encodeEvent(strokeEvent('c1', 'board-1', 0, false)), 'c1');
    expect(parsed).toMatchObject({ type: 'stroke', active: false });
  });

  it.each([
    ['an unknown kind', { ...line, kind: 'text' }],
    ['a colour that is not hex', { ...line, color: 'red; background:url(x)' }],
    ['a huge width', { ...line, width: 5 }],
    ['out-of-range coordinates', { ...line, points: [[9, 9]] }],
    ['too many points', { ...line, points: Array.from({ length: MAX_LIVE_POINTS + 1 }, () => [0.1, 0.1]) }],
  ])('drops a stroke with %s', (_name, shape) => {
    const event = { ...strokeEvent('c1', 'board-1', 0, true), shape };
    expect(parseClassEvent(encodeEvent(event as never), 'c1')).toBeNull();
  });

  it('drops a stroke meant for another class', () => {
    expect(parseClassEvent(encodeEvent(strokeEvent('other', 'board-1', 0, true, line)), 'c1')).toBeNull();
  });
});

describe('capPoints / toLiveShape', () => {
  it('keeps a long stroke inside the packet cap and keeps its end', () => {
    const points: [number, number][] = Array.from({ length: 5000 }, (_, i) => [i / 5000, (i % 50) / 50]);
    const capped = capPoints(points);
    expect(capped.length).toBeLessThanOrEqual(MAX_LIVE_POINTS);
    expect(capped[capped.length - 1]).toEqual(points[points.length - 1]);
  });

  it('previews strokes and shapes but never the eraser or text', () => {
    expect(toLiveShape({ kind: 'pen', color: '#d62828', width: 0.004, points: [[0, 0]] })).not.toBeNull();
    expect(toLiveShape({ kind: 'rect', color: '#d62828', width: 0.004, x: 0, y: 0, w: 0.1, h: 0.1 })).not.toBeNull();
    expect(toLiveShape({ kind: 'erase', color: '#ffffff', width: 0.01, points: [[0, 0]] })).toBeNull();
    expect(toLiveShape({ kind: 'text', color: '#111111' })).toBeNull();
  });
});

describe('useLiveStrokes', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    publish.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it("shows someone else's stroke while it is being drawn", () => {
    const { result } = mount();
    act(() => handler({ event: strokeEvent('c1', 'board-1', 0, true, line), senderIdentity: 'a|1' }));
    expect(result.current.drafts).toHaveLength(1);
    expect(result.current.drafts[0].id).toBe('a|1');
  });

  it('keeps one stroke per sender, at its latest shape', () => {
    const { result } = mount();
    act(() => handler({ event: strokeEvent('c1', 'board-1', 0, true, line), senderIdentity: 'a|1' }));
    const longer = { ...line, points: [...line.points, [0.3, 0.3]] as [number, number][] };
    act(() => handler({ event: strokeEvent('c1', 'board-1', 0, true, longer), senderIdentity: 'a|1' }));
    expect(result.current.drafts).toHaveLength(1);
    expect(result.current.drafts[0].shape.points).toHaveLength(3);
  });

  it('ignores another page, another board, anonymous senders and personal boards', () => {
    const { result } = mount(0);
    act(() => handler({ event: strokeEvent('c1', 'board-1', 4, true, line), senderIdentity: 'a|1' }));
    act(() => handler({ event: strokeEvent('c1', 'other', 0, true, line), senderIdentity: 'a|1' }));
    act(() => handler({ event: strokeEvent('c1', 'board-1', 0, true, line), senderIdentity: undefined }));
    expect(result.current.drafts).toHaveLength(0);

    const off = mount(0, false);
    act(() => handler({ event: strokeEvent('c1', 'board-1', 0, true, line), senderIdentity: 'a|1' }));
    expect(off.result.current.drafts).toHaveLength(0);
  });

  it('lets the preview linger after pen-up, then removes it', () => {
    const { result } = mount();
    act(() => handler({ event: strokeEvent('c1', 'board-1', 0, true, line), senderIdentity: 'a|1' }));
    act(() => handler({ event: strokeEvent('c1', 'board-1', 0, false), senderIdentity: 'a|1' }));
    expect(result.current.drafts).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(21_000);
    });
    expect(result.current.drafts).toHaveLength(0);
  });

  it('keeps the preview after a save notification, until its exact saved shape is rendered', () => {
    const { result } = mount();
    const strokeId = '11111111-1111-4111-8111-111111111111';
    act(() => handler({ event: strokeEvent('c1', 'board-1', 0, false, line, strokeId), senderIdentity: 'user-a|1' }));
    act(() => result.current.settle('user-a'));
    expect(result.current.drafts).toHaveLength(1);
    act(() => result.current.acknowledgeRendered(['22222222-2222-4222-8222-222222222222']));
    expect(result.current.drafts).toHaveLength(1);
    act(() => result.current.acknowledgeRendered([strokeId]));
    expect(result.current.drafts).toHaveLength(0);
  });

  it('drops a preview whose sender went quiet', () => {
    const { result } = mount();
    act(() => handler({ event: strokeEvent('c1', 'board-1', 0, true, line), senderIdentity: 'a|1' }));
    act(() => {
      vi.advanceTimersByTime(16_000);
    });
    expect(result.current.drafts).toHaveLength(0);
  });

  it('never overwrites fast consecutive strokes from one student', () => {
    const { result } = mount();
    const a = '11111111-1111-4111-8111-111111111111';
    const b = '22222222-2222-4222-8222-222222222222';
    act(() => handler({ event: strokeEvent('c1', 'board-1', 0, false, line, a), senderIdentity: 'student|ipad' }));
    act(() => handler({ event: strokeEvent('c1', 'board-1', 0, false, line, b), senderIdentity: 'student|ipad' }));
    expect(result.current.drafts).toHaveLength(2);
    act(() => result.current.acknowledgeRendered([a]));
    expect(result.current.drafts).toHaveLength(1);
    expect(result.current.drafts[0].id).toBe('student|ipad:' + b);
  });

  it('sends final geometry reliably using the same ID as the saved operation', () => {
    const { result } = mount();
    const strokeId = '11111111-1111-4111-8111-111111111111';
    act(() => result.current.sendDraft(toLiveShape(line), strokeId));
    act(() => result.current.sendDraft(toLiveShape(line), strokeId, true));
    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish.mock.calls[1][0]).toMatchObject({
      type: 'stroke', strokeId, active: false, shape: { kind: 'pen' },
    });
    expect(publish.mock.calls[1][1]).toBe(true);
  });

  it('throttles outgoing previews, sends them lossily, and announces pen-up reliably', () => {
    const { result } = mount();
    const now = vi.spyOn(performance, 'now');
    now.mockReturnValue(1000);
    result.current.sendDraft(toLiveShape(line));
    now.mockReturnValue(1010);
    result.current.sendDraft(toLiveShape(line));
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0][1]).toBe(false);

    now.mockReturnValue(1100);
    result.current.sendDraft(toLiveShape(line));
    expect(publish).toHaveBeenCalledTimes(2);

    result.current.sendDraft(null);
    expect(publish).toHaveBeenCalledTimes(3);
    expect(publish.mock.calls[2][0]).toMatchObject({ type: 'stroke', active: false });
    expect(publish.mock.calls[2][1]).toBe(true);
  });

  it('sends nothing when disabled, and no pen-up without a stroke', () => {
    const off = mount(0, false);
    off.result.current.sendDraft(toLiveShape(line));
    const on = mount();
    on.result.current.sendDraft(null);
    expect(publish).not.toHaveBeenCalled();
  });
});
