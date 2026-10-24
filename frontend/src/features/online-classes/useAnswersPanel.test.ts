import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { lessonPreparationApi } from '../../api/lessonPreparation';
import type { LessonPreparation } from '../../api/types';
import { useAnswersPanel } from './useAnswersPanel';
import { usePdf } from './usePdf';
import { openPdf } from './pdfDocument';

const pdfDocuments = vi.hoisted(() => new Map());

vi.mock('../../api/lessonPreparation', () => ({
  lessonPreparationApi: { get: vi.fn(), answersBytes: vi.fn(), uploadAnswers: vi.fn() },
}));
vi.mock('./pdfDocument', () => ({ openPdf: vi.fn() }));
// The PDF layer is exercised in its own tests; here only the gating matters.
vi.mock('./usePdf', () => ({
  usePdf: vi.fn((key: string | null) => {
    if (!key) return { status: 'idle' };
    if (!pdfDocuments.has(key)) pdfDocuments.set(key, { pageCount: 4, renderPage: vi.fn(), destroy: vi.fn() });
    return { status: 'ready', doc: pdfDocuments.get(key) };
  }),
  usePdfPage: vi.fn(() => null),
}));

const api = vi.mocked(lessonPreparationApi);

const prep = (hasAnswers: boolean): LessonPreparation => ({
  eventId: 'e1',
  homeworkNotes: null,
  difficulties: null,
  lessonPlan: null,
  transcriptText: null,
  hasTranscript: false,
  transcriptFilename: null,
  hasWorkbook: false,
  workbookFilename: null,
  hasAnswers,
  answersFilename: hasAnswers ? 'answers.pdf' : null,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const pdfFile = () => new File(['%PDF-1.4 sample'], 'answers.pdf', { type: 'application/pdf' });
const pdfKey = () => vi.mocked(usePdf).mock.calls.at(-1)?.[0];

describe('useAnswersPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks(); pdfDocuments.clear(); api.get.mockReset(); api.uploadAnswers.mockReset(); api.answersBytes.mockReset();
    api.get.mockResolvedValue(prep(false)); api.uploadAnswers.mockResolvedValue(prep(true)); api.answersBytes.mockResolvedValue(new ArrayBuffer(8));
    vi.mocked(openPdf).mockReset().mockImplementation(async () => ({ pageCount: 4, renderPage: vi.fn(), destroy: vi.fn() }));
  });

  it('asks the server for nothing and refuses upload when the viewer is not the host', async () => {
    const { result } = renderHook(() => useAnswersPanel('e1', false));
    expect(result.current.status).toBe('unavailable');
    expect(api.get).not.toHaveBeenCalled();
    act(() => result.current.toggle());
    expect(result.current.open).toBe(false);
    await act(async () => { await result.current.upload(pdfFile()); });
    expect(api.get).not.toHaveBeenCalled(); expect(api.uploadAnswers).not.toHaveBeenCalled(); expect(api.answersBytes).not.toHaveBeenCalled();
  });

  it('opens the empty answers panel so the teacher can upload a first PDF', async () => {
    api.get.mockResolvedValue(prep(false));
    const { result } = renderHook(() => useAnswersPanel('e1', true));
    await waitFor(() => expect(result.current.status).toBe('none'));
    act(() => result.current.toggle());
    expect(result.current.open).toBe(true); expect(result.current.pdf.status).toBe('idle');
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

  it('validates the PDF type and rejects an empty file before making an upload request', async () => {
    const { result } = renderHook(() => useAnswersPanel('e1', true)); await waitFor(() => expect(result.current.status).toBe('none'));
    await act(async () => { await result.current.upload(new File(['text'], 'notes.txt', { type: 'text/plain' })); });
    expect(result.current.uploadError).toBe('Для решений нужен PDF');
    await act(async () => { await result.current.upload(new File([], 'empty.pdf', { type: 'application/pdf' })); });
    expect(result.current.uploadError).toBe('Выбранный PDF пустой');
    expect(api.uploadAnswers).not.toHaveBeenCalled(); expect(api.answersBytes).not.toHaveBeenCalled(); expect(result.current.uploading).toBe(false);
  });

  it('uploads and verifies the first PDF, refreshes the document key and resets its independent view', async () => {
    const { result } = renderHook(() => useAnswersPanel('e1', true)); await waitFor(() => expect(result.current.status).toBe('none'));
    act(() => { result.current.toggle(); result.current.setView({ page: 3, zoom: 2 }); result.current.rememberScroll(250, 20); });
    const file = pdfFile(); await act(async () => { await result.current.upload(file); });
    expect(api.uploadAnswers).toHaveBeenCalledExactlyOnceWith('e1', file); expect(api.answersBytes).toHaveBeenCalledExactlyOnceWith('e1');
    expect(result.current.status).toBe('available'); expect(result.current.open).toBe(true); expect(result.current.pdf.status).toBe('ready');
    expect(pdfKey()).toBe('e1:answers.pdf:1'); expect(result.current.getView()).toEqual({ page: 0, zoom: 1, scrollTop: 0, scrollLeft: 0 });
    expect(result.current.uploadError).toBeNull(); expect(result.current.uploading).toBe(false);
    const [, loader, open] = vi.mocked(usePdf).mock.calls.at(-1)!;
    const loaded = await loader(); await open!(loaded);
    expect(api.answersBytes).toHaveBeenCalledTimes(1);
    expect(openPdf).toHaveBeenCalledTimes(1);
  });

  it('refreshes a replaced PDF even when its filename is unchanged', async () => {
    api.get.mockResolvedValue(prep(true));
    const { result } = renderHook(() => useAnswersPanel('e1', true)); await waitFor(() => expect(result.current.status).toBe('available'));
    act(() => result.current.toggle()); const previous = result.current.pdf, key = pdfKey();
    await act(async () => { await result.current.upload(pdfFile()); });
    expect(pdfKey()).not.toBe(key); expect(result.current.pdf).not.toEqual(previous);
  });

  it.each(['upload', 'empty verification', 'PDF parsing'])('keeps the existing document and view after %s fails and permits retry', async failure => {
    api.get.mockResolvedValue(prep(true));
    const { result } = renderHook(() => useAnswersPanel('e1', true)); await waitFor(() => expect(result.current.status).toBe('available'));
    act(() => { result.current.toggle(); result.current.setView({ page: 2, zoom: 2 }); result.current.rememberScroll(340, 20); });
    const previous = result.current.pdf, key = pdfKey();
    if (failure === 'upload') api.uploadAnswers.mockRejectedValueOnce(new Error('upload failed'));
    else if (failure === 'empty verification') api.answersBytes.mockResolvedValueOnce(new ArrayBuffer(0));
    else vi.mocked(openPdf).mockRejectedValueOnce(new Error('Invalid PDF'));
    await act(async () => { await result.current.upload(pdfFile()); });
    expect(result.current.uploadError).toBe(failure === 'upload' ? 'upload failed' : failure === 'empty verification' ? 'Сервер вернул пустой PDF' : 'Invalid PDF');
    expect(result.current.pdf).toEqual(previous); expect(pdfKey()).toBe(key); expect(result.current.status).toBe('available');
    expect(result.current.getView()).toEqual({ page: 2, zoom: 2, scrollTop: 340, scrollLeft: 20 }); expect(result.current.uploading).toBe(false);
    await act(async () => { await result.current.upload(pdfFile()); }); expect(result.current.uploadError).toBeNull();
  });

  it('prevents duplicate uploads and respects closing the panel while an upload is pending', async () => {
    const pending = deferred<LessonPreparation>(); api.uploadAnswers.mockReturnValue(pending.promise);
    const { result } = renderHook(() => useAnswersPanel('e1', true)); await waitFor(() => expect(result.current.status).toBe('none'));
    act(() => { result.current.toggle(); void result.current.upload(pdfFile()); void result.current.upload(pdfFile()); });
    expect(result.current.uploading).toBe(true); expect(api.uploadAnswers).toHaveBeenCalledTimes(1);
    act(() => result.current.close()); await act(async () => { pending.resolve(prep(true)); });
    expect(result.current.open).toBe(false); expect(result.current.status).toBe('available'); expect(result.current.uploading).toBe(false);
  });

  it('ignores a pending upload after the lesson context changes and rejects old upload callbacks', async () => {
    const pending = deferred<LessonPreparation>(); api.uploadAnswers.mockReturnValue(pending.promise);
    const { result, rerender } = renderHook(({ eventId }) => useAnswersPanel(eventId, true), { initialProps: { eventId: 'e1' } });
    await waitFor(() => expect(result.current.status).toBe('none'));
    const oldUpload = result.current.upload; act(() => { void oldUpload(pdfFile()); });
    rerender({ eventId: 'e2' }); await waitFor(() => expect(result.current.status).toBe('none'));
    await act(async () => { pending.resolve(prep(true)); await oldUpload(pdfFile()); });
    expect(api.uploadAnswers).toHaveBeenCalledTimes(1); expect(api.answersBytes).not.toHaveBeenCalled();
    expect(result.current.status).toBe('none'); expect(result.current.open).toBe(false); expect(result.current.uploading).toBe(false);
  });

  it('does not upload or open when the lesson has no calendar event', async () => {
    const { result } = renderHook(() => useAnswersPanel(undefined, true));
    await act(async () => { result.current.toggle(); await result.current.upload(pdfFile()); });
    expect(result.current.status).toBe('unavailable'); expect(result.current.open).toBe(false);
    expect(api.get).not.toHaveBeenCalled(); expect(api.uploadAnswers).not.toHaveBeenCalled(); expect(api.answersBytes).not.toHaveBeenCalled();
  });
});
