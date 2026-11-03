import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type BoardPages, goToPage, initialPages, viewOf } from './boardView';
import { type ClassEvent, type DocumentViewport, VIEW_TOPIC, viewEvent } from './events';
import { HEARTBEAT_MS, STALE_AFTER_MS, useFollowTeacher } from './useFollowTeacher';

const publish = vi.fn().mockResolvedValue(undefined);
let handler: (received: { event: ClassEvent; senderIdentity: string | undefined }) => void = () => {};

vi.mock('./useClassEvents', () => ({
  useClassEvents: (_classId: string, topic: string, onEvent: typeof handler) => {
    expect(topic).toBe(VIEW_TOPIC);
    handler = onEvent;
    return { publish };
  },
}));

let board = { width: 1000, height: 500 };

type DocumentOptions = { documentView?: DocumentViewport; onDocumentView?: (value: DocumentViewport, page: number) => void; active?: boolean };

function mount(isHost: boolean, hostUserId: string | null = 'teacher', enabled = true, options: DocumentOptions = {}) {
  return renderHook(
    ({ start, documentView, onDocumentView, active }: { start: BoardPages } & DocumentOptions) => {
      const [pages, setPages] = useState<BoardPages>(start);
      const follow = useFollowTeacher({
        classId: 'c1',
        boardId: 'board-1',
        isHost,
        hostUserId,
        pages,
        setPages,
        getBoardSize: () => board,
        enabled,
        active,
        documentView,
        onDocumentView,
      });
      return { pages, setPages, ...follow };
    },
    { initialProps: { start: initialPages(3), ...options } },
  );
}

const senderContext = { classId: 'c1', boardId: 'board-1', isHost: true, hostUserId: 'teacher', enabled: true, active: true };
function mountSender() {
  return renderHook((context: typeof senderContext) => {
    const [pages, setPages] = useState(initialPages(3));
    return useFollowTeacher({ ...context, pages, setPages, getBoardSize: () => board });
  }, { initialProps: senderContext });
}

const hostView = (patch: Partial<Parameters<typeof viewEvent>[1]> = {}) =>
  viewEvent('c1', {
    boardId: 'board-1',
    page: 2,
    pageCount: 3,
    zoom: 2,
    panX: -0.5,
    panY: -0.25,
    follow: true,
    ...patch,
  });

