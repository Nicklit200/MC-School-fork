export type LessonRepeatPeriod = 'ONCE' | 'TWO_WEEKS' | 'THREE_WEEKS' | 'MONTH';

export function localLessonDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
}

function parseDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(value + 'T12:00:00');
  return Number.isFinite(date.getTime()) && localLessonDate(date) === value ? date : null;
}

export function lessonWeekday(value: string): number {
  const day = parseDate(value)?.getDay();
  return day === undefined ? 1 : day === 0 ? 7 : day;
}

export function lessonPeriodEnd(startDate: string, period: LessonRepeatPeriod): string | null {
  const end = parseDate(startDate);
  if (!end) return null;
  if (period === 'MONTH') {
    const originalDay = end.getDate();
    end.setDate(1);
    end.setMonth(end.getMonth() + 1);
    const lastDay = new Date(end.getFullYear(), end.getMonth() + 1, 0).getDate();
    end.setDate(Math.min(originalDay, lastDay));
  } else {
    end.setDate(end.getDate() + (period === 'TWO_WEEKS' ? 14 : period === 'THREE_WEEKS' ? 21 : 1));
  }
  end.setDate(end.getDate() - 1);
  return localLessonDate(end);
}

export function lessonOccurrenceDates(startDate: string, period: LessonRepeatPeriod, weekdays: number[]): string[] {
  const date = parseDate(startDate);
  const end = lessonPeriodEnd(startDate, period);
  if (!date || !end) return [];
  const dates: string[] = [];
  for (let offset = 0; offset < 32 && localLessonDate(date) <= end; offset++) {
    const key = localLessonDate(date);
    if (period === 'ONCE' || weekdays.includes(lessonWeekday(key))) dates.push(key);
    date.setDate(date.getDate() + 1);
  }
  return dates;
}
