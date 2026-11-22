import { describe, expect, it } from 'vitest';
import { calculateMonthReadiness, type CurriculumMonth } from './monthReadiness';

const base: CurriculumMonth = {
  schemaVersion: 1,
  schoolYear: '2026/27',
  month: '2026-11',
  grade: 6,
  schoolType: 'GYMNASIUM',
  boardId: 'grade-6',
  skillIds: ['addition', 'subtraction', 'fractions'],
  topics: ['Brüche'],
  source: 'approximate curriculum',
  unmappedTopics: ['diagrammes'],
};

describe('monthly readiness from skill mastery', () => {
  it('does not call a skill with missing mastery a demonstrated zero', () => {
    expect(calculateMonthReadiness(base, { addition: 80, fractions: 40 })).toEqual({
      percent: 60, assessed: 2, total: 3, assessedCoverage: 67, unmappedCount: 1,
    });
  });
  it('does count an explicit zero as evidence', () => {
    expect(calculateMonthReadiness(base, { addition: 0, fractions: 100 }).percent).toBe(50);
  });
  it('uses no fake percentage when nothing has been assessed', () => {
    expect(calculateMonthReadiness(base, {})).toMatchObject({
      percent: null, assessed: 0, total: 3, assessedCoverage: 0,
    });
    expect(calculateMonthReadiness(base, null).percent).toBeNull();
  });
  it('recalculates when the transcript-driven skill values change', () => {
    const before = calculateMonthReadiness(base, { addition: 40, subtraction: 20 });
    const after = calculateMonthReadiness(base, { addition: 80, subtraction: 60 });
    expect(before.percent).toBe(30);
    expect(after.percent).toBe(70);
    expect(after.assessedCoverage).toBe(before.assessedCoverage);
  });
  it('deduplicates repeated skill links', () => {
    expect(calculateMonthReadiness({ ...base, skillIds: ['addition', 'addition', 'fractions'] },
      { addition: 90, fractions: 70 })).toMatchObject({
      percent: 80, total: 2, assessed: 2,
    });
  });
});
