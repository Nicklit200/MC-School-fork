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
  shape: Shape;
}

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
          if (!parsed.operationId || !parsed.actorId || !parsed.shape) return;
          setRemotePreviews((current) => ({
            ...current,
            [parsed.operationId]: { actorId: parsed.actorId, shape: parsed.shape },
          }));
          return;
        }

        if (parsed.type === 'annotation' && parsed.operation?.operationId) {
          setRemotePreviews((current) => {
            if (!(parsed.operation.operationId in current)) return current;
            const next = { ...current };
            delete next[parsed.operation.operationId];
            return next;
          });
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
    const timer = window.setInterval(() => void poll(), 1500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [classId, document, merge]);

  const shapes = useMemo(() => foldOperations(operations), [operations]);
  const undoable = useMemo(() => undoableOperations(operations, actorId), [operations, actorId]);

  const submit = useCallback(
    async (
      operationType: Operation['operationType'],
      payload: string,
      requestedOperationId?: string,
    ) => {
      if (!document) return;
      const operationId = requestedOperationId ?? newId();
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
          // Put the optimistic realtime operation after already-persisted ones.
          // The server-assigned sequence replaces this same operationId shortly
          // after persistence succeeds.
          sequence: Math.max(lastSequence.current + 1, Date.now()),
        },
      };
      void room.localParticipant
        .publishData(new TextEncoder().encode(JSON.stringify(realtimePacket)), {
          reliable: false,
          topic: ANNOTATION_TOPIC,
        })
        .catch(() => undefined);

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
    [actorId, classId, document, merge, room],
  );

  const previewShape = useCallback(
    (operationId: string, shape: Shape) => {
      if (!document) return;
      const packet: RealtimeAnnotationPreviewPacket = {
        v: 1,
        type: 'annotation-preview',
        classId,
        documentId: document.id,
        operationId,
        actorId,
        shape,
      };
      void room.localParticipant
        .publishData(new TextEncoder().encode(JSON.stringify(packet)), {
          reliable: false,
          topic: ANNOTATION_TOPIC,
        })
        .catch(() => undefined);
    },
    [actorId, classId, document, room],
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

  const previewShapes = useMemo(
    () =>
      Object.entries(remotePreviews).map(([operationId, preview]) => ({
        operationId: `preview-${operationId}`,
        layerOwnerId: preview.actorId,
        sequence: Number.MAX_SAFE_INTEGER,
        shape: preview.shape,
      })),
    [remotePreviews],
  );

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
