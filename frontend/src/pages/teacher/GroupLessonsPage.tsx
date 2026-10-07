import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { driveApi, type DriveItem } from '../../api/drive';
import { lessonPreparationApi } from '../../api/lessonPreparation';
import type { DailyReviewHistoryItem, GoogleCalendarConnection, GroupLesson, Homework, StudentGroup, StudentListItem, User } from '../../api/types';
import { toErrorMessage } from '../../lib/errors';
import { useI18n } from '../../i18n/I18nContext';

type StudentBrief = {
  studentId: string;
  name: string;
  homeworkText: string;
  errorText: string | null;
  recommendation: string;
};

type LessonBrief = {
  group: StudentGroup;
  students: StudentBrief[];
  recentWorksheet: Homework | null;
};

type BriefMap = Record<string, LessonBrief>;
type ScheduleDay = { key: string; date: Date; lessons: GroupLesson[] };
type ViewMode = 'week' | 'month';

const STARTED_LESSON_KEY = 'mindcrafti.startedGroupLesson';
const STARTED_LESSON_AT_KEY = 'mindcrafti.startedGroupLessonOpenedAt';
const SONIOX_NOTIFICATION_PREFIX = 'mindcrafti.sonioxStopNotification.';

export function GroupLessonsPage() {
  const { language, t } = useI18n();
  const [connection, setConnection] = useState<GoogleCalendarConnection | null>(null);
  const [teacher, setTeacher] = useState<User | null>(null);
  const [lessons, setLessons] = useState<GroupLesson[]>([]);
  const [students, setStudents] = useState<StudentListItem[]>([]);
  const [groups, setGroups] = useState<StudentGroup[]>([]);
  const [briefs, setBriefs] = useState<BriefMap>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedLessonId, setExpandedLessonId] = useState<string | null>(null);
  const [startReminderLessonId, setStartReminderLessonId] = useState<string | null>(null);
  const [finishReminderLessonId, setFinishReminderLessonId] = useState<string | null>(null);
  const [startedLessonId, setStartedLessonId] = useState<string | null>(() => localStorage.getItem(STARTED_LESSON_KEY));
  const [finishedLessonId, setFinishedLessonId] = useState<string | null>(null);
  const [returnedLessonId, setReturnedLessonId] = useState<string | null>(null);
  const [unsafeReturnContext, setUnsafeReturnContext] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('week');
  const [monthCursor, setMonthCursor] = useState(() => startOfMonth(new Date()));
  const [selectedMonthDayKey, setSelectedMonthDayKey] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('fromMeet') !== '1') return;

    const completedLesson = params.get('completedLesson');
    const returnedStartedAt = Number(params.get('lessonStartedAt') ?? 0);
    const locallyStartedLesson = localStorage.getItem(STARTED_LESSON_KEY);
    const locallyStartedAt = Number(localStorage.getItem(STARTED_LESSON_AT_KEY) ?? 0);
    const maxLessonContextAgeMs = 12 * 60 * 60 * 1000;
    const now = Date.now();

    const localContextIsFresh = Boolean(
      locallyStartedLesson
      && locallyStartedAt > 0
      && now >= locallyStartedAt
      && now - locallyStartedAt <= maxLessonContextAgeMs,
    );
    const returnedContextIsFresh = Boolean(
      completedLesson
      && returnedStartedAt > 0
      && now >= returnedStartedAt
      && now - returnedStartedAt <= maxLessonContextAgeMs,
    );

    // The lesson started in this browser is authoritative. Chrome extension
    // storage may contain an abandoned older lesson, so its eventId is only a
    // fallback when it carries a fresh startedAt timestamp.
    const resolvedCompletedLesson = localContextIsFresh
      ? locallyStartedLesson
      : returnedContextIsFresh
        ? completedLesson
        : null;

    if (resolvedCompletedLesson) {
      setReturnedLessonId(resolvedCompletedLesson);
      setFinishedLessonId(resolvedCompletedLesson);
      setUnsafeReturnContext(false);
    } else if (completedLesson) {
      setUnsafeReturnContext(true);
      console.warn('Ignored stale Mindcrafti lesson return context', completedLesson);
    }

    setStartedLessonId(null);
    setFinishReminderLessonId(null);
    localStorage.removeItem(STARTED_LESSON_KEY);
    localStorage.removeItem(STARTED_LESSON_AT_KEY);
    window.history.replaceState({}, '', window.location.pathname);
  }, []);

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const [googleConnection, currentTeacher, studentList, groupList] = await Promise.all([
        api.lessons.googleCalendarConnection(),
        api.auth.me(),
        api.students.list(),
        api.groups.list(),
      ]);
      setConnection(googleConnection);
      setTeacher(currentTeacher);
      setStudents(studentList);
      setGroups(groupList);
      if (!googleConnection.connected) {
        setLessons([]);
        setBriefs({});
        return;
      }

      const lessonList = await api.lessons.groupLessons();
      setLessons(lessonList);
      const groupIds = Array.from(new Set(lessonList.map((lesson) => lesson.groupId).filter((id): id is string => Boolean(id))));
      const entries = await Promise.all(groupIds.map(async (groupId) => {
        const group = groupList.find((item) => item.id === groupId) ?? await api.groups.get(groupId);
        const studentBriefs = await Promise.all(group.students.map(async (student) => {
          const [homeworks, history, summary] = await Promise.all([
            api.homeworks.listForStudent(student.id),
            api.students.reviewHistory(student.id),
            api.cards.summaryForStudent(student.id),
          ]);
          return buildStudentBrief(student.id, student.fullName, homeworks, history, summary.dueNow + summary.awaitingRepetition);
        }));
        const allHomeworks = (await Promise.all(group.students.map((student) => api.homeworks.listForStudent(student.id)))).flat();
        const recentWorksheet = allHomeworks
          .filter((homework) => homework.hasWorksheet)
          .sort((a, b) => b.startDate.localeCompare(a.startDate) || b.createdAt.localeCompare(a.createdAt))[0] ?? null;
        return [groupId, { group, students: studentBriefs, recentWorksheet }] as const;
      }));
      setBriefs(Object.fromEntries(entries));
    } catch (e) {
      setError(toErrorMessage(e, t));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadAll(); }, [t]);

  useEffect(() => {
    if (!startedLessonId) return;
    const openedAt = Number(localStorage.getItem(STARTED_LESSON_AT_KEY) ?? 0);
    const startedLesson = lessons.find((lesson) => lesson.eventId === startedLessonId);
    const triggerStopReminder = () => {
      setFinishReminderLessonId(startedLessonId);
      void showSonioxBrowserNotification(startedLessonId, openedAt, startedLesson?.title ?? 'Google Meet', language);
    };
    const check = async () => {
      try {
        const status = await api.lessons.googleMeetEventStatus();
        const leftAt = status.lastLeftAt ? new Date(status.lastLeftAt).getTime() : 0;
        if (openedAt > 0 && leftAt >= openedAt) { triggerStopReminder(); return; }
      } catch {
        // The browser extension remains the primary Meet-leave detector.
      }
      if (startedLesson && Date.now() >= new Date(startedLesson.endsAt).getTime()) triggerStopReminder();
    };
    void check();
    const timer = window.setInterval(() => void check(), 1800);
    return () => window.clearInterval(timer);
  }, [startedLessonId, lessons, language]);

  const scheduleDays = useMemo<ScheduleDay[]>(() => {
    const start = startOfLocalDay(new Date());
    const endExclusive = addDays(start, 7);
    const weekLessons = lessons
      .filter((lesson) => { const startsAt = new Date(lesson.startsAt); return startsAt >= start && startsAt < endExclusive; })
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
    return Array.from({ length: 7 }, (_, offset) => {
      const date = addDays(start, offset);
      const nextDate = addDays(date, 1);
      return { key: localDateKey(date), date, lessons: weekLessons.filter((lesson) => { const startsAt = new Date(lesson.startsAt); return startsAt >= date && startsAt < nextDate; }) };
    });
  }, [lessons]);

  const lessonsByDay = useMemo(() => {
    const map = new Map<string, GroupLesson[]>();
    for (const lesson of lessons) {
      const key = berlinDateKey(lesson.startsAt);
      const bucket = map.get(key) ?? [];
      bucket.push(lesson);
      map.set(key, bucket);
    }
    for (const bucket of map.values()) {
      bucket.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
    }
    return map;
  }, [lessons]);

  const monthGridDays = useMemo(() => {
    const first = startOfMonth(monthCursor);
    const gridStart = startOfWeekMonday(first);
    return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
  }, [monthCursor]);

  useEffect(() => {
    if (viewMode !== 'month') return;
    const monthPrefix = monthKey(monthCursor);
    if (selectedMonthDayKey?.startsWith(monthPrefix)) return;

    const todayKey = localDateKey(new Date());
    if (todayKey.startsWith(monthPrefix) && (lessonsByDay.get(todayKey)?.length ?? 0) > 0) {
      setSelectedMonthDayKey(todayKey);
      return;
    }

    const firstLessonDay = monthGridDays
      .map(localDateKey)
      .find((key) => key.startsWith(monthPrefix) && (lessonsByDay.get(key)?.length ?? 0) > 0);
    setSelectedMonthDayKey(firstLessonDay ?? null);
  }, [viewMode, monthCursor, monthGridDays, lessonsByDay, selectedMonthDayKey]);

  const selectedMonthLessons = selectedMonthDayKey ? (lessonsByDay.get(selectedMonthDayKey) ?? []) : [];

  const returnedLesson = returnedLessonId ? lessons.find((lesson) => lesson.eventId === returnedLessonId) ?? null : null;
  const returnedGroup = returnedLesson?.groupId
    ? groups.find((group) => group.id === returnedLesson.groupId) ?? briefs[returnedLesson.groupId]?.group ?? null
    : null;
  const returnedStudent = returnedLesson?.studentId ? students.find((student) => student.id === returnedLesson.studentId) ?? null : null;

  async function bindTarget(lesson: GroupLesson, value: string) {
    if (!value) return;
    setError(null);
    try {
      if (value.startsWith('group:')) {
        await api.lessons.bindGroup(lesson.bindingKey, value.slice('group:'.length));
      } else if (value.startsWith('student:')) {
        await api.lessons.bindStudent(lesson.bindingKey, value.slice('student:'.length));
      }
      await loadAll();
    } catch (e) {
      setError(toErrorMessage(e, t));
    }
  }

  async function disconnectCalendar() {
    if (!window.confirm(language === 'DE' ? 'Google Calendar trennen?' : 'Отключить Google Calendar?')) return;
    try {
      await api.lessons.disconnectGoogleCalendar();
      setConnection(await api.lessons.googleCalendarConnection());
      setLessons([]);
      setBriefs({});
    } catch (e) { setError(toErrorMessage(e, t)); }
  }

  async function requestStartLesson(lesson: GroupLesson) {
    if (!lesson.meetUrl) {
      window.alert(language === 'DE' ? 'Kein Google Meet für diesen Termin.' : 'У этого события нет ссылки Google Meet.');
      return;
    }
    await prepareBrowserNotifications();
    setStartReminderLessonId(lesson.eventId);
  }

  async function openMeetAfterSoniox(lesson: GroupLesson) {
    if (!lesson.meetUrl) return;
    try { await api.lessons.ensureGoogleMeetEvents(); } catch { /* Meet still opens. */ }
    const openedAt = Date.now();
    localStorage.setItem(STARTED_LESSON_KEY, lesson.eventId);
    localStorage.setItem(STARTED_LESSON_AT_KEY, String(openedAt));
    localStorage.removeItem(`${SONIOX_NOTIFICATION_PREFIX}${lesson.eventId}`);
    setStartedLessonId(lesson.eventId);
    setFinishedLessonId(null);
    setReturnedLessonId(null);
    setFinishReminderLessonId(null);
    setStartReminderLessonId(null);
    const tab = window.open(lesson.meetUrl, '_blank');
    if (tab) tab.opener = null;
  }

  function confirmSonioxStopped(lesson: GroupLesson) {
    setFinishedLessonId(lesson.eventId);
    setReturnedLessonId(lesson.eventId);
    setStartedLessonId(null);
    setFinishReminderLessonId(null);
    localStorage.removeItem(STARTED_LESSON_KEY);
    localStorage.removeItem(STARTED_LESSON_AT_KEY);
    void closeSonioxBrowserNotification(lesson.eventId);
  }

  function renderLessonCard(lesson: GroupLesson) {
    const brief = lesson.groupId ? briefs[lesson.groupId] : undefined;
    const linkedGroup = Boolean(lesson.groupId && lesson.groupName);
    const selectedTarget = lesson.groupId ? `group:${lesson.groupId}` : lesson.studentId ? `student:${lesson.studentId}` : '';
    const expanded = expandedLessonId === lesson.eventId;
    const finished = finishedLessonId === lesson.eventId;

    return (
      <div key={lesson.eventId} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 12, background: '#fff' }}>
        <div style={{ fontSize: 17, fontWeight: 800 }}>{formatStartTime(lesson.startsAt, language)}</div>
        <div style={{ fontWeight: 750, marginTop: 4 }}>{lesson.title}</div>
        <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>{formatLessonTime(lesson.startsAt, lesson.endsAt, language)}</div>

        {linkedGroup && (
          <div className="banner banner--info" style={{ marginTop: 8, padding: 8, fontSize: 12 }}>{language === 'DE' ? `Gruppe: ${lesson.groupName}` : `Группа: ${lesson.groupName}`}</div>
        )}

        <label className="field" style={{ marginTop: 8, marginBottom: 0 }}>
          <span className="field__label" style={{ fontSize: 12 }}>{language === 'DE' ? 'Gruppe oder Schüler für diesen Termin' : 'Группа или ученик для этого события'}</span>
          <select className="select" value={selectedTarget} onChange={(e) => void bindTarget(lesson, e.target.value)}>
            <option value="">{language === 'DE' ? 'Probeunterricht / keine Zuordnung' : 'Пробный урок / без привязки'}</option>
            {groups.length > 0 && <optgroup label={language === 'DE' ? 'Gruppen' : 'Группы'}>{groups.map((group) => <option key={group.id} value={`group:${group.id}`}>{group.name}</option>)}</optgroup>}
            {students.length > 0 && <optgroup label={language === 'DE' ? 'Schüler' : 'Ученики'}>{students.map((student) => <option key={student.id} value={`student:${student.id}`}>{student.fullName}</option>)}</optgroup>}
          </select>
        </label>

        <div className="stack" style={{ gap: 6, marginTop: 10 }}>
          <button className="btn" type="button" data-mindcrafti-lesson-id={lesson.eventId} data-mindcrafti-group-id={lesson.groupId ?? ''} data-mindcrafti-student-id={lesson.studentId ?? ''} onClick={() => void requestStartLesson(lesson)} style={{ width: '100%' }}>{language === 'DE' ? 'Unterricht starten' : 'Начать урок'}</button>
          {linkedGroup && <button className="btn btn--secondary" type="button" onClick={() => setExpandedLessonId(expanded ? null : lesson.eventId)} style={{ width: '100%' }}>{expanded ? (language === 'DE' ? 'Details schließen' : 'Скрыть детали') : (language === 'DE' ? 'Vorbereitung' : 'Подготовка')}</button>}
          {lesson.calendarUrl && <a className="btn btn--ghost" href={lesson.calendarUrl} target="_blank" rel="noreferrer" style={{ width: '100%', textAlign: 'center' }}>Google Calendar</a>}
        </div>

        {expanded && linkedGroup && brief && lesson.groupId && (
          <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
            <div style={{ fontWeight: 750, marginBottom: 8 }}>{language === 'DE' ? 'Kurz vor dem Unterricht' : 'Кратко перед уроком'}</div>
            <div className="stack" style={{ gap: 8 }}>
              {brief.students.map((student) => <div key={student.studentId} style={{ fontSize: 12 }}><strong>{student.name}</strong><div className="muted" style={{ marginTop: 2 }}>{student.homeworkText}</div>{student.errorText && <div style={{ marginTop: 2 }}>{student.errorText}</div>}<div style={{ marginTop: 2 }}><strong>{language === 'DE' ? 'Empfehlung:' : 'Рекомендация:'}</strong> {student.recommendation}</div></div>)}
            </div>
            {brief.recentWorksheet && <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>{brief.recentWorksheet.worksheetFilename}</div>}
            <Link className="btn btn--secondary" to={`/groups/${lesson.groupId}`} style={{ width: '100%', textAlign: 'center', marginTop: 10 }}>{language === 'DE' ? 'Gruppe / Material öffnen' : 'Открыть группу / материал'}</Link>
          </div>
        )}

        {finished && !returnedLessonId && linkedGroup && lesson.groupId && <TranscriptUpload eventId={lesson.eventId} target={{ kind: 'group', id: lesson.groupId, initialFolderId: brief?.group.googleDriveTranscriptFolderId ?? groups.find((group) => group.id === lesson.groupId)?.googleDriveTranscriptFolderId ?? null }} language={language} />}
        {finished && !returnedLessonId && !linkedGroup && lesson.studentId && <TranscriptUpload eventId={lesson.eventId} target={{ kind: 'student', id: lesson.studentId, initialFolderId: students.find((student) => student.id === lesson.studentId)?.googleDriveTranscriptFolderId ?? null }} language={language} />}
        {finished && !returnedLessonId && !linkedGroup && !lesson.studentId && teacher && <TranscriptUpload eventId={lesson.eventId} target={{ kind: 'trial', id: teacher.id, initialFolderId: teacher.googleDriveTrialTranscriptFolderId ?? null }} language={language} />}
      </div>
    );
  }

  if (loading) return <p className="muted">{t('common.loading')}</p>;
  const startReminderLesson = startReminderLessonId ? lessons.find((lesson) => lesson.eventId === startReminderLessonId) ?? null : null;
  const finishReminderLesson = finishReminderLessonId ? lessons.find((lesson) => lesson.eventId === finishReminderLessonId) ?? null : null;

  return (
    <div className="teacher-lessons-page">
      <div className="teacher-page-heading" style={{ display: 'flex', justifyContent: 'space-between', gap: 18, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div>
          <h1>{language === 'DE' ? 'Unterricht' : 'Уроки'}</h1>
          <p>
            {viewMode === 'week'
              ? (language === 'DE' ? 'Dein Stundenplan für die nächsten 7 Tage.' : 'Расписание на ближайшие 7 дней.')
              : (language === 'DE' ? 'Monatsübersicht: Unterrichtstage sind orange markiert.' : 'Календарь на месяц: дни с уроками отмечены оранжевым.')}
          </p>
        </div>
        {connection?.connected === true && (
          <div style={{ display: 'inline-flex', padding: 4, borderRadius: 12, background: '#eef1f5', border: '1px solid #e1e5ea' }}>
            <button type="button" onClick={() => setViewMode('week')} style={viewToggleStyle(viewMode === 'week')}>
              {language === 'DE' ? 'Woche' : 'Неделя'}
            </button>
            <button type="button" onClick={() => setViewMode('month')} style={viewToggleStyle(viewMode === 'month')}>
              {language === 'DE' ? 'Monat' : 'Месяц'}
            </button>
          </div>
        )}
      </div>

      {error && <div className="banner banner--error">{error}</div>}
      {unsafeReturnContext && (
        <div className="banner banner--error" style={{ marginBottom: 14 }}>
          {language === 'DE'
            ? 'Der zurückgegebene Unterricht konnte nicht sicher zugeordnet werden. Öffne den richtigen Termin in Mindcrafti und lade die Transkription dort hoch.'
            : 'Не удалось безопасно определить завершённый урок. Открой нужный урок в Mindcrafti и загрузи транскрипцию именно в него.'}
        </div>
      )}

      {returnedLessonId && (
        <div className="panel" style={{ marginBottom: 18, padding: 22, border: '2px solid #ff6a00', boxShadow: '0 12px 32px rgba(255,106,0,.10)' }}>
          <div style={{ fontSize: 24, fontWeight: 900, marginBottom: 6 }}>{language === 'DE' ? 'Unterricht beendet' : 'Урок завершён'}</div>
          <div style={{ fontSize: 16, marginBottom: 14 }}>
            {returnedLesson?.title
              ? (language === 'DE' ? `${returnedLesson.title}. Lade jetzt die Soniox-Transkription hoch.` : `${returnedLesson.title}. Теперь загрузи транскрипцию Soniox.`)
              : (language === 'DE' ? 'Lade jetzt die Soniox-Transkription hoch.' : 'Теперь загрузи транскрипцию Soniox.')}
          </div>
          {returnedGroup ? (
            <TranscriptUpload eventId={returnedLesson?.eventId ?? returnedLessonId ?? ''} target={{ kind: 'group', id: returnedGroup.id, initialFolderId: returnedGroup.googleDriveTranscriptFolderId ?? null }} language={language} prominent />
          ) : returnedStudent ? (
            <TranscriptUpload eventId={returnedLesson?.eventId ?? returnedLessonId ?? ''} target={{ kind: 'student', id: returnedStudent.id, initialFolderId: returnedStudent.googleDriveTranscriptFolderId ?? null }} language={language} prominent />
          ) : teacher ? (
            <TranscriptUpload eventId={returnedLesson?.eventId ?? returnedLessonId ?? ''} target={{ kind: 'trial', id: teacher.id, initialFolderId: teacher.googleDriveTrialTranscriptFolderId ?? null }} language={language} prominent />
          ) : null}
        </div>
      )}

      {connection?.connected !== true ? (
        <div className="panel" style={{ maxWidth: 720, padding: 24 }}>
          <h2 style={{ marginTop: 0 }}>{language === 'DE' ? 'Google Calendar verbinden' : 'Подключить Google Calendar'}</h2>
          <p className="muted">{language === 'DE' ? 'Verbinde dein Google-Konto, damit deine Termine hier erscheinen.' : 'Подключи свой Google-аккаунт, и события календаря появятся здесь.'}</p>
          {connection?.authorizationUrl ? <a className="btn" href={connection.authorizationUrl}>{language === 'DE' ? 'Mit Google verbinden' : 'Войти через Google'}</a> : <div className="banner banner--info">{language === 'DE' ? 'Google OAuth ist noch nicht eingerichtet.' : 'Google OAuth на сервере пока не настроен.'}</div>}
        </div>
      ) : <>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <div className="banner banner--success" style={{ margin: 0 }}>{language === 'DE' ? 'Google Calendar ist verbunden.' : 'Google Calendar подключён.'}</div>
          <button className="btn btn--ghost" type="button" onClick={() => void disconnectCalendar()}>{language === 'DE' ? 'Trennen' : 'Отключить календарь'}</button>
        </div>

        {viewMode === 'week' ? (
          <div style={{ overflowX: 'auto', paddingBottom: 10 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(220px, 1fr))', gap: 12, minWidth: 1540 }}>
              {scheduleDays.map((day, index) => (
                <section key={day.key} className="panel" style={{ padding: 14, margin: 0, minHeight: 260 }}>
                  <div style={{ paddingBottom: 10, borderBottom: '1px solid var(--border)', marginBottom: 10 }}>
                    <div style={{ fontWeight: 800, fontSize: 16 }}>{formatDayTitle(day.date, index, language)}</div>
                    <div className="muted" style={{ marginTop: 3, fontSize: 12 }}>{formatDayDate(day.date, language)}</div>
                  </div>
                  {day.lessons.length === 0 ? (
                    <div className="muted" style={{ fontSize: 13, padding: '8px 0' }}>{language === 'DE' ? 'Kein Unterricht' : 'Уроков нет'}</div>
                  ) : (
                    <div className="stack" style={{ gap: 8 }}>{day.lessons.map(renderLessonCard)}</div>
                  )}
                </section>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(360px, 420px) minmax(760px, 1fr)', gap: 22, alignItems: 'start' }}>
            <aside className="panel" style={{ margin: 0, padding: 18, minHeight: 500, position: 'sticky', top: 86 }}>
              <div style={{ paddingBottom: 13, borderBottom: '1px solid var(--border)', marginBottom: 14 }}>
                <div className="muted" style={{ fontSize: 12, fontWeight: 750, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                  {language === 'DE' ? 'Unterricht an diesem Tag' : 'Уроки в этот день'}
                </div>
                <h2 style={{ margin: '6px 0 0', fontSize: 20, lineHeight: 1.25 }}>
                  {selectedMonthDayKey ? formatSelectedDayTitle(selectedMonthDayKey, language) : (language === 'DE' ? 'Wähle einen Tag' : 'Выбери день')}
                </h2>
              </div>

              {!selectedMonthDayKey ? (
                <div className="muted" style={{ fontSize: 14, lineHeight: 1.5 }}>
                  {language === 'DE' ? 'Klicke rechts im Kalender auf einen Tag.' : 'Нажми справа на нужный день в календаре.'}
                </div>
              ) : selectedMonthLessons.length === 0 ? (
                <div style={{ padding: '12px 4px' }}>
                  <div style={{ fontWeight: 800, marginBottom: 5 }}>{language === 'DE' ? 'Kein Unterricht' : 'Уроков нет'}</div>
                  <div className="muted" style={{ fontSize: 13, lineHeight: 1.45 }}>
                    {language === 'DE' ? 'Für diesen Tag ist kein Unterricht geplant.' : 'На этот день нет запланированных уроков.'}
                  </div>
                </div>
              ) : (
                <div className="stack" style={{ gap: 10 }}>{selectedMonthLessons.map(renderLessonCard)}</div>
              )}
            </aside>

            <section className="panel" style={{ padding: 16, margin: 0, overflowX: 'auto', width: '100%', maxWidth: 1160, justifySelf: 'end' }}>
              <div style={{ minWidth: 760 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '52px 1fr 52px', alignItems: 'center', marginBottom: 12 }}>
                  <button
                    type="button"
                    aria-label={language === 'DE' ? 'Vorheriger Monat' : 'Предыдущий месяц'}
                    onClick={() => { setMonthCursor((value) => addMonths(value, -1)); setSelectedMonthDayKey(null); }}
                    style={{ ...monthNavButtonStyle, width: 38, height: 38, fontSize: 26 }}
                  >
                    ‹
                  </button>
                  <div style={{ textAlign: 'center', fontSize: 24, fontWeight: 850, color: '#1f2933' }}>
                    {formatMonthTitle(monthCursor, language)}
                  </div>
                  <button
                    type="button"
                    aria-label={language === 'DE' ? 'Nächster Monat' : 'Следующий месяц'}
                    onClick={() => { setMonthCursor((value) => addMonths(value, 1)); setSelectedMonthDayKey(null); }}
                    style={{ ...monthNavButtonStyle, width: 38, height: 38, fontSize: 26, justifySelf: 'end' }}
                  >
                    ›
                  </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid #e8e9ec' }}>
                  {weekdayLabels(language).map((label) => (
                    <div key={label} style={{ textAlign: 'center', padding: '6px 4px 9px', fontSize: 12, fontWeight: 800, color: '#7b8493' }}>
                      {label}
                    </div>
                  ))}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
                  {monthGridDays.map((date) => {
                    const key = localDateKey(date);
                    const dayLessons = lessonsByDay.get(key) ?? [];
                    const hasLessons = dayLessons.length > 0;
                    const inMonth = date.getMonth() === monthCursor.getMonth() && date.getFullYear() === monthCursor.getFullYear();
                    const selected = selectedMonthDayKey === key;
                    const today = key === localDateKey(new Date());

                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setSelectedMonthDayKey(key)}
                        style={{
                          appearance: 'none',
                          border: 'none',
                          borderRight: '1px solid #eceef1',
                          borderBottom: '1px solid #eceef1',
                          background: selected ? '#fff5ed' : '#fff',
                          minHeight: 86,
                          padding: 7,
                          cursor: 'pointer',
                          opacity: inMonth ? 1 : 0.30,
                          outline: selected ? '2px solid #ffb27a' : 'none',
                          outlineOffset: -2,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'center' }}>
                          <div
                            style={{
                              width: 34,
                              height: 34,
                              borderRadius: '50%',
                              display: 'grid',
                              placeItems: 'center',
                              fontSize: 15,
                              fontWeight: 850,
                              background: hasLessons && inMonth ? '#ff6a00' : '#fff',
                              color: hasLessons && inMonth ? '#fff' : inMonth ? '#1f2933' : '#8f98a6',
                              border: !hasLessons && today && inMonth ? '2px solid #ff6a00' : '2px solid transparent',
                              boxShadow: hasLessons && inMonth ? '0 4px 10px rgba(255, 106, 0, .20)' : 'none',
                            }}
                          >
                            {date.getDate()}
                          </div>
                        </div>
                        {inMonth && hasLessons && (
                          <div style={{ marginTop: 7, textAlign: 'center', fontSize: 10, fontWeight: 800, color: '#c04b00', lineHeight: 1.2 }}>
                            {dayLessons.length === 1
                              ? (language === 'DE' ? '1 Unterricht' : '1 урок')
                              : (language === 'DE' ? dayLessons.length + ' Unterrichte' : dayLessons.length + ' урока')}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>
          </div>
        )}
      </>}

      {startReminderLesson && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(15,23,42,.55)', display: 'grid', placeItems: 'center', padding: 20 }}>
          <div className="panel" style={{ width: 'min(560px, 100%)', padding: 28, textAlign: 'center', boxShadow: '0 24px 70px rgba(15,23,42,.28)' }}>
            <div style={{ fontSize: 28, fontWeight: 900, marginBottom: 10 }}>{language === 'DE' ? 'Soniox einschalten' : 'Включи Soniox'}</div>
            <div style={{ fontSize: 17, lineHeight: 1.5, marginBottom: 20 }}>{language === 'DE' ? 'Starte jetzt die Soniox-Aufnahme. Erst danach öffnen wir Google Meet.' : 'Сначала запусти запись Soniox. Только после этого открывай Google Meet.'}</div>
            <div style={{ fontWeight: 800, marginBottom: 18 }}>{startReminderLesson.title} · {formatLessonTime(startReminderLesson.startsAt, startReminderLesson.endsAt, language)}</div>
            <div className="stack" style={{ gap: 10 }}>
              <button className="btn" type="button" onClick={() => void openMeetAfterSoniox(startReminderLesson)} style={{ width: '100%', minHeight: 52, fontSize: 16 }}>{language === 'DE' ? 'Soniox läuft — Google Meet öffnen' : 'Soniox включён — открыть Google Meet'}</button>
              <button className="btn btn--ghost" type="button" onClick={() => setStartReminderLessonId(null)} style={{ width: '100%' }}>{language === 'DE' ? 'Abbrechen' : 'Отмена'}</button>
            </div>
          </div>
        </div>
      )}

      {finishReminderLesson && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 10001, background: 'rgba(15,23,42,.62)', display: 'grid', placeItems: 'center', padding: 20 }}>
          <div className="panel" style={{ width: 'min(580px, 100%)', padding: 30, textAlign: 'center', boxShadow: '0 24px 70px rgba(15,23,42,.32)', border: '2px solid #ff6a00' }}>
            <div style={{ fontSize: 30, fontWeight: 900, marginBottom: 10, color: '#d94f00' }}>{language === 'DE' ? 'Soniox stoppen' : 'Останови Soniox'}</div>
            <div style={{ fontSize: 18, lineHeight: 1.5, marginBottom: 18 }}>{language === 'DE' ? 'Google Meet meldet, dass du den Anruf verlassen hast. Stoppe jetzt Soniox.' : 'Google Meet сообщил, что ты вышел из звонка. Сейчас останови запись Soniox.'}</div>
            <div style={{ fontWeight: 800, marginBottom: 20 }}>{finishReminderLesson.title}</div>
            <div className="stack" style={{ gap: 10 }}>
              <button className="btn" type="button" onClick={() => confirmSonioxStopped(finishReminderLesson)} style={{ width: '100%', minHeight: 52, fontSize: 16 }}>{language === 'DE' ? 'Soniox gestoppt — Unterricht abschließen' : 'Soniox остановлен — завершить урок'}</button>
              <button className="btn btn--secondary" type="button" onClick={() => setFinishReminderLessonId(null)} style={{ width: '100%' }}>{language === 'DE' ? 'Unterricht läuft noch' : 'Урок ещё идёт'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

async function prepareBrowserNotifications() {
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    const config = await api.push.config();
    if (!config.enabled || !config.publicKey) return;
    const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
    if (permission !== 'granted') return;
    const registration = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToArrayBuffer(config.publicKey) });
    const json = subscription.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return;
    await api.push.subscribe({ endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth });
  } catch { /* Lesson flow continues without web push. */ }
}

function urlBase64ToArrayBuffer(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const bytes = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) bytes[i] = rawData.charCodeAt(i);
  return bytes.buffer;
}

async function showSonioxBrowserNotification(lessonId: string, openedAt: number, title: string, language: 'DE' | 'RU') {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const storageKey = `${SONIOX_NOTIFICATION_PREFIX}${lessonId}`;
  const marker = String(openedAt);
  if (localStorage.getItem(storageKey) === marker) return;
  localStorage.setItem(storageKey, marker);
  const notificationTitle = language === 'DE' ? 'Soniox stoppen' : 'Останови Soniox';
  const body = language === 'DE' ? `${title}: Du hast Google Meet verlassen. Stoppe jetzt die Soniox-Aufnahme.` : `${title}: ты вышел из Google Meet. Останови запись Soniox.`;
  try {
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.ready;
      await registration.showNotification(notificationTitle, { body, icon: '/icon-192.png', badge: '/icon-192.png', tag: `soniox-stop-${lessonId}`, requireInteraction: true, data: { url: '/teacher/lessons' } });
      return;
    }
    new Notification(notificationTitle, { body, requireInteraction: true, tag: `soniox-stop-${lessonId}` });
  } catch { /* Mindcrafti modal remains fallback. */ }
}

async function closeSonioxBrowserNotification(lessonId: string) {
  try {
    if (!('serviceWorker' in navigator)) return;
    const registration = await navigator.serviceWorker.ready;
    const notifications = await registration.getNotifications({ tag: `soniox-stop-${lessonId}` });
    notifications.forEach((notification) => notification.close());
  } catch { /* no-op */ }
}

type TranscriptTarget = { kind: 'group' | 'student' | 'trial'; id: string; initialFolderId: string | null };

function TranscriptUpload({ eventId, target, language, prominent = false }: { eventId: string; target: TranscriptTarget; language: 'DE' | 'RU'; prominent?: boolean }) {
  const storageKey = target.kind === 'group'
    ? `mindcrafti.groupTranscriptFolder.${target.id}`
    : target.kind === 'student'
      ? `mindcrafti.studentTranscriptFolder.${target.id}`
      : `mindcrafti.trialTranscriptFolder.${target.id}`;
  const configuredFolderId = target.initialFolderId ?? localStorage.getItem(storageKey) ?? '';
  const [folderId, setFolderId] = useState(configuredFolderId);
  const [folderPickerOpen, setFolderPickerOpen] = useState(target.kind !== 'trial' && !configuredFolderId);
  const [drives, setDrives] = useState<DriveItem[]>([]);
  const [driveId, setDriveId] = useState('');
  const [folders, setFolders] = useState<DriveItem[]>([]);
  const [path, setPath] = useState<DriveItem[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (target.initialFolderId) {
      setFolderId(target.initialFolderId);
      localStorage.setItem(storageKey, target.initialFolderId);
    }
  }, [target.initialFolderId, storageKey]);

  useEffect(() => {
    if (!folderPickerOpen || drives.length > 0) return;
    driveApi.listSharedDrives().then(setDrives).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [folderPickerOpen, drives.length]);

  async function selectDrive(value: string) { setDriveId(value); setPath([]); setFolders(value ? await driveApi.listFolders(value) : []); }
  async function enter(folder: DriveItem) { setPath((current) => [...current, folder]); setFolders(await driveApi.listFolders(driveId, folder.id)); }

  async function saveCurrentFolder() {
    if (target.kind === 'trial') return;
    const current = path.length > 0 ? path[path.length - 1].id : driveId;
    if (!current) return;
    setError(null);
    try {
      if (target.kind === 'group') await api.groups.updateTranscriptFolder(target.id, current);
      else await api.students.updateTranscriptDriveFolder(target.id, current);
      localStorage.setItem(storageKey, current);
      setFolderId(current);
      setFolderPickerOpen(false);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }

  async function upload() {
    if (!file || uploading) return;
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setError(language === 'DE' ? 'Bitte eine PDF-Transkription auswählen.' : 'Выбери PDF-транскрипцию Soniox.');
      return;
    }
    setUploading(true); setError(null); setMessage(null);
    try {
      // Mindcrafti is the primary source for the lesson transcript.
      // Google Drive remains a convenient archive copy.
      await lessonPreparationApi.uploadTranscript(eventId, file);
      if (folderId) {
        try {
          const result = await driveApi.upload(folderId, file);
          setMessage(language === 'DE'
            ? `Transkription im Unterricht gespeichert und in Google Drive archiviert: ${result.name}`
            : `Транскрипция сохранена в уроке Mindcrafti и скопирована в Google Drive: ${result.name}`);
        } catch (driveError) {
          setMessage(language === 'DE'
            ? 'Transkription ist im Unterricht gespeichert. Die Google-Drive-Kopie ist fehlgeschlagen.'
            : 'Транскрипция сохранена в уроке Mindcrafti. Копию в Google Drive сохранить не удалось.');
          setError(driveError instanceof Error ? driveError.message : String(driveError));
        }
      } else {
        setMessage(language === 'DE'
          ? 'Transkription ist im Unterricht gespeichert. Kein Google-Drive-Ordner ist eingerichtet.'
          : 'Транскрипция сохранена в уроке Mindcrafti. Папка Google Drive не настроена, поэтому копия туда не создавалась.');
      }
      setFile(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setUploading(false); }
  }

  return (
    <div style={prominent ? { marginTop: 8 } : { marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
      <strong style={{ fontSize: prominent ? 16 : 12 }}>{target.kind === 'trial' ? (language === 'DE' ? 'Probeunterricht · Soniox-Transkription' : 'Пробный урок · транскрипция Soniox') : (language === 'DE' ? 'Soniox-Transkription' : 'Транскрипция Soniox')}</strong>
      {folderId && <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>{target.kind === 'trial' ? (language === 'DE' ? 'Der Ordner für Probeunterricht ist eingerichtet.' : 'Папка пробных уроков уже настроена администратором.') : (language === 'DE' ? 'Zielordner ist gespeichert.' : 'Папка для транскрипций уже настроена.')}</div>}
      {!folderId && <div className="banner banner--info" style={{ marginTop: 8, fontSize: 12 }}>
        {language === 'DE'
          ? 'Die Transkription wird trotzdem im Unterricht gespeichert. Ohne Drive-Ordner wird nur keine Archivkopie erstellt.'
          : 'Транскрипция всё равно сохранится в самом уроке. Без папки Drive просто не будет дополнительной копии.'}
      </div>}
      {error && <div className="banner banner--error" style={{ marginTop: 8 }}>{error}</div>}
      {message && <div className="banner banner--success" style={{ marginTop: 8 }}>{message}</div>}
      {target.kind !== 'trial' && (!folderId || folderPickerOpen) ? (
        <div className="stack" style={{ gap: 7, marginTop: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>{language === 'DE' ? 'Zielordner auswählen:' : 'Выбери папку для транскрипций:'}</div>
          <select className="select" value={driveId} onChange={(e) => void selectDrive(e.target.value)}>
            <option value="">{language === 'DE' ? 'Drive auswählen' : 'Выберите общий диск'}</option>
            {drives.map((drive) => <option key={drive.id} value={drive.id}>{drive.name}</option>)}
          </select>
          {driveId && <>{path.length > 0 && <div className="muted" style={{ fontSize: 12 }}>{path.map((item) => item.name).join(' / ')}</div>}{folders.map((folder) => <button key={folder.id} className="btn btn--ghost" type="button" onClick={() => void enter(folder)}>{folder.name}</button>)}<button className="btn btn--secondary" type="button" onClick={() => void saveCurrentFolder()}>{language === 'DE' ? 'Ordner speichern' : 'Сохранить эту папку'}</button></>}
        </div>
      ) : target.kind !== 'trial' ? <button className="btn btn--ghost" type="button" onClick={() => setFolderPickerOpen(true)} style={{ marginTop: 8 }}>{language === 'DE' ? 'Ordner ändern' : 'Изменить папку'}</button> : null}
      <input className="input" type="file" accept=".pdf,application/pdf" style={{ marginTop: 10 }} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <button className="btn" type="button" disabled={!file || uploading} onClick={() => void upload()} style={{ width: '100%', marginTop: 8, minHeight: prominent ? 50 : undefined }}>{uploading ? (language === 'DE' ? 'Speichern…' : 'Загружаем…') : (language === 'DE' ? 'Transkription speichern' : 'Загрузить транскрипцию')}</button>
    </div>
  );
}

function buildStudentBrief(studentId: string, name: string, homeworks: Homework[], history: DailyReviewHistoryItem[], dueCards: number): StudentBrief {
  const recentHomework = [...homeworks].filter((item) => item.hasWorksheet).sort((a, b) => b.startDate.localeCompare(a.startDate))[0];
  const recentHistory = [...history].sort((a, b) => b.date.localeCompare(a.date))[0];
  const wrongAnswers = recentHistory?.answers?.filter((answer) => !answer.correct) ?? [];
  const homeworkText = !recentHomework ? 'Домашка: данных пока нет.' : recentHomework.submitted ? `Домашка: сдана (${recentHomework.startDate}).` : `Домашка: не сдана (${recentHomework.startDate}).`;
  const errorText = wrongAnswers.length > 0 ? `Ошибки: ${wrongAnswers.slice(0, 2).map((answer) => answer.question).join('; ')}${wrongAnswers.length > 2 ? '…' : ''}` : null;
  const recommendation = !recentHomework?.submitted ? 'В начале проверить домашку.' : wrongAnswers.length > 0 ? 'Коротко разобрать повторяющиеся ошибки.' : dueCards > 0 ? 'Начать с короткого повторения.' : 'Быстро проверить прошлую тему и идти дальше.';
  return { studentId, name, homeworkText, errorText, recommendation };
}

function viewToggleStyle(active: boolean) {
  return {
    appearance: 'none' as const,
    border: 'none',
    borderRadius: 9,
    padding: '9px 18px',
    fontSize: 14,
    fontWeight: 800,
    cursor: 'pointer',
    background: active ? '#fff' : 'transparent',
    color: active ? '#1f2933' : '#6b7280',
    boxShadow: active ? '0 2px 8px rgba(31, 41, 51, .10)' : 'none',
  };
}

const monthNavButtonStyle = {
  appearance: 'none' as const,
  width: 44,
  height: 44,
  borderRadius: 12,
  border: '1px solid #e1e4e8',
  background: '#fff',
  color: '#26313f',
  fontSize: 30,
  lineHeight: 1,
  cursor: 'pointer',
  display: 'grid',
  placeItems: 'center',
};

function formatMonthTitle(date: Date, language: 'DE' | 'RU') {
  const value = new Intl.DateTimeFormat(language === 'DE' ? 'de-DE' : 'ru-RU', { month: 'long', year: 'numeric' }).format(date);
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatSelectedDayTitle(key: string, language: 'DE' | 'RU') {
  const [year, month, day] = key.split('-').map(Number);
  return new Intl.DateTimeFormat(language === 'DE' ? 'de-DE' : 'ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(year, month - 1, day));
}

function weekdayLabels(language: 'DE' | 'RU') {
  return language === 'DE'
    ? ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
    : ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
}

function startOfMonth(date: Date) { return new Date(date.getFullYear(), date.getMonth(), 1); }
function startOfWeekMonday(date: Date) { const day = date.getDay(); const offset = day === 0 ? -6 : 1 - day; return addDays(startOfLocalDay(date), offset); }
function addMonths(date: Date, months: number) { return new Date(date.getFullYear(), date.getMonth() + months, 1); }
function monthKey(date: Date) { return localDateKey(startOfMonth(date)).slice(0, 7); }
function berlinDateKey(value: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));
  const year = parts.find((part) => part.type === 'year')?.value ?? '';
  const month = parts.find((part) => part.type === 'month')?.value ?? '';
  const day = parts.find((part) => part.type === 'day')?.value ?? '';
  return `${year}-${month}-${day}`;
}

function formatDayTitle(date: Date, index: number, language: 'DE' | 'RU') { if (index === 0) return language === 'DE' ? 'Heute' : 'Сегодня'; if (index === 1) return language === 'DE' ? 'Morgen' : 'Завтра'; return new Intl.DateTimeFormat(language === 'DE' ? 'de-DE' : 'ru-RU', { weekday: 'short' }).format(date); }
function formatDayDate(date: Date, language: 'DE' | 'RU') { return new Intl.DateTimeFormat(language === 'DE' ? 'de-DE' : 'ru-RU', { day: '2-digit', month: '2-digit' }).format(date); }
function formatStartTime(value: string, language: 'DE' | 'RU') { return new Intl.DateTimeFormat(language === 'DE' ? 'de-DE' : 'ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date(value)); }
function formatLessonTime(start: string, end: string, language: 'DE' | 'RU') { const formatter = new Intl.DateTimeFormat(language === 'DE' ? 'de-DE' : 'ru-RU', { hour: '2-digit', minute: '2-digit' }); return `${formatter.format(new Date(start))}–${formatter.format(new Date(end))}`; }
function startOfLocalDay(date: Date) { return new Date(date.getFullYear(), date.getMonth(), date.getDate()); }
function addDays(date: Date, days: number) { return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days); }
function localDateKey(date: Date) { const year = date.getFullYear(); const month = String(date.getMonth() + 1).padStart(2, '0'); const day = String(date.getDate()).padStart(2, '0'); return `${year}-${month}-${day}`; }
