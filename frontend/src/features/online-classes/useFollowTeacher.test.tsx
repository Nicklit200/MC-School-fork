import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type BoardPages, goToPage, initialPages, viewOf } from './boardView';
import { type ClassEvent, VIEW_TOPIC, viewEvent } from './events';
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

function mount(isHost: boolean, hostUserId: string | null = 'teacher', enabled = true) {
  return renderHook(
    ({ start }: { start: BoardPages }) => {
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
      });
      return { pages, setPages, ...follow };
    },
    { initialProps: { start: initialPages(3) } },
  );
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
