import type { Homework } from '../api/types';

export function schoolHomeworkDate(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const value = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function formatHomeworkDate(date: string, language: 'DE' | 'RU'): string {
  return new Intl.DateTimeFormat(language === 'DE' ? 'de-DE' : 'ru-RU', {
    timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(new Date(`${date}T00:00:00Z`));
}

export function splitStudentHomeworks(items: Homework[], today: string, includeSubmittedToday = false) {
  const worksheets = items.filter(item => item.hasWorksheet);
  const latestFirst = (a: Homework, b: Homework) =>
    b.startDate.localeCompare(a.startDate) || (b.createdAt ?? '').localeCompare(a.createdAt ?? '');
  return {
    today: worksheets.filter(item => item.startDate === today && (includeSubmittedToday || !item.submitted)).sort(latestFirst),
    overdue: worksheets.filter(item => item.startDate < today && item.overdue && !item.submitted).sort(latestFirst),
  };
}
