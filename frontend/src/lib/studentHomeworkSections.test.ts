import { describe, expect, it } from 'vitest';
import type { Homework } from '../api/types';
import { formatHomeworkDate, schoolHomeworkDate, splitStudentHomeworks } from './studentHomeworkSections';

const hw = (id: string, startDate: string, patch: Partial<Homework> = {}): Homework => ({
  id, studentId: 's', startDate, createdAt: startDate, totalCards: 0, notStarted: 0,
  inProgress: 0, learned: 0, status: 'ACTIVE', hasWorksheet: true,
  submitted: false, submittedAt: null, overdue: false, submittedLate: false, ...patch,
} as Homework);

describe('student homework sections', () => {
  it('puts today first even after the deadline, separates overdue newest-first, excludes future and completed work', () => {
    const items = [hw('old', '2026-11-21', { overdue: true }), hw('new', '2026-11-27', { overdue: true }),
      hw('today', '2026-11-28', { overdue: true }), hw('future', '2026-11-29'),
      hw('submitted', '2026-11-28', { submitted: true }), hw('cards', '2026-11-28', { hasWorksheet: false })];
    const sections = splitStudentHomeworks(items, '2026-11-28');
    expect(sections.today.map(item => item.id)).toEqual(['today']);
    expect(sections.overdue.map(item => item.id)).toEqual(['new', 'old']);
    expect(splitStudentHomeworks(items, '2026-11-28', true).today.map(item => item.id)).toContain('submitted');
  });
  it('uses the school timezone and formats the assigned date', () => {
    expect(schoolHomeworkDate(new Date('2026-11-27T23:30:00Z'))).toBe('2026-11-28');
    expect(formatHomeworkDate('2026-11-28', 'RU')).toBe('28.11.2026');
  });
});
