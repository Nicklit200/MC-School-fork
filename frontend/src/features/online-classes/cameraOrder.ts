/**
 * Fixed ordering for the camera column.
 *
 * Deliberately free of React and LiveKit so the rules can be tested directly.
 * The column must never reshuffle during a lesson: the active speaker is
 * highlighted in place, a late joiner is appended, and a leaver is removed with
 * everyone else keeping their relative order.
 */

export interface CameraSlot {
  identity: string;
  /** The teacher always sits in the first slot. */
  isHost: boolean;
}

/**
 * Merges the previous order with whoever is present now.
 *
 * - participants already placed keep their relative order;
 * - newcomers are appended in the order they are given;
 * - anyone no longer present is dropped;
 * - the host is moved to the front regardless of when they appeared.
 */
export function mergeCameraOrder(previous: string[], current: CameraSlot[]): string[] {
  const present = new Map(current.map((slot) => [slot.identity, slot]));
  const kept = previous.filter((identity) => present.has(identity));
  const known = new Set(kept);
  const added = current.map((slot) => slot.identity).filter((identity) => !known.has(identity));
  const merged = [...kept, ...added];

  const hosts = merged.filter((identity) => present.get(identity)?.isHost);
  const others = merged.filter((identity) => !present.get(identity)?.isHost);
  return [...hosts, ...others];
}

/** Two orders are equal when they hold the same identities in the same places. */
export function sameOrder(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((identity, index) => identity === b[index]);
}

/** Sorts items by a computed order; items missing from the order go last. */
export function sortByOrder<T>(items: T[], order: string[], identityOf: (item: T) => string): T[] {
  const rank = new Map(order.map((identity, index) => [identity, index]));
  return [...items].sort(
    (a, b) =>
      (rank.get(identityOf(a)) ?? Number.MAX_SAFE_INTEGER) -
      (rank.get(identityOf(b)) ?? Number.MAX_SAFE_INTEGER),
  );
}

/** Up to this many cameras fit the column without scrolling (stage 4 layout). */
export const MAX_COLUMN_CAMERAS = 5;
