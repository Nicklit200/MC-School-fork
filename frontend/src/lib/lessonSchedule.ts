import type { GroupLesson, Language } from '../api/types';

export function isNativeLesson(lesson: GroupLesson): boolean {
  return lesson.eventId.startsWith('local-');
}

export function lessonDateLabel(lesson: GroupLesson, language: Language): string {
  return new Intl.DateTimeFormat(language === 'DE' ? 'de-DE' : 'ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(new Date(lesson.startsAt));
}

export function lessonDurationLabel(lesson: GroupLesson, language: Language): string {
  const minutes = Math.round((new Date(lesson.endsAt).getTime() - new Date(lesson.startsAt).getTime()) / 60_000);
  return minutes + (language === 'DE' ? ' Min.' : ' мин');
}
