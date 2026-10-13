import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { lessonPreparationApi } from '../../api/lessonPreparation';
import type { LessonPreparation } from '../../api/types';
import { useAnswersPanel } from './useAnswersPanel';

vi.mock('../../api/lessonPreparation', () => ({
  lessonPreparationApi: { get: vi.fn(), answersBytes: vi.fn() },
}));
// The PDF layer is exercised in its own tests; here only the gating matters.
vi.mock('./usePdf', () => ({
  usePdf: vi.fn((key: string | null) =>
    key ? { status: 'ready', doc: { pageCount: 4, renderPage: vi.fn(), destroy: vi.fn() } } : { status: 'idle' },
  ),
  usePdfPage: vi.fn(() => null),
}));

const api = vi.mocked(lessonPreparationApi);

const prep = (hasAnswers: boolean): LessonPreparation => ({
  eventId: 'e1',
  homeworkNotes: null,
  difficulties: null,
  lessonPlan: null,
  hasWorkbook: false,
  workbookFilename: null,
  hasAnswers,
  answersFilename: hasAnswers ? 'answers.pdf' : null,
});

describe('useAnswersPanel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('asks the server for nothing when the viewer is not the host', () => {
    const { result } = renderHook(() => useAnswersPanel('e1', false));
    expect(result.current.status).toBe('unavailable');
    expect(api.get).not.toHaveBeenCalled();
    act(() => result.current.toggle());
    expect(result.current.open).toBe(false);
  });

  it('reports "none" when no answers file is bound, and refuses to open', async () => {
    api.get.mockResolvedValue(prep(false));
    const { result } = renderHook(() => useAnswersPanel('e1', true));
    await waitFor(() => expect(result.current.status).toBe('none'));
    act(() => result.current.toggle());
    expect(result.current.open).toBe(false);
  });

  it('reads a failed lookup as "none" rather than breaking the lesson', async () => {
    api.get.mockRejectedValue(new Error('500'));
    const { result } = renderHook(() => useAnswersPanel('e1', true));
    await waitFor(() => expect(result.current.status).toBe('none'));
  });

  it('opens when answers exist and loads the file only once opened', async () => {
    api.get.mockResolvedValue(prep(true));
    const { result } = renderHook(() => useAnswersPanel('e1', true));
    await waitFor(() => expect(result.current.status).toBe('available'));
    expect(result.current.pdf.status).toBe('idle');
    act(() => result.current.toggle());
    expect(result.current.open).toBe(true);
    expect(result.current.pdf.status).toBe('ready');
  });

  it('remembers page, zoom and scroll across close and reopen, and keeps the document', async () => {
    api.get.mockResolvedValue(prep(true));
    const { result } = renderHook(() => useAnswersPanel('e1', true));
    await waitFor(() => expect(result.current.status).toBe('available'));
    act(() => result.current.toggle());
    act(() => result.current.setView({ page: 2, zoom: 2 }));
    act(() => result.current.rememberScroll(340, 20));

    act(() => result.current.close());
    expect(result.current.open).toBe(false);
    // The document stays loaded while the panel is closed.
    expect(result.current.pdf.status).toBe('ready');

    act(() => result.current.toggle());
    expect(result.current.getView()).toEqual({ page: 2, zoom: 2, scrollTop: 340, scrollLeft: 20 });
  });
});
