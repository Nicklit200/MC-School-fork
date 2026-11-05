import { afterEach, describe, expect, it, vi } from 'vitest';
import { lessonPreparationApi } from './lessonPreparation';

vi.mock('./client', async () => ({
  ...await vi.importActual<typeof import('./client')>('./client'),
  getAccessToken: () => 'test-teacher-token',
}));
afterEach(() => vi.unstubAllGlobals());

describe('live teacher-answer requests', () => {
  it('reads only current answer metadata with authorization and bypasses the browser cache', async () => {
    const metadata = { hasAnswers: true, answersFilename: 'answers.pdf', version: 12 };
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify(metadata)));
    vi.stubGlobal('fetch', request);
    expect(await lessonPreparationApi.answersMetadata('lesson /1')).toEqual(metadata);
    expect(request).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('/lesson-preparations/lesson%20%2F1/answers/metadata'), {
      headers: { Authorization: 'Bearer test-teacher-token' }, cache: 'no-store',
    });
  });

  it('bypasses cached shared answer bytes after a same-name replacement', async () => {
    const request = vi.fn().mockResolvedValue(new Response(new Uint8Array([37, 80, 68, 70, 50])));
    vi.stubGlobal('fetch', request);
    expect([...new Uint8Array(await lessonPreparationApi.answersBytes('lesson'))]).toEqual([37, 80, 68, 70, 50]);
    expect(request).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('/lesson-preparations/lesson/answers'), {
      headers: { Authorization: 'Bearer test-teacher-token' }, cache: 'no-store',
    });
  });

  it('keeps private metadata and bytes scoped to the selected pupil without cached responses', async () => {
    const metadata = { studentId: 'pupil /2', hasAnswers: true, answersFilename: 'answers.pdf', version: 4 };
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(metadata)))
      .mockResolvedValueOnce(new Response(new Uint8Array([37, 80, 68, 70])));
    vi.stubGlobal('fetch', request);
    expect(await lessonPreparationApi.personalAnswersMetadata('lesson', 'pupil /2')).toEqual(metadata);
    await lessonPreparationApi.personalAnswersBytes('lesson', 'pupil /2');
    expect(request.mock.calls.map(call => call[0])).toEqual([
      expect.stringContaining('/lesson-preparations/lesson/personal-answers/pupil%20%2F2/metadata'),
      expect.stringContaining('/lesson-preparations/lesson/personal-answers/pupil%20%2F2'),
    ]);
    expect(request.mock.calls.every(call => call[1].cache === 'no-store')).toBe(true);
  });
});
