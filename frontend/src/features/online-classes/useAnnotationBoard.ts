import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

function newId(): string {
  return typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
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

  // Until annotation data-channel delivery is wired into this screen, keep
  // every participant in sync by replaying only operations newer than the last
  // sequence we have seen. This is lightweight (incremental) and gives a
  // sub-second shared-board experience on staging.
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
    const timer = window.setInterval(() => void poll(), 400);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [classId, document, merge]);

  const shapes = useMemo(() => foldOperations(operations), [operations]);
  const undoable = useMemo(() => undoableOperations(operations, actorId), [operations, actorId]);

  const submit = useCallback(
    async (operationType: Operation['operationType'], payload: string) => {
      if (!document) return;
      const operationId = newId();
      const optimistic: Operation = {
        operationId,
        sequence: optimisticSequence.current--,
        actorId,
        layerOwnerId: actorId,
        operationType,
        payload,
      };
      merge(optimistic);

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
    [actorId, classId, document, merge],
  );

  const addShape = useCallback((shape: Shape) => submit('ADD', JSON.stringify(shape)), [submit]);

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
    undo,
    redo,
    clearMine,
    clearAll,
    ingest,
  };
}
