import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRoomContext } from '@livekit/components-react';
import { RoomEvent } from 'livekit-client';
import {
  onlineClassesApi,
  type AnnotationDocument,
  type AnnotationTargetType,
} from '../../api/onlineClasses';
import {
  type Operation,
  type Shape,
  foldOperations,
  undoableOperations,
} from './annotations';
import { ANNOTATION_TOPIC } from './events';

function newId(): string {
  return typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

interface RealtimeAnnotationPacket {
  v: 1;
  type: 'annotation';
  classId: string;
  documentId: string;
  operation: Operation;
}

interface RealtimeAnnotationPreviewPacket {
  v: 1;
  type: 'annotation-preview';
  classId: string;
  documentId: string;
  operationId: string;
  actorId: string;
  mode: 'replace' | 'append';
  shape?: Shape;
  points?: [number, number][];
}

interface PreviewSendState {
  sentPoints: number;
  lastSentAt: number;
  pendingShape: Shape | null;
  timer: number | null;
}

const PREVIEW_INTERVAL_MS = 24;

/**
 * Board state for one annotated surface.
 *
 * <p>Operations are applied optimistically and reconciled against the server's
 * assigned sequence. Because the stream is append-only and folding is pure, a
 * reconnecting client can replay from its last known sequence rather than
 * refetching the whole document.
 */
export function useAnnotationBoard({
  classId,
  targetType,
  targetId,
  pageIndex = 0,
  actorId,
  isHost,
  sourceWidth,
  sourceHeight,
}: {
  classId: string;
  targetType: AnnotationTargetType;
  targetId: string;
  pageIndex?: number;
  actorId: string;
  isHost: boolean;
  sourceWidth?: number;
  sourceHeight?: number;
}) {
  const [document, setDocument] = useState<AnnotationDocument | null>(null);
  const [operations, setOperations] = useState<Operation[]>([]);
  const [redoStack, setRedoStack] = useState<string[]>([]);
  const [remotePreviews, setRemotePreviews] = useState<
    Record<string, { actorId: string; shape: Shape }>
  >({});
  const room = useRoomContext();
  const mounted = useRef(true);
  // Optimistic entries use a negative sequence so they sort after nothing and
  // are replaced the moment the server assigns a real one.
  const optimisticSequence = useRef(-1);
  const lastSequence = useRef(0);
  const previewSendState = useRef(new Map<string, PreviewSendState>());

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const merge = useCallback((incoming: Operation) => {
    if (incoming.sequence > 0) {
      lastSequence.current = Math.max(lastSequence.current, incoming.sequence);
    }
    setOperations((current) => {
      const index = current.findIndex((item) => item.operationId === incoming.operationId);
      if (index >= 0) {
        const next = current.slice();
        next[index] = incoming;
        return next;
      }
      return [...current, incoming];
    });
  }, []);

  useEffect(() => {
    const onData = (payload: Uint8Array, _participant: unknown, _kind: unknown, topic?: string) => {
      if (topic !== ANNOTATION_TOPIC || !document) return;
      try {
        const parsed = JSON.parse(new TextDecoder().decode(payload)) as
          | RealtimeAnnotationPacket
          | RealtimeAnnotationPreviewPacket;
        if (
          parsed?.v !== 1
          || parsed.classId !== classId
          || parsed.documentId !== document.id
        ) {
          return;
        }

        if (parsed.type === 'annotation-preview') {
          if (!parsed.operationId || !parsed.actorId) return;
          setRemotePreviews((current) => {
            if (parsed.mode === 'replace' && parsed.shape) {
              return {
                ...current,
                [parsed.operationId]: { actorId: parsed.actorId, shape: parsed.shape },
              };
            }

            if (parsed.mode === 'append' && parsed.points?.length) {
              const existing = current[parsed.operationId];
              if (!existing?.shape.points) return current;
              return {
                ...current,
                [parsed.operationId]: {
                  actorId: existing.actorId,
                  shape: {
                    ...existing.shape,
                    points: [...existing.shape.points, ...parsed.points],
                  },
                },
              };
            }

            return current;
          });
          return;
        }

        if (parsed.type === 'annotation' && parsed.operation?.operationId) {
          merge(parsed.operation);
        }
      } catch {
        // Malformed realtime packets are ignored. The durable replay remains
        // authoritative and will reconcile the board.
      }
    };

    room.on(RoomEvent.DataReceived, onData);
    return () => {
      room.off(RoomEvent.DataReceived, onData);
    };
  }, [classId, document, merge, room]);

  useEffect(() => {
    let active = true;
    onlineClassesApi
      .openAnnotationDocument(classId, targetType, targetId, pageIndex, sourceWidth, sourceHeight)
      .then(async (opened) => {
        if (!active) return;
        setDocument(opened);
        const replayed = await onlineClassesApi.replayAnnotations(classId, opened.id, 0);
        if (!active) return;
        const replayedOperations = replayed as unknown as Operation[];
        setOperations(replayedOperations);
        lastSequence.current = replayedOperations.reduce(
          (max, operation) => Math.max(max, operation.sequence > 0 ? operation.sequence : 0),
          0,
        );
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [classId, targetType, targetId, pageIndex, sourceWidth, sourceHeight]);

  // Durable fallback/reconnect path. Realtime operations arrive over LiveKit;
  // this incremental replay repairs any lossy packet that was dropped and
  // catches a participant up after reconnecting.
  useEffect(() => {
    if (!document) return;
    let active = true;
    let inFlight = false;

    const poll = async () => {
      if (!active || inFlight) return;
      inFlight = true;
      try {
        const incoming = await onlineClassesApi.replayAnnotations(
          classId,
          document.id,
          lastSequence.current,
        );
        if (!active) return;
        (incoming as unknown as Operation[]).forEach(merge);
      } catch {
        // A transient network hiccup should not blank the board. The next poll
        // resumes from the last successfully merged sequence.
      } finally {
        inFlight = false;
      }
    };

    void poll();
    const timer = window.setInterval(() => void poll(), 2500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [classId, document, merge]);

  const shapes = useMemo(() => foldOperations(operations), [operations]);

  // Flicker-free handoff: keep a remote preview visible until the same
  // operation is already present in the authoritative/rendered shape list.
  // Cleanup happens after the render that contains the final shape, so there is
  // never a frame where both preview and final shape are absent.
  useEffect(() => {
    const authoritativeIds = new Set(shapes.map((shape) => shape.operationId));
    const stalePreviewIds = Object.keys(remotePreviews).filter((id) => authoritativeIds.has(id));
    if (stalePreviewIds.length === 0) return;

    const frame = window.requestAnimationFrame(() => {
      setRemotePreviews((current) => {
        let changed = false;
        const next = { ...current };
        for (const id of stalePreviewIds) {
          if (id in next) {
            delete next[id];
            changed = true;
          }
        }
        return changed ? next : current;
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [remotePreviews, shapes]);

  const undoable = useMemo(() => undoableOperations(operations, actorId), [operations, actorId]);

  const flushPreview = useCallback(
    (operationId: string) => {
      if (!document) return;
      const state = previewSendState.current.get(operationId);
      const shape = state?.pendingShape;
      if (!state || !shape) return;

      state.pendingShape = null;
      state.lastSentAt = performance.now();
      if (state.timer !== null) {
        window.clearTimeout(state.timer);
        state.timer = null;
      }

      let packet: RealtimeAnnotationPreviewPacket;

      if (shape.points) {
        if (state.sentPoints === 0) {
          // First packet carries style plus the first sampled points.
          packet = {
            v: 1,
            type: 'annotation-preview',
            classId,
            documentId: document.id,
            operationId,
            actorId,
            mode: 'replace',
            shape,
          };
          state.sentPoints = shape.points.length;
        } else {
          const points = shape.points.slice(state.sentPoints);
          if (points.length === 0) return;
          packet = {
            v: 1,
            type: 'annotation-preview',
            classId,
            documentId: document.id,
            operationId,
            actorId,
            mode: 'append',
            points,
          };
          state.sentPoints = shape.points.length;
        }
      } else {
        // Geometry tools are already tiny, so replacing their current bounds
        // is cheaper and simpler than inventing field-level deltas.
        packet = {
          v: 1,
          type: 'annotation-preview',
          classId,
          documentId: document.id,
          operationId,
          actorId,
          mode: 'replace',
          shape,
        };
      }

      void room.localParticipant
        .publishData(new TextEncoder().encode(JSON.stringify(packet)), {
          reliable: false,
          topic: ANNOTATION_TOPIC,
        })
        .catch(() => undefined);
    },
    [actorId, classId, document, room],
  );

  const submit = useCallback(
    async (
      operationType: Operation['operationType'],
      payload: string,
      requestedOperationId?: string,
    ) => {
      if (!document) return;
      const operationId = requestedOperationId ?? newId();
      if (requestedOperationId) {
        flushPreview(operationId);
      }
      const optimistic: Operation = {
        operationId,
        sequence: optimisticSequence.current--,
        actorId,
        layerOwnerId: actorId,
        operationType,
        payload,
      };
      merge(optimistic);

      // Lowest-latency path: broadcast the operation immediately over LiveKit
      // instead of waiting for the HTTP persistence round-trip. Lossy delivery
      // minimizes delay; the REST write + incremental replay below remain the
      // durable fallback if a packet is ever dropped.
      const realtimePacket: RealtimeAnnotationPacket = {
        v: 1,
        type: 'annotation',
        classId,
        documentId: document.id,
        operation: {
          ...optimistic,
          // Realtime delivery is not authoritative. Sequence 0 prevents this
          // transient packet from advancing the durable replay cursor.
          sequence: 0,
        },
      };
      void room.localParticipant
        .publishData(new TextEncoder().encode(JSON.stringify(realtimePacket)), {
          // Finalized operations are tiny after thinning and must not be lost.
          // In-progress previews use lossy packets below.
          reliable: true,
          topic: ANNOTATION_TOPIC,
        })
        .catch(() => undefined);

      const previewState = previewSendState.current.get(operationId);
      if (previewState && previewState.timer !== null) {
        window.clearTimeout(previewState.timer);
      }
      previewSendState.current.delete(operationId);

      try {
        const saved = await onlineClassesApi.appendAnnotation(
          classId,
          document.id,
          operationId,
          operationType,
          payload,
        );
        if (mounted.current) merge(saved as unknown as Operation);
      } catch {
        // The server rejected it (validation, or the class ended): drop the
        // optimistic shape rather than showing something nobody else has.
        if (mounted.current) {
          setOperations((current) =>
            current.filter((item) => item.operationId !== operationId),
          );
        }
      }
    },
    [actorId, classId, document, flushPreview, merge, room],
  );

  const previewShape = useCallback(
    (operationId: string, shape: Shape) => {
      if (!document) return;

      let state = previewSendState.current.get(operationId);
      if (!state) {
        state = {
          sentPoints: 0,
          lastSentAt: 0,
          pendingShape: null,
          timer: null,
        };
        previewSendState.current.set(operationId, state);
      }

      state.pendingShape = shape;
      const elapsed = performance.now() - state.lastSentAt;

      if (state.lastSentAt === 0 || elapsed >= PREVIEW_INTERVAL_MS) {
        flushPreview(operationId);
        return;
      }

      if (state.timer === null) {
        state.timer = window.setTimeout(
          () => flushPreview(operationId),
          Math.max(0, PREVIEW_INTERVAL_MS - elapsed),
        );
      }
    },
    [document, flushPreview],
  );

  const addShape = useCallback(
    (shape: Shape, operationId?: string) =>
      submit('ADD', JSON.stringify(shape), operationId),
    [submit],
  );

  const undo = useCallback(() => {
    const last = undoable[undoable.length - 1];
    if (!last) return;
    setRedoStack((current) => [...current, last.operationId]);
    return submit('UNDO', JSON.stringify({ targetOperationId: last.operationId }));
  }, [submit, undoable]);

  const redo = useCallback(() => {
    const target = redoStack[redoStack.length - 1];
    if (!target) return;
    setRedoStack((current) => current.slice(0, -1));
    return submit('REDO', JSON.stringify({ targetOperationId: target }));
  }, [redoStack, submit]);

  const clearMine = useCallback(() => {
    setRedoStack([]);
    return submit('CLEAR_LAYER', '{}');
  }, [submit]);

  const clearAll = useCallback(() => {
    if (!isHost) return;
    setRedoStack([]);
    return submit('CLEAR_ALL', '{}');
  }, [isHost, submit]);

  const previewShapes = useMemo(() => {
    const authoritativeIds = new Set(shapes.map((shape) => shape.operationId));
    return Object.entries(remotePreviews)
      .filter(([operationId]) => !authoritativeIds.has(operationId))
      .map(([operationId, preview]) => ({
        operationId: `preview-${operationId}`,
        layerOwnerId: preview.actorId,
        sequence: Number.MAX_SAFE_INTEGER,
        shape: preview.shape,
      }));
  }, [remotePreviews, shapes]);

  /** Applies an operation that arrived over the realtime channel. */
  const ingest = useCallback(
    (operation: Operation) => {
      merge(operation);
    },
    [merge],
  );

  return {
    document,
    shapes,
    canUndo: undoable.length > 0,
    canRedo: redoStack.length > 0,
    addShape,
    previewShape,
    previewShapes,
    undo,
    redo,
    clearMine,
    clearAll,
    ingest,
  };
}
