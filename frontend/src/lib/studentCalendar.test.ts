import { describe, expect, it } from 'vitest';
import type { GroupLesson, StudentLessonHistoryItem } from '../api/types';
import { buildStudentCalendarLessons, formatCalendarLessonTime, resolveCalendarLessonStatus, type StudentCalendarLesson } from './studentCalendar';

const lesson: StudentCalendarLesson = {
  key: 'lesson', eventId: 'lesson', title: 'Математика', groupName: null,
  startsAt: '2026-11-20T16:00:00Z', endsAt: '2026-11-20T17:00:00Z',
  sourceTeacherName: null, archived: false, href: '/teacher/lessons/lesson',
};
const now = new Date('2026-11-26T12:00:00Z');

function groupLesson(overrides: Partial<GroupLesson> = {}): GroupLesson {
  return {
    eventId: lesson.eventId, bindingKey: lesson.eventId, title: lesson.title,
    startsAt: lesson.startsAt, endsAt: lesson.endsAt, groupId: null, groupName: null,
    studentId: 'pupil', studentName: 'Ученик', participantStudentIds: ['pupil'],
    meetUrl: null, calendarUrl: null, ...overrides,
  };
}

describe('combined student calendar', () => {
  it('requires a recorded start before claiming a lesson was held and does not leave old rooms live forever', () => {
    expect(resolveCalendarLessonStatus(lesson, now)).toBe('PAST');
    expect(resolveCalendarLessonStatus({ ...lesson, status: 'ENDED' }, now)).toBe('PAST');
    expect(resolveCalendarLessonStatus({ ...lesson, status: 'ENDED', actualStartAt: lesson.startsAt }, now)).toBe('COMPLETED');
    expect(resolveCalendarLessonStatus({ ...lesson, status: 'LIVE', actualStartAt: lesson.startsAt }, now)).toBe('COMPLETED');
    expect(resolveCalendarLessonStatus({ ...lesson, status: 'LIVE', actualStartAt: '2026-11-26T10:00:00Z' }, now)).toBe('LIVE');
    expect(resolveCalendarLessonStatus({ ...lesson, status: 'LIVE', actualStartAt: '2026-11-25T23:30:00Z' }, now)).toBe('LIVE');
    expect(resolveCalendarLessonStatus({ ...lesson, status: 'CANCELLED', actualStartAt: lesson.startsAt }, now)).toBe('CANCELLED');
    expect(resolveCalendarLessonStatus({ ...lesson, startsAt: '2026-11-27T16:00:00Z' }, now)).toBe('UPCOMING');
  });

  it('respects occurrence membership, including a student explicitly removed from an individual lesson', () => {
    const included = groupLesson({ eventId: 'included' });
    const removed = { ...included, eventId: 'removed', participantStudentIds: [] };
    const group = { ...included, eventId: 'group', studentId: null, participantStudentIds: ['pupil', 'other'] };
    const other = { ...included, eventId: 'other', studentId: null, participantStudentIds: ['other'] };
    expect(buildStudentCalendarLessons([included, removed, group, other], [], 'pupil').map(row => row.eventId))
      .toEqual(['included', 'group']);
  });

  it('deduplicates copied schedules while preserving completed former-teacher lessons and their links', () => {
    const current = groupLesson({ eventId: 'copied' });
    const history: StudentLessonHistoryItem = {
      ...lesson, sourceTeacherId: 'former', sourceTeacherName: 'Прежний учитель',
      hasWorkbook: false, hasAnswers: false, hasTranscript: false,
    };
    expect(buildStudentCalendarLessons([current], [history], 'pupil')).toHaveLength(1);
    const recorded = { ...history, onlineClassStatus: 'ENDED' as const, actualStartAt: lesson.startsAt };
    const rows = buildStudentCalendarLessons([current], [recorded], 'pupil');
    expect(rows).toHaveLength(2);
    expect(rows.find(row => row.archived)?.href).toBe('/teacher/students/pupil/lesson-history/former/lesson');
    expect(resolveCalendarLessonStatus(rows.find(row => row.archived)!, now)).toBe('COMPLETED');
  });

  it('uses Berlin wall-clock times independently of browser timezone and omits invalid timestamps', () => {
    expect(formatCalendarLessonTime('2026-11-26T23:30:00Z', 'RU')).toBe('00:30');
    expect(formatCalendarLessonTime('2026-07-26T22:30:00Z', 'DE')).toBe('00:30');
    const invalid = groupLesson({ startsAt: 'invalid' });
    expect(buildStudentCalendarLessons([invalid], [], 'pupil')).toEqual([]);
  });
});
