import type { GroupLesson, Language } from '../api/types';

export const SCHOOL_TIME_ZONE = 'Europe/Berlin';

export function schoolDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: SCHOOL_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? '';
  return `${read('year')}-${read('month')}-${read('day')}`;
}

/** Resolve a school calendar date to Berlin time, including the DST change days. */
export function lessonDayInstant(date: string, hour = 0): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(hour) || hour < 0 || hour > 23) return new Date(NaN);
  const target = new Date(`${date}T${String(hour).padStart(2, '0')}:00:00.000Z`);
  if (!Number.isFinite(target.getTime()) || target.toISOString().slice(0, 10) !== date) return new Date(NaN);
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: SCHOOL_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  let instant = target.getTime();
  for (let attempt = 0; attempt < 3; attempt++) {
    const parts = formatter.formatToParts(new Date(instant));
    const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(part => part.type === type)?.value);
    const berlinClock = Date.UTC(read('year'), read('month') - 1, read('day'), read('hour'), read('minute'), read('second'));
    const correction = target.getTime() - berlinClock;
    instant += correction;
    if (correction === 0) break;
  }
  return new Date(instant);
}

/** Convert Berlin wall-clock date and HH:mm to UTC for newly scheduled lessons.
 * On clock-change days, reject missing or duplicated times instead of silently moving a lesson.
 */
export function lessonTimeInstant(date: string, time: string): Date {
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(date) || !/^(?:[01]\\d|2[0-3]):[0-5]\\d$/.test(time)) return new Date(NaN);
  const localAsUtc = new Date(`${date}T${time}:00.000Z`);
  if (!Number.isFinite(localAsUtc.getTime()) || localAsUtc.toISOString().slice(0, 10) !== date) return new Date(NaN);
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: SCHOOL_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  // Modern Berlin standard/daylight offsets. Testing both also detects the repeated autumn hour.
  const matching = [1, 2].map(hours => new Date(localAsUtc.getTime() - hours * 3_600_000))
    .filter(candidate => {
      const parts = Object.fromEntries(formatter.formatToParts(candidate).map(part => [part.type, part.value]));
      return `${parts.year}-${parts.month}-${parts.day}` === date && `${parts.hour}:${parts.minute}` === time;
    });
  return matching.length === 1 ? matching[0] : new Date(NaN);
}

export function isNativeLesson(lesson: GroupLesson): boolean {
  return lesson.eventId.startsWith('local-');
}

export function lessonDateLabel(lesson: GroupLesson, language: Language): string {
  return new Intl.DateTimeFormat(language === 'DE' ? 'de-DE' : 'ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: SCHOOL_TIME_ZONE,
  }).format(new Date(lesson.startsAt));
}

export function lessonDurationLabel(lesson: GroupLesson, language: Language): string {
  const minutes = Math.round((new Date(lesson.endsAt).getTime() - new Date(lesson.startsAt).getTime()) / 60_000);
  return minutes + (language === 'DE' ? ' Min.' : ' мин');
}
