import { useEffect, useMemo, useState } from 'react';
import { CreateLessonPanel } from './CreateLessonPanel';
import { Link } from 'react-router-dom';
import { isNativeLesson } from '../../lib/lessonSchedule';
import { api } from '../../api/client';
import { ApiRequestError } from '../../api/client';
import { driveApi, type DriveItem } from '../../api/drive';
import { lessonPreparationApi } from '../../api/lessonPreparation';
import type { DailyReviewHistoryItem, GoogleCalendarConnection, GroupLesson, Homework, StudentGroup, StudentListItem, User } from '../../api/types';
import { toErrorMessage } from '../../lib/errors';
import { useI18n } from '../../i18n/I18nContext';
import './lesson-agenda.css';

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
  const [createdLesson, setCreatedLesson] = useState<GroupLesson | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editTime, setEditTime] = useState('');
  const [editDuration, setEditDuration] = useState(60);
  const [editBusy, setEditBusy] = useState(false);
  const [deletingLessonId, setDeletingLessonId] = useState<string | null>(null);
  const [createdCount, setCreatedCount] = useState(1);
  const [expandedLessonId, setExpandedLessonId] = useState<string | null>(null);
  const [startReminderLessonId, setStartReminderLessonId] = useState<string | null>(null);
  const [finishReminderLessonId, setFinishReminderLessonId] = useState<string | null>(null);
  const [startedLessonId, setStartedLessonId] = useState<string | null>(() => localStorage.getItem(STARTED_LESSON_KEY));
  const [finishedLessonId, setFinishedLessonId] = useState<string | null>(null);
  const [returnedLessonId, setReturnedLessonId] = useState<string | null>(null);
  const [unsafeReturnContext, setUnsafeReturnContext] = useState(false);
  const [weekCursor, setWeekCursor] = useState(() => startOfWeekMonday(dateFromKey(berlinDateKey(new Date().toISOString()))));
  const [selectedDayKey, setSelectedDayKey] = useState(() => berlinDateKey(new Date().toISOString()));


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
    // Only the lesson that this Mindcrafti tab itself started may be selected
    // automatically. Extension storage is useful for returning to the site, but
    // it is not authoritative enough to choose where a transcript is stored.
    // This intentionally fails closed: without a fresh local lesson context the
    // teacher must open the correct lesson instead of risking a wrong attachment.
    const resolvedCompletedLesson = localContextIsFresh ? locallyStartedLesson : null;

    if (resolvedCompletedLesson) {
      setReturnedLessonId(resolvedCompletedLesson);
      setFinishedLessonId(resolvedCompletedLesson);
      setUnsafeReturnContext(false);
    } else if (completedLesson || returnedContextIsFresh) {
      setUnsafeReturnContext(true);
      console.warn('Ignored non-authoritative Mindcrafti lesson return context', completedLesson);
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
        api.lessons.googleCalendarConnection().catch(() => ({ connected: false, authorizationUrl: null })),
        api.auth.me(),
        api.students.list(),
        api.groups.list(),
      ]);
      setConnection(googleConnection);
      setTeacher(currentTeacher);
      setStudents(studentList);
      setGroups(groupList);
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

  const scheduleDays = useMemo<ScheduleDay[]>(() => Array.from({ length: 7 }, (_, offset) => {
    const date = addDays(weekCursor, offset);
    const key = localDateKey(date);
    return { key, date, lessons: lessonsByDay.get(key) ?? [] };
  }), [weekCursor, lessonsByDay]);
  const selectedLessons = lessonsByDay.get(selectedDayKey) ?? [];
  const selectedDate = dateFromKey(selectedDayKey);
  const todayKey = berlinDateKey(new Date().toISOString());
  function selectDate(key: string) {
    setSelectedDayKey(key);
    setWeekCursor(startOfWeekMonday(dateFromKey(key)));
    setExpandedLessonId(null);
  }
  function moveWeek(offset: number) { selectDate(localDateKey(addDays(selectedDate, offset * 7))); }

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
      await loadAll();
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

  function toBerlinParts(iso: string) {
    const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
    const value = (type: string) => parts.find(item => item.type === type)?.value ?? '';
    return { date: `${value('year')}-${value('month')}-${value('day')}`, time: `${value('hour')}:${value('minute')}` };
  }

  function openTimeEditor(lesson: GroupLesson) {
    const fields = toBerlinParts(lesson.startsAt);
    setEditDate(fields.date);
    setEditTime(fields.time);
    setEditDuration(Math.max(1, Math.round((Date.parse(lesson.endsAt) - Date.parse(lesson.startsAt)) / 60000)));
    setExpandedLessonId(lesson.eventId);
  }

  async function saveTime(lesson: GroupLesson) {
    const value = new Date(`${editDate}T${editTime}:00`);
    if (!editDate || !editTime || !Number.isFinite(value.getTime()) || editDuration < 1 || editDuration > 1440) {
      setError('Укажите корректную дату, время и длительность от 1 до 1440 минут.');
      return;
    }
    // Interpret the calendar entry as a Berlin wall-clock time, including DST.
    const naive = Date.parse(`${editDate}T${editTime}:00Z`);
    let start = NaN;
    for (let offset = -120; offset <= 120; offset += 30) {
      const candidate = new Date(naive + offset * 60000);
      const berlin = toBerlinParts(candidate.toISOString());
      if (berlin.date === editDate && berlin.time === editTime) { start = candidate.getTime(); break; }
    }
    if (!Number.isFinite(start)) { setError('Такое время не существует при переводе часов в Германии.'); return; }
    setEditBusy(true); setError(null);
    try {
      await api.lessons.updateSchedule(lesson.eventId, new Date(start).toISOString(),
        new Date(start + editDuration * 60000).toISOString());
      selectDate(editDate);
      await loadAll();
      setExpandedLessonId(null);
    } catch (error) { setError(toErrorMessage(error, t)); }
    finally { setEditBusy(false); }
  }

  async function deleteLesson(lesson: GroupLesson) {
    if (deletingLessonId) return;
    const confirmed = window.confirm(language === 'DE'
      ? `Unterricht „${lesson.title}“ aus dem Stundenplan entfernen? Ein zugehöriger Online-Raum wird für alle geschlossen. Materialien bleiben gespeichert. Nicht rückgängig zu machen.`
      : `Удалить урок «${lesson.title}» из расписания? Его онлайн-комната закроется для всех участников. Материалы сохранятся. Это действие нельзя отменить.`);
    if (!confirmed) return;
    setDeletingLessonId(lesson.eventId);
    setError(null);
    try {
      await api.lessons.deleteLesson(lesson.eventId);
      // An already-successful deletion must not reappear if the subsequent
      // Google/Drive refresh temporarily fails.
      setLessons(current => current.filter(item => item.eventId !== lesson.eventId));
      setExpandedLessonId(null);
      if (startedLessonId === lesson.eventId) setStartedLessonId(null);
      await loadAll();
    } catch (error) {
      setError(error instanceof ApiRequestError && error.errorCode === 'CONFLICT'
        ? (language === 'DE' ? 'Dieser Unterricht konnte nicht gelöscht werden. Laden Sie die Seite neu und versuchen Sie es erneut.'
          : 'Не удалось удалить урок из-за конфликта состояния. Обновите страницу и повторите попытку.')
        : toErrorMessage(error, t));
    }
    finally { setDeletingLessonId(null); }
  }

  function renderLessonCard(lesson: GroupLesson) {
    const brief = lesson.groupId ? briefs[lesson.groupId] : undefined;
    const linkedGroup = Boolean(lesson.groupId && lesson.groupName);
    const selectedTarget = lesson.groupId ? `group:${lesson.groupId}` : lesson.studentId ? `student:${lesson.studentId}` : '';
    const expanded = expandedLessonId === lesson.eventId;
    const finished = finishedLessonId === lesson.eventId;

    const native = isNativeLesson(lesson);
    const past = native ? berlinDateKey(lesson.startsAt) < todayKey : new Date(lesson.endsAt).getTime() < Date.now();
    const kind = lesson.groupId ? (language === 'DE' ? 'Gruppenunterricht' : 'Групповое занятие')
      : lesson.studentId ? (language === 'DE' ? 'Einzelunterricht' : 'Индивидуальное занятие')
        : (language === 'DE' ? 'Probeunterricht' : 'Пробный урок');
    return (
      <article key={lesson.eventId} className="lesson-agenda-card">
        <div className="lesson-agenda-card__row">
          <div className="lesson-agenda-card__when">
            <strong>{formatStartTime(lesson.startsAt, language)}</strong>
            <span>{(language === 'DE' ? 'bis ' : 'до ') + formatStartTime(lesson.endsAt, language)}</span>
          </div>
          <div className="lesson-agenda-card__info">
            <h3>{lesson.title}</h3><p>{kind}{lesson.meetUrl ? ' · Google Meet' : ''}</p>
            <span className={'lesson-agenda-status' + (past ? ' is-past' : '')}>{past ? (language === 'DE' ? 'Vergangen' : 'Прошедший') : (language === 'DE' ? 'Geplant' : 'Запланирован')}</span>
          </div>
          <div className="lesson-agenda-card__actions">
            <Link className="btn" to={'/teacher/lessons/' + encodeURIComponent(lesson.eventId)}>{language === 'DE' ? 'Unterricht öffnen' : 'Открыть урок'}</Link>
            <button className="teacher-icon-button" type="button" aria-label={(language === 'DE' ? 'Unterrichtseinstellungen: ' : 'Настройки урока: ') + lesson.title} aria-expanded={expanded} aria-controls={'lesson-options-' + lesson.eventId} onClick={() => expanded ? setExpandedLessonId(null) : openTimeEditor(lesson)}>⋯</button>
          </div>
        </div>
        {expanded && <div className="lesson-agenda-card__options" id={'lesson-options-' + lesson.eventId}>
          <div className="stack" style={{ gap: 8, marginBottom: 14 }}>
            <strong>{language === 'DE' ? 'Datum und Dauer bearbeiten (auch vergangene Stunden)' : 'Изменить дату и длительность (включая прошедшие уроки)'}</strong>
            <label>Дата / Datum <input type="date" value={editDate} onChange={event => setEditDate(event.target.value)} /></label>
            <label>Время / Uhrzeit (Berlin) <input type="time" value={editTime} onChange={event => setEditTime(event.target.value)} /></label>
            <label>Минуты / Minuten <input type="number" min="1" max="1440" value={editDuration} onChange={event => setEditDuration(Number(event.target.value))} /></label>
            <button className="btn btn--secondary" type="button" disabled={editBusy} onClick={() => void saveTime(lesson)}>
              {editBusy ? 'Сохраняем…' : language === 'DE' ? 'Änderungen speichern' : 'Сохранить изменения'}
            </button>
            <button className="btn btn--ghost" type="button" disabled={deletingLessonId !== null}
              onClick={() => void deleteLesson(lesson)}>
              {deletingLessonId === lesson.eventId ? 'Удаляем…' : language === 'DE' ? 'Unterricht löschen' : 'Удалить урок'}
            </button>
          </div>
        <label className="field" style={{ marginTop: 8, marginBottom: 0 }}>
          <span className="field__label" style={{ fontSize: 12 }}>{language === 'DE' ? 'Gruppe oder Schüler für diesen Termin' : 'Группа или ученик для этого события'}</span>
          <select className="select" value={selectedTarget} onChange={(e) => void bindTarget(lesson, e.target.value)}>
            <option value="">{language === 'DE' ? 'Probeunterricht / keine Zuordnung' : 'Пробный урок / без привязки'}</option>
            {groups.length > 0 && <optgroup label={language === 'DE' ? 'Gruppen' : 'Группы'}>{groups.map((group) => <option key={group.id} value={`group:${group.id}`}>{group.name}</option>)}</optgroup>}
            {students.length > 0 && <optgroup label={language === 'DE' ? 'Schüler' : 'Ученики'}>{students.map((student) => <option key={student.id} value={`student:${student.id}`}>{student.fullName}</option>)}</optgroup>}
          </select>
        </label>
          <div className="lesson-agenda-card__links">
            {lesson.meetUrl && <button className="btn" type="button" data-mindcrafti-lesson-id={lesson.eventId} data-mindcrafti-group-id={lesson.groupId ?? ''} data-mindcrafti-student-id={lesson.studentId ?? ''} onClick={() => void requestStartLesson(lesson)}>{language === 'DE' ? 'Unterricht starten' : 'Начать урок'}</button>}
            {lesson.calendarUrl && <a className="btn btn--ghost" href={lesson.calendarUrl} target="_blank" rel="noreferrer">Google Calendar</a>}
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

        </div>}

        {finished && !returnedLessonId && linkedGroup && lesson.groupId && <TranscriptUpload eventId={lesson.eventId} target={{ kind: 'group', id: lesson.groupId, initialFolderId: brief?.group.googleDriveTranscriptFolderId ?? groups.find((group) => group.id === lesson.groupId)?.googleDriveTranscriptFolderId ?? null }} language={language} />}
        {finished && !returnedLessonId && !linkedGroup && lesson.studentId && <TranscriptUpload eventId={lesson.eventId} target={{ kind: 'student', id: lesson.studentId, initialFolderId: students.find((student) => student.id === lesson.studentId)?.googleDriveTranscriptFolderId ?? null }} language={language} />}
        {finished && !returnedLessonId && !linkedGroup && !lesson.studentId && teacher && <TranscriptUpload eventId={lesson.eventId} target={{ kind: 'trial', id: teacher.id, initialFolderId: teacher.googleDriveTrialTranscriptFolderId ?? null }} language={language} />}
      </article>
    );
  }

  const startReminderLesson = startReminderLessonId ? lessons.find((lesson) => lesson.eventId === startReminderLessonId) ?? null : null;
  const finishReminderLesson = finishReminderLessonId ? lessons.find((lesson) => lesson.eventId === finishReminderLessonId) ?? null : null;

  return (
    <div className="teacher-lessons-page">
      <div className="teacher-page-heading lesson-agenda-heading">
        <div><h1>{language === 'DE' ? 'Unterricht' : 'Уроки'}</h1>
          <p>{language === 'DE' ? 'Stundenplan und Unterrichtsmaterialien' : 'Расписание и переход к материалам урока'}</p>
        </div>
        <CreateLessonPanel students={students} groups={groups} selectedDate={selectedDayKey} disabled={loading} onCreated={async (created) => {
          const lesson = created[0];
          if (!lesson) return;
          selectDate(berlinDateKey(lesson.startsAt));
          await loadAll();
          setCreatedCount(created.length);
          setCreatedLesson(lesson);
        }} />
      </div>
      {createdLesson && <div className="banner banner--success" role="status" style={{ marginBottom: 18 }}>
        {createdCount > 1 ? (language === 'DE' ? 'Unterrichtstermine erstellt: ' : 'Создано уроков: ') + createdCount + '. ' : (language === 'DE' ? 'Unterricht erstellt: ' : 'Урок создан: ')}{createdLesson.title}.{' '}
        <Link to={'/teacher/lessons/' + encodeURIComponent(createdLesson.eventId)}>{language === 'DE' ? 'Unterricht öffnen' : 'Открыть урок'}</Link>
      </div>}

      {error && <div className="banner banner--error">{error}</div>}
      {unsafeReturnContext && (
        <div className="banner banner--error" style={{ marginBottom: 14 }}>
          {language === 'DE'
            ? 'Der zurückgegebene Unterricht konnte nicht sicher zugeordnet werden. Öffne den richtigen Termin in Mindcrafti und lade die Transkription dort hoch.'
            : 'Не удалось безопасно определить завершённый урок. Открой нужный урок в Mindcrafti и загрузи транскрипцию именно в него.'}
        </div>
      )}

      {returnedLessonId && (
        <div className="panel" style={{ marginBottom: 18, padding: 22, border: '2px solid var(--teacher-selected-border, #ff6a00)', boxShadow: '0 12px 32px rgba(255,106,0,.10)' }}>
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

      <section className="lesson-agenda" aria-label={language === 'DE' ? 'Unterrichtsplan' : 'Расписание уроков'} aria-busy={loading}>
        <div className="lesson-agenda-navigation">
          <button className="lesson-agenda-arrow" type="button" aria-label={language === 'DE' ? 'Vorherige Woche' : 'Предыдущая неделя'} onClick={() => moveWeek(-1)}>‹</button>
          <label className="lesson-agenda-month" title={language === 'DE' ? 'Datum auswählen' : 'Выбрать дату'}>
            <strong>{formatMonthTitle(selectedDate, language)}</strong>
            <input type="date" aria-label={language === 'DE' ? 'Zu Datum wechseln' : 'Перейти к дате'} value={selectedDayKey} onClick={(event) => event.currentTarget.showPicker?.()} onChange={(event) => { if (event.target.value) selectDate(event.target.value); }} />
          </label>
          <button className="lesson-agenda-arrow" type="button" aria-label={language === 'DE' ? 'Nächste Woche' : 'Следующая неделя'} onClick={() => moveWeek(1)}>›</button>
        </div>
        <div className="lesson-agenda-days" role="group" aria-label={language === 'DE' ? 'Unterrichtstag auswählen' : 'Выбрать день уроков'}>
          {scheduleDays.map((day, index) => <button type="button" key={day.key} className={'lesson-agenda-day' + (day.key === todayKey ? ' is-today' : '')}
            aria-pressed={selectedDayKey === day.key} aria-label={formatAgendaDate(day.key, language) + ', ' + lessonCountText(day.lessons.length, language)} onClick={() => selectDate(day.key)}>
            <span>{weekdayLabels(language)[index]}</span><strong>{day.date.getUTCDate()}</strong>
            <i className={day.lessons.length > 0 ? 'has-lessons' : ''} aria-hidden="true" />
          </button>)}
        </div>
        <div className="lesson-agenda-day-heading"><h2>{formatAgendaDate(selectedDayKey, language)}</h2><span>{lessonCountText(selectedLessons.length, language)}</span></div>
        {loading ? <p className="muted">{t('common.loading')}</p>
          : selectedLessons.length ? <div className="lesson-agenda-list">{selectedLessons.map(renderLessonCard)}</div>
          : error ? <div className="teacher-empty-state"><button className="btn btn--secondary" type="button" onClick={() => void loadAll()}>{language === 'DE' ? 'Erneut versuchen' : 'Повторить загрузку'}</button></div>
          : <div className="lesson-agenda-empty"><strong>{language === 'DE' ? 'Kein Unterricht geplant' : 'На этот день уроков нет'}</strong><p>{language === 'DE' ? 'Wähle einen anderen Tag oder plane einen neuen Unterricht.' : 'Выберите другой день или запланируйте новое занятие.'}</p></div>}
      </section>
      <div className="lesson-agenda-integration">
      {connection?.connected !== true ? (
        <details className="lesson-calendar-option">
          <summary>{language === 'DE' ? 'Google Calendar verbinden (optional)' : 'Подключить Google Calendar (необязательно)'}</summary>
          <p className="muted">{language === 'DE' ? 'Kalendertermine werden zusätzlich zu den hier erstellten Unterrichten angezeigt.' : 'Занятия из календаря будут отображаться вместе с уроками, созданными здесь.'}</p>
          {connection?.authorizationUrl ? <a className="btn btn--secondary" href={connection.authorizationUrl}>{language === 'DE' ? 'Mit Google verbinden' : 'Подключить Google Calendar'}</a> : <p className="muted">{language === 'DE' ? 'Die Synchronisierung ist derzeit nicht verfügbar. Du kannst Unterricht direkt hier erstellen.' : 'Синхронизация пока недоступна. Создавайте уроки прямо здесь.'}</p>}
        </details>
      ) : (
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <div className="banner banner--success" style={{ margin: 0 }}>{language === 'DE' ? 'Google Calendar ist verbunden.' : 'Google Calendar подключён.'}</div>
          <button className="btn btn--ghost" type="button" onClick={() => void disconnectCalendar()}>{language === 'DE' ? 'Trennen' : 'Отключить календарь'}</button>
        </div>
      )}
      </div>

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
          <div className="panel" style={{ width: 'min(580px, 100%)', padding: 30, textAlign: 'center', boxShadow: '0 24px 70px rgba(15,23,42,.32)', border: '2px solid var(--teacher-selected-border, #ff6a00)' }}>
            <div style={{ fontSize: 30, fontWeight: 900, marginBottom: 10, color: 'var(--teacher-selected-text, #d94f00)' }}>{language === 'DE' ? 'Soniox stoppen' : 'Останови Soniox'}</div>
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

function formatMonthTitle(date: Date, language: 'DE' | 'RU') {
  const value = new Intl.DateTimeFormat(language === 'DE' ? 'de-DE' : 'ru-RU', { month: 'long', year: 'numeric', timeZone: 'Europe/Berlin' }).format(date).replace(/\sг\.$/, '');
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function dateFromKey(key: string) { return new Date(key + 'T12:00:00Z'); }
function formatAgendaDate(key: string, language: 'DE' | 'RU') {
  const date = dateFromKey(key);
  return new Intl.DateTimeFormat(language === 'DE' ? 'de-DE' : 'ru-RU', {
    day: 'numeric', month: 'long', timeZone: 'Europe/Berlin', ...(date.getUTCFullYear() !== Number(berlinDateKey(new Date().toISOString()).slice(0, 4)) ? { year: 'numeric' } as const : {}),
  }).format(date);
}
function lessonCountText(count: number, language: 'DE' | 'RU') {
  if (language === 'DE') return count + (count === 1 ? ' Termin' : ' Termine');
  const mod10 = count % 10, mod100 = count % 100;
  return count + ' ' + (mod10 === 1 && mod100 !== 11 ? 'занятие' : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'занятия' : 'занятий');
}

function weekdayLabels(language: 'DE' | 'RU') {
  return language === 'DE'
    ? ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
    : ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
}

function startOfWeekMonday(date: Date) { const day = date.getUTCDay(); const offset = day === 0 ? -6 : 1 - day; return addDays(startOfLocalDay(date), offset); }
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

function formatStartTime(value: string, language: 'DE' | 'RU') { return new Intl.DateTimeFormat(language === 'DE' ? 'de-DE' : 'ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' }).format(new Date(value)); }
function formatLessonTime(start: string, end: string, language: 'DE' | 'RU') { const formatter = new Intl.DateTimeFormat(language === 'DE' ? 'de-DE' : 'ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' }); return `${formatter.format(new Date(start))}–${formatter.format(new Date(end))}`; }
function startOfLocalDay(date: Date) { return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12)); }
function addDays(date: Date, days: number) { return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days, 12)); }
function localDateKey(date: Date) { return date.toISOString().slice(0, 10); }
