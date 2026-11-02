import type { OnlineClass } from '../../api/onlineClasses';

export type LessonEntryState = NonNullable<OnlineClass['entryState']> | 'IDLE';

export function berlinLessonDate(value: string | number): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const part = (type: string) => parts.find(value => value.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** UI can narrow a stale server grant, never invent permission to connect. */
export function lessonEntry(room: OnlineClass | undefined | null, scheduledStart: string, now = Date.now()) {
  const date = room?.entryDate ?? berlinLessonDate(scheduledStart);
  // Student re-entry eligibility ends on Monday at 00:00 Europe/Berlin.
  // This calendar boundary never ends the durable lesson for its teacher.
  const stamp = new Date(date + 'T12:00:00Z');
  const day = stamp.getUTCDay();
  const daysUntilMonday = (8 - day) % 7 || 7;
  stamp.setUTCDate(stamp.getUTCDate() + daysUntilMonday);
  const weekEnd = Number.isFinite(stamp.getTime()) ? stamp.toISOString().slice(0, 10) : '';
  let state: LessonEntryState;
  if (room?.status === 'ENDED' || room?.status === 'CANCELLED' || room?.entryState === 'ENDED') {
    state = 'ENDED';
  } else if (room?.viewerIsHost === true) {
    // The owner may prepare or resume a nonterminal lesson on any day. The
    // server still decides whether this particular room is open for entry.
    if (room.entryState === 'CLOSED' || room.entryState === 'DAY_CLOSED' || !room.joinWindowOpen) {
      state = 'CLOSED';
    } else if (room.status !== 'LIVE' && room.status !== 'LOBBY_OPEN') {
      state = 'WAITING_FOR_TEACHER';
    } else if (room.mediaState === 'IDLE') {
      state = 'IDLE';
    } else {
      state = room.viewerHasJoined || room.entryState === 'RECONNECT' ? 'RECONNECT' : 'OPEN';
    }
  } else if (!room) {
    state = 'WAITING_FOR_TEACHER';
  } else if (room.teacherPresent !== undefined) {
    // The current server grants entry from verified teacher presence. The
    // schedule describes the appointment; it must not veto that live grant.
    if (room.entryState === 'CLOSED' || room.entryState === 'DAY_CLOSED') {
      state = room.entryState;
    } else if (room.status !== 'LIVE' && room.status !== 'LOBBY_OPEN') {
      state = 'WAITING_FOR_TEACHER';
    } else if (!room.teacherPresent) {
      state = room.mediaState === 'IDLE' ? 'IDLE' : 'WAITING_FOR_TEACHER';
    } else if (!room.joinWindowOpen) {
      state = 'CLOSED';
    } else {
      state = room.viewerHasJoined || room.entryState === 'RECONNECT' ? 'RECONNECT' : 'OPEN';
    }
  } else {
    // Older servers did not report verified teacher presence. Retain their
    // existing calendar restrictions rather than inventing a new permission.
    const today = berlinLessonDate(now);
    const openRoom = room?.status === 'LIVE' || room?.status === 'LOBBY_OPEN';
    const returning = Boolean(room?.viewerHasJoined || room?.entryState === 'RECONNECT');
    if ((openRoom && weekEnd !== '' && today >= weekEnd)
        || !date || today < date || (today > date && !(openRoom && returning && room?.joinWindowOpen))) {
      state = 'DAY_CLOSED';
    } else if (room.entryState === 'CLOSED' || room.entryState === 'DAY_CLOSED') {
      state = room.entryState;
    } else if (!room || !openRoom) {
      state = 'WAITING_FOR_TEACHER';
    } else if (!room.joinWindowOpen) {
      state = today === date ? 'CLOSED' : 'DAY_CLOSED';
    } else if (room.mediaState === 'IDLE') {
      state = 'IDLE';
    } else {
      state = today === date ? 'OPEN' : 'RECONNECT';
    }
  }
  return { state, date, canJoin: state === 'OPEN' || state === 'RECONNECT'
    || (state === 'IDLE' && room?.viewerIsHost === true) };
}

export function entryText(state: LessonEntryState, language: string): string {
  const labels: Record<LessonEntryState, [string, string]> = {
    WAITING_FOR_TEACHER: ['Ожидаем учителя: кнопка появится, когда преподаватель войдёт в урок.', 'Wir warten auf die Lehrkraft. Die Schaltfläche erscheint, sobald sie den Unterricht betritt.'],
    IDLE: ['Комната в ожидании входа учителя', 'Der Raum wartet auf den Beitritt der Lehrkraft'],
    OPEN: ['Урок открыт', 'Unterricht geöffnet'],
    RECONNECT: ['Урок продолжается: можно вернуться', 'Der Unterricht läuft weiter: Wiederbeitritt möglich'],
    DAY_CLOSED: ['Сейчас вход в урок закрыт. Кнопка появится, когда преподаватель войдёт в урок.', 'Der Beitritt ist derzeit geschlossen. Die Schaltfläche erscheint, sobald die Lehrkraft den Unterricht betritt.'],
    CLOSED: ['Вход в комнату закрыт.', 'Der Raum ist für den Beitritt geschlossen.'],
    ENDED: ['Урок завершён', 'Unterricht beendet'],
  };
  return labels[state][language === 'DE' ? 1 : 0];
}
