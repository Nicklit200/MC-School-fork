import { ConnectionQuality, ConnectionState } from 'livekit-client';
import { describe, expect, it } from 'vitest';
import { initialsOf, isReconnecting } from './cameraCard';

describe('initialsOf', () => {
  it('uses the first and last word', () => {
    expect(initialsOf('Anna Maria Schmidt')).toBe('AS');
    expect(initialsOf('Анна Иванова')).toBe('АИ');
  });

  it('uses one letter for a single word and survives blanks', () => {
    expect(initialsOf('madonna')).toBe('M');
    expect(initialsOf('   ')).toBe('?');
    expect(initialsOf(undefined)).toBe('?');
  });

  it('does not split an astral character in half', () => {
    expect(initialsOf('😀 Test')).toBe('😀T');
  });
});

describe('isReconnecting', () => {
  it('follows the room state for the local participant', () => {
    expect(
      isReconnecting({ isLocal: true, quality: ConnectionQuality.Excellent, roomState: ConnectionState.Reconnecting }),
    ).toBe(true);
    expect(
      isReconnecting({ isLocal: true, quality: ConnectionQuality.Lost, roomState: ConnectionState.Connected }),
    ).toBe(false);
  });

  it('follows connection quality for a remote participant', () => {
    expect(
      isReconnecting({ isLocal: false, quality: ConnectionQuality.Lost, roomState: ConnectionState.Connected }),
    ).toBe(true);
    expect(
      isReconnecting({ isLocal: false, quality: ConnectionQuality.Poor, roomState: ConnectionState.Connected }),
    ).toBe(false);
  });
});
