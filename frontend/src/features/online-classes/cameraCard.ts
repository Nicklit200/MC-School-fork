import { ConnectionQuality, ConnectionState } from 'livekit-client';

/**
 * Up to two letters for the avatar shown when a camera is off.
 *
 * Takes the first letter of the first and last word, so "Anna Maria Schmidt"
 * is "AS". Works on any script (it slices by code point, not by UTF-16 unit).
 */
export function initialsOf(name: string | undefined | null): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = [...words[0]][0] ?? '';
  const last = words.length > 1 ? ([...words[words.length - 1]][0] ?? '') : '';
  return (first + last).toLocaleUpperCase();
}

/**
 * Whether a card should read "Переподключение…".
 *
 * A remote participant who has lost their connection reports a Lost quality;
 * for the local participant the room's own state is the authority.
 */
export function isReconnecting({
  isLocal,
  quality,
  roomState,
}: {
  isLocal: boolean;
  quality: ConnectionQuality;
  roomState: ConnectionState;
}): boolean {
  if (isLocal) return roomState === ConnectionState.Reconnecting;
  return quality === ConnectionQuality.Lost;
}
