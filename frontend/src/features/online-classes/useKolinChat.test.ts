import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { kolinApi, type KolinContext, type KolinResponse, type KolinTranscriptContext, type KolinWorksheet } from '../../api/kolin';
import { ApiRequestError } from '../../api/client';
import { useKolinChat } from './useKolinChat';

vi.mock('../../api/kolin', async importOriginal => ({ ...await importOriginal<typeof import('../../api/kolin')>(),
  kolinApi: { status: vi.fn(), send: vi.fn(), appendWorksheet: vi.fn() } }));

const transcriptContext: KolinTranscriptContext = { state: 'included', segmentCount: 12, truncated: true,
  latestSegmentAt: '2026-11-07T15:45:00Z', fromMs: 120000, toMs: 525000, transcriptionActive: false };

beforeEach(() => {
  vi.mocked(kolinApi.status).mockReset().mockResolvedValue({ configured: true });
  vi.mocked(kolinApi.send).mockReset().mockResolvedValue({ type: 'text', text: '1) 1/2 + 1/4\n2) 2/3 + 1/6' });
  vi.mocked(kolinApi.appendWorksheet).mockReset();
});

async function open(result: { current: ReturnType<typeof useKolinChat> }) {
  act(() => result.current.toggle());
  await waitFor(() => expect(result.current.availability).toBe('ready'));
}
async function ask(result: { current: ReturnType<typeof useKolinChat> }, text: string, context: KolinContext = {}) {
  act(() => result.current.setDraft(text));
  await act(async () => { await result.current.send(context); });
}

