import { describe, expect, it } from 'vitest';
import type { Homework } from '../api/types';
import { getSchoolDateString, resolveHomeworkHistoryStatus } from './homeworkHistory';

const homework = {
  startDate: '2026-11-26', deadlineAt: '2026-11-26T23:00:00Z',
  submitted: false, submittedAt: null, overdue: false, submittedLate: false,
} as Homework;

describe('homework calendar deadlines', () => {
  it('uses Berlin school dates during both winter and summer time', () => {
    expect(getSchoolDateString(new Date('2026-11-26T23:15:00Z'))).toBe('2026-11-27');
    expect(getSchoolDateString(new Date('2026-06-26T22:15:00Z'))).toBe('2026-06-27');
  });

  it('keeps a current assignment pending until the exclusive midnight deadline', () => {
    expect(resolveHomeworkHistoryStatus(homework, new Date('2026-11-26T22:59:59.999Z'))).toBe('TODAY');
    // The API overdue snapshot may still be false in a page left open overnight.
    expect(resolveHomeworkHistoryStatus(homework, new Date('2026-11-26T23:00:00Z'))).toBe('MISSED');
  });

  it('classifies submitted work by its submission time, even when viewed much later', () => {
    const later = new Date('2026-12-10T12:00:00Z');
    expect(resolveHomeworkHistoryStatus({
      ...homework, submitted: true, submittedAt: '2026-11-26T22:59:59.999Z',
    }, later)).toBe('DONE');
    expect(resolveHomeworkHistoryStatus({
      ...homework, submitted: true, submittedAt: '2026-11-26T23:00:00Z',
    }, later)).toBe('LATE');
  });

  it('retains API submission classifications and never marks future work as missed', () => {
    const before = new Date('2026-11-25T12:00:00Z');
    expect(resolveHomeworkHistoryStatus(homework, before)).toBe('UPCOMING');
    expect(resolveHomeworkHistoryStatus({ ...homework, submitted: true, submittedLate: true }, before)).toBe('LATE');
    expect(resolveHomeworkHistoryStatus({ ...homework, submitted: true }, before)).toBe('DONE');
  });
});
