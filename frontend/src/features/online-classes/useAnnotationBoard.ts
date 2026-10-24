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

/** A board that fails to open is retried this many times, with a growing pause. */
const OPEN_RETRIES = 3;
const OPEN_RETRY_DELAY_MS = 500;

function newId(): string {
  return typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

interface PageState {
  document: AnnotationDocument | null;
  operations: Operation[];
}

const EMPTY_PAGE: PageState = { document: null, operations: [] };

/** Highest server-assigned sequence; optimistic entries are negative. */
function lastSequence(operations: Operation[]): number {
  return operations.reduce((max, item) => Math.max(max, item.sequence), 0);
}

/**
 * Board state for one annotated surface, across its pages.
 *
 * <p>Operations are applied optimistically and reconciled against the server's
 * assigned sequence. Because the stream is append-only and folding is pure, a
 * reconnecting client can replay from its last known sequence rather than
 * refetching the whole document.
 *
 * <p>Each page is its own annotation document and keeps its own operations in
 * memory, so flipping back to a page shows its marks immediately (and refreshes
 * quietly) instead of waiting on the network.
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
  onSaved,
}: {
  classId: string;
  targetType: AnnotationTargetType;
  targetId: string;
  pageIndex?: number;
  actorId: string;
  isHost: boolean;
  sourceWidth?: number;
  sourceHeight?: number;
  /** Called after the server accepts an operation, e.g. to tell peers. */
  onSaved?: (operation: Operation, documentId: string) => void;
}) {
  const [pages, setPages] = useState<Record<number, PageState>>({});
  const [redoStack, setRedoStack] = useState<string[]>([]);
  const mounted = useRef(true);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  // Optimistic entries use a negative sequence so they sort after nothing and
  // are replaced the moment the server assigns a real one.
  const optimisticSequence = useRef(-1);
  const pagesRef = useRef(pages);
  pagesRef.current = pages;

  const current = pages[pageIndex] ?? EMPTY_PAGE;
  const document = current.document;
  const operations = current.operations;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const update = useCallback((page: number, change: (state: PageState) => PageState) => {
    setPages((all) => ({ ...all, [page]: change(all[page] ?? EMPTY_PAGE) }));
  }, []);

  const merge = useCallback(
    (page: number, incoming: Operation) => {
      update(page, (state) => {
        const index = state.operations.findIndex((item) => item.operationId === incoming.operationId);
        if (index >= 0) {
          const next = state.operations.slice();
          next[index] = incoming;
          return { ...state, operations: next };
        }
        return { ...state, operations: [...state.operations, incoming] };
      });
    },
    [update],
  );

  useEffect(() => {
    let active = true;
    // Marks from another page must never be drawn on this one, and a stroke
    // must never be filed under the wrong page's document.
    setRedoStack([]);
    const open = async (attempt: number): Promise<void> => {
      try {
        const opened = await onlineClassesApi.openAnnotationDocument(
          classId,
          targetType,
          targetId,
          pageIndex,
          sourceWidth,
          sourceHeight,
        );
        if (!active) return;
        update(pageIndex, (state) => ({ ...state, document: opened }));
        const known = lastSequence(pagesRef.current[pageIndex]?.operations ?? []);
        const replayed = (await onlineClassesApi.replayAnnotations(
          classId,
          opened.id,
          known,
        )) as unknown as Operation[];
        if (!active) return;
        update(pageIndex, (state) => {
          if (known === 0) return { ...state, operations: replayed };
          const byId = new Map(state.operations.map((item) => [item.operationId, item]));
          for (const item of replayed) byId.set(item.operationId, item);
          return { ...state, operations: [...byId.values()] };
        });
      } catch {
        // Without a document every stroke would be dropped silently, so a
        // failed open (a hiccup, a busy server) is retried a few times.
        if (!active || attempt >= OPEN_RETRIES) return;
        await new Promise((resolve) => window.setTimeout(resolve, OPEN_RETRY_DELAY_MS * (attempt + 1)));
        if (active) await open(attempt + 1);
      }
    };
    void open(0);
    return () => {
      active = false;
    };
  }, [classId, targetType, targetId, pageIndex, sourceWidth, sourceHeight, update]);

  const shapes = useMemo(() => foldOperations(operations), [operations]);
  // A durable ADD can already be hidden by a following undo/clear in the same
  // replay batch. Its live preview is still settled by that authoritative ADD;
  // optimistic negative sequences must never acknowledge a remote preview.
  const confirmedStrokeIds = useMemo(() => operations
    .filter(operation => operation.operationType === 'ADD' && operation.sequence > 0)
    .map(operation => operation.operationId), [operations]);
  const undoable = useMemo(() => undoableOperations(operations, actorId), [operations, actorId]);

  const submit = useCallback(
    async (operationType: Operation['operationType'], payload: string, providedOperationId?: string) => {
      if (!document) return false;
      const page = pageIndex;
      const operationId = providedOperationId ?? newId();
      const optimistic: Operation = {
        operationId,
        sequence: optimisticSequence.current--,
        actorId,
        layerOwnerId: actorId,
        operationType,
        payload,
      };
      merge(page, optimistic);

      try {
        const saved = (await onlineClassesApi.appendAnnotation(
          classId,
          document.id,
          operationId,
          operationType,
          payload,
        )) as unknown as Operation;
        if (mounted.current) {
          merge(page, saved);
          onSavedRef.current?.(saved, document.id);
        }
        return true;
      } catch {
        // The server rejected it (validation, or the class ended): drop the
        // optimistic shape rather than showing something nobody else has.
        if (mounted.current) {
          update(page, (state) => ({
            ...state,
            operations: state.operations.filter((item) => item.operationId !== operationId),
          }));
        }
        return false;
      }
    },
    [actorId, classId, document, merge, pageIndex, update],
  );

  const addShape = useCallback((shape: Shape, operationId?: string) => submit('ADD', JSON.stringify(shape), operationId), [submit]);

  const undo = useCallback(() => {
    const last = undoable[undoable.length - 1];
    if (!last) return;
    setRedoStack((stack) => [...stack, last.operationId]);
    return submit('UNDO', JSON.stringify({ targetOperationId: last.operationId }));
  }, [submit, undoable]);

  const redo = useCallback(() => {
    const target = redoStack[redoStack.length - 1];
    if (!target) return;
    setRedoStack((stack) => stack.slice(0, -1));
    return submit('REDO', JSON.stringify({ targetOperationId: target }));
  }, [redoStack, submit]);

  /**
   * Deletes a whole stroke/shape (the eraser's "stroke" mode). Reuses UNDO,
   * which the fold already restricts to the author's own work, so it can never
   * remove someone else's marks. Not pushed to the redo stack: it is a
   * deliberate delete, not a step back.
   */
  const eraseShape = useCallback(
    (operationId: string) => {
      const own = shapes.find((entry) => entry.operationId === operationId);
      if (!own || own.layerOwnerId !== actorId) return;
      return submit('UNDO', JSON.stringify({ targetOperationId: operationId }));
    },
    [actorId, shapes, submit],
  );

  /** Replaces an own shape's geometry in place (selection tool drag). */
  const moveShape = useCallback(
    (operationId: string, shape: Shape) => {
      const own = shapes.find((entry) => entry.operationId === operationId);
      if (!own || own.layerOwnerId !== actorId) return;
      return submit('UPDATE', JSON.stringify({ ...shape, targetOperationId: operationId }));
    },
    [actorId, shapes, submit],
  );

  const clearMine = useCallback(() => {
    setRedoStack([]);
    return submit('CLEAR_LAYER', '{}');
  }, [submit]);

  const clearAll = useCallback(() => {
    if (!isHost) return;
    setRedoStack([]);
    return submit('CLEAR_ALL', '{}');
  }, [isHost, submit]);

  /** Fetches whatever this page is missing; heals gaps in realtime delivery. */
  const refresh = useCallback(async () => {
    if (!document) return;
    const page = pageIndex;
    try {
      const known = lastSequence(pagesRef.current[page]?.operations ?? []);
      const replayed = (await onlineClassesApi.replayAnnotations(
        classId,
        document.id,
        known,
      )) as unknown as Operation[];
      if (!mounted.current) return;
      for (const item of replayed) merge(page, item);
    } catch {
      // Next packet or heartbeat will retry.
    }
  }, [classId, document, merge, pageIndex]);

  return {
    document,
    shapes,
    confirmedStrokeIds,
    canUndo: undoable.length > 0,
    canRedo: redoStack.length > 0,
    addShape,
    undo,
    redo,
    eraseShape,
    moveShape,
    clearMine,
    clearAll,
    refresh,
  };
}
