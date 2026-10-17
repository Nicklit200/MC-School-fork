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

  it('retries opening the board after a failure instead of silently dropping strokes', async () => {
    api.openAnnotationDocument
      .mockRejectedValueOnce(new Error('500'))
      .mockRejectedValueOnce(new Error('500'))
      .mockResolvedValue(DOC);
    const { result } = board(true);

    // Two failures, then success: the board ends up with its document.
    await waitFor(() => expect(result.current.document?.id).toBe('doc-1'), { timeout: 4000 });
    expect(api.openAnnotationDocument).toHaveBeenCalledTimes(3);

    await act(async () => {
      await result.current.addShape(PEN);
    });
    expect(api.appendAnnotation).toHaveBeenCalledTimes(1);
  });

  it('gives up after a few attempts rather than hammering the server', async () => {
    api.openAnnotationDocument.mockRejectedValue(new Error('500'));
    const { result } = board(true);
    await waitFor(() => expect(api.openAnnotationDocument).toHaveBeenCalledTimes(4), { timeout: 6000 });
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(api.openAnnotationDocument).toHaveBeenCalledTimes(4);
    expect(result.current.document).toBeNull();
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

    let saved: boolean | undefined;
    await act(async () => {
      saved = await result.current.addShape(PEN);
    });

    // Server error must be explicitly reported to the board's persistent
    // local ink overlay, rather than silently pretending save succeeded.
    expect(saved).toBe(false);
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

});

describe('useAnnotationBoard — pages, eraser and move', () => {
  let sequence = 0;

  beforeEach(() => {
    vi.clearAllMocks();
    sequence = 0;
    api.openAnnotationDocument.mockImplementation(async (_c, _t, _id, pageIndex = 0) => ({
      ...DOC,
      id: `doc-${pageIndex}`,
      pageIndex,
    }));
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

  function paged(initial = 0) {
    return renderHook(
      ({ page }: { page: number }) =>
        useAnnotationBoard({
          classId: 'class-1',
          targetType: 'WHITEBOARD',
          targetId: 'board-1',
          pageIndex: page,
          actorId: 'teacher-1',
          isHost: true,
        }),
      { initialProps: { page: initial } },
    );
  }

  it('keeps each page’s marks separate and shows them again on return', async () => {
    const { result, rerender } = paged(0);
    await waitFor(() => expect(result.current.document?.id).toBe('doc-0'));
    await act(async () => {
      await result.current.addShape(PEN);
    });
    expect(result.current.shapes).toHaveLength(1);

    rerender({ page: 1 });
    // Page 1 is empty and its document is not page 0's.
    expect(result.current.shapes).toHaveLength(0);
    await waitFor(() => expect(result.current.document?.id).toBe('doc-1'));
    expect(result.current.shapes).toHaveLength(0);

    rerender({ page: 0 });
    // Back on page 0 the stroke is there immediately, without waiting on the network.
    expect(result.current.shapes).toHaveLength(1);
  });

  it('never files a stroke under a page whose document has not loaded', async () => {
    const { result, rerender } = paged(0);
    await waitFor(() => expect(result.current.document?.id).toBe('doc-0'));
    rerender({ page: 1 });
    expect(result.current.document).toBeNull();
    await act(async () => {
      await result.current.addShape(PEN);
    });
    expect(api.appendAnnotation).not.toHaveBeenCalled();
  });

  it('deletes a whole own stroke without touching the redo stack', async () => {
    const { result } = paged(0);
    await waitFor(() => expect(result.current.document).not.toBeNull());
    await act(async () => {
      await result.current.addShape(PEN);
    });
    const id = result.current.shapes[0].operationId;
    await act(async () => {
      await result.current.eraseShape(id);
    });
    expect(result.current.shapes).toHaveLength(0);
    expect(result.current.canRedo).toBe(false);
  });

  it('will not delete or move someone else’s shape', async () => {
    api.replayAnnotations.mockResolvedValue([
      {
        id: 'r', operationId: 'op-theirs', sequence: 1, actorId: 's', layerOwnerId: 's',
        operationType: 'ADD', payload: JSON.stringify(PEN), createdAt: '',
      },
    ] as never);
    const { result } = paged(0);
    await waitFor(() => expect(result.current.shapes).toHaveLength(1));
    await act(async () => {
      await result.current.eraseShape('op-theirs');
      await result.current.moveShape('op-theirs', PEN);
    });
    expect(api.appendAnnotation).not.toHaveBeenCalled();
  });

  it('moves an own shape in place with a targeted update', async () => {
    const { result } = paged(0);
    await waitFor(() => expect(result.current.document).not.toBeNull());
    await act(async () => {
      await result.current.addShape({ kind: 'rect', x: 0.1, y: 0.1, w: 0.2, h: 0.2 });
    });
    const id = result.current.shapes[0].operationId;
    await act(async () => {
      await result.current.moveShape(id, { kind: 'rect', x: 0.4, y: 0.4, w: 0.2, h: 0.2 });
    });
    expect(result.current.shapes).toHaveLength(1);
    expect(result.current.shapes[0].shape.x).toBe(0.4);
  });

  it('reports saved operations so peers can be told', async () => {
    const onSaved = vi.fn();
    const { result } = renderHook(() =>
      useAnnotationBoard({
        classId: 'class-1', targetType: 'WHITEBOARD', targetId: 'board-1',
        actorId: 'teacher-1', isHost: true, onSaved,
      }),
    );
    await waitFor(() => expect(result.current.document).not.toBeNull());
    await act(async () => {
      await result.current.addShape(PEN);
    });
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ operationType: 'ADD' }), 'doc-0');
  });
});
