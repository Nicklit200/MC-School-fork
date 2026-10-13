/** The shared board every participant sees. */
export const SHARED_BOARD_ID = 'board-1';

const PERSONAL_PREFIX = 'personal-';

/**
 * Target id of a student's personal board. The server derives access from
 * this exact shape (see `PersonalBoard` on the backend): only the owner and
 * the teacher can reach it.
 */
export function personalBoardId(userId: string): string {
  return `${PERSONAL_PREFIX}${userId}`;
}

export function isPersonalBoard(targetId: string): boolean {
  return targetId.startsWith(PERSONAL_PREFIX);
}

/** The student who owns a personal board, or null for any other board. */
export function personalBoardOwner(targetId: string): string | null {
  return isPersonalBoard(targetId) ? targetId.slice(PERSONAL_PREFIX.length) : null;
}