describe('useFollowTeacher — student', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    publish.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it('mirrors page, zoom and pan from the teacher and reports it is following', () => {
    const { result } = mount(false);
    act(() => handler({ event: hostView(), senderIdentity: 'teacher|tab' }));
    expect(result.current.following).toBe(true);
    expect(result.current.pages.current).toBe(2);
    expect(viewOf(result.current.pages)).toEqual({ zoom: 2, panX: -500, panY: -125 });
  });

  it('delivers a trusted whole-document anchor once, preserving legacy page fallback and temporary layout', () => {
    const onDocumentView = vi.fn(), documentView = { zoom: 2.5, x: .4, y: 1.1 };
    const { result } = mount(false, 'teacher', true, { onDocumentView });
    expect(result.current.followLayout).toBeNull();
    act(() => handler({ event: hostView({ documentView }), senderIdentity: 'teacher|tab' }));
    expect(onDocumentView).toHaveBeenCalledExactlyOnceWith(documentView, 2);
    expect(result.current.pages.current).toBe(2);
    expect(viewOf(result.current.pages)).toEqual({ zoom: 2, panX: -500, panY: -125 });
    expect(result.current.followLayout).toBe('continuous');
    act(() => handler({ event: hostView(), senderIdentity: 'teacher|tab' }));
    expect(result.current.followLayout).toBe('paged');
    expect(onDocumentView).toHaveBeenCalledOnce();
    act(() => handler({ event: hostView({ documentView, follow: false }), senderIdentity: 'teacher|tab' }));
    expect(result.current.followLayout).toBeNull();
    expect(onDocumentView).toHaveBeenCalledOnce();
    act(() => handler({ event: hostView({ documentView }), senderIdentity: 'teacher|tab' }));
    act(() => vi.advanceTimersByTime(STALE_AFTER_MS + 2000));
    expect(result.current.followLayout).toBeNull();
  });

  it.each([
    ['non-host', false, 'teacher', true, 'student-2|tab', {}],
    ['unknown host', false, null, true, 'teacher|tab', {}],
    ['disabled personal board', false, 'teacher', false, 'teacher|tab', {}],
    ['teacher itself', true, 'teacher', true, 'teacher|tab', {}],
    ['another board', false, 'teacher', true, 'teacher|tab', { boardId: 'other' }],
    ['follow off', false, 'teacher', true, 'teacher|tab', { follow: false }],
  ] as const)('does not apply a document anchor from %s', (_name, isHost, host, enabled, senderIdentity, patch) => {
    const onDocumentView = vi.fn();
    const { result } = mount(isHost, host, enabled, { onDocumentView });
    act(() => handler({ event: hostView({ documentView: { zoom: 2, x: .5, y: .5 }, ...patch }), senderIdentity }));
    expect(onDocumentView).not.toHaveBeenCalled();
    expect(result.current.followLayout).toBeNull();
  });

  it('delivers the document anchor before a target page mounts without replaying it on every rerender', () => {
    const onDocumentView = vi.fn(), documentView = { zoom: 3, x: .25, y: .75 };
    board = { width: 0, height: 0 };
    try {
      const { rerender } = mount(false, 'teacher', true, { onDocumentView });
      act(() => handler({ event: hostView({ documentView }), senderIdentity: 'teacher|tab' }));
      expect(onDocumentView).toHaveBeenCalledExactlyOnceWith(documentView, 2);
      board = { width: 1000, height: 500 };
      rerender({ start: initialPages(3), onDocumentView });rerender({ start: initialPages(3), onDocumentView });
      expect(onDocumentView).toHaveBeenCalledOnce();
    } finally { board = { width: 1000, height: 500 }; }
  });

  it('maps pan using the incoming page dimensions instead of the previously selected page', () => {
    const getBoardSize = vi.fn((pageIndex?: number) => pageIndex === 2
      ? { width: 300, height: 180 }
      : { width: 1000, height: 500 });
    const { result } = renderHook(() => {
      const [pages, setPages] = useState(initialPages(3));
      const follow = useFollowTeacher({
        classId: 'c1', boardId: 'board-1', isHost: false, hostUserId: 'teacher',
        pages, setPages, getBoardSize,
      });
      return { pages, ...follow };
    });
    expect(result.current.pages.current).toBe(0);
    act(() => handler({ event: hostView(), senderIdentity: 'teacher|tab' }));
    expect(getBoardSize).toHaveBeenCalledExactlyOnceWith(2);
    expect(result.current.pages.current).toBe(2);
    expect(result.current.following).toBe(true);
    expect(viewOf(result.current.pages)).toEqual({ zoom: 2, panX: -150, panY: -45 });
    expect(viewOf(result.current.pages, 0)).toEqual({ zoom: 1, panX: 0, panY: 0 });
  });

  it('applies the latest trusted view when an initially unmounted target page gets its dimensions', () => {
    let targetSize = { width: 0, height: 0 };
    const getBoardSize = vi.fn(() => targetSize);
    const { result, rerender } = renderHook(() => {
      const [pages, setPages] = useState(initialPages(1));
      const follow = useFollowTeacher({
        classId: 'c1', boardId: 'board-1', isHost: false, hostUserId: 'teacher',
        pages, setPages, getBoardSize,
      });
      return { pages, ...follow };
    });
    act(() => handler({ event: hostView(), senderIdentity: 'teacher|tab' }));
    expect(result.current.pages.current).toBe(2);
    expect(result.current.pages.count).toBe(3);
    expect(viewOf(result.current.pages)).toEqual({ zoom: 1, panX: 0, panY: 0 });
    act(() => handler({ event: hostView({ zoom: 3 }), senderIdentity: 'teacher|tab' }));
    targetSize = { width: 300, height: 180 };
    rerender();
    expect(result.current.following).toBe(true);
    expect(viewOf(result.current.pages)).toEqual({ zoom: 3, panX: -150, panY: -45 });
    const lookups = getBoardSize.mock.calls.length;
    rerender();
    expect(getBoardSize).toHaveBeenCalledTimes(lookups);
    expect(publish).not.toHaveBeenCalled();
  });

  it.each(['follow-off', 'disabled'] as const)('discards a pending view after %s', (reason) => {
    let targetSize = { width: 0, height: 0 };
    const { result, rerender } = renderHook(({ enabled }) => {
      const [pages, setPages] = useState(initialPages(1));
      const follow = useFollowTeacher({
        classId: 'c1', boardId: 'board-1', isHost: false, hostUserId: 'teacher',
        pages, setPages, getBoardSize: () => targetSize, enabled,
      });
      return { pages, ...follow };
    }, { initialProps: { enabled: true } });
    act(() => handler({ event: hostView(), senderIdentity: 'teacher|tab' }));
    if (reason === 'follow-off') {
      act(() => handler({ event: hostView({ follow: false }), senderIdentity: 'teacher|tab' }));
    } else {
      rerender({ enabled: false });
    }
    targetSize = { width: 300, height: 180 };
    rerender({ enabled: true });
    expect(viewOf(result.current.pages)).toEqual({ zoom: 1, panX: 0, panY: 0 });
  });

  it('ignores a view packet from anyone but the host', () => {
    const { result } = mount(false);
    act(() => handler({ event: hostView(), senderIdentity: 'student-2|tab' }));
    expect(result.current.following).toBe(false);
    expect(result.current.pages.current).toBe(0);
  });

  it('ignores view packets until the host is known', () => {
    const { result } = mount(false, null);
    act(() => handler({ event: hostView(), senderIdentity: 'teacher|tab' }));
    expect(result.current.following).toBe(false);
  });

  it('ignores another board’s view', () => {
    const { result } = mount(false);
    act(() => handler({ event: hostView({ boardId: 'personal-x' }), senderIdentity: 'teacher|tab' }));
    expect(result.current.following).toBe(false);
  });

  it('ignores trusted navigation while inactive and applies a fresh packet after reactivation', () => {
    const onDocumentView = vi.fn();
    const documentView = { zoom: 2, x: .5, y: .4 };
    const { result, rerender } = mount(false, 'teacher', true, { active: false, onDocumentView });
    act(() => handler({ event: hostView({ documentView }), senderIdentity: 'teacher|tab' }));
    expect(result.current.following).toBe(false);
    expect(result.current.pages.current).toBe(0);
    expect(onDocumentView).not.toHaveBeenCalled();
    rerender({ start: initialPages(3), active: true, onDocumentView });
    act(() => handler({ event: hostView({ documentView }), senderIdentity: 'teacher|tab' }));
    expect(result.current.following).toBe(true);
    expect(onDocumentView).toHaveBeenCalledExactlyOnceWith(documentView, 2);
  });

  it('keeps the student where they are when follow is off, but learns the page count', () => {
    const { result } = mount(false);
    act(() => result.current.setPages((p) => goToPage(p, 1)));
    act(() => handler({ event: hostView({ follow: false, page: 0, pageCount: 6 }), senderIdentity: 'teacher|tab' }));
    expect(result.current.following).toBe(false);
    expect(result.current.pages.current).toBe(1);
    expect(result.current.pages.count).toBe(6);
  });

  it('releases the lock when the teacher turns follow off', () => {
    const { result } = mount(false);
    act(() => handler({ event: hostView(), senderIdentity: 'teacher|tab' }));
    act(() => handler({ event: hostView({ follow: false }), senderIdentity: 'teacher|tab' }));
    expect(result.current.following).toBe(false);
  });

  it('releases the lock if the teacher goes silent', () => {
    const { result } = mount(false);
    act(() => handler({ event: hostView(), senderIdentity: 'teacher|tab' }));
    expect(result.current.following).toBe(true);
    act(() => {
      vi.advanceTimersByTime(STALE_AFTER_MS + 2000);
    });
    expect(result.current.following).toBe(false);
  });

  it('never publishes anything', () => {
    mount(false);
    act(() => {
      vi.advanceTimersByTime(HEARTBEAT_MS * 3);
    });
    expect(publish).not.toHaveBeenCalled();
  });
});

