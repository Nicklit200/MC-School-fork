import type { GroupLesson, Language, StudentLessonHistoryItem } from '../api/types';
import type { OnlineClassStatus } from '../api/onlineClasses';
import { getSchoolDateString } from './homeworkHistory';

export type CalendarLessonStatus = 'COMPLETED' | 'LIVE' | 'UPCOMING' | 'PAST' | 'CANCELLED';

export type StudentCalendarLesson = {
  key: string;
  eventId: string;
  title: string;
  groupName: string | null;
  startsAt: string;
  endsAt: string;
  sourceTeacherName: string | null;
  href: string;
  archived: boolean;
  status?: OnlineClassStatus | null;
  actualStartAt?: string | null;
  actualEndAt?: string | null;
};

function hasRecordedStart(lesson: Pick<StudentCalendarLesson, 'actualStartAt'>): boolean {
  return Boolean(lesson.actualStartAt && Number.isFinite(Date.parse(lesson.actualStartAt)));
}

export function resolveCalendarLessonStatus(lesson: StudentCalendarLesson, now = new Date()): CalendarLessonStatus {
  if (lesson.status === 'CANCELLED') return 'CANCELLED';
  if (hasRecordedStart(lesson)) {
    if (lesson.status === 'ENDED' || (lesson.actualEndAt && Number.isFinite(Date.parse(lesson.actualEndAt)))) return 'COMPLETED';
    if (lesson.status === 'LIVE') {
      // Empty rooms may retain LIVE until the teacher explicitly ends them.
      // A recorded start on an earlier school date confirms that a lesson occurred.
      return getSchoolDateString(new Date(lesson.actualStartAt!)) < getSchoolDateString(now)
        ? 'COMPLETED'
        : 'LIVE';
    }
  }
  // A past schedule or a room closed without ever starting is not proof of a lesson.
  return Date.parse(lesson.startsAt) > now.getTime() ? 'UPCOMING' : 'PAST';
}

export function calendarLessonStatusText(status: CalendarLessonStatus, language: Language): string {
  const labels: Record<CalendarLessonStatus, string> = language === 'DE'
    ? { COMPLETED: 'Unterricht fand statt', LIVE: 'Unterricht läuft', UPCOMING: 'Unterricht geplant', PAST: 'Durchführung nicht bestätigt', CANCELLED: 'Unterricht abgesagt' }
    : { COMPLETED: 'Урок проведён', LIVE: 'Урок идёт', UPCOMING: 'Урок запланирован', PAST: 'Проведение не подтверждено', CANCELLED: 'Урок отменён' };
  return labels[status];
}

export function formatCalendarLessonTime(startsAt: string, language: Language): string {
  return new Intl.DateTimeFormat(language === 'DE' ? 'de-DE' : 'ru-RU', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin',
  }).format(new Date(startsAt));
}

function scheduleKey(lesson: Pick<StudentCalendarLesson, 'title' | 'groupName' | 'startsAt' | 'endsAt'>): string {
  return JSON.stringify([lesson.title, lesson.groupName ?? '', Date.parse(lesson.startsAt), Date.parse(lesson.endsAt)]);
}

export function buildStudentCalendarLessons(
  lessons: GroupLesson[], history: StudentLessonHistoryItem[], studentId: string,
): StudentCalendarLesson[] {
  const current: StudentCalendarLesson[] = lessons
    .filter(lesson => Array.isArray(lesson.participantStudentIds)
      ? lesson.participantStudentIds.includes(studentId)
      : lesson.studentId === studentId)
    .map(lesson => ({
      key: `current:${lesson.eventId}`, eventId: lesson.eventId, title: lesson.title,
      groupName: lesson.groupName, startsAt: lesson.startsAt, endsAt: lesson.endsAt,
      sourceTeacherName: null, archived: false,
      href: `/teacher/lessons/${encodeURIComponent(lesson.eventId)}`,
      status: lesson.onlineClassStatus, actualStartAt: lesson.actualStartAt, actualEndAt: lesson.actualEndAt,
    }));
  const currentScheduleKeys = new Set(current.map(scheduleKey));
  const previous: StudentCalendarLesson[] = history
    .map(lesson => ({
      key: `${lesson.sourceTeacherId}:${lesson.eventId}`, eventId: lesson.eventId, title: lesson.title,
      groupName: lesson.groupName, startsAt: lesson.startsAt, endsAt: lesson.endsAt,
      sourceTeacherName: lesson.sourceTeacherName, archived: true,
      href: `/teacher/students/${encodeURIComponent(studentId)}/lesson-history/${encodeURIComponent(lesson.sourceTeacherId)}/${encodeURIComponent(lesson.eventId)}`,
      status: lesson.onlineClassStatus, actualStartAt: lesson.actualStartAt, actualEndAt: lesson.actualEndAt,
    }))
    // A copied transfer schedule is one occurrence. Keep separately recorded lessons.
    .filter(lesson => hasRecordedStart(lesson) || !currentScheduleKeys.has(scheduleKey(lesson)));
  const unique = new Map<string, StudentCalendarLesson>();
  for (const lesson of [...current, ...previous]) {
    if (Number.isFinite(Date.parse(lesson.startsAt)) && Number.isFinite(Date.parse(lesson.endsAt))) {
      unique.set(lesson.key, lesson);
    }
  }
  return [...unique.values()].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}