describe('private Kolyn lesson session', () => {
  it('does no API work until the teacher opens it, and none at all for a pupil', async () => {
    const pupil = renderHook(() => useKolinChat('class-1', 'pupil', false));
    act(() => { pupil.result.current.toggle(); pupil.result.current.setDraft('hello'); });
    await act(async () => { await pupil.result.current.send({}); });
    expect(pupil.result.current.open).toBe(false);
    expect(kolinApi.status).not.toHaveBeenCalled();
    expect(kolinApi.send).not.toHaveBeenCalled();
    const teacher = renderHook(() => useKolinChat('class-1', 'teacher', true));
    expect(kolinApi.status).not.toHaveBeenCalled();
    await open(teacher.result);
    expect(kolinApi.status).toHaveBeenCalledExactlyOnceWith('class-1');
  });

  it('retains conversation and draft across close/reopen and sends current pupil context separately', async () => {
    const { result } = renderHook(() => useKolinChat('class-1', 'teacher', true));
    await open(result);
    await ask(result, 'Дай 3 задания', { targetType: 'student', studentId: 'alice', currentWorkbookPage: 3 });
    act(() => { result.current.setDraft('Сделай второе сложнее'); result.current.close(); });
    await open(result);
    expect(result.current.draft).toBe('Сделай второе сложнее');
    expect(result.current.messages).toHaveLength(2);
    await act(async () => { await result.current.send({ targetType: 'student', studentId: 'bob' }); });
    expect(vi.mocked(kolinApi.send).mock.calls[1]).toEqual(['class-1', 'Сделай второе сложнее', [
      { role: 'user', text: 'Дай 3 задания' }, { role: 'assistant', text: '1) 1/2 + 1/4\n2) 2/3 + 1/6' },
    ], { targetType: 'student', studentId: 'bob' }, expect.any(String)]);
    expect(result.current.messages.every(message => message.type === 'text')).toBe(true);
    expect(kolinApi.status).toHaveBeenCalledTimes(1);
  });

  it('includes at most eight previous completed messages, never the current question twice', async () => {
    const { result } = renderHook(() => useKolinChat('class-1', 'teacher', true));
    await open(result);
    for (let index = 0; index < 6; index++) await ask(result, `Question ${index}`);
    const last = vi.mocked(kolinApi.send).mock.calls[5];
    expect(last[1]).toBe('Question 5');
    expect(last[2]).toHaveLength(8);
    expect(last[2][0]).toEqual({ role: 'user', text: 'Question 1' });
    expect(last[2].some(message => message.text === 'Question 5')).toBe(false);
    expect(result.current.messages).toHaveLength(12);
  });

  it('keeps each answer transcript snapshot on that answer without sending metadata in history', async () => {
    vi.mocked(kolinApi.send).mockResolvedValueOnce({ type: 'text', text: 'First answer', transcriptContext });
    const { result } = renderHook(() => useKolinChat('class-1', 'teacher', true));
    await open(result);
    await ask(result, 'Use saved lesson speech');
    act(() => result.current.close());
    await open(result);
    expect(result.current.messages[0].transcriptContext).toBeUndefined();
    expect(result.current.messages[1].transcriptContext).toEqual(transcriptContext);
    await ask(result, 'And now?');
    expect(result.current.messages[1].transcriptContext).toEqual(transcriptContext);
    expect(result.current.messages[3].transcriptContext).toBeUndefined();
    expect(vi.mocked(kolinApi.send).mock.calls[1][2]).toEqual([
      { role: 'user', text: 'Use saved lesson speech' }, { role: 'assistant', text: 'First answer' },
    ]);
    expect(kolinApi.status).toHaveBeenCalledTimes(1);
    expect(kolinApi.send).toHaveBeenCalledTimes(2);
  });

  it('ignores malformed optional metadata while keeping the answer and discards stale transcript snapshots', async () => {
    vi.mocked(kolinApi.send).mockResolvedValueOnce({ type: 'text', text: 'Valid answer',
      transcriptContext: { ...transcriptContext, segmentCount: 'not a count' } } as unknown as KolinResponse);
    const { result, rerender } = renderHook(({ classId }) => useKolinChat(classId, 'teacher', true), {
      initialProps: { classId: 'class-1' },
    });
    await open(result);
    await ask(result, 'Question');
    expect(result.current.messages[1].text).toBe('Valid answer');
    expect(result.current.messages[1].transcriptContext).toBeUndefined();
    let resolve!: (value: KolinResponse) => void;
    vi.mocked(kolinApi.send).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    act(() => result.current.setDraft('Pending question'));
    let pending: Promise<void> | undefined;
    act(() => { pending = result.current.send({}); });
    rerender({ classId: 'class-2' });
    await act(async () => { resolve({ type: 'text', text: 'Stale answer', transcriptContext }); await pending; });
    expect(result.current.messages).toEqual([]);
  });

  it('retries a failed question without duplicating its bubble or losing the original context', async () => {
    vi.mocked(kolinApi.send).mockRejectedValueOnce(new Error('network'));
    const { result } = renderHook(() => useKolinChat('class-1', 'teacher', true));
    await open(result);
    await ask(result, 'Ответ?', { studentId: 'alice', targetType: 'student' });
    expect(result.current.draft).toBe('Ответ?');
    expect(result.current.error).toBe('response');
    expect(result.current.messages).toHaveLength(1);
    await act(async () => { await result.current.retry(); });
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0].status).toBe('complete');
    expect(result.current.draft).toBe('');
    expect(vi.mocked(kolinApi.send).mock.calls[1]).toEqual(vi.mocked(kolinApi.send).mock.calls[0]);
  });

  it.each([[undefined, 1], [1, 2]])('reuses the failed request when the same pupil page changes from %s to %s', async (originalPage, currentPage) => {
    vi.mocked(kolinApi.send).mockRejectedValueOnce(new Error('generation failed'));
    const { result } = renderHook(() => useKolinChat('class-1', 'teacher', true));
    await open(result);
    const context: KolinContext = { targetType: 'student', studentId: 'alice',
      ...(originalPage !== undefined ? { currentWorkbookPage: originalPage } : {}) };
    const text = 'А ну дай пару заданий для виталины что по дробям';
    await ask(result, text, context);
    const originalId = result.current.messages[0].id;
    expect(result.current.draft).toBe(text);
    await act(async () => { await result.current.send({ ...context, currentWorkbookPage: currentPage }); });
    expect(vi.mocked(kolinApi.send).mock.calls[1]).toEqual(vi.mocked(kolinApi.send).mock.calls[0]);
    expect(result.current.messages.filter(message => message.role === 'user')).toEqual([
      expect.objectContaining({ id: originalId, text, status: 'complete' }),
    ]);
    expect(result.current.messages.filter(message => message.role === 'assistant')).toHaveLength(1);
  });

  it('creates a distinct request when the recipient changes after a failed send', async () => {
    vi.mocked(kolinApi.send).mockRejectedValueOnce(new Error('generation failed'));
    const { result } = renderHook(() => useKolinChat('class-1', 'teacher', true));
    await open(result);
    await ask(result, 'Дай задания по дробям', { targetType: 'student', studentId: 'alice', currentWorkbookPage: 1 });
    await act(async () => { await result.current.send({ targetType: 'student', studentId: 'bob', currentWorkbookPage: 2 }); });
    const [original, changed] = vi.mocked(kolinApi.send).mock.calls;
    expect(original[3]).toEqual({ targetType: 'student', studentId: 'alice', currentWorkbookPage: 1 });
    expect(changed[3]).toEqual({ targetType: 'student', studentId: 'bob', currentWorkbookPage: 2 });
    expect(changed[4]).not.toBe(original[4]);
    expect(result.current.messages.filter(message => message.role === 'user')).toHaveLength(2);
  });

  it('clears a recognized failure code when retry begins and keeps unknown failures generic', async () => {
    vi.mocked(kolinApi.send).mockRejectedValueOnce(new ApiRequestError(429, 'KOLIN_BUSY', 'private provider message'));
    const { result, rerender } = renderHook(({ classId }) => useKolinChat(classId, 'teacher', true), {
      initialProps: { classId: 'class-1' },
    });
    await open(result);
    await ask(result, 'Дай задания', { studentId: 'alice' });
    expect(result.current.error).toBe('response');
    expect(result.current.failureCode).toBe('KOLIN_BUSY');
    let resolve!: (value: KolinResponse) => void;
    vi.mocked(kolinApi.send).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    let retry!: Promise<void>;
    act(() => { retry = result.current.retry()!; });
    expect(result.current.failureCode).toBeNull();
    expect(result.current.error).toBeNull();
    await act(async () => { resolve({ type: 'text', text: 'Готово' }); await retry; });
    expect(result.current.failureCode).toBeNull();
    vi.mocked(kolinApi.send).mockRejectedValueOnce(new ApiRequestError(502, 'UNKNOWN_CODE', 'private provider message'));
    await ask(result, 'Следующий вопрос');
    expect(result.current.error).toBe('response');
    expect(result.current.failureCode).toBeNull();
    vi.mocked(kolinApi.send).mockRejectedValueOnce(new ApiRequestError(502, 'KOLIN_TASK_INVALID', 'private provider message'));
    await act(async () => { await result.current.retry(); });
    expect(result.current.failureCode).toBe('KOLIN_TASK_INVALID');
    rerender({ classId: 'class-2' });
    expect(result.current.failureCode).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('excludes a failed turn from a new question history and blocks a second send while pending', async () => {
    vi.mocked(kolinApi.send).mockRejectedValueOnce(new Error('network'));
    const { result } = renderHook(() => useKolinChat('class-1', 'teacher', true));
    await open(result);
    await ask(result, 'Failed question');
    let resolve!: (value: { type: 'text'; text: string }) => void;
    vi.mocked(kolinApi.send).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    act(() => result.current.setDraft('Different question'));
    let pending: Promise<void> | undefined;
    act(() => { pending = result.current.send({}); });
    await act(async () => { await result.current.send({}); });
    expect(kolinApi.send).toHaveBeenCalledTimes(2);
    expect(vi.mocked(kolinApi.send).mock.calls[1][2]).toEqual([]);
    await act(async () => { resolve({ type: 'text', text: 'New answer' }); await pending; });
    await ask(result, 'Follow up');
    expect(vi.mocked(kolinApi.send).mock.calls[2][2]).toEqual([
      { role: 'user', text: 'Different question' }, { role: 'assistant', text: 'New answer' },
    ]);
  });

  it('preserves a response while closed and keeps the submitted pupil context after switching pupils', async () => {
    let resolve!: (value: { type: 'text'; text: string }) => void;
    vi.mocked(kolinApi.send).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const { result } = renderHook(() => useKolinChat('class-1', 'teacher', true));
    await open(result);
    act(() => result.current.setDraft('Example'));
    let pending: Promise<void> | undefined;
    act(() => { pending = result.current.send({ targetType: 'student', studentId: 'alice' }); result.current.close(); });
    await act(async () => { resolve({ type: 'text', text: 'Saved answer' }); await pending; });
    expect(result.current.open).toBe(false);
    await open(result);
    expect(result.current.messages[1].text).toBe('Saved answer');
    await ask(result, 'Question for Bob', { targetType: 'student', studentId: 'bob' });
    expect(vi.mocked(kolinApi.send).mock.calls[0][3]).toEqual({ targetType: 'student', studentId: 'alice' });
    expect(vi.mocked(kolinApi.send).mock.calls[1][3]).toEqual({ targetType: 'student', studentId: 'bob' });
  });

  it('resets between lessons and teachers and discards late responses from an earlier scope', async () => {
    let resolve!: (value: { type: 'text'; text: string }) => void;
    vi.mocked(kolinApi.send).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const { result, rerender } = renderHook(({ classId, teacher }) => useKolinChat(classId, teacher, true), {
      initialProps: { classId: 'class-1', teacher: 'teacher-1' },
    });
    await open(result);
    act(() => result.current.setDraft('Old question'));
    let pending: Promise<void> | undefined;
    act(() => { pending = result.current.send({}); });
    rerender({ classId: 'class-2', teacher: 'teacher-1' });
    expect(result.current.messages).toHaveLength(0);
    expect(result.current.open).toBe(false);
    rerender({ classId: 'class-1', teacher: 'teacher-1' });
    await act(async () => { resolve({ type: 'text', text: 'PRIVATE OLD RESPONSE' }); await pending; });
    expect(result.current.messages).toHaveLength(0);
    await open(result);
    let resolveTeacher!: (value: { type: 'text'; text: string }) => void;
    vi.mocked(kolinApi.send).mockImplementationOnce(() => new Promise(done => { resolveTeacher = done; }));
    act(() => result.current.setDraft('New lesson question'));
    act(() => { pending = result.current.send({}); });
    rerender({ classId: 'class-1', teacher: 'teacher-2' });
    await act(async () => { resolveTeacher({ type: 'text', text: 'ANOTHER TEACHER RESPONSE' }); await pending; });
    expect(result.current.messages).toHaveLength(0);
    expect(result.current.draft).toBe('');
  });
});

