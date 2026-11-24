import { expect, it } from 'vitest';
import { matchesAnalysisCandidate } from './useAutomaticPageAnalysis';
import type { KolinBoardSnapshot, KolinPageAnalysisCandidate } from '../../api/kolin';

const candidate: KolinPageAnalysisCandidate = {
  studentId: 'pupil', boardId: 'personal-pupil', pageNumber: 2,
  documentVersion: 0, sharedDocumentVersion: 3, revision: 7,
};
const snapshot: KolinBoardSnapshot = {
  ...candidate, scope: 'task_page', imageDataUrl: 'data:image/jpeg;base64,example',
  capturedAt: new Date().toISOString(), observedAt: null, totalPageCount: 5, additionalPages: [],
};

it('accepts only the exact candidate version', () => {
  expect(matchesAnalysisCandidate(candidate, snapshot)).toBe(true);
  for (const changed of [
    { revision: 8 }, { pageNumber: 3 }, { studentId: 'other' },
    { boardId: 'board-1' }, { documentVersion: 1 }, { sharedDocumentVersion: 4 },
    { scope: 'workbook' as const },
  ]) expect(matchesAnalysisCandidate(candidate, { ...snapshot, ...changed })).toBe(false);
});
