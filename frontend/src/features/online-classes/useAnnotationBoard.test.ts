import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { onlineClassesApi, type AnnotationDocument } from '../../api/onlineClasses';
import { useAnnotationBoard } from './useAnnotationBoard';

vi.mock('../../api/onlineClasses', async () => {
  const actual = await vi.importActual<typeof import('../../api/onlineClasses')>(
    '../../api/onlineClasses',
  );
  return {
    ...actual,
    onlineClassesApi: {
      openAnnotationDocument: vi.fn(),
      replayAnnotations: vi.fn(),
      appendAnnotation: vi.fn(),
    },
  };
});

const api = vi.mocked(onlineClassesApi);

const DOC: AnnotationDocument = {
  id: 'doc-1',
  targetType: 'WHITEBOARD',
  targetId: 'board-1',
  pageIndex: 0,
  sourceWidth: 1920,
  sourceHeight: 1080,
  revision: 0,
  snapshotSavedAt: null,
};

const PEN = { kind: 'pen' as const, width: 0.004, points: [[0.1, 0.2]] as [number, number][] };

function board(isHost = false) {
  return renderHook(() =>
    useAnnotationBoard({
      classId: 'class-1',
      targetType: 'WHITEBOARD',
      targetId: 'board-1',
      actorId: 'teacher-1',
      isHost,
    }),
  );
}

describe('useAnnotationBoard', () => {
  let sequence = 0;

  beforeEach(() => {
    vi.clearAllMocks();
    sequence = 0;
    api.openAnnotationDocument.mockResolvedValue(DOC);
    api.replayAnnotations.mockResolvedValue([]);
    api.appendAnnotation.mockImplementation(
      async (_c, _d, operationId, operationType, payload) =>
        ({
          id: `row-${++sequence}`,
          operationId,
          sequence,
          actorId: 'teacher-1',
          layerOwnerId: 'teacher-1',
          operationType,
          payload,
          createdAt: new Date().toISOString(),
        }) as never,
    );
  });

  it('opens the document and replays existing operations', async () => {
    api.replayAnnotations.mockResolvedValue([
      {
        id: 'row-0',
        operationId: 'op-existing',
        sequence: 1,
        actorId: 'student-1',
        layerOwnerId: 'student-1',
        operationType: 'ADD',
        payload: JSON.stringify(PEN),
        createdAt: new Date().toISOString(),
      },
    ] as never);

    const { result } = board();

    await waitFor(() => expect(result.current.shapes).toHaveLength(1));
    expect(result.current.document?.id).toBe('doc-1');
  });

  it('shows a stroke optimistically then reconciles it', async () => {
    const { result } = board();
    await waitFor(() => expect(result.current.document).not.toBeNull());

    await act(async () => {
      await result.current.addShape(PEN);
    });

    expect(result.current.shapes).toHaveLength(1);
    // Reconciled to the server-assigned sequence, not the optimistic negative.
    expect(result.current.shapes[0].sequence).toBeGreaterThan(0);
  });

  it('removes an optimistic stroke the server rejected', async () => {
    api.appendAnnotation.mockRejectedValue(new Error('invalid'));
    const { result } = board();
    await waitFor(() => expect(result.current.document).not.toBeNull());

    await act(async () => {
      await result.current.addShape(PEN);
    });

    // Never show something nobody else has.
    expect(result.current.shapes).toHaveLength(0);
  });

  it('undoes and redoes the actor’s own stroke', async () => {
    const { result } = board();
    await waitFor(() => expect(result.current.document).not.toBeNull());
    await act(async () => {
      await result.current.addShape(PEN);
    });
    expect(result.current.canUndo).toBe(true);

    await act(async () => {
      await result.current.undo();
    });
    expect(result.current.shapes).toHaveLength(0);
    expect(result.current.canRedo).toBe(true);

    await act(async () => {
      await result.current.redo();
    });
    expect(result.current.shapes).toHaveLength(1);
  });

  it('cannot undo when the actor has drawn nothing', async () => {
    api.replayAnnotations.mockResolvedValue([
      {
        id: 'row-0',
        operationId: 'op-theirs',
        sequence: 1,
        actorId: 'student-1',
        layerOwnerId: 'student-1',
        operationType: 'ADD',
        payload: JSON.stringify(PEN),
        createdAt: new Date().toISOString(),
      },
    ] as never);
    const { result } = board();

    await waitFor(() => expect(result.current.shapes).toHaveLength(1));

    // Someone else's stroke is not undoable by this actor.
    expect(result.current.canUndo).toBe(false);
  });

  it('clears only the actor’s own layer', async () => {
    const { result } = board();
    await waitFor(() => expect(result.current.document).not.toBeNull());

    await act(async () => {
      await result.current.clearMine();
    });

    expect(api.appendAnnotation).toHaveBeenCalledWith(
      'class-1',
      'doc-1',
      expect.any(String),
      'CLEAR_LAYER',
      '{}',
    );
  });

  it('does not let a student clear everything', async () => {
    const { result } = board(false);
    await waitFor(() => expect(result.current.document).not.toBeNull());

    await act(async () => {
      await result.current.clearAll();
    });

    expect(api.appendAnnotation).not.toHaveBeenCalled();
  });

  it('lets the host clear everything', async () => {
    const { result } = board(true);
    await waitFor(() => expect(result.current.document).not.toBeNull());

    await act(async () => {
      await result.current.clearAll();
    });

    expect(api.appendAnnotation).toHaveBeenCalledWith(
      'class-1',
      'doc-1',
      expect.any(String),
      'CLEAR_ALL',
      '{}',
    );
  });

  it('merges a realtime operation without duplicating it', async () => {
    const { result } = board();
    await waitFor(() => expect(result.current.document).not.toBeNull());

    const incoming = {
      operationId: 'op-remote',
      sequence: 5,
      actorId: 'student-1',
      layerOwnerId: 'student-1',
      operationType: 'ADD' as const,
      payload: JSON.stringify(PEN),
    };

    act(() => {
      result.current.ingest(incoming);
      result.current.ingest(incoming);
    });

    expect(result.current.shapes).toHaveLength(1);
  });
});