describe('useFollowTeacher — teacher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    publish.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it('announces the page count once, with follow off', () => {
    mount(true);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0][0]).toMatchObject({ type: 'view', follow: false, pageCount: 3 });
  });

  it('streams the view while follow is on, then announces follow:false when it is turned off', () => {
    const { result } = mount(true);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    publish.mockClear();

    act(() => result.current.setFollowEnabled(true));
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ follow: true }));

    act(() => result.current.setPages((p) => goToPage(p, 1)));
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ follow: true, page: 1 }));

    act(() => result.current.setFollowEnabled(false));
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ follow: false }));
  });

  it('repeats the view on a heartbeat while following so late joiners catch up', () => {
    const { result } = mount(true);
    act(() => result.current.setFollowEnabled(true));
    act(() => {
      vi.advanceTimersByTime(300);
    });
    publish.mockClear();
    act(() => {
      vi.advanceTimersByTime(HEARTBEAT_MS * 2 + 50);
    });
    expect(publish.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('throttles whole-document anchor changes and repeats the latest anchor for late joiners', () => {
    const first = { zoom: 1.5, x: .5, y: .2 }, latest = { zoom: 3, x: .3, y: .8 };
    const { result, rerender } = mount(true, 'teacher', true, { documentView: first });
    act(() => result.current.setFollowEnabled(true));
    act(() => vi.advanceTimersByTime(150));
    expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ documentView: first, follow: true }));
    publish.mockClear();
    rerender({ start: initialPages(3), documentView: { zoom: 2, x: .5, y: .4 } });
    act(() => vi.advanceTimersByTime(50));
    rerender({ start: initialPages(3), documentView: latest });
    act(() => vi.advanceTimersByTime(49));
    expect(publish).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ documentView: latest }));
    publish.mockClear();
    act(() => vi.advanceTimersByTime(HEARTBEAT_MS));
    expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ documentView: latest }));
  });

  it('sends during uninterrupted 16-ms zoom updates and flushes the final view without waiting for a heartbeat', () => {
    const first = { zoom: 1, x: .5, y: .2 };
    const sentAt: number[] = [];
    publish.mockImplementation(() => { sentAt.push(Date.now()); return Promise.resolve(undefined); });
    try {
      const { result, rerender } = mount(true, 'teacher', true, { documentView: first });
      act(() => result.current.setFollowEnabled(true));
      act(() => vi.advanceTimersByTime(150));
      publish.mockClear(); sentAt.length = 0;
      for (let index = 1; index <= 20; index++) {
        rerender({ start: initialPages(3), documentView: { zoom: 1 + index / 20, x: .5, y: index / 100 } });
        act(() => vi.advanceTimersByTime(16));
      }
      // A debounce would send nothing until the continuous gesture stopped.
      expect(publish.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(publish.mock.calls.length).toBeLessThanOrEqual(3);
      for (let index = 1; index < sentAt.length; index++) expect(sentAt[index] - sentAt[index - 1]).toBeGreaterThanOrEqual(100);
      act(() => vi.advanceTimersByTime(100));
      expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({
        follow: true, documentView: { zoom: 2, x: .5, y: .2 },
      }));
      expect(publish).toHaveBeenCalledTimes(3);
    } finally { publish.mockResolvedValue(undefined); }
  });

  it.each(['isHost', 'enabled', 'active'] as const)('cancels pending and heartbeat packets when %s becomes false', guard => {
    const { result, rerender } = mountSender();
    act(() => result.current.setFollowEnabled(true));
    act(() => vi.advanceTimersByTime(50));
    rerender({ ...senderContext, [guard]: false });
    act(() => vi.advanceTimersByTime(HEARTBEAT_MS * 3));
    expect(publish).not.toHaveBeenCalled();
  });

  it.each([
    { classId: 'c2', boardId: 'board-1' },
    { classId: 'c1', boardId: 'board-2' },
  ])('cancels the old scope before announcing the current class and board: %s', scope => {
    const { result, rerender } = mountSender();
    act(() => result.current.setFollowEnabled(true));
    act(() => vi.advanceTimersByTime(50));
    rerender({ ...senderContext, ...scope });
    act(() => vi.advanceTimersByTime(51));
    expect(publish).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(49));
    expect(publish).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ ...scope, follow: true }));
  });

  it('cancels a pending view when the sender unmounts', () => {
    const { result, unmount } = mountSender();
    act(() => result.current.setFollowEnabled(true));
    act(() => vi.advanceTimersByTime(50));
    unmount();
    act(() => vi.advanceTimersByTime(HEARTBEAT_MS * 3));
    expect(publish).not.toHaveBeenCalled();
  });

  it('replaces a pending follow-on packet with the latest follow-off state', () => {
    const { result } = mountSender();
    act(() => result.current.setFollowEnabled(true));
    act(() => vi.advanceTimersByTime(50));
    act(() => result.current.setFollowEnabled(false));
    act(() => vi.advanceTimersByTime(50));
    expect(publish).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ follow: false }));
    act(() => vi.advanceTimersByTime(HEARTBEAT_MS * 2));
    expect(publish).toHaveBeenCalledOnce();
  });

  it('sends nothing for the view while the board is hidden', () => {
    const { result } = mount(true);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    publish.mockClear();
    board = { width: 0, height: 0 };
    try {
      act(() => result.current.setFollowEnabled(true));
      act(() => {
        vi.advanceTimersByTime(HEARTBEAT_MS * 2);
      });
      expect(publish).not.toHaveBeenCalled();
    } finally {
      board = { width: 1000, height: 500 };
    }
  });

  it('is never reported as "following" itself', () => {
    const { result } = mount(true);
    act(() => handler({ event: hostView(), senderIdentity: 'teacher|tab' }));
    expect(result.current.following).toBe(false);
  });
});

describe('useFollowTeacher — disabled (personal boards)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    publish.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it('a student on a personal board is never moved by the teacher', () => {
    const { result } = mount(false, 'teacher', false);
    act(() => handler({ event: hostView(), senderIdentity: 'teacher|tab' }));
    expect(result.current.following).toBe(false);
    expect(result.current.pages.current).toBe(0);
  });

  it('the teacher publishes nothing about a personal board', () => {
    const { result } = mount(true, 'teacher', false);
    act(() => result.current.setFollowEnabled(true));
    act(() => {
      vi.advanceTimersByTime(HEARTBEAT_MS * 3);
    });
    expect(publish).not.toHaveBeenCalled();
  });
});
