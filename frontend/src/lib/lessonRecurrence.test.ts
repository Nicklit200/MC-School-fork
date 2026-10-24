import { describe, expect, it } from 'vitest';
import { lessonOccurrenceDates, lessonPeriodEnd, lessonWeekday } from './lessonRecurrence';

describe('lesson recurrence dates', () => {
  it('keeps a single lesson on its selected date', () => {
    expect(lessonOccurrenceDates('2026-10-22', 'ONCE', [])).toEqual(['2026-10-22']);
  });
  it('creates two or three weekly Thursdays', () => {
    expect(lessonOccurrenceDates('2026-10-22', 'TWO_WEEKS', [4])).toEqual(['2026-10-22', '2026-10-29']);
    expect(lessonOccurrenceDates('2026-10-22', 'THREE_WEEKS', [4])).toEqual(['2026-10-22', '2026-10-29', '2026-11-05']);
  });
  it('shows every Thursday for a rolling month, including a fifth occurrence', () => {
    expect(lessonPeriodEnd('2026-10-22', 'MONTH')).toBe('2026-11-21');
    expect(lessonOccurrenceDates('2026-10-22', 'MONTH', [4])).toEqual(['2026-10-22', '2026-10-29', '2026-11-05', '2026-11-12', '2026-11-19']);
  });
  it('supports several weekdays without dates before the selected start', () => {
    expect(lessonOccurrenceDates('2026-10-22', 'TWO_WEEKS', [1, 4])).toEqual(['2026-10-22', '2026-10-26', '2026-10-29', '2026-11-02']);
  });
  it('clamps a month starting on January 31 like the backend LocalDate calculation', () => {
    expect(lessonPeriodEnd('2027-01-31', 'MONTH')).toBe('2027-02-27');
    expect(lessonOccurrenceDates('2027-01-31', 'MONTH', [7])).toEqual(['2027-01-31', '2027-02-07', '2027-02-14', '2027-02-21']);
  });
  it('handles leap years and daylight saving changes using calendar dates', () => {
    expect(lessonPeriodEnd('2028-01-31', 'MONTH')).toBe('2028-02-28');
    expect(lessonOccurrenceDates('2026-10-25', 'TWO_WEEKS', [7])).toEqual(['2026-10-25', '2026-11-01']);
  });
  it('returns no dates for invalid input or an empty repeating selection', () => {
    expect(lessonOccurrenceDates('', 'MONTH', [4])).toEqual([]);
    expect(lessonOccurrenceDates('2026-02-30', 'MONTH', [4])).toEqual([]);
    expect(lessonOccurrenceDates('2026-10-22', 'MONTH', [])).toEqual([]);
  });
  it('uses ISO weekday numbers', () => {
    expect(lessonWeekday('2026-10-22')).toBe(4);
    expect(lessonWeekday('2026-10-25')).toBe(7);
  });
});
