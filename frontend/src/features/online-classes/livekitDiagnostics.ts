/** Safe, non-sensitive diagnostics for browser LiveKit connection failures.
 * Do not surface raw error messages: SDK messages may contain signed URLs.
 */
export type LiveKitErrorCategory = 'authorization' | 'signaling' | 'network' | 'devices' | 'unknown';

export function categorizeLiveKitError(error: unknown): LiveKitErrorCategory {
  if (error == null || typeof error !== 'object') return 'unknown';
  const candidate = error as { name?: unknown; message?: unknown; code?: unknown };
  const summary = [candidate.name, candidate.message, candidate.code]
    .filter((value) => typeof value === 'string' || typeof value === 'number')
    .join(' ').toLowerCase();
  if (/token|jwt|signature|authorization|authentication|unauthori[sz]ed|forbidden|403|401/.test(summary)) {
    return 'authorization';
  }
  if (/permission|notallowederror|notfounderror|device|capture|microphone|camera|track/.test(summary)) {
    return 'devices';
  }
  if (/websocket|signal|signaling|handshake|server unreachable|gateway|connection refused/.test(summary)) {
    return 'signaling';
  }
  if (/ice|peerconnection|transport|timeout|timed out|network|connection failed/.test(summary)) {
    return 'network';
  }
  return 'unknown';
}
