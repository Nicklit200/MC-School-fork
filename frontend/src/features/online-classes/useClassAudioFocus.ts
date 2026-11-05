import { useRoomContext } from '@livekit/components-react';
import { RoomEvent, Track } from 'livekit-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { onlineClassesApi, type ClassAudioFocus } from '../../api/onlineClasses';
import { canHearClassAudio, parseAudioFocus } from './audioFocus';

/** Change receiver subscriptions only: cameras, microphones and recorder feeds stay published. */
export function useClassAudioFocus(classId: string, teacherId: string | null, isHost: boolean) {
  const room = useRoomContext();
  const [focus, setFocus] = useState<ClassAudioFocus | null>(null);
  const [busy, setBusy] = useState(false);
  const [controlError, setControlError] = useState(false);
  const [playbackError, setPlaybackError] = useState(false);
  const scope = JSON.stringify([classId, isHost, room.localParticipant.identity]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const mounted = useRef(true);
  const latest = useRef(0);
  const queue = useRef(Promise.resolve());
  useEffect(() => {
    mounted.current = true;
    queue.current = Promise.resolve();
    setBusy(false); setControlError(false); setPlaybackError(false);
    return () => { mounted.current = false; latest.current++; };
  }, [room, scope]);

  useEffect(() => {
    const sync = () => {
      const hostPresent = isHost || [...room.remoteParticipants.values()].some(p => p.identity.split('|')[0] === teacherId);
      const next = hostPresent ? parseAudioFocus(room.metadata, classId, teacherId) : null;
      setFocus(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
      for (const participant of room.remoteParticipants.values()) {
        const hear = isHost || canHearClassAudio(room.localParticipant.identity.split('|')[0], participant.identity.split('|')[0], teacherId, next);
        for (const publication of participant.trackPublications.values()) {
          if (publication.kind !== Track.Kind.Audio || publication.isSubscribed === hear) continue;
          try { publication.setSubscribed(hear); } catch { setPlaybackError(true); }
        }
      }
    };
    const failed = () => setPlaybackError(true);
    const recovered = () => { setPlaybackError(false); sync(); };
    const events = [RoomEvent.RoomMetadataChanged, RoomEvent.ParticipantConnected,
      RoomEvent.ParticipantDisconnected, RoomEvent.TrackPublished, RoomEvent.TrackSubscribed, RoomEvent.TrackUnsubscribed];
    for (const event of events) room.on(event, sync);
    room.on(RoomEvent.Connected, recovered);
    room.on(RoomEvent.Reconnected, recovered);
    room.on(RoomEvent.TrackSubscriptionFailed, failed);
    sync();
    return () => {
      for (const event of events) room.off(event, sync);
      room.off(RoomEvent.Connected, recovered);
      room.off(RoomEvent.Reconnected, recovered);
      room.off(RoomEvent.TrackSubscriptionFailed, failed);
    };
  }, [room, classId, teacherId, isHost]);

  const change = useCallback((studentId: string | null, announceAll = false) => {
    if (!isHost) return;
    const sequence = ++latest.current;
    const isCurrent = () => mounted.current && currentScope.current === scope && sequence === latest.current;
    setBusy(true); setControlError(false);
    // Coalesce rapid board switches and serialize writes already in flight.
    queue.current = queue.current.catch(() => {}).then(async () => {
      if (!isCurrent()) return;
      await onlineClassesApi.setAudioFocus(classId, studentId, announceAll);
    }).catch(() => { if (isCurrent()) setControlError(true); })
      .finally(() => { if (isCurrent()) setBusy(false); });
  }, [isHost, classId, scope]);

  return { focus: focus?.classId === classId ? focus : null, busy, error: controlError || playbackError, change };
}
