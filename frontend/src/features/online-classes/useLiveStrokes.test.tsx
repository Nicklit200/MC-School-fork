import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_LIVE_POINTS, NOTEBOOK_STROKE_TOPIC, STROKE_TOPIC, type ClassEvent, parseClassEvent, strokeEvent, encodeEvent } from './events';
import { capPoints, toLiveShape, useLiveStrokes } from './useLiveStrokes';
import type { AnnotationTargetType } from '../../api/onlineClasses';

const publish = vi.fn().mockResolvedValue(undefined);
let handler: (received: { event: ClassEvent; senderIdentity: string | undefined }) => void = () => {};
const topicHandlers = new Map<string, typeof handler>();

vi.mock('./useClassEvents', () => ({
  useClassEvents: (_c: string, topic: string, onEvent: typeof handler) => {
    handler = onEvent;
    topicHandlers.set(topic, onEvent);
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

  it('keeps every short pen sample and pressure exactly as seen before saving', () => {
    const points: [number, number][] = [
      [0.1111, 0.4444], [0.1112, 0.4444], [0.1113, 0.4445],
      [0.1114, 0.4446], [0.112, 0.445],
    ];
    const pressures = [0.14, 0.25, 0.36, 0.47, 0.58];
    const live = toLiveShape({ kind: 'pen', color: '#111111', width: 0.004, points, pressures });
    expect(live?.points).toEqual(points);
    expect(live?.pressures).toEqual(pressures);
  });

  it('sends a long stable handwriting preview within the 8 KB packet limit', () => {
    const points: [number, number][] = Array.from({ length: 480 }, (_, i) =>
      [Math.round(i / 1000 * 10000) / 10000, Math.round((0.2 + i / 4800) * 10000) / 10000]);
    const pressures = points.map(() => 0.5);
    const live = toLiveShape({ kind: 'pen', color: '#111111', width: 0.004, points, pressures });
    expect(live?.points).toHaveLength(MAX_LIVE_POINTS);
    expect(live?.points?.[0]).toEqual(points[0]);
    expect(live?.points?.at(-1)).toEqual(points[points.length - 1]);
    const wire = encodeEvent(strokeEvent('c1', 'board-1', 0, true, live!));
    expect(wire.length).toBeLessThanOrEqual(8192);
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
    topicHandlers.clear();
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

  it('does not rewind handwriting when a delayed network frame arrives', () => {
    const { result } = mount();
    const strokeId = '11111111-1111-4111-8111-111111111111';
    const longer = { ...line, points: [...line.points, [0.3, 0.3]] as [number, number][] };
    act(() => handler({
      event: strokeEvent('c1', 'board-1', 0, true, longer, strokeId, 3),
      senderIdentity: 'student|tablet',
    }));
    act(() => handler({
      event: strokeEvent('c1', 'board-1', 0, true, line, strokeId, 2),
      senderIdentity: 'student|tablet',
    }));
    expect(result.current.drafts).toHaveLength(1);
    expect(result.current.drafts[0].shape.points).toHaveLength(3);
  });

  it('never resurrects a finished line from a delayed unreliable frame', () => {
    const { result } = mount();
    const strokeId = '11111111-1111-4111-8111-111111111111';
    act(() => handler({
      event: strokeEvent('c1', 'board-1', 0, false, line, strokeId, 4),
      senderIdentity: 'student|tablet',
    }));
    act(() => result.current.acknowledgeRendered([strokeId]));
    expect(result.current.drafts).toHaveLength(0);
    act(() => handler({
      event: strokeEvent('c1', 'board-1', 0, true, line, strokeId, 3),
      senderIdentity: 'student|tablet',
    }));
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

describe('private notebook stroke previews', () => {
  const props = { classId: 'c1', targetId: 'personal-pupil', targetType: 'NOTEBOOK_CAMERA' as const,
    page: 0, enabled: true, personalOwnerId: 'pupil', hostUserId: 'teacher', currentUserId: 'pupil' };
  const strokeId = '11111111-1111-4111-8111-111111111111';
  beforeEach(() => { vi.useFakeTimers(); publish.mockClear(); topicHandlers.clear(); });
  afterEach(() => vi.useRealTimers());

  it.each([
    ['pupil', 'teacher|laptop'],
    ['teacher', 'pupil|tablet'],
  ])('allows %s to receive and send canonical notebook ink only with the owner and teacher', (currentUserId, senderIdentity) => {
    const { result } = renderHook(() => useLiveStrokes({ ...props, currentUserId }));
    const shape = { ...line, points: [[0.025, 0.96], [0.875, 0.14]] as [number, number][], pressures: [0.2, 0.8] };
    act(() => handler({ event: strokeEvent('c1', props.targetId, 0, true, shape, strokeId, 1), senderIdentity }));
    expect(result.current.drafts).toEqual([{ id: `${senderIdentity}:${strokeId}`, shape }]);
    act(() => result.current.sendDraft(shape, strokeId));
    act(() => result.current.sendDraft(shape, strokeId, true));
    expect(publish).toHaveBeenNthCalledWith(1, expect.objectContaining({ targetId: props.targetId, active: true, shape, strokeId, revision: 1 }), false, ['pupil', 'teacher']);
    expect(publish).toHaveBeenNthCalledWith(2, expect.objectContaining({ active: false, shape, strokeId, revision: 2 }), true, ['pupil', 'teacher']);
    expect(topicHandlers.has(NOTEBOOK_STROKE_TOPIC)).toBe(true);
    expect(topicHandlers.has(STROKE_TOPIC)).toBe(false);
  });

  it('rejects a foreign pupil and a phone-room identity even for an authorized receiver', () => {
    const { result } = renderHook(() => useLiveStrokes(props));
    act(() => {
      handler({ event: strokeEvent('c1', props.targetId, 0, true, line), senderIdentity: 'other-pupil|tablet' });
      handler({ event: strokeEvent('c1', props.targetId, 0, true, line), senderIdentity: 'notebook-phone:camera-id' });
      handler({ event: strokeEvent('c1', 'personal-other-pupil', 0, true, line), senderIdentity: 'teacher|laptop' });
    });
    expect(result.current.drafts).toEqual([]);
  });

  it.each([
    ['no owner', { personalOwnerId: undefined }],
    ['an empty owner', { personalOwnerId: '' }],
    ['a mismatched personal board', { targetId: 'personal-other-pupil' }],
    ['a shared board', { targetId: 'board-1' }],
    ['an unknown local user', { currentUserId: undefined }],
    ['a foreign local pupil', { currentUserId: 'other-pupil' }],
  ])('fails closed with %s', (_name, overrides) => {
    const configured = { ...props, ...overrides };
    const { result } = renderHook(() => useLiveStrokes(configured));
    act(() => {
      handler({ event: strokeEvent('c1', configured.targetId, 0, true, line), senderIdentity: 'teacher|laptop' });
      result.current.sendDraft(line, strokeId);
      result.current.sendDraft(null);
    });
    expect(result.current.drafts).toEqual([]);
    expect(publish).not.toHaveBeenCalled();
  });

  it('hides existing private previews immediately when disabled or the receiver loses access', () => {
    const { result, rerender } = renderHook(({ enabled, currentUserId }) => useLiveStrokes({ ...props, enabled, currentUserId }),
      { initialProps: { enabled: true, currentUserId: 'pupil' } });
    act(() => handler({ event: strokeEvent('c1', props.targetId, 0, true, line), senderIdentity: 'teacher|laptop' }));
    expect(result.current.drafts).toHaveLength(1);
    rerender({ enabled: false, currentUserId: 'pupil' });
    expect(result.current.drafts).toEqual([]);
    rerender({ enabled: true, currentUserId: 'other-pupil' });
    expect(result.current.drafts).toEqual([]);
  });

  it('separates paper and notebook previews even when their personal target and stroke ID match', () => {
    const paper = renderHook(() => useLiveStrokes({ ...props, targetType: 'WHITEBOARD' }));
    const notebook = renderHook(() => useLiveStrokes(props));
    const packet = { event: strokeEvent('c1', props.targetId, 0, true, line, strokeId, 1), senderIdentity: 'teacher|laptop' };
    act(() => topicHandlers.get(STROKE_TOPIC)!(packet));
    expect(paper.result.current.drafts).toHaveLength(1);
    expect(notebook.result.current.drafts).toEqual([]);
    act(() => topicHandlers.get(NOTEBOOK_STROKE_TOPIC)!(packet));
    expect(notebook.result.current.drafts).toHaveLength(1);
    act(() => paper.result.current.acknowledgeRendered([strokeId]));
    expect(paper.result.current.drafts).toEqual([]);
    expect(notebook.result.current.drafts).toHaveLength(1);
  });

  it('clears previous target previews and packet counters when changing between paper and notebook modes', () => {
    const { result, rerender } = renderHook(({ targetType }: { targetType: AnnotationTargetType }) => useLiveStrokes({ ...props, targetType }),
      { initialProps: { targetType: 'WHITEBOARD' as AnnotationTargetType } });
    act(() => handler({ event: strokeEvent('c1', props.targetId, 0, true, line, strokeId, 8), senderIdentity: 'teacher|laptop' }));
    act(() => result.current.sendDraft(line, strokeId));
    expect(result.current.drafts).toHaveLength(1);
    rerender({ targetType: 'NOTEBOOK_CAMERA' });
    expect(result.current.drafts).toEqual([]);
    act(() => result.current.sendDraft(line, strokeId));
    expect(publish.mock.calls.at(-1)?.[0]).toMatchObject({ revision: 1, active: true });
  });

  it('keeps notebook previews until their saved operation is rendered and rejects delayed older revisions', () => {
    const { result } = renderHook(() => useLiveStrokes(props));
    const senderIdentity = 'teacher|laptop';
    const longer = { ...line, points: [...line.points, [0.3, 0.3]] as [number, number][] };
    act(() => handler({ event: strokeEvent('c1', props.targetId, 0, true, longer, strokeId, 3), senderIdentity }));
    act(() => handler({ event: strokeEvent('c1', props.targetId, 0, true, line, strokeId, 2), senderIdentity }));
    expect(result.current.drafts[0].shape).toEqual(longer);
    act(() => handler({ event: strokeEvent('c1', props.targetId, 0, false, longer, strokeId, 4), senderIdentity }));
    act(() => result.current.settle('teacher'));
    expect(result.current.drafts).toHaveLength(1);
    act(() => result.current.acknowledgeRendered([strokeId]));
    expect(result.current.drafts).toEqual([]);
    act(() => handler({ event: strokeEvent('c1', props.targetId, 0, true, line, strokeId, 5), senderIdentity }));
    expect(result.current.drafts).toEqual([]);
    act(() => handler({ event: strokeEvent('c1', props.targetId, 0, false, line, strokeId, 6), senderIdentity }));
    expect(result.current.drafts).toEqual([]);
  });

  it('rejects active and final packets when the durable ADD was confirmed before any preview arrived', () => {
    const { result } = renderHook(() => useLiveStrokes(props));
    act(() => result.current.acknowledgeRendered([strokeId]));
    act(() => handler({ event: strokeEvent('c1', props.targetId, 0, true, line, strokeId, 1), senderIdentity: 'teacher|laptop' }));
    expect(result.current.drafts).toEqual([]);
    act(() => handler({ event: strokeEvent('c1', props.targetId, 0, false, line, strokeId, 2), senderIdentity: 'teacher|laptop' }));
    expect(result.current.drafts).toEqual([]);
    const nextId = '22222222-2222-4222-8222-222222222222';
    act(() => handler({ event: strokeEvent('c1', props.targetId, 0, true, line, nextId, 1), senderIdentity: 'teacher|laptop' }));
    expect(result.current.drafts).toHaveLength(1);
    expect(result.current.drafts[0].id).toBe(`teacher|laptop:${nextId}`);
  });

  it('keeps newer final geometry before durable confirmation and never revives it after confirmation', () => {
    const { result } = renderHook(() => useLiveStrokes(props));
    const senderIdentity = 'teacher|laptop';
    act(() => handler({ event: strokeEvent('c1', props.targetId, 0, false, line, strokeId, 2), senderIdentity }));
    const final = { ...line, points: [...line.points, [0.3, 0.3]] as [number, number][] };
    act(() => handler({ event: strokeEvent('c1', props.targetId, 0, false, final, strokeId, 3), senderIdentity }));
    expect(result.current.drafts[0].shape).toEqual(final);
    act(() => result.current.acknowledgeRendered([strokeId]));
    act(() => handler({ event: strokeEvent('c1', props.targetId, 0, false, final, strokeId, 4), senderIdentity }));
    expect(result.current.drafts).toEqual([]);
  });

  it('keeps the most recently confirmed IDs when a long lesson exceeds the bounded ACK history', () => {
    const { result } = renderHook(() => useLiveStrokes(props));
    const ids = Array.from({ length: 512 }, (_, i) => `${i.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`);
    act(() => result.current.acknowledgeRendered(ids));
    // Reconfirming the first operation keeps it recent when one more is saved.
    act(() => result.current.acknowledgeRendered([ids[0], strokeId]));
    act(() => {
      handler({ event: strokeEvent('c1', props.targetId, 0, false, line, ids[0], 4), senderIdentity: 'teacher|laptop' });
      handler({ event: strokeEvent('c1', props.targetId, 0, false, line, strokeId, 4), senderIdentity: 'teacher|laptop' });
    });
    expect(result.current.drafts).toEqual([]);
    // Only the oldest untouched ID has been evicted; memory does not grow.
    act(() => handler({ event: strokeEvent('c1', props.targetId, 0, false, line, ids[1], 4), senderIdentity: 'teacher|laptop' }));
    expect(result.current.drafts).toHaveLength(1);
  });
});
