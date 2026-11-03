import { useEffect, useRef, useState } from 'react';
import { lessonPreparationApi, type PersonalWorkbooks } from '../../api/lessonPreparation';
import { useI18n } from '../../i18n/I18nContext';

/** The server decides which teacher has access to the personal worksheet pilot. */
export function PersonalWorkbooksPanel({ eventId }: { eventId: string }) {
  const { language } = useI18n();
  const de = language === 'DE';
  const [data, setData] = useState<{ eventId: string; value: PersonalWorkbooks } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const currentEvent = useRef(eventId);
  currentEvent.current = eventId;
  const generation = useRef(0);
  const busyRef = useRef<string | null>(null);

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
  if (!value?.enabled) return null;

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

  return <section className="panel" style={{ padding: 20, marginBottom: 18 }} aria-labelledby="personal-workbooks-title">
    <h2 id="personal-workbooks-title" style={{ marginTop: 0 }}>{de ? 'Persönliche Arbeitsblätter' : 'Персональные листы'}</h2>
    <p className="muted">{de
      ? 'Die gemeinsame PDF wird allen unter „Gemeinsames Whiteboard“ und „Mein Whiteboard“ angezeigt. Eine persönliche PDF erscheint zusätzlich nur beim ausgewählten Schüler unter „Persönliches Arbeitsblatt“. Diese PDF und die Notizen sind nur für ihn und dich sichtbar.'
      : 'Общий PDF показывается всем в разделах «Общая доска» и «Моя доска». Персональный PDF появляется отдельно у выбранного ученика по кнопке «Персональный лист». Его PDF и записи доступны только ему и тебе.'}</p>
    <p className="muted">{de ? 'Persönliche Lösungen bleiben privat. Beim Wechsel zu diesem Schüler zeigt die Lösungsleiste dessen eigenes PDF.'
      : 'Решения каждого ученика видны только преподавателю. При переключении на ученика панель решений покажет его отдельный PDF.'}</p>
    {!value.students.length && <p className="muted">{de ? 'Diesem Unterricht sind noch keine Schüler zugeordnet.' : 'К этому уроку ещё не привязаны ученики.'}</p>}
    <div style={{ display: 'grid', gap: 12 }}>
      {value.students.map(student => <div key={student.studentId} role="group" aria-label={student.studentName}
        style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', border: '1px solid #e5e7eb', borderRadius: 12, padding: 12 }}>
        <div style={{ flex: '1 1 180px', overflowWrap: 'anywhere' }}>
          <strong>{student.studentName}</strong>
          <div className="muted" style={{ fontSize: 13 }}>{student.hasWorkbook ? student.filename : (de ? 'Kein persönliches Arbeitsblatt' : 'Персональный лист ещё не добавлен')}</div>
        </div>
        {student.hasWorkbook && <button type="button" className="button secondary" onClick={() => void open(student.studentId)}>{de ? 'Arbeitsblatt ansehen' : 'Посмотреть лист'}</button>}
        <label className="button secondary" style={{ cursor: busy ? 'wait' : 'pointer' }}>
          {busy === `${student.studentId}:workbook` ? (de ? 'Wird hochgeladen…' : 'Загрузка…') : student.hasWorkbook ? (de ? 'Arbeitsblatt ersetzen' : 'Заменить лист') : (de ? 'Arbeitsblatt hochladen' : 'Загрузить лист')}
          <input type="file" accept="application/pdf,.pdf" disabled={busy !== null}
            aria-label={`${de ? 'Arbeitsblatt für' : 'Лист для'} ${student.studentName}`}
            style={{ display: 'none' }} onChange={event => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void upload(student.studentId, file);
            }} />
        </label>
        <div style={{ flex: '1 1 180px', overflowWrap: 'anywhere' }}>
          <strong>{de ? 'Lösungen · nur Lehrkraft' : 'Решения · только учителю'}</strong>
          <div className="muted" style={{ fontSize: 13 }}>{student.hasAnswers ? student.answersFilename : (de ? 'Keine persönlichen Lösungen' : 'Персональные решения ещё не добавлены')}</div>
        </div>
        {student.hasAnswers && <button type="button" className="button secondary" onClick={() => void open(student.studentId, 'answers')}>
          {de ? 'Lösungen ansehen' : 'Посмотреть решения'}</button>}
        <label className="button secondary" style={{ cursor: busy ? 'wait' : 'pointer' }}>
          {busy === `${student.studentId}:answers` ? (de ? 'Wird hochgeladen…' : 'Загрузка…')
            : student.hasAnswers ? (de ? 'Lösungen ersetzen' : 'Заменить решения') : (de ? 'Lösungen hochladen' : 'Загрузить решения')}
          <input type="file" accept="application/pdf,.pdf" disabled={busy !== null}
            aria-label={`${de ? 'Lösungen für' : 'Решения для'} ${student.studentName}`} style={{ display: 'none' }}
            onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void upload(student.studentId, file, 'answers'); }} />
        </label>
      </div>)}
    </div>
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert" style={{ color: '#b91c1c' }}>{error}</p>}
  </section>;
}
