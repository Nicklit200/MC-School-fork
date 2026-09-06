import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { driveApi, type DriveItem } from '../../api/drive';
import type { DailyReviewHistoryItem, GoogleCalendarConnection, GroupLesson, Homework, StudentGroup, StudentListItem } from '../../api/types';
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

const STARTED_LESSON_KEY = 'mindcrafti.startedGroupLesson';
const STARTED_LESSON_AT_KEY = 'mindcrafti.startedGroupLessonOpenedAt';
const SONIOX_NOTIFICATION_PREFIX = 'mindcrafti.sonioxStopNotification.';

export function GroupLessonsPage() {
  const { language, t } = useI18n();
  const [connection, setConnection] = useState<GoogleCalendarConnection | null>(null);
  const [lessons, setLessons] = useState<GroupLesson[]>([]);
  const [students, setStudents] = useState<StudentListItem[]>([]);
  const [briefs, setBriefs] = useState<BriefMap>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedLessonId, setExpandedLessonId] = useState<string | null>(null);
  const [startReminderLessonId, setStartReminderLessonId] = useState<string | null>(null);
  const [finishReminderLessonId, setFinishReminderLessonId] = useState<string | null>(null);
  const [startedLessonId, setStartedLessonId] = useState<string | null>(() => localStorage.getItem(STARTED_LESSON_KEY));
  const [finishedLessonId, setFinishedLessonId] = useState<string | null>(null);
  const [returnedLessonId, setReturnedLessonId] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('fromMeet') !== '1') return;
    const completedLesson = params.get('completedLesson');
    if (completedLesson) {
      setReturnedLessonId(completedLesson);
      setFinishedLessonId(completedLesson);
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
      const googleConnection = await api.lessons.googleCalendarConnection();
      setConnection(googleConnection);
      const studentList = await api.students.list();
      setStudents(studentList);
      if (!googleConnection.connected) {
        setLessons([]);
        setBriefs({});
        return;
      }

      const lessonList = await api.lessons.groupLessons();
      setLessons(lessonList);
      const groupIds = Array.from(new Set(lessonList.map((lesson) => lesson.groupId).filter((id): id is string => Boolean(id))));
      const entries = await Promise.all(groupIds.map(async (groupId) => {
        const group = await api.groups.get(groupId);
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

  const returnedLesson = returnedLessonId ? lessons.find((lesson) => lesson.eventId === returnedLessonId) ?? null : null;
  const returnedGroup = returnedLesson?.groupId ? briefs[returnedLesson.groupId]?.group ?? null : null;
  const returnedStudent = returnedLesson?.studentId ? students.find((student) => student.id === returnedLesson.studentId) ?? null : null;

  async function bindStudent(lesson: GroupLesson, studentId: string) {
    if (!studentId) return;
    setError(null);
    try {
      await api.lessons.bindStudent(lesson.bindingKey, studentId);
      const selected = students.find((student) => student.id === studentId);
      setLessons((current) => current.map((item) => item.bindingKey === lesson.bindingKey
        ? { ...item, studentId, studentName: selected?.fullName ?? item.studentName }
        : item));
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

  if (loading) return <p className="muted">{t('common.loading')}</p>;
  const startReminderLesson = startReminderLessonId ? lessons.find((lesson) => lesson.eventId === startReminderLessonId) ?? null : null;
  const finishReminderLesson = finishReminderLessonId ? lessons.find((lesson) => lesson.eventId === finishReminderLessonId) ?? null : null;

  return (
    <div className="teacher-lessons-page">
      <div className="teacher-page-heading">
        <h1>{language === 'DE' ? 'Unterricht' : 'Уроки'}</h1>
        <p>{language === 'DE' ? 'Dein Stundenplan für die nächsten 7 Tage.' : 'Расписание на ближайшие 7 дней.'}</p>
      </div>

      {error && <div className="banner banner--error">{error}</div>}

      {returnedLessonId && (
        <div className="panel" style={{ marginBottom: 18, padding: 22, border: '2px solid #ff6a00', boxShadow: '0 12px 32px rgba(255,106,0,.10)' }}>
          <div style={{ fontSize: 24, fontWeight: 900, marginBottom: 6 }}>{language === 'DE' ? 'Unterricht beendet' : 'Урок завершён'}</div>
          <div style={{ fontSize: 16, marginBottom: 14 }}>
            {returnedLesson?.title
              ? (language === 'DE' ? `${returnedLesson.title}. Lade jetzt die Soniox-Transkription hoch.` : `${returnedLesson.title}. Теперь загрузи транскрипцию Soniox.`)
              : (language === 'DE' ? 'Lade jetzt die Soniox-Transkription hoch.' : 'Теперь загрузи транскрипцию Soniox.')}
          </div>
          {returnedGroup ? (
            <TranscriptUpload target={{ kind: 'group', id: returnedGroup.id, initialFolderId: returnedGroup.googleDriveTranscriptFolderId ?? null }} language={language} prominent />
          ) : returnedStudent ? (
            <TranscriptUpload target={{ kind: 'student', id: returnedStudent.id, initialFolderId: returnedStudent.googleDriveTranscriptFolderId ?? null }} language={language} prominent />
          ) : (
            <div className="banner banner--info">
              {language === 'DE' ? 'Ordne diesen Termin zuerst einem Schüler zu.' : 'Сначала привяжи это событие календаря к ученику. После этого транскрипция попадёт в его папку.'}
            </div>
          )}
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

        <div style={{ overflowX: 'auto', paddingBottom: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(220px, 1fr))', gap: 12, minWidth: 1540 }}>
            {scheduleDays.map((day, index) => (
              <section key={day.key} className="panel" style={{ padding: 14, margin: 0, minHeight: 260 }}>
                <div style={{ paddingBottom: 10, borderBottom: '1px solid var(--border)', marginBottom: 10 }}>
                  <div style={{ fontWeight: 800, fontSize: 16 }}>{formatDayTitle(day.date, index, language)}</div>
                  <div className="muted" style={{ marginTop: 3, fontSize: 12 }}>{formatDayDate(day.date, language)}</div>
                </div>
                {day.lessons.length === 0 ? <div className="muted" style={{ fontSize: 13, padding: '8px 0' }}>{language === 'DE' ? 'Kein Unterricht' : 'Уроков нет'}</div> : (
                  <div className="stack" style={{ gap: 8 }}>
                    {day.lessons.map((lesson) => {
                      const brief = lesson.groupId ? briefs[lesson.groupId] : undefined;
                      const linkedGroup = Boolean(lesson.groupId && lesson.groupName);
                      const expanded = expandedLessonId === lesson.eventId;
                      const finished = finishedLessonId === lesson.eventId;
                      return (
                        <div key={lesson.eventId} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 12, background: '#fff' }}>
                          <div style={{ fontSize: 17, fontWeight: 800 }}>{formatStartTime(lesson.startsAt, language)}</div>
                          <div style={{ fontWeight: 750, marginTop: 4 }}>{lesson.title}</div>
                          <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>{formatLessonTime(lesson.startsAt, lesson.endsAt, language)}</div>

                          {linkedGroup ? (
                            <div className="banner banner--info" style={{ marginTop: 8, padding: 8, fontSize: 12 }}>{language === 'DE' ? `Gruppe: ${lesson.groupName}` : `Группа: ${lesson.groupName}`}</div>
                          ) : (
                            <label className="field" style={{ marginTop: 8, marginBottom: 0 }}>
                              <span className="field__label" style={{ fontSize: 12 }}>{language === 'DE' ? 'Schüler für diesen Termin' : 'Ученик для этого события'}</span>
                              <select className="select" value={lesson.studentId ?? ''} onChange={(e) => void bindStudent(lesson, e.target.value)}>
                                <option value="">{language === 'DE' ? 'Schüler auswählen' : 'Выбрать ученика'}</option>
                                {students.map((student) => <option key={student.id} value={student.id}>{student.fullName}</option>)}
                              </select>
                            </label>
                          )}

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

                          {finished && !returnedLessonId && linkedGroup && lesson.groupId && <TranscriptUpload target={{ kind: 'group', id: lesson.groupId, initialFolderId: brief?.group.googleDriveTranscriptFolderId ?? null }} language={language} />}
                          {finished && !returnedLessonId && !linkedGroup && lesson.studentId && <TranscriptUpload target={{ kind: 'student', id: lesson.studentId, initialFolderId: students.find((student) => student.id === lesson.studentId)?.googleDriveTranscriptFolderId ?? null }} language={language} />}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            ))}
          </div>
        </div>
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

type TranscriptTarget = { kind: 'group' | 'student'; id: string; initialFolderId: string | null };

function TranscriptUpload({ target, language, prominent = false }: { target: TranscriptTarget; language: 'DE' | 'RU'; prominent?: boolean }) {
  const storageKey = target.kind === 'group' ? `mindcrafti.groupTranscriptFolder.${target.id}` : `mindcrafti.studentTranscriptFolder.${target.id}`;
  const [folderId, setFolderId] = useState(target.initialFolderId ?? localStorage.getItem(storageKey) ?? '');
  const [folderPickerOpen, setFolderPickerOpen] = useState(!(target.initialFolderId ?? localStorage.getItem(storageKey)));
  const [drives, setDrives] = useState<DriveItem[]>([]);
  const [driveId, setDriveId] = useState('');
  const [folders, setFolders] = useState<DriveItem[]>([]);
  const [path, setPath] = useState<DriveItem[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!folderPickerOpen || drives.length > 0) return;
    driveApi.listSharedDrives().then(setDrives).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [folderPickerOpen, drives.length]);

  async function selectDrive(value: string) { setDriveId(value); setPath([]); setFolders(value ? await driveApi.listFolders(value) : []); }
  async function enter(folder: DriveItem) { setPath((current) => [...current, folder]); setFolders(await driveApi.listFolders(driveId, folder.id)); }

  async function saveCurrentFolder() {
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
    if (!folderId || !file || uploading) return;
    setUploading(true); setError(null); setMessage(null);
    try {
      const result = await driveApi.upload(folderId, file);
      setMessage(language === 'DE' ? `Transkription gespeichert: ${result.name}` : `Транскрипция загружена в нужную папку Google Drive: ${result.name}`);
      setFile(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setUploading(false); }
  }

  return (
    <div style={prominent ? { marginTop: 8 } : { marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
      <strong style={{ fontSize: prominent ? 16 : 12 }}>{language === 'DE' ? 'Soniox-Transkription' : 'Транскрипция Soniox'}</strong>
      {folderId && !folderPickerOpen && <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>{language === 'DE' ? 'Zielordner ist gespeichert.' : 'Папка для транскрипций уже настроена.'}</div>}
      {error && <div className="banner banner--error" style={{ marginTop: 8 }}>{error}</div>}
      {message && <div className="banner banner--success" style={{ marginTop: 8 }}>{message}</div>}
      {!folderId || folderPickerOpen ? (
        <div className="stack" style={{ gap: 7, marginTop: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>{language === 'DE' ? 'Zielordner auswählen:' : 'Выбери папку для транскрипций:'}</div>
          <select className="select" value={driveId} onChange={(e) => void selectDrive(e.target.value)}>
            <option value="">{language === 'DE' ? 'Drive auswählen' : 'Выберите общий диск'}</option>
            {drives.map((drive) => <option key={drive.id} value={drive.id}>{drive.name}</option>)}
          </select>
          {driveId && <>{path.length > 0 && <div className="muted" style={{ fontSize: 12 }}>{path.map((item) => item.name).join(' / ')}</div>}{folders.map((folder) => <button key={folder.id} className="btn btn--ghost" type="button" onClick={() => void enter(folder)}>{folder.name}</button>)}<button className="btn btn--secondary" type="button" onClick={() => void saveCurrentFolder()}>{language === 'DE' ? 'Ordner speichern' : 'Сохранить эту папку'}</button></>}
        </div>
      ) : <button className="btn btn--ghost" type="button" onClick={() => setFolderPickerOpen(true)} style={{ marginTop: 8 }}>{language === 'DE' ? 'Ordner ändern' : 'Изменить папку'}</button>}
      <input className="input" type="file" style={{ marginTop: 10 }} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <button className="btn" type="button" disabled={!file || !folderId || uploading} onClick={() => void upload()} style={{ width: '100%', marginTop: 8, minHeight: prominent ? 50 : undefined }}>{uploading ? (language === 'DE' ? 'Speichern…' : 'Загружаем…') : (language === 'DE' ? 'Transkription speichern' : 'Загрузить транскрипцию')}</button>
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

function formatDayTitle(date: Date, index: number, language: 'DE' | 'RU') { if (index === 0) return language === 'DE' ? 'Heute' : 'Сегодня'; if (index === 1) return language === 'DE' ? 'Morgen' : 'Завтра'; return new Intl.DateTimeFormat(language === 'DE' ? 'de-DE' : 'ru-RU', { weekday: 'short' }).format(date); }
function formatDayDate(date: Date, language: 'DE' | 'RU') { return new Intl.DateTimeFormat(language === 'DE' ? 'de-DE' : 'ru-RU', { day: '2-digit', month: '2-digit' }).format(date); }
function formatStartTime(value: string, language: 'DE' | 'RU') { return new Intl.DateTimeFormat(language === 'DE' ? 'de-DE' : 'ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date(value)); }
function formatLessonTime(start: string, end: string, language: 'DE' | 'RU') { const formatter = new Intl.DateTimeFormat(language === 'DE' ? 'de-DE' : 'ru-RU', { hour: '2-digit', minute: '2-digit' }); return `${formatter.format(new Date(start))}–${formatter.format(new Date(end))}`; }
function startOfLocalDay(date: Date) { return new Date(date.getFullYear(), date.getMonth(), date.getDate()); }
function addDays(date: Date, days: number) { return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days); }
function localDateKey(date: Date) { const year = date.getFullYear(); const month = String(date.getMonth() + 1).padStart(2, '0'); const day = String(date.getDate()).padStart(2, '0'); return `${year}-${month}-${day}`; }
