import { describe, expect, it } from 'vitest';
import { goToPage, initialPages, viewOf, withView } from './boardView';
import {
  applyHostView,
  describeView,
  isFromHost,
  navigationLocked,
  userIdOfIdentity,
} from './followTeacher';

const board = { width: 1000, height: 500 };

describe('trust', () => {
  it('extracts the user id from a device-suffixed identity', () => {
    expect(userIdOfIdentity('abc|d1')).toBe('abc');
    expect(userIdOfIdentity('abc')).toBe('abc');
    expect(userIdOfIdentity(undefined)).toBeNull();
  });

  it('accepts only the host, on any of their devices', () => {
    expect(isFromHost('teacher|tab1', 'teacher')).toBe(true);
    expect(isFromHost('teacher|tab2', 'teacher')).toBe(true);
    expect(isFromHost('student|tab1', 'teacher')).toBe(false);
  });

  it('accepts nobody until the host is known', () => {
    expect(isFromHost('teacher|tab1', null)).toBe(false);
  });

  it('does not let a look-alike prefix pass', () => {
    expect(isFromHost('teacher-evil|x', 'teacher')).toBe(false);
  });
});

describe('view mapping', () => {
  it('sends pan as a fraction of the board', () => {
    let pages = goToPage(initialPages(4), 2);
    pages = withView(pages, { zoom: 2, panX: -500, panY: -125 });
    expect(describeView(pages, { zoom: 2, panX: -500, panY: -125 }, board, 'board-1', true)).toEqual({
      boardId: 'board-1',
      page: 2,
      pageCount: 4,
      zoom: 2,
      panX: -0.5,
      panY: -0.25,
      follow: true,
    });
  });

  it('lands on the same region on a different screen size', () => {
    const applied = applyHostView(
      initialPages(),
      { page: 1, pageCount: 3, zoom: 2, panX: -0.5, panY: -0.25 },
      { width: 400, height: 200 },
    );
    expect(applied.current).toBe(1);
    expect(applied.count).toBe(3);
    expect(viewOf(applied)).toEqual({ zoom: 2, panX: -200, panY: -50 });
  });

  it('never shrinks the page count and clamps a wild page index', () => {
    const applied = applyHostView(
      initialPages(6),
      { page: 99, pageCount: 2, zoom: 1, panX: 0, panY: 0 },
      board,
    );
    expect(applied.count).toBe(6);
    expect(applied.current).toBe(5);
  });

  it('clamps an out-of-range pan to the board', () => {
    const applied = applyHostView(
      initialPages(),
      { page: 0, pageCount: 1, zoom: 1, panX: -0.4, panY: -0.4 },
      board,
    );
    expect(viewOf(applied)).toEqual({ zoom: 1, panX: 0, panY: 0 });
  });
});

describe('hidden board', () => {
  it('keeps the existing view when the local board has no size', () => {
    const start = withView(initialPages(3), { zoom: 2, panX: -50, panY: -20 });
    const applied = applyHostView(
      start,
      { page: 0, pageCount: 3, zoom: 3, panX: -0.5, panY: -0.5 },
      { width: 0, height: 0 },
    );
    expect(applied.current).toBe(0);
    expect(viewOf(applied)).toEqual({ zoom: 2, panX: -50, panY: -20 });
  });
});

describe('navigation lock', () => {
  it('locks only students who are following', () => {
    expect(navigationLocked(false, true)).toBe(true);
    expect(navigationLocked(false, false)).toBe(false);
    expect(navigationLocked(true, true)).toBe(false);
  });
});
