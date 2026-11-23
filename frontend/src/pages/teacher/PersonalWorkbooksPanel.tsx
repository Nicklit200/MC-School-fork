import { TeacherIcon } from '../../components/TeacherIcon';
import { useEffect, useRef, useState } from 'react';
import { lessonPreparationApi, type PersonalWorkbooks } from '../../api/lessonPreparation';
import { useI18n } from '../../i18n/I18nContext';
import { api } from '../../api/client';
import type { GroupLesson, StudentListItem } from '../../api/types';
import { RemoveLessonParticipantButton } from './RemoveLessonParticipantButton';

/** The server decides which teacher has access to the personal worksheet pilot. */
export function PersonalWorkbooksPanel({ eventId, lesson, lessons = [], students = [], onChanged }: {
  eventId: string;
  lesson?: GroupLesson | null;
  lessons?: GroupLesson[];
  students?: StudentListItem[];
  onChanged?: () => Promise<void>;
}) {
  const { language } = useI18n();
  const de = language === 'DE';
  const [data, setData] = useState<{ eventId: string; value: PersonalWorkbooks } | null>(null);
  const [roster, setRoster] = useState<Array<{ studentId: string; studentName: string }>>([]);
  const [rosterLoaded, setRosterLoaded] = useState(false);
  const [newStudentId, setNewStudentId] = useState('');
  const [moveStudentId, setMoveStudentId] = useState('');
  const [targetEventId, setTargetEventId] = useState('');
  const [editingRoster, setEditingRoster] = useState(false);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const editable = Boolean(lesson?.startsAt && Date.parse(lesson.startsAt) > Date.now());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const currentEvent = useRef(eventId);
  currentEvent.current = eventId;
  const generation = useRef(0);
  const busyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!lesson) return;
    let cancelled = false;
    setRosterLoaded(false);
    setRosterError(null);
    void api.lessons.participants(eventId).then(items => {
      if (!cancelled) { setRoster(items); setRosterLoaded(true); }
    }).catch(() => {
      if (!cancelled) setRosterError(de ? 'Teilnehmer konnten nicht geladen werden.' : 'Не удалось загрузить участников урока.');
    });
    return () => { cancelled = true; };
  }, [eventId, lesson?.eventId, de]);

  async function refreshParticipants() {
    const [updatedRoster, workbooks] = await Promise.all([
      api.lessons.participants(eventId),
      lessonPreparationApi.personalWorkbooks(eventId),
    ]);
    setRoster(updatedRoster);
    setData({ eventId, value: workbooks });
    await onChanged?.();
  }

  async function editParticipants(operation: () => Promise<unknown>): Promise<boolean> {
    if (editingRoster || !editable) return false;
    setEditingRoster(true);
    setRosterError(null);
    try {
      await operation();
      await refreshParticipants();
      setNewStudentId('');
      setMoveStudentId('');
      setTargetEventId('');
      return true;
    } catch {
      setRosterError(de
        ? 'Änderung nicht gespeichert. Prüfen Sie, ob die Stunde bereits begonnen hat.'
        : 'Не удалось изменить состав урока. Возможно, занятие уже началось.');
      return false;
    } finally {
      setEditingRoster(false);
    }
  }

  useEffect(() => {
    generation.current++;
    let cancelled = false;
    setError(null);
    setNotice(null);
    setBusy(null);
    busyRef.current = null;
    void lessonPreparationApi.personalWorkbooks(eventId).then(value => {
      if (!cancelled) setData({ eventId, value });
    }).catch(() => { /* An unavailable pilot must not block normal lesson preparation. */ });
    return () => { cancelled = true; generation.current++; };
  }, [eventId]);

  const value = data?.eventId === eventId ? data.value : null;
  if (!value?.enabled && !lesson) return null;
  const chosen = new Set(roster.map(item => item.studentId));
  const available = students.filter(item => !chosen.has(item.id));
  const transferTargets = lessons.filter(item => item.eventId !== eventId
    && item.startsAt && Date.parse(item.startsAt) > Date.now());

  async function upload(studentId: string, file: File, kind: 'workbook' | 'answers' = 'workbook') {
    if (busyRef.current) return;
    const epoch = generation.current;
    const current = () => currentEvent.current === eventId && generation.current === epoch;
    setError(null);
    setNotice(null);
    if (!file.name.toLowerCase().endsWith('.pdf') || !file.size || file.size > 25 * 1024 * 1024) {
      setError(de ? 'Bitte eine PDF-Datei zwischen 1 Byte und 25 MB auswählen.' : 'Выберите непустой PDF размером до 25 МБ.');
      return;
    }
    busyRef.current = `${studentId}:${kind}`;
    setBusy(busyRef.current);
    try {
      if (kind === 'answers') {
        const saved = await lessonPreparationApi.uploadPersonalAnswers(eventId, studentId, file);
        if (!current()) return;
        if (!saved.hasAnswers || saved.studentId !== studentId) throw new Error(de ? 'Die Speicherung wurde nicht bestätigt.' : 'Сервер не подтвердил сохранение решений.');
        setData(previous => previous?.eventId === eventId ? {
          eventId, value: { ...previous.value, students: previous.value.students.map(row => row.studentId === studentId
            ? { ...row, hasAnswers: saved.hasAnswers, answersFilename: saved.answersFilename, answersVersion: saved.version } : row) },
        } : previous);
        setNotice(de ? 'Persönliche Lösungen gespeichert. Nur für die Lehrkraft sichtbar.' : 'Персональные решения сохранены. Они видны только преподавателю.');
        return;
      }
      const saved = await lessonPreparationApi.uploadPersonalWorkbook(eventId, studentId, file);
      if (!current()) return;
      if (!saved.hasWorkbook || saved.studentId !== studentId) throw new Error(de ? 'Die Speicherung wurde nicht bestätigt.' : 'Сервер не подтвердил сохранение листа.');
      setData(current => current?.eventId === eventId ? {
        eventId, value: { ...current.value, students: current.value.students.map(row => row.studentId === studentId ? {
          ...row, ...saved, hasAnswers: saved.hasAnswers ?? row.hasAnswers,
          answersFilename: saved.answersFilename === undefined ? row.answersFilename : saved.answersFilename,
          answersVersion: saved.answersVersion ?? row.answersVersion,
        } : row) },
      } : current);
      setNotice(de ? `Arbeitsblatt für ${saved.studentName} gespeichert.` : `Лист для ${saved.studentName} сохранён.`);
      window.dispatchEvent(new Event('mc-workbook-updated'));
    } catch (failure) {
      if (current()) setError(failure instanceof Error ? failure.message : (de ? 'Upload fehlgeschlagen.' : 'Не удалось загрузить PDF.'));
    } finally {
      if (current()) { busyRef.current = null; setBusy(null); }
    }
  }

  async function open(studentId: string, kind: 'workbook' | 'answers' = 'workbook') {
    const epoch = generation.current;
    setError(null);
    // Open the tab during the click so that browsers do not block the PDF after fetching.
    const tab = window.open('about:blank', '_blank');
    if (tab) tab.opener = null;
    try {
      const url = kind === 'answers' ? await lessonPreparationApi.personalAnswersUrl(eventId, studentId)
        : await lessonPreparationApi.personalWorkbookUrl(eventId, studentId);
      if (currentEvent.current !== eventId || generation.current !== epoch || !tab) {
        URL.revokeObjectURL(url);
        tab?.close();
        if (!tab) throw new Error(de ? 'Bitte Pop-ups für die PDF-Vorschau erlauben.' : 'Разрешите открытие новой вкладки для просмотра PDF.');
        return;
      }
      tab.location.href = url;
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (failure) {
      tab?.close();
      if (currentEvent.current === eventId && generation.current === epoch) setError(failure instanceof Error ? failure.message : (de ? 'PDF konnte nicht geöffnet werden.' : 'Не удалось открыть PDF.'));
    }
  }


  return <section className="workspace-personal" aria-label={de ? 'Persönliche Arbeitshefte' : 'Личные рабочие тетради'}>
    {lesson && <div style={{ display: 'grid', gap: 10, padding: '12px 0 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: '0 0 4px', fontSize: 18 }}>
            {de ? 'Schüler in dieser Stunde' : 'Ученики этого урока'}
          </h2>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            {de ? 'Änderungen betreffen nur diese Stunde, nicht die feste Gruppe oder andere Termine.'
              : 'Изменения касаются только этого урока, не постоянной группы и других занятий.'}
          </p>
        </div>
        {editable && rosterLoaded && <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select className="input" value={newStudentId} aria-label={de ? 'Schüler auswählen' : 'Выбрать ученика для добавления'}
            disabled={editingRoster} onChange={event => setNewStudentId(event.target.value)}>
            <option value="">{de ? 'Schüler auswählen…' : 'Выбрать ученика…'}</option>
            {available.map(student => <option key={student.id} value={student.id}>{student.fullName}</option>)}
          </select>
          <button type="button" className="btn" disabled={editingRoster || !newStudentId}
            onClick={() => void editParticipants(() => api.lessons.addParticipant(eventId, newStudentId))}>
            + {de ? 'Schüler hinzufügen' : 'Добавить ученика'}
          </button>
        </div>}
      </div>
      {!rosterLoaded && !rosterError && <p role="status" className="muted">
        {de ? 'Teilnehmer werden geladen…' : 'Загружаем участников…'}
      </p>}
      {rosterError && <p role="alert" style={{ margin: 0, color: '#b91c1c' }}>{rosterError}</p>}
    </div>}
    {value?.enabled && <>
      {!value.students.length && <p className="muted">{de ? 'Diesem Unterricht sind noch keine Schüler zugeordnet.' : 'К этому уроку ещё не привязаны ученики.'}</p>}
      <div className="workspace-pupils">
        {value.students.map(student => <section key={student.studentId} className="workspace-pupil-card" aria-label={student.studentName}>
          <div className="workspace-pupil-heading" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span><TeacherIcon name="person"/></span>
            <h3 style={{ flex: 1 }}>{student.studentName}</h3>
            {lesson && editable && rosterLoaded && chosen.has(student.studentId) && <RemoveLessonParticipantButton
              studentName={student.studentName} de={de} disabled={editingRoster || busy !== null}
              onRemove={() => editParticipants(() => api.lessons.removeParticipant(eventId, student.studentId))}/>}
          </div>
          <div className="workspace-pupil-halves">{(['workbook','answers'] as const).map(kind=><div key={kind}>
            <strong>{kind==='workbook' ? (de?'Arbeitsheft':'Рабочая тетрадь') : (de?'Lösungen':'Решения')}</strong>
            <p className="muted">{(kind==='workbook'?student.filename:student.answersFilename) || (de?'Noch keine Datei':'Файл пока не добавлен')}</p>
            <div className="workspace-actions">
              {(kind==='workbook'?student.hasWorkbook:student.hasAnswers) && <button type="button" className="btn btn--secondary" disabled={busy!==null} onClick={()=>void open(student.studentId,kind)}>{de?'Öffnen':'Открыть'}</button>}
              <label className="btn btn--secondary">{(kind==='workbook'?student.hasWorkbook:student.hasAnswers)?(de?'Ersetzen':'Заменить'):(de?'Hinzufügen':'Добавить')}
                <input type="file" accept="application/pdf,.pdf" hidden disabled={busy!==null} aria-label={`${kind==='workbook'?(de?'Arbeitsblatt für':'Лист для'):(de?'Lösungen für':'Решения для')} ${student.studentName}`} onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)void upload(student.studentId,file,kind);}} />
              </label>
            </div>
          </div>)}</div>
        </section>)}
      </div>
    </>}
    {lesson && !value?.enabled && rosterLoaded && <div className="workspace-pupils">
      {roster.map(student => <section key={student.studentId} className="workspace-pupil-card"
        aria-label={student.studentName}>
        <div className="workspace-pupil-heading" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span><TeacherIcon name="person"/></span><h3 style={{ flex: 1 }}>{student.studentName}</h3>
          {editable && <RemoveLessonParticipantButton studentName={student.studentName} de={de}
            disabled={editingRoster}
            onRemove={() => editParticipants(() => api.lessons.removeParticipant(eventId, student.studentId))}/>}
        </div>
      </section>)}
    </div>}
    {lesson && editable && rosterLoaded && roster.length > 0 && transferTargets.length > 0 && <div
      style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', paddingTop: 16 }}>
      <strong style={{ marginRight: 6 }}>{de ? 'Einmalig verschieben:' : 'Разовый перенос:'}</strong>
      <select className="input" aria-label={de ? 'Schüler verschieben' : 'Кого перенести'}
        disabled={editingRoster} value={moveStudentId} onChange={event => setMoveStudentId(event.target.value)}>
        <option value="">{de ? 'Schüler auswählen…' : 'Кого перенести…'}</option>
        {roster.map(student => <option key={student.studentId} value={student.studentId}>{student.studentName}</option>)}
      </select>
      <select className="input" aria-label={de ? 'Zielstunde' : 'В какой урок перенести'}
        disabled={editingRoster} value={targetEventId} onChange={event => setTargetEventId(event.target.value)}>
        <option value="">{de ? 'Stunde auswählen…' : 'Выбрать урок…'}</option>
        {transferTargets.map(item => <option key={item.eventId} value={item.eventId}>
          {new Date(item.startsAt).toLocaleString(de ? 'de-DE' : 'ru-RU', { dateStyle: 'short',
            timeStyle: 'short', timeZone: 'Europe/Berlin' })} · {item.title}
        </option>)}
      </select>
      <button type="button" className="btn btn--secondary"
        disabled={editingRoster || !moveStudentId || !targetEventId}
        onClick={() => void editParticipants(() => api.lessons.transferParticipant(eventId, targetEventId, moveStudentId))}>
        {de ? 'Einmalig verschieben' : 'Перенести на один урок'}
      </button>
    </div>}
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert" style={{ color: '#b91c1c' }}>{error}</p>}
  </section>;
}
