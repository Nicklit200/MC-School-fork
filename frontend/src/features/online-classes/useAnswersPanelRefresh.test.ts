import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lessonPreparationApi } from '../../api/lessonPreparation';
import type { LessonPreparation } from '../../api/types';
import { openPdf, type PdfDoc } from './pdfDocument';
import { useAnswersPanel } from './useAnswersPanel';

// Keep the real usePdf lifecycle: the regression is stale PDF ownership, not
// just a metadata flag or a mocked cache key changing.
vi.mock('../../api/lessonPreparation', () => ({ lessonPreparationApi: {
  get: vi.fn(), answersMetadata: vi.fn(), answersBytes: vi.fn(), uploadAnswers: vi.fn(),
  personalAnswersMetadata: vi.fn(), personalAnswersBytes: vi.fn(), uploadPersonalAnswers: vi.fn(),
} }));
vi.mock('./pdfDocument', () => ({ openPdf: vi.fn(), widthBucket: (width: number) => width }));

const api = vi.mocked(lessonPreparationApi);
type Metadata = { hasAnswers: boolean; answersFilename: string | null; version: number };
type TestDoc = PdfDoc & { stamp: string };
let sharedVersion = 1;
let personalVersions: Record<string, number> = {};
const metadata = (version: number): Metadata => ({ hasAnswers: true, answersFilename: 'answers.pdf', version });
const bytes = (version: number, personal = 0) => new Uint8Array([version, personal]).buffer;
const parsed = (data: ArrayBuffer): TestDoc => ({
  stamp: [...new Uint8Array(data)].join(':'), pageCount: 4,
  renderPage: vi.fn(), destroy: vi.fn(),
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function settle() { await act(async () => { await Promise.resolve(); }); }
async function tick(milliseconds = 4000) {
  await act(async () => { await vi.advanceTimersByTimeAsync(milliseconds); });
}
async function focus() {
  await act(async () => { window.dispatchEvent(new Event('focus')); });
}
function documentOf(value: ReturnType<typeof useAnswersPanel>): TestDoc {
  expect(value.pdf.status).toBe('ready');
  if (value.pdf.status !== 'ready') throw new Error('Expected the current PDF to be ready');
  return value.pdf.doc as TestDoc;
}

describe('live answers refresh with the real PDF lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    sharedVersion = 1; personalVersions = { alice: 1, bob: 1 };
    api.answersMetadata.mockReset().mockImplementation(async () => metadata(sharedVersion));
    api.answersBytes.mockReset().mockImplementation(async () => bytes(sharedVersion));
    api.personalAnswersMetadata.mockReset().mockImplementation(async (_eventId, studentId) => ({ studentId, ...metadata(personalVersions[studentId]) }));
    api.personalAnswersBytes.mockReset().mockImplementation(async (_eventId, studentId) => bytes(personalVersions[studentId], studentId === 'alice' ? 1 : 2));
    api.uploadAnswers.mockReset(); api.uploadPersonalAnswers.mockReset();
    vi.mocked(openPdf).mockReset().mockImplementation(async data => parsed(data));
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

  it('adopts a same-filename shared replacement on the timer and never reloads an unchanged version', async () => {
    const { result } = renderHook(() => useAnswersPanel('lesson', true));
    await settle();
    act(() => result.current.toggle()); await settle();
    const original = documentOf(result.current);
    expect(original.stamp).toBe('1:0');
    act(() => { result.current.setView({ page: 2, zoom: 2 }); result.current.rememberScroll(240, 16); });
    await tick(12000);
    expect(documentOf(result.current)).toBe(original);
    expect(api.answersBytes).toHaveBeenCalledTimes(1);
    expect(openPdf).toHaveBeenCalledTimes(1);
    expect(result.current.getView()).toEqual({ page: 2, zoom: 2, scrollTop: 240, scrollLeft: 16 });

    sharedVersion = 2; await tick();
    expect(documentOf(result.current).stamp).toBe('2:0');
    expect(original.destroy).toHaveBeenCalledOnce();
    expect(api.answersBytes).toHaveBeenCalledTimes(2);
    expect(openPdf).toHaveBeenCalledTimes(2);
    expect(result.current.getView()).toEqual({ page: 0, zoom: 1, scrollTop: 0, scrollLeft: 0 });
    await tick(8000);
    expect(api.answersBytes).toHaveBeenCalledTimes(2);
    expect(api.get).not.toHaveBeenCalled();
  });

  it('refreshes private answers on focus and visibility without reading shared or another pupil PDF', async () => {
    const { result } = renderHook(() => useAnswersPanel('lesson', true, 'alice', 'teacher'));
    await settle(); act(() => result.current.toggle()); await settle();
    const original = documentOf(result.current);
    personalVersions.alice = 2; await focus();
    expect(documentOf(result.current).stamp).toBe('2:1');
    expect(original.destroy).toHaveBeenCalledOnce();
    personalVersions.alice = 3;
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(documentOf(result.current).stamp).toBe('3:1');
    expect(api.personalAnswersBytes.mock.calls.every(([eventId, studentId]) => eventId === 'lesson' && studentId === 'alice')).toBe(true);
    expect(api.answersMetadata).not.toHaveBeenCalled(); expect(api.answersBytes).not.toHaveBeenCalled();
  });

  it('keeps the displayed PDF while a replacement parses, then swaps and releases it', async () => {
    const { result } = renderHook(() => useAnswersPanel('lesson', true));
    await settle(); act(() => result.current.toggle()); await settle();
    const original = documentOf(result.current), candidate = parsed(bytes(2));
    const pending = deferred<PdfDoc>();
    vi.mocked(openPdf).mockReturnValueOnce(pending.promise);
    sharedVersion = 2; await tick();
    expect(documentOf(result.current)).toBe(original);
    expect(original.destroy).not.toHaveBeenCalled();
    await act(async () => { pending.resolve(candidate); });
    expect(documentOf(result.current)).toBe(candidate);
    expect(original.destroy).toHaveBeenCalledOnce();
    expect(openPdf).toHaveBeenCalledTimes(2);
    expect(api.answersBytes).toHaveBeenCalledTimes(2);
  });

  it.each(['metadata', 'download', 'parse'] as const)('keeps the old PDF after a temporary %s failure and retries the new version', async failure => {
    const { result } = renderHook(() => useAnswersPanel('lesson', true));
    await settle(); act(() => result.current.toggle()); await settle();
    const original = documentOf(result.current);
    sharedVersion = 2;
    if (failure === 'metadata') api.answersMetadata.mockRejectedValueOnce(new Error('temporary metadata outage'));
    else if (failure === 'download') api.answersBytes.mockRejectedValueOnce(new Error('temporary PDF outage'));
    else vi.mocked(openPdf).mockRejectedValueOnce(new Error('temporary parser failure'));
    await tick();
    expect(documentOf(result.current)).toBe(original);
    expect(original.destroy).not.toHaveBeenCalled();
    expect(result.current.status).toBe('available');
    await tick();
    expect(documentOf(result.current).stamp).toBe('2:0');
    expect(original.destroy).toHaveBeenCalledOnce();
  });

  it('destroys a late previous pupil replacement instead of exposing it in the new pupil scope', async () => {
    const { result, rerender } = renderHook(({ studentId }) => useAnswersPanel('lesson', true, studentId, 'teacher'), { initialProps: { studentId: 'alice' } });
    await settle(); act(() => result.current.toggle()); await settle();
    const pending = deferred<PdfDoc>(), late = parsed(bytes(2, 1));
    vi.mocked(openPdf).mockReturnValueOnce(pending.promise);
    personalVersions.alice = 2; await tick();
    rerender({ studentId: 'bob' }); await settle();
    const bob = documentOf(result.current);
    expect(bob.stamp).toBe('1:2');
    await act(async () => { pending.resolve(late); });
    expect(documentOf(result.current)).toBe(bob);
    expect(late.destroy).toHaveBeenCalledOnce();
    expect(api.answersBytes).not.toHaveBeenCalled();
  });

  it('does not let an older metadata response overwrite an uploaded replacement', async () => {
    const { result } = renderHook(() => useAnswersPanel('lesson', true));
    await settle(); act(() => result.current.toggle()); await settle();
    const oldMetadata = deferred<Metadata>();
    api.answersMetadata.mockReturnValueOnce(oldMetadata.promise);
    await focus();
    api.uploadAnswers.mockImplementationOnce(async () => {
      sharedVersion = 3;
      return { ...metadata(3), eventId: 'lesson', answersVersion: 3 } as unknown as LessonPreparation;
    });
    await act(async () => { await result.current.upload(new File(['%PDF replacement'], 'answers.pdf', { type: 'application/pdf' })); });
    const replacement = documentOf(result.current);
    expect(replacement.stamp).toBe('3:0');
    await act(async () => { oldMetadata.resolve(metadata(2)); });
    await tick();
    expect(documentOf(result.current)).toBe(replacement);
    expect(api.answersBytes).toHaveBeenCalledTimes(2);
  });

  it('probes availability without downloading unopened PDFs and cleans up its timer and focus listener', async () => {
    const { result, unmount } = renderHook(() => useAnswersPanel('lesson', true));
    await settle(); sharedVersion = 2; await tick();
    expect(result.current.status).toBe('available'); expect(result.current.pdf.status).toBe('idle');
    expect(api.answersBytes).not.toHaveBeenCalled();
    const calls = api.answersMetadata.mock.calls.length;
    unmount(); await focus(); await tick(12000);
    expect(api.answersMetadata).toHaveBeenCalledTimes(calls);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    { eventId: 'lesson', isHost: false, pending: false },
    { eventId: 'lesson', isHost: true, pending: true },
    { eventId: undefined, isHost: true, pending: false },
  ])('never polls or fetches protected PDFs without an accessible host scope: %j', async input => {
    renderHook(() => useAnswersPanel(input.eventId, input.isHost, 'alice', 'teacher', input.pending));
    await settle(); await focus(); await tick(12000);
    expect(api.answersMetadata).not.toHaveBeenCalled(); expect(api.personalAnswersMetadata).not.toHaveBeenCalled();
    expect(api.answersBytes).not.toHaveBeenCalled(); expect(api.personalAnswersBytes).not.toHaveBeenCalled();
    expect(openPdf).not.toHaveBeenCalled();
  });
});
