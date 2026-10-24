import { schoolDateKey } from './lessonSchedule';

export type LessonRepeatPeriod = 'ONCE' | 'TWO_WEEKS' | 'THREE_WEEKS' | 'MONTH';

export function localLessonDate(date: Date): string {
  return schoolDateKey(date);
}

function calendarDateKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return date.getUTCFullYear() + '-' + pad(date.getUTCMonth() + 1) + '-' + pad(date.getUTCDate());
}

function parseDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(value + 'T12:00:00Z');
  return Number.isFinite(date.getTime()) && calendarDateKey(date) === value ? date : null;
}

export function lessonWeekday(value: string): number {
  const day = parseDate(value)?.getUTCDay();
  return day === undefined ? 1 : day === 0 ? 7 : day;
}

export function lessonPeriodEnd(startDate: string, period: LessonRepeatPeriod): string | null {
  const end = parseDate(startDate);
  if (!end) return null;
  if (period === 'MONTH') {
    const originalDay = end.getUTCDate();
    end.setUTCDate(1);
    end.setUTCMonth(end.getUTCMonth() + 1);
    const lastDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
    end.setUTCDate(Math.min(originalDay, lastDay));
  } else {
    end.setUTCDate(end.getUTCDate() + (period === 'TWO_WEEKS' ? 14 : period === 'THREE_WEEKS' ? 21 : 1));
  }
  end.setUTCDate(end.getUTCDate() - 1);
  return calendarDateKey(end);
}

export function lessonOccurrenceDates(startDate: string, period: LessonRepeatPeriod, weekdays: number[]): string[] {
  const date = parseDate(startDate);
  const end = lessonPeriodEnd(startDate, period);
  if (!date || !end) return [];
  const dates: string[] = [];
  for (let offset = 0; offset < 32 && calendarDateKey(date) <= end; offset++) {
    const key = calendarDateKey(date);
    if (period === 'ONCE' || weekdays.includes(lessonWeekday(key))) dates.push(key);
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return dates;
}
