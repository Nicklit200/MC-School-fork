import { describe, expect, it } from 'vitest';
import { categorizeLiveKitError } from './livekitDiagnostics';

describe('safe LiveKit diagnostics', () => {
  it('recognizes token or permission failures', () => {
    expect(categorizeLiveKitError(new Error('JWT validation failed'))).toBe('authorization');
    expect(categorizeLiveKitError({ name: 'NotAllowedError' })).toBe('devices');
  });
  it('separates signaling failures from WebRTC failures', () => {
    expect(categorizeLiveKitError(new Error('WebSocket signaling handshake error'))).toBe('signaling');
    expect(categorizeLiveKitError(new Error('ICE negotiation timed out'))).toBe('network');
  });
  it('does not interpret the LiveKit unknown disconnect code 0 as a real cause', () => {
    expect(categorizeLiveKitError({ code: 0 })).toBe('unknown');
    expect(categorizeLiveKitError(null)).toBe('unknown');
  });
});
