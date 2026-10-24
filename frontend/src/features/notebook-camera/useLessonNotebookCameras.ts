import { useEffect, useMemo, useState } from 'react';
import { ApiRequestError } from '../../api/client';
import { notebookCameraError, notebookCamerasApi, type NotebookCamera } from '../../api/notebookCameras';

interface LessonNotebookCameraOptions {
  eventId?: string;
  classId?: string;
  enabled: boolean;
}

interface CameraSnapshot {
  scope: string;
  cameras: NotebookCamera[];
  error: string | null;
}

const EMPTY_CAMERAS: NotebookCamera[] = [];
const POLL_MS = 5000;

function connectedCameras(values: NotebookCamera[], eventId: string, classId: string | undefined, now: number) {
  const byOwner = new Map<string, NotebookCamera>();
  for (const camera of values) {
    if (camera.eventId !== eventId || (camera.classId ?? null) !== (classId ?? null)
      || camera.status !== 'CONNECTED' || !(Date.parse(camera.sessionExpiresAt) > now)) continue;
    const previous = byOwner.get(camera.ownerId);
    const expiry = Date.parse(camera.sessionExpiresAt);
    const previousExpiry = previous ? Date.parse(previous.sessionExpiresAt) : 0;
    if (!previous || expiry > previousExpiry || expiry === previousExpiry && camera.cameraId > previous.cameraId) {
      byOwner.set(camera.ownerId, camera);
    }
  }
  return [...byOwner.values()].sort((left, right) => left.ownerId.localeCompare(right.ownerId));
}

function sameCameras(left: NotebookCamera[], right: NotebookCamera[]) {
  return left.length === right.length && left.every((camera, index) => {
    const other = right[index];
    return camera.cameraId === other.cameraId && camera.eventId === other.eventId
      && (camera.classId ?? null) === (other.classId ?? null) && camera.ownerId === other.ownerId
      && camera.ownerName === other.ownerName && camera.status === other.status
      && camera.sessionExpiresAt === other.sessionExpiresAt && camera.pairingExpiresAt === other.pairingExpiresAt;
  });
}

/** Discovers connected notebook cameras for the host without creating a pairing or a media connection. */
export function useLessonNotebookCameras({ eventId, classId, enabled }: LessonNotebookCameraOptions) {
  const scope = JSON.stringify([eventId ?? null, classId ?? null, enabled]);
  const [snapshot, setSnapshot] = useState<CameraSnapshot>({ scope, cameras: EMPTY_CAMERAS, error: null });

  useEffect(() => {
    setSnapshot({ scope, cameras: EMPTY_CAMERAS, error: null });
    if (!enabled || !eventId) return;

    let active = true;
    let stopped = false;
    let sequence = 0;
    let timer: ReturnType<typeof setInterval>;
    const load = async () => {
      if (!active || stopped) return;
      const request = ++sequence;
      try {
        const values = await notebookCamerasApi.list(eventId);
        if (!active || stopped || request !== sequence) return;
        const next = connectedCameras(values, eventId, classId, Date.now());
        setSnapshot(previous => ({ scope, cameras: previous.scope === scope && sameCameras(previous.cameras, next) ? previous.cameras : next, error: null }));
      } catch (reason) {
        if (!active || stopped || request !== sequence) return;
        const error = notebookCameraError(reason);
        if (reason instanceof ApiRequestError && [403, 404].includes(reason.status)) {
          stopped = true;
          clearInterval(timer);
          setSnapshot({ scope, cameras: EMPTY_CAMERAS, error });
        } else {
          setSnapshot(previous => ({ scope, cameras: previous.scope === scope ? previous.cameras : EMPTY_CAMERAS, error }));
        }
      }
    };

    timer = setInterval(() => {
      const now = Date.now();
      setSnapshot(previous => {
        if (previous.scope !== scope) return previous;
        const remaining = previous.cameras.filter(camera => Date.parse(camera.sessionExpiresAt) > now);
        return remaining.length === previous.cameras.length ? previous : { ...previous, cameras: remaining };
      });
      void load();
    }, POLL_MS);
    void load();
    return () => { active = false; clearInterval(timer); };
  }, [eventId, classId, enabled, scope]);

  const currentScope = enabled && eventId && snapshot.scope === scope;
  const cameras = currentScope ? snapshot.cameras : EMPTY_CAMERAS;
  const camerasByOwner = useMemo(() => new Map(cameras.map(camera => [camera.ownerId, camera])), [cameras]);
  return { cameras, camerasByOwner, error: currentScope ? snapshot.error : null };
}
