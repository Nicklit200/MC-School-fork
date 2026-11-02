import { describe, expect, it } from 'vitest';
import type { OnlineClass } from '../../api/onlineClasses';
import { berlinLessonDate, entryText, lessonEntry } from './lessonEntry';

const start = '2026-10-24T12:00:00Z';
const room = (patch: Partial<OnlineClass> = {}) => ({
  scheduledStartAt: start, status: 'LIVE', joinWindowOpen: true, ...patch,
}) as OnlineClass;
const at = (time: string) => Date.parse(time);

describe('lesson entry calendar policy', () => {
  it('uses Berlin instead of the browser timezone', () => {
    expect(berlinLessonDate('2026-10-23T22:00:00Z')).toBe('2026-10-24');
    expect(berlinLessonDate('invalid')).toBe('');
  });
  it('is inclusive at midnight and exclusive at the next midnight', () => {
    expect(lessonEntry(room(), start, at('2026-10-23T21:59:59Z')).canJoin).toBe(false);
    expect(lessonEntry(room(), start, at('2026-10-23T22:00:00Z')).state).toBe('OPEN');
    expect(lessonEntry(room(), start, at('2026-10-24T21:59:59Z')).canJoin).toBe(true);
    expect(lessonEntry(room(), start, at('2026-10-24T22:00:00Z')).state).toBe('DAY_CLOSED');
  });
  it('requires teacher opening even on the right date', () => {
    expect(lessonEntry(undefined, start, at(start)).state).toBe('WAITING_FOR_TEACHER');
    expect(lessonEntry(room({ status: 'SCHEDULED', joinWindowOpen: true }), start, at(start)).canJoin).toBe(false);
  });
  it('does not mistake late opening or admission for previous entry', () => {
    const late = room({ actualStartAt: '2026-10-25T12:00:00Z', viewerHasJoined: false });
    expect(lessonEntry(late, start, at('2026-10-25T12:00:00Z')).canJoin).toBe(false);
  });
  it('permits returning users after midnight only while the server permits it', () => {
    const returning = room({ viewerHasJoined: true });
    expect(lessonEntry(returning, start, at('2026-10-25T12:00:00Z')).state).toBe('RECONNECT');
    expect(lessonEntry({ ...returning, joinWindowOpen: false }, start, at('2026-10-25T12:00:00Z')).canJoin).toBe(false);
  });
  it('closes student entry at Monday midnight without declaring the durable lesson ended', () => {
    expect(lessonEntry(room({ viewerHasJoined: true }), start, at('2026-10-25T22:59:59Z')).canJoin).toBe(true);
    expect(lessonEntry(room({ viewerHasJoined: true }), start, at('2026-10-25T23:00:00Z')).state).toBe('DAY_CLOSED');
  });
  it.each(['ENDED', 'CANCELLED'] as const)('never reconnects a %s room', status => {
    expect(lessonEntry(room({ status, viewerHasJoined: true }), start, at(start)).state).toBe('ENDED');
  });
  it('closes stale grants after the weekly deadline is reported', () => {
    expect(lessonEntry(room({ entryState: 'CLOSED' }), start, at(start)).canJoin).toBe(false);
  });
  it.each([true, false])('shows an idle room without calling it active and only permits its host to enter (host=%s)', viewerIsHost => {
    expect(lessonEntry(room({ mediaState: 'IDLE', viewerIsHost }), start, at(start)))
      .toMatchObject({ state: 'IDLE', canJoin: viewerIsHost });
    expect(entryText('IDLE', 'RU')).toBe('Комната в ожидании входа учителя');
    expect(entryText('IDLE', 'DE')).toBe('Der Raum wartet auf den Beitritt der Lehrkraft');
  });
  it('keeps student day, admission and weekly restrictions ahead of idle-room re-entry', () => {
    const idle = room({ mediaState: 'IDLE', viewerIsHost: false, viewerHasJoined: true });
    expect(lessonEntry(idle, start, at('2026-10-23T12:00:00Z')).state).toBe('DAY_CLOSED');
    expect(lessonEntry({ ...idle, entryState: 'CLOSED' }, start, at(start)).state).toBe('CLOSED');
    expect(lessonEntry({ ...idle, joinWindowOpen: false }, start, at(start)).canJoin).toBe(false);
    expect(lessonEntry(idle, start, at('2026-10-25T23:00:00Z')).state).toBe('DAY_CLOSED');
    expect(lessonEntry({ ...idle, status: 'ENDED' }, start, at(start)).state).toBe('ENDED');
  });
  it('keeps older server responses without mediaState compatible', () => {
    expect(lessonEntry(room(), start, at(start))).toMatchObject({ state: 'OPEN', canJoin: true });
    expect(lessonEntry(room({ viewerHasJoined: true }), start, at('2026-10-25T12:00:00Z')))
      .toMatchObject({ state: 'RECONNECT', canJoin: true });
  });
  it.each(['2026-10-23T12:00:00Z', '2026-11-02T12:00:00Z'])('lets the teacher enter the same idle lesson before its date or after its week (%s)', now => {
    const teacherRoom = room({ mediaState: 'IDLE', viewerIsHost: true, viewerHasJoined: true });
    expect(lessonEntry(teacherRoom, start, at(now))).toMatchObject({ state: 'IDLE', canJoin: true });
    expect(lessonEntry({ ...teacherRoom, mediaState: 'ACTIVE' }, start, at(now)))
      .toMatchObject({ state: 'RECONNECT', canJoin: true });
    expect(lessonEntry({ ...teacherRoom, viewerIsHost: false }, start, at(now)))
      .toMatchObject({ state: 'DAY_CLOSED', canJoin: false });
  });
  it('lets a teacher open a future lesson for the first time when the server permits entry', () => {
    expect(lessonEntry(room({ viewerIsHost: true, viewerHasJoined: false }), start,
      at('2026-10-23T12:00:00Z'))).toMatchObject({ state: 'OPEN', canJoin: true });
  });
  it.each([
    { joinWindowOpen: false }, { entryState: 'CLOSED' }, { entryState: 'DAY_CLOSED' },
    { status: 'ENDED' }, { status: 'CANCELLED' }, { entryState: 'ENDED' },
  ] as Partial<OnlineClass>[])('does not override a server denial or explicit terminal state for the teacher (%j)', denied => {
    const teacherRoom = room({ viewerIsHost: true, mediaState: 'IDLE', ...denied });
    expect(lessonEntry(teacherRoom, start, at('2026-11-02T12:00:00Z')).canJoin).toBe(false);
    expect(lessonEntry(teacherRoom, start, at('2026-11-02T12:00:00Z')).state).not.toBe('DAY_CLOSED');
  });
  it.each([
    ['2026-03-29T12:00:00Z', '2026-03-28T23:00:00Z', '2026-03-29T22:00:00Z'],
    ['2026-10-25T12:00:00Z', '2026-10-24T22:00:00Z', '2026-10-25T23:00:00Z'],
  ])('respects both DST transitions (%s)', (scheduledStartAt, opens, closes) => {
    const current = room({ scheduledStartAt });
    expect(lessonEntry(current, scheduledStartAt, at(opens)).canJoin).toBe(true);
    expect(lessonEntry(current, scheduledStartAt, at(closes) - 1).canJoin).toBe(true);
    expect(lessonEntry(current, scheduledStartAt, at(closes)).canJoin).toBe(false);
  });

  it.each(['2026-10-23T12:00:00Z', '2026-11-02T12:00:00Z'])('honours a verified teacher-presence grant independently of the scheduled day (%s)', now => {
    const live = room({ teacherPresent: true, mediaState: 'ACTIVE', viewerHasJoined: false, entryState: 'OPEN' });
    expect(lessonEntry(live, start, at(now))).toMatchObject({ state: 'OPEN', canJoin: true });
    expect(lessonEntry({ ...live, status: 'LOBBY_OPEN', viewerHasJoined: true }, start, at(now)))
      .toMatchObject({ state: 'RECONNECT', canJoin: true });
  });

  it.each(['ACTIVE', 'IDLE'] as const)('waits for the actual teacher instead of blaming the future scheduled day (media=%s)', mediaState => {
    expect(lessonEntry(room({ teacherPresent: false, mediaState, entryState: 'WAITING_FOR_TEACHER', joinWindowOpen: false }),
      start, at('2026-10-23T12:00:00Z')))
      .toMatchObject({ state: mediaState === 'IDLE' ? 'IDLE' : 'WAITING_FOR_TEACHER', canJoin: false });
  });

  it.each([undefined, null])('waits for the teacher when there is no room for a future lesson (%s)', absent => {
    expect(lessonEntry(absent, start, at('2026-10-23T12:00:00Z')))
      .toMatchObject({ state: 'WAITING_FOR_TEACHER', canJoin: false });
  });

  it.each([
    { joinWindowOpen: false }, { entryState: 'CLOSED' }, { entryState: 'DAY_CLOSED' },
    { status: 'SCHEDULED' }, { status: 'ENDED' }, { status: 'CANCELLED' }, { entryState: 'ENDED' },
  ] as Partial<OnlineClass>[])('never uses teacher presence to bypass a server denial or non-connectable room (%j)', denied => {
    expect(lessonEntry(room({ teacherPresent: true, mediaState: 'ACTIVE', viewerHasJoined: true, ...denied }),
      start, at('2026-10-23T12:00:00Z')).canJoin).toBe(false);
  });

  it('uses an actionable waiting message instead of claiming entry is restricted to one calendar day', () => {
    expect(entryText('DAY_CLOSED', 'RU')).toBe('Сейчас вход в урок закрыт. Кнопка появится, когда преподаватель войдёт в урок.');
    expect(entryText('DAY_CLOSED', 'DE')).toContain('sobald die Lehrkraft');
    expect(entryText('DAY_CLOSED', 'DE')).not.toContain('nur am Unterrichtstag');
  });
});