describe('confirmed Kolyn worksheet append', () => {
  const worksheet: KolinWorksheet = { id: 'artifact-alice', studentId: 'alice', studentName: 'Виталина', taskCount: 3, pageCount: 1, state: 'READY' };
  const response: KolinResponse = { type: 'worksheet', text: 'Задания готовы.', worksheet };

  it('creates a card without appending even when the teacher asks to create and add', async () => {
    vi.mocked(kolinApi.send).mockResolvedValueOnce(response);
    const { result } = renderHook(() => useKolinChat('class-1', 'teacher', true));
    await open(result);
    await ask(result, 'Создай и добавь три задания', { targetType: 'student', studentId: 'alice' });
    expect(result.current.messages[1].worksheet).toEqual(worksheet);
    expect(result.current.messages[1].type).toBe('worksheet');
    expect(kolinApi.appendWorksheet).not.toHaveBeenCalled();
    expect(vi.mocked(kolinApi.send).mock.calls[0][4]).toMatch(/^[0-9a-f-]{36}$/);
    await ask(result, 'Теперь вопрос для другого ученика', { targetType: 'student', studentId: 'bob' });
    expect(vi.mocked(kolinApi.send).mock.calls[1][2]).toEqual([
      { role: 'user', text: 'Создай и добавь три задания' }, { role: 'assistant', text: 'Задания готовы.' },
    ]);
    expect(result.current.messages[1].worksheet?.studentId).toBe('alice');
  });

  it('reuses the same submission ID after a lost generation response and never duplicates the card', async () => {
    vi.mocked(kolinApi.send).mockRejectedValueOnce(new Error('lost response')).mockResolvedValueOnce(response);
    const { result } = renderHook(() => useKolinChat('class-1', 'teacher', true));
    await open(result);
    await ask(result, 'Три задания', { studentId: 'alice' });
    await act(async () => { await result.current.retry(); });
    expect(vi.mocked(kolinApi.send).mock.calls[1]).toEqual(vi.mocked(kolinApi.send).mock.calls[0]);
    expect(result.current.messages.filter(message => message.worksheet)).toHaveLength(1);
    expect(kolinApi.appendWorksheet).not.toHaveBeenCalled();
  });

  it('deduplicates repeated confirmation and refreshes the workbook after the artifact-bound append', async () => {
    vi.mocked(kolinApi.send).mockResolvedValueOnce(response);
    let resolve!: (value: KolinWorksheet) => void;
    vi.mocked(kolinApi.appendWorksheet).mockImplementation(() => new Promise(done => { resolve = done; }));
    const refreshed = vi.fn();
    window.addEventListener('mc-workbook-updated', refreshed);
    const { result } = renderHook(() => useKolinChat('class-1', 'teacher', true));
    try {
      await open(result);
      await ask(result, 'Задания', { studentId: 'alice' });
      await ask(result, 'Вопрос для Боба', { studentId: 'bob' });
      let adding!: Promise<void>;
      act(() => { adding = result.current.appendWorksheet(worksheet.id); });
      await act(async () => { await result.current.appendWorksheet(worksheet.id); });
      expect(kolinApi.appendWorksheet).toHaveBeenCalledExactlyOnceWith('class-1', worksheet.id);
      expect(result.current.messages[1].appendStatus).toBe('pending');
      await act(async () => { resolve({ ...worksheet, state: 'ADDED', fromPage: 4, toPage: 4 }); await adding; });
      expect(result.current.messages[1].worksheet).toMatchObject({ studentId: 'alice', state: 'ADDED', fromPage: 4 });
      await act(async () => { await result.current.appendWorksheet(worksheet.id); });
      expect(kolinApi.appendWorksheet).toHaveBeenCalledTimes(1);
      expect(refreshed).toHaveBeenCalledTimes(1);
    } finally { window.removeEventListener('mc-workbook-updated', refreshed); }
  });

  it('keeps the saved artifact ID for safe append retry and discards stale completion after a lesson switch', async () => {
    vi.mocked(kolinApi.send).mockResolvedValueOnce(response);
    vi.mocked(kolinApi.appendWorksheet).mockRejectedValueOnce(new Error('lost append response'));
    const { result, rerender } = renderHook(({ classId }) => useKolinChat(classId, 'teacher', true), {
      initialProps: { classId: 'class-1' },
    });
    await open(result);
    await ask(result, 'Задания', { studentId: 'alice' });
    await act(async () => { await result.current.appendWorksheet(worksheet.id); });
    expect(result.current.messages[1].appendStatus).toBe('failed');
    let resolve!: (value: KolinWorksheet) => void;
    vi.mocked(kolinApi.appendWorksheet).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    let retry!: Promise<void>;
    act(() => { retry = result.current.appendWorksheet(worksheet.id); });
    expect(vi.mocked(kolinApi.appendWorksheet).mock.calls[1]).toEqual(vi.mocked(kolinApi.appendWorksheet).mock.calls[0]);
    rerender({ classId: 'class-2' });
    await act(async () => { resolve({ ...worksheet, state: 'ADDED' }); await retry; });
    expect(result.current.messages).toEqual([]);
  });
});
