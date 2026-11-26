import type { Homework } from '../api/types';

export type HomeworkHistoryStatus = 'DONE' | 'LATE' | 'MISSED' | 'TODAY' | 'UPCOMING';

const schoolDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
});

export function getSchoolDateString(now = new Date()): string {
  const parts = schoolDateFormatter.formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(value => value.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function resolveHomeworkHistoryStatus(homework: Homework, now = new Date()): HomeworkHistoryStatus {
  const deadline = Date.parse(homework.deadlineAt);
  if (homework.submitted) {
    const submitted = homework.submittedAt ? Date.parse(homework.submittedAt) : NaN;
    // The API deadline is the beginning of the next school day, exclusive.
    return homework.submittedLate || (Number.isFinite(submitted) && submitted >= deadline) ? 'LATE' : 'DONE';
  }

  const today = getSchoolDateString(now);
  const deadlinePassed = Number.isFinite(deadline) ? now.getTime() >= deadline : homework.startDate < today;
  if (homework.overdue || deadlinePassed) return 'MISSED';
  return homework.startDate <= today ? 'TODAY' : 'UPCOMING';
}

export function homeworkHistoryText(status: HomeworkHistoryStatus, language: 'DE' | 'RU'): string {
  const labels: Record<HomeworkHistoryStatus, string> = language === 'DE'
    ? {
      DONE: 'Rechtzeitig abgegeben', LATE: 'Verspätet abgegeben', MISSED: 'Nicht abgegeben',
      TODAY: 'Heute fällig', UPCOMING: 'Geplant',
    }
    : {
      DONE: 'Сдано вовремя', LATE: 'Сдано с опозданием', MISSED: 'Не сдано',
      TODAY: 'Нужно сделать сегодня', UPCOMING: 'Запланировано',
    };
  return labels[status];
}
