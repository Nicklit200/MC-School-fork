import { describe, expect, it } from 'vitest';
import { SHARED_BOARD_ID, isPersonalBoard, personalBoardId, personalBoardOwner, personalWorkbookBoardId, isPersonalWorkbookBoard } from './boards';

describe('board ids', () => {
  it('round-trips a personal board id', () => {
    const id = personalBoardId('abc-123');
    expect(id).toBe('personal-abc-123');
    expect(isPersonalBoard(id)).toBe(true);
    expect(personalBoardOwner(id)).toBe('abc-123');
  });

  it('never treats the shared board as personal', () => {
    expect(isPersonalBoard(SHARED_BOARD_ID)).toBe(false);
    expect(personalBoardOwner(SHARED_BOARD_ID)).toBeNull();
  });

  it('separates worksheet and personal board ink but resolves the same private owner', () => {
    const board = personalBoardId('student-1'), worksheet = personalWorkbookBoardId('student-1');
    expect(worksheet).not.toBe(board);
    expect(isPersonalBoard(worksheet)).toBe(true);
    expect(isPersonalWorkbookBoard(worksheet)).toBe(true);
    expect(isPersonalWorkbookBoard(board)).toBe(false);
    expect(personalBoardOwner(worksheet)).toBe('student-1');
  });
});
