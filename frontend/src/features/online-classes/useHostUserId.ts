import { useEffect, useState } from 'react';
import { onlineClassesApi } from '../../api/onlineClasses';

const RETRY_MS = 5000;

/**
 * The teacher's user id, taken from the roster.
 *
 * Needed to decide whose realtime packets to believe: a LiveKit identity is
 * `<userId>|<device>`, and any participant can publish data, so view packets
 * are only honoured when the sender's user id is the host's.
 */
export function useHostUserId(classId: string): string | null {
  const [hostUserId, setHostUserId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let timer: number | undefined;

    const load = async () => {
      try {
        const roster = await onlineClassesApi.listParticipants(classId);
        const host = roster.find((entry) => entry.classRole === 'HOST');
        if (!active) return;
        if (host) {
          setHostUserId(host.userId);
          return;
        }
      } catch {
        // Fall through to the retry.
      }
      if (active) timer = window.setTimeout(load, RETRY_MS);
    };
    void load();

    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [classId]);

  return hostUserId;
}
