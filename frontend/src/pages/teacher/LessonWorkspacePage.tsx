import { LessonCardsPanel } from './LessonCardsPanel';
import { TeacherIcon, type TeacherIconName } from '../../components/TeacherIcon';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import { completedLessonApi, lessonPreparationApi, type CompletedLessonDocument } from '../../api/lessonPreparation';
import type { GroupLesson, LessonPreparation } from '../../api/types';
import { StartOnlineClassButton } from '../../features/online-classes/StartOnlineClassButton';
import { TrialInvitationPanel } from './TrialInvitationPanel';
import { trialInvitationsApi } from '../../api/trialInvitations';
import { LessonHomeworkSeriesPanel } from '../../components/LessonHomeworkSeriesPanel';
import { PersonalWorkbooksPanel } from './PersonalWorkbooksPanel';
import { useI18n } from '../../i18n/I18nContext';
import { toErrorMessage } from '../../lib/errors';

type Kind = 'workbook' | 'answers' | 'transcript';
export function LessonWorkspacePage() {
  const { eventId = '' } = useParams();
  const { language, t } = useI18n();
  const de = language === 'DE';
  const [lesson, setLesson] = useState<GroupLesson | null>(null);
  const [previousTrialInvite, setPreviousTrialInvite] = useState(false);
  const [prep, setPrep] = useState<LessonPreparation | null>(null);
  const [documents, setDocuments] = useState<CompletedLessonDocument[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const documentsDialog = useRef<HTMLDialogElement>(null);
  const homeworkDialog = useRef<HTMLDialogElement>(null);
  const generation = useRef(0);
  useEffect(() => {
    let active = true;
    setPreviousTrialInvite(false);
    void trialInvitationsApi.listMine().then(ids => {
      if (active) setPreviousTrialInvite(ids.includes(eventId));
    }).catch(() => {});
    return () => { active = false; };
  }, [eventId]);

  useEffect(() => {
    const epoch = ++generation.current;
    setLoading(true); setError(''); setNotice(''); setPrep(null); setLesson(null); setDocuments([]);
    Promise.all([api.lessons.groupLessons(), lessonPreparationApi.get(eventId), completedLessonApi.list(eventId).catch(() => [] as CompletedLessonDocument[])])
      .then(([lessons, preparation, docs]) => { if (epoch === generation.current) { setLesson(lessons.find(item => item.eventId === eventId) ?? null); setPrep(preparation); setDocuments(docs); } })
      .catch(e => { if (epoch === generation.current) setError(toErrorMessage(e, t)); })
      .finally(() => { if (epoch === generation.current) setLoading(false); });
    return () => { generation.current++; };
  }, [eventId, t]);
  async function perform(action: () => Promise<unknown>, success = '') {
    const epoch = generation.current;
    setBusy(true); setError('');
    try { await action(); if (epoch === generation.current && success) setNotice(success); }
    catch (e) { if (epoch === generation.current) setError(toErrorMessage(e, t)); }
    finally { if (epoch === generation.current) setBusy(false); }
  }
  async function upload(kind: Kind, file: File) {
    const epoch = generation.current;
    await perform(async () => {
      const updated = await (kind === 'workbook' ? lessonPreparationApi.uploadWorkbook(eventId, file) : kind === 'answers' ? lessonPreparationApi.uploadAnswers(eventId, file) : lessonPreparationApi.uploadTranscript(eventId, file));
      if (epoch === generation.current) setPrep(current => current ? { ...updated, homeworkNotes: current.homeworkNotes, difficulties: current.difficulties } : updated);
    }, de ? 'Datei gespeichert.' : 'Файл сохранён.');
  }
  function open(kind: Kind) {
    const tab = window.open('about:blank', '_blank');
    if (tab) tab.opener = null;
    const epoch = generation.current;
    void perform(async () => {
      try {
        const url = await (kind === 'workbook' ? lessonPreparationApi.workbookUrl(eventId) : kind === 'answers' ? lessonPreparationApi.answersUrl(eventId) : lessonPreparationApi.transcriptUrl(eventId));
        if (!tab || epoch !== generation.current) { URL.revokeObjectURL(url); tab?.close(); if (!tab) throw new Error(de ? 'Bitte Pop-ups erlauben.' : 'Разрешите открытие PDF в новой вкладке.'); return; }
        tab.location.href = url; window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      } catch(e) { tab?.close(); throw e; }
    });
  }
  function fileControls(kind: Kind) {
    const filename = kind === 'workbook' ? prep?.workbookFilename : kind === 'answers' ? prep?.answersFilename : prep?.transcriptFilename;
    return <><p className="muted workspace-filename">{filename || (de?'Noch keine Datei':'Файл пока не добавлен')}</p><div className="workspace-actions">
      <button type="button" className="btn btn--secondary" disabled={busy || !filename} onClick={()=>open(kind)}><TeacherIcon name="openFile"/>{de?'Arbeitsheft öffnen':'Открыть тетрадь'}</button>
      <label className="btn btn--secondary"><TeacherIcon name="upload"/>{filename?(de?'Arbeitsheft ersetzen':'Заменить тетрадь'):(de?'Arbeitsheft hinzufügen':'Добавить тетрадь')}<input type="file" accept="application/pdf,.pdf" disabled={busy} hidden aria-label={de?'Arbeitsheft hochladen':'Загрузить тетрадь'} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void upload(kind,file);}}/></label>
    </div></>;
  }

  async function save() {
    if (!prep) return;
    await perform(() => lessonPreparationApi.update(eventId, {
      coveredMaterial: prep.coveredMaterial ?? '', homeworkNotes: prep.homeworkNotes ?? '', difficulties: prep.difficulties ?? '', lessonPlan: prep.lessonPlan ?? '',
      transcriptText: prep.manualTranscriptText === undefined ? prep.transcriptText ?? '' : prep.manualTranscriptText ?? '',
    }), de ? 'Gespeichert.' : 'Информация сохранена.');
  }
  function note(field: 'homeworkNotes' | 'difficulties') {
    return <textarea className="input workspace-note" aria-label={field === 'homeworkNotes' ? (de ? 'Hausaufgabeninformationen' : 'Информация о домашке') : (de ? 'Schwierigkeiten' : 'Проблемы и сложности')} value={prep?.[field] ?? ''} onChange={e => setPrep(current => current ? { ...current, [field]: e.target.value } : current)} />;
  }
  if (loading) return <p className="muted">{t('common.loading')}</p>;
  return <div className="lesson-workspace">
    <Link className="workspace-back" to="/teacher/lessons">← {de ? 'Zum Stundenplan' : 'Назад к расписанию'}</Link>
    <div className="teacher-page-heading"><h1>{lesson?.title || (de ? 'Unterricht' : 'Урок')}</h1><p>{lesson && new Intl.DateTimeFormat(de ? 'de-DE' : 'ru-RU', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Berlin' }).format(new Date(lesson.startsAt))}</p></div>
    {error && <div role="alert" className="banner banner--error">{error}</div>}
    {notice && <div role="status" className="banner banner--success">{notice}</div>}
    <section className="workspace-summary panel"><div><span>{de ? 'Teilnehmer' : 'Участники'}</span><strong>{lesson?.groupName || lesson?.studentName || (de ? 'Probestunde' : 'Пробный урок')}</strong></div><div><span>{de ? 'Format' : 'Формат'}</span><strong>{de ? 'Online' : 'Онлайн'} · {lesson ? Math.round((Date.parse(lesson.endsAt) - Date.parse(lesson.startsAt)) / 60000) : 60} {de ? 'Minuten' : 'минут'}</strong></div>
      {lesson && (import.meta.env.VITE_MINDCRAFTI_LIVEKIT_ENABLED === 'true' ? <StartOnlineClassButton eventId={lesson.eventId} /> : lesson.meetUrl ? <a className="btn" href={lesson.meetUrl} target="_blank" rel="noreferrer">{de ? 'Online-Unterricht starten' : 'Начать онлайн-урок'}</a> : <Link className="btn" to={`/lesson-board/${encodeURIComponent(eventId)}`}>{de ? 'Tafel öffnen' : 'Открыть доску урока'}</Link>)}
    </section>
    {lesson && !lesson.groupId && (!lesson.studentId || previousTrialInvite) && <TrialInvitationPanel eventId={eventId} de={de} />}
    {prep && <div className="workspace-columns"><div className="workspace-materials"><WorkspaceCard title={de ? 'Gemeinsames Arbeitsheft' : 'Общая рабочая тетрадь'} symbol="workbook">{fileControls('workbook')}</WorkspaceCard><PersonalWorkbooksPanel eventId={eventId} /></div>
      <div className="workspace-info-grid">
        <WorkspaceCard title={de ? 'Hausaufgaben' : 'Домашняя работа'} symbol="homework"><button type="button" className="btn btn--secondary" onClick={() => homeworkDialog.current?.showModal()}>{de ? 'Hausaufgaben vergeben' : 'Выдать домашку'}</button>{note('homeworkNotes')}</WorkspaceCard>
        <LessonCardsPanel lesson={lesson} />
        <WorkspaceCard title={de ? 'Schwierigkeiten' : 'Проблемы и сложности'} symbol="difficulties"><button type="button" className="btn btn--secondary" disabled={busy} onClick={() => void save()}>{busy ? (de ? 'Speichern…' : 'Сохраняем…') : (de ? 'Informationen speichern' : 'Сохранить информацию')}</button>{note('difficulties')}</WorkspaceCard>
        <WorkspaceCard title={de ? 'Transkription' : 'Транскрипция'} symbol="transcript"><button type="button" className="btn btn--secondary" disabled={busy || !(prep.transcriptFilename || (prep.sonioxTranscriptText || prep.transcriptText || '').trim())} onClick={()=>{if(prep.transcriptFilename){open('transcript');return;}const url=URL.createObjectURL(new Blob([prep.sonioxTranscriptText || prep.transcriptText || ''],{type:'text/plain;charset=utf-8'}));window.open(url,'_blank','noopener,noreferrer');window.setTimeout(()=>URL.revokeObjectURL(url),60000);}}>{de?'Transkription öffnen':'Открыть транскрипцию'}</button></WorkspaceCard>
        <WorkspaceCard title={de ? 'Dokument der vergangenen Stunde' : 'Документ пройденного урока'} symbol="completed"><button type="button" className="btn btn--secondary" onClick={()=>documentsDialog.current?.showModal()}>{de?'Alle Dokumente':'Все документы'}</button>{!documents.length && <p className="muted">{de?'Das Dokument wird nach dem Unterricht hinzugefügt.':'Документ добавится после урока.'}</p>}</WorkspaceCard>
      </div></div>}
    <dialog className="workspace-homework-dialog" ref={documentsDialog}><div className="workspace-dialog-heading"><h2>{de?'Alle Dokumente':'Все документы'}</h2><button type="button" className="teacher-icon-button" aria-label={de?'Schließen':'Закрыть'} onClick={()=>documentsDialog.current?.close()}>×</button></div><div className="workspace-document-list">{documents.length ? documents.map(doc=><button type="button" className="workspace-document" key={doc.id} onClick={()=>void perform(()=>completedLessonApi.open(eventId,doc.id))}>{doc.filename} ↗</button>) : <p className="muted">{de?'Das Dokument wird nach dem Unterricht hinzugefügt.':'Документ добавится после урока.'}</p>}</div></dialog>
    <dialog className="workspace-homework-dialog" ref={homeworkDialog}><div className="workspace-dialog-heading"><h2>{de ? 'Hausaufgaben vergeben' : 'Выдать домашку'}</h2><button type="button" className="teacher-icon-button" aria-label={de ? 'Schließen' : 'Закрыть'} onClick={() => homeworkDialog.current?.close()}>×</button></div><LessonHomeworkSeriesPanel lesson={lesson} onAssign={(startDate, days, files) => lessonPreparationApi.assignHomeworkSeries(eventId, startDate, days, files)} /></dialog>
  </div>;
}
function WorkspaceCard({ title, symbol, children }: { title: string; symbol: TeacherIconName; children: ReactNode }) {
  return <section className="panel workspace-card"><div className="workspace-card-heading"><span aria-hidden="true"><TeacherIcon name={symbol} /></span><h2>{title}</h2></div>{children}</section>;
}
