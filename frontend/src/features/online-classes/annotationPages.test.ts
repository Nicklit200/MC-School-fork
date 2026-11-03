import { describe, expect, it } from 'vitest';
import { annotationPageCount } from './annotationPages';

describe('persisted annotation page count', () => {
  it('counts durable blank pages while ignoring other pupils and surface types', () => {
    expect(annotationPageCount([
      { targetType: 'WHITEBOARD', targetId: 'personal-workbook-alice', pageIndex: 2 },
      { targetType: 'WHITEBOARD', targetId: 'personal-workbook-bob', pageIndex: 20 },
      { targetType: 'NOTEBOOK_CAMERA', targetId: 'personal-workbook-alice', pageIndex: 30 },
    ], 'WHITEBOARD', 'personal-workbook-alice')).toBe(3);
  });

  it('retains the PDF/local floor and rejects malformed or unbounded indices', () => {
    const documents = [-1, .5, NaN, Infinity, 10_000, 100_000_000].map(pageIndex => ({
      targetType: 'WHITEBOARD' as const, targetId: 'personal-alice', pageIndex,
    }));
    expect(annotationPageCount(documents, 'WHITEBOARD', 'personal-alice', 4)).toBe(4);
    expect(annotationPageCount([], 'WHITEBOARD', 'personal-alice', Infinity)).toBe(1);
    expect(annotationPageCount([], 'WHITEBOARD', 'personal-alice', 100_000)).toBe(10_000);
  });
});
