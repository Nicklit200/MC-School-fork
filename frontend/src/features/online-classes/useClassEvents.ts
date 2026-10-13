import { useRoomContext } from '@livekit/components-react';
import { RoomEvent, type RemoteParticipant } from 'livekit-client';
import { useCallback, useEffect, useRef } from 'react';
import { type ClassEvent, encodeEvent, parseClassEvent } from './events';

export interface ReceivedEvent {
  event: ClassEvent;
  /** LiveKit identity of the sender (`<userUuid>|<device>`). */
  senderIdentity: string | undefined;
}

/**
 * Publishes and receives class data packets on one topic.
 *
 * <p>Must be used inside the LiveKit room context. Every incoming packet is
 * strictly parsed and dropped when malformed or meant for another class; the
 * sender identity is handed to the handler so it can decide how far to trust
 * the packet.
 */
export function useClassEvents(
  classId: string,
  topic: string,
  onEvent: (received: ReceivedEvent) => void,
) {
  const room = useRoomContext();
  // The latest handler without re-subscribing on every render.
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    const listener = (
      payload: Uint8Array,
      participant?: RemoteParticipant,
      _kind?: unknown,
      receivedTopic?: string,
    ) => {
      if (receivedTopic !== topic) return;
      const event = parseClassEvent(payload, classId);
      if (event) handler.current({ event, senderIdentity: participant?.identity });
    };
    room.on(RoomEvent.DataReceived, listener);
    return () => {
      room.off(RoomEvent.DataReceived, listener);
    };
  }, [room, classId, topic]);

  const publish = useCallback(
    async (event: ClassEvent, reliable = true) => {
      try {
        await room.localParticipant.publishData(encodeEvent(event) as never, { reliable, topic });
      } catch {
        // Realtime is an accelerator, never the source of truth: the durable
        // state still arrives by REST, so a failed publish is not fatal.
      }
    },
    [room, topic],
  );

  return { publish };
}
