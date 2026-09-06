import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { driveApi, type DriveItem } from '../../api/drive';
import type { DailyReviewHistoryItem, GroupLesson, Homework, StudentGroup } from '../../api/types';
import { toErrorMessage } from '../../lib/errors';
import { useI18n } from '../../i18n/I18nContext';

type StudentBrief = {
  studentId: string;
  name: string;
  homeworkText: string;
  cardText: string;
  errorText: string | null;
  recommendation: string;
};

type LessonBrief = {
  group: StudentGroup;
  students: StudentBrief[];
  recentWorksheet: Homework | null;
};

type BriefMap = Record<string, LessonBrief>;

export function GroupLessonsPage() {
  const { language, t } = useI18n();
  const [lessons, setLessons] = useState<GroupLesson[]>([]);
  const [briefs, setBriefs] = useState<BriefMap>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startedLessonId, setStartedLessonId] = useState<string | null>(() => localStorage.getItem('mindcrafti.startedGroupLesson'));
  const [finishedLessonId, setFinishedLessonId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const lessonList = await api.lessons.groupLessons();
        setLessons(lessonList);
        const uniqueGroupIds = Array.from(new Set(lessonList.map((lesson) => lesson.groupId)));
        const entries = await Promise.all(uniqueGroupIds.map(async (groupId) => {
          const group = await api.groups.get(groupId);
          const students = await Promise.all(group.students.map(async (student) => {
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
          return [groupId, { group, students, recentWorksheet }] as const;
        }));
        setBriefs(Object.fromEntries(entries));
      } catch (e) {
        setError(toErrorMessage(e, t));
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [t]);

  const upcoming = useMemo(() => lessons.filter((lesson) => new Date(lesson.endsAt).getTime() >= Date.now() - 3 * 60 * 60 * 1000), [lessons]);

  function startLesson(lesson: GroupLesson) {
    if (!lesson.meetUrl) {
      window.alert(language === 'DE' ? 'Für diesen Termin ist kein Google Meet hinterlegt.' : 'У этого события в Google Calendar нет ссылки Google Meet.');
      return;
    }
    const confirmed = window.confirm(language === 'DE'
      ? 'Hast du die Aufnahme in Soniox gestartet? Danach öffnen wir genau das Google Meet dieses Kalendereintrags.'
      : 'Ты включил запись в Soniox? После подтверждения откроется именно Google Meet этого события из Google Calendar.');
    if (!confirmed) return;
    setStartedLessonId(lesson.eventId);
    setFinishedLessonId(null);
    localStorage.setItem('mindcrafti.startedGroupLesson', lesson.eventId);
    const tab = window.open(lesson.meetUrl, '_blank');
    if (tab) tab.opener = null;
  }

  function finishLesson(lesson: GroupLesson) {
    const confirmed = window.confirm(language === 'DE'
      ? 'Stoppe zuerst die Soniox-Aufnahme. Ist die Aufnahme gestoppt?'
      : 'Сначала останови запись Soniox. Запись уже остановлена?');
    if (!confirmed) return;
    setFinishedLessonId(lesson.eventId);
    setStartedLessonId(null);
    localStorage.removeItem('mindcrafti.startedGroupLesson');
  }

  return (
    <div className="teacher-lessons-page">
      <div className="teacher-page-heading">
        <h1>{language === 'DE' ? 'Gruppenunterricht' : 'Уроки групп'}</h1>
        <p>{language === 'DE' ? 'Kalender, kurze Vorbereitung, Meet und Soniox an einem Ort.' : 'Расписание, краткая подготовка, Meet и Soniox в одном месте.'}</p>
      </div>

      {error && <div className="banner banner--error">{error}</div>}
      {loading ? <p className="muted">{t('common.loading')}</p> : upcoming.length === 0 ? (
        <div className="teacher-empty-state">
          <strong>{language === 'DE' ? 'Keine Gruppentermine gefunden.' : 'Групповые уроки пока не найдены.'}</strong>
          <div className="muted" style={{ marginTop: 8 }}>
            {language === 'DE'
              ? 'Prüfe GOOGLE_CALENDAR_ID und ob der Kalender mit dem Google-Servicekonto geteilt wurde.'
              : 'Проверь GOOGLE_CALENDAR_ID и доступ сервисного аккаунта Google к календарю.'}
          </div>
        </div>
      ) : (
        <div className="stack">
          {upcoming.map((lesson) => {
            const brief = briefs[lesson.groupId];
            const isStarted = startedLessonId === lesson.eventId;
            const isFinished = finishedLessonId === lesson.eventId;
            return (
              <section key={lesson.eventId} className="panel" style={{ padding: 22 }}>
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 18, flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 420px' }}>
                    <div className="muted" style={{ fontSize: 13 }}>{formatLessonDate(lesson.startsAt, language)}</div>
                    <h2 style={{ margin: '4px 0 5px', fontSize: 24 }}>{lesson.groupName}</h2>
                    <div className="muted">{formatLessonTime(lesson.startsAt, lesson.endsAt, language)}</div>
                  </div>
                  <Link className="btn btn--secondary" to={`/groups/${lesson.groupId}`}>{language === 'DE' ? 'Gruppe öffnen' : 'Открыть группу'}</Link>
                </div>

                {brief && (
                  <div style={{ marginTop: 20 }}>
                    <h3 style={{ marginBottom: 10 }}>{language === 'DE' ? 'Kurz vor dem Unterricht' : 'Кратко перед уроком'}</h3>
                    <div className="stack">
                      {brief.students.map((student) => (
                        <div key={student.studentId} style={{ padding: '12px 14px', border: '1px solid var(--border)', borderRadius: 12 }}>
                          <strong>{student.name}</strong>
                          <div className="muted" style={{ marginTop: 5, fontSize: 13 }}>{student.homeworkText}</div>
                          <div className="muted" style={{ marginTop: 3, fontSize: 13 }}>{student.cardText}</div>
                          {student.errorText && <div style={{ marginTop: 6, fontSize: 13 }}>{student.errorText}</div>}
                          <div style={{ marginTop: 6, fontSize: 13 }}><strong>{language === 'DE' ? 'Empfehlung:' : 'Рекомендация:'}</strong> {student.recommendation}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                  <strong>{language === 'DE' ? 'Arbeitsmaterial' : 'Рабочая тетрадь / материал'}</strong>
                  {brief?.recentWorksheet ? (
                    <div className="row" style={{ marginTop: 8, alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <div className="muted" style={{ flex: '1 1 320px' }}>{brief.recentWorksheet.worksheetFilename}</div>
                      <Link className="btn btn--secondary" to={`/groups/${lesson.groupId}`}>{language === 'DE' ? 'Ansehen / bearbeiten' : 'Посмотреть / редактировать'}</Link>
                    </div>
                  ) : (
                    <div className="muted" style={{ marginTop: 6 }}>{language === 'DE' ? 'Noch kein PDF-Material gefunden.' : 'PDF-материал для группы пока не найден.'}</div>
                  )}
                </div>

                <div className="row" style={{ marginTop: 18, gap: 10, flexWrap: 'wrap' }}>
                  {!isStarted ? (
                    <button className="btn" type="button" onClick={() => startLesson(lesson)} disabled={!lesson.meetUrl}>
                      {language === 'DE' ? 'Unterricht starten' : 'Начать урок'}
                    </button>
                  ) : (
                    <>
                      <a className="btn" href={lesson.meetUrl ?? '#'} target="_blank" rel="noreferrer">Google Meet</a>
                      <button className="btn btn--secondary" type="button" onClick={() => finishLesson(lesson)}>{language === 'DE' ? 'Unterricht beenden' : 'Завершить урок'}</button>
                    </>
                  )}
                  {lesson.calendarUrl && <a className="btn btn--ghost" href={lesson.calendarUrl} target="_blank" rel="noreferrer">Google Calendar</a>}
                </div>

                {isStarted && (
                  <div className="banner banner--info" style={{ marginTop: 14, marginBottom: 0 }}>
                    {language === 'DE' ? 'Soniox-Aufnahme sollte jetzt laufen.' : 'Запись Soniox должна сейчас идти. После урока нажми «Завершить урок».'}
                  </div>
                )}

                {isFinished && <TranscriptUpload groupId={lesson.groupId} language={language} />}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TranscriptUpload({ groupId, language }: { groupId: string; language: 'DE' | 'RU' }) {
  const storageKey = `mindcrafti.groupTranscriptFolder.${groupId}`;
  const [folderId, setFolderId] = useState(() => localStorage.getItem(storageKey) ?? '');
  const [folderPickerOpen, setFolderPickerOpen] = useState(!folderId);
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

  async function selectDrive(value: string) {
    setDriveId(value);
    setPath([]);
    setFolders(value ? await driveApi.listFolders(value) : []);
  }

  async function enter(folder: DriveItem) {
    setPath((current) => [...current, folder]);
    setFolders(await driveApi.listFolders(driveId, folder.id));
  }

  function saveCurrentFolder() {
    const current = path.length > 0 ? path[path.length - 1].id : driveId;
    if (!current) return;
    localStorage.setItem(storageKey, current);
    setFolderId(current);
    setFolderPickerOpen(false);
  }

  async function upload() {
    if (!folderId || !file || uploading) return;
    setUploading(true);
    setError(null);
    setMessage(null);
    try {
      const result = await driveApi.upload(folderId, file);
      setMessage(language === 'DE' ? `Soniox-Datei gespeichert: ${result.name}` : `Файл Soniox сохранён в Google Drive: ${result.name}`);
      setFile(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="panel stack" style={{ marginTop: 14, marginBottom: 0, padding: 16 }}>
      <strong>{language === 'DE' ? 'Soniox-Datei speichern' : 'Загрузить файл Soniox'}</strong>
      <div className="muted" style={{ fontSize: 13 }}>
        {language === 'DE' ? 'Die gewählte Ordner-ID wird für diese Gruppe auf diesem Gerät gemerkt.' : 'Папка запоминается для этой группы на этом устройстве, и следующие файлы будут уходить туда автоматически.'}
      </div>
      {error && <div className="banner banner--error">{error}</div>}
      {message && <div className="banner banner--success">{message}</div>}

      {folderId && !folderPickerOpen ? (
        <div className="row" style={{ alignItems: 'center', gap: 10 }}>
          <div className="muted">{language === 'DE' ? 'Google-Drive-Ordner ist eingerichtet.' : 'Папка Google Drive настроена.'}</div>
          <button className="btn btn--ghost" type="button" onClick={() => setFolderPickerOpen(true)}>{language === 'DE' ? 'Ordner ändern' : 'Изменить папку'}</button>
        </div>
      ) : (
        <div className="stack">
          <select className="select" value={driveId} onChange={(e) => void selectDrive(e.target.value)}>
            <option value="">{language === 'DE' ? 'Ablage auswählen' : 'Выберите общий диск'}</option>
            {drives.map((drive) => <option key={drive.id} value={drive.id}>{drive.name}</option>)}
          </select>
          {driveId && (
            <>
              <div className="muted" style={{ fontSize: 13 }}>{[drives.find((drive) => drive.id === driveId)?.name, ...path.map((item) => item.name)].filter(Boolean).join(' / ')}</div>
              <div className="stack">
                {folders.map((folder) => <button key={folder.id} className="btn btn--ghost" type="button" style={{ textAlign: 'left' }} onClick={() => void enter(folder)}>{folder.name}</button>)}
              </div>
              <button className="btn btn--secondary" type="button" onClick={saveCurrentFolder}>{language === 'DE' ? 'Diesen Ordner verwenden' : 'Использовать эту папку'}</button>
            </>
          )}
        </div>
      )}

      <input className="input" type="file" accept=".txt,.doc,.docx,.pdf,.srt,.vtt,.json,text/plain,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <button className="btn" type="button" disabled={!file || !folderId || uploading} onClick={() => void upload()}>
        {uploading ? (language === 'DE' ? 'Wird gespeichert…' : 'Сохраняем…') : (language === 'DE' ? 'In Google Drive speichern' : 'Сохранить в Google Drive')}
      </button>
    </div>
  );
}

function buildStudentBrief(studentId: string, name: string, homeworks: Homework[], history: DailyReviewHistoryItem[], dueCards: number): StudentBrief {
  const recentHomework = [...homeworks].filter((item) => item.hasWorksheet).sort((a, b) => b.startDate.localeCompare(a.startDate))[0];
  const recentHistory = [...history].sort((a, b) => b.date.localeCompare(a.date))[0];
  const wrongAnswers = recentHistory?.answers?.filter((answer) => !answer.correct) ?? [];

  const homeworkText = !recentHomework
    ? 'Домашка: данных пока нет.'
    : recentHomework.submitted
      ? `Домашка: сдана (${recentHomework.startDate}).`
      : `Домашка: не сдана (${recentHomework.startDate}).`;
  const cardText = dueCards > 0 ? `Карточки: сейчас нужно повторить ${dueCards}.` : 'Карточки: срочных повторений нет.';
  const errorText = wrongAnswers.length > 0
    ? `Ошибки в карточках: ${wrongAnswers.slice(0, 2).map((answer) => answer.question).join('; ')}${wrongAnswers.length > 2 ? '…' : ''}`
    : null;
  const recommendation = !recentHomework?.submitted
    ? 'В начале проверить домашку и понять, где возникла проблема.'
    : wrongAnswers.length > 0
      ? 'Коротко разобрать повторяющиеся ошибки перед новой темой.'
      : dueCards > 0
        ? 'Начать с короткого повторения карточек.'
        : 'Можно быстро проверить прошлую тему и переходить к плану урока.';

  return { studentId, name, homeworkText, cardText, errorText, recommendation };
}

function formatLessonDate(value: string, language: 'DE' | 'RU') {
  return new Intl.DateTimeFormat(language === 'DE' ? 'de-DE' : 'ru-RU', { weekday: 'long', day: '2-digit', month: 'long' }).format(new Date(value));
}

function formatLessonTime(start: string, end: string, language: 'DE' | 'RU') {
  const locale = language === 'DE' ? 'de-DE' : 'ru-RU';
  const formatter = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });
  return `${formatter.format(new Date(start))}–${formatter.format(new Date(end))}`;
}
