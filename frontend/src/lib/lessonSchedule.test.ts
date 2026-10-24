import { describe, expect, it } from 'vitest';
import { lessonDayInstant, schoolDateKey } from './lessonSchedule';
import { lessonOccurrenceDates } from './lessonRecurrence';

describe('Berlin lesson dates', () => {
  it('uses the Berlin calendar date near UTC midnight', () => {
    expect(schoolDateKey(new Date('2026-10-23T22:30:00Z'))).toBe('2026-10-24');
    expect(schoolDateKey(new Date('2026-01-23T22:30:00Z'))).toBe('2026-01-23');
  });
  it('resolves school midnight correctly on both daylight-saving change days', () => {
    expect(lessonDayInstant('2026-03-29').toISOString()).toBe('2026-03-28T23:00:00.000Z');
    expect(lessonDayInstant('2026-10-25').toISOString()).toBe('2026-10-24T22:00:00.000Z');
    expect(lessonDayInstant('2026-10-26').toISOString()).toBe('2026-10-25T23:00:00.000Z');
  });
  it('retains selected recurrence dates across a Berlin clock change', () => {
    expect(lessonOccurrenceDates('2026-10-25', 'TWO_WEEKS', [7])).toEqual(['2026-10-25', '2026-11-01']);
    expect(lessonDayInstant('2026-10-24', 12).toISOString()).toBe('2026-10-24T10:00:00.000Z');
  });
  it('rejects invalid calendar dates before creating a lesson', () => {
    expect(Number.isNaN(lessonDayInstant('2026-02-30').getTime())).toBe(true);
    expect(Number.isNaN(lessonDayInstant('').getTime())).toBe(true);
  });
});
