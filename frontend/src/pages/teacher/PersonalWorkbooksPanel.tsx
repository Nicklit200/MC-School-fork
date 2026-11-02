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

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setNotice(null);
    setBusy(null);
    void lessonPreparationApi.personalWorkbooks(eventId).then(value => {
      if (!cancelled) setData({ eventId, value });
    }).catch(() => { /* An unavailable pilot must not block normal lesson preparation. */ });
    return () => { cancelled = true; };
  }, [eventId]);

  const value = data?.eventId === eventId ? data.value : null;
  if (!value?.enabled) return null;

  async function upload(studentId: string, file: File) {
    if (busy) return;
    setError(null);
    setNotice(null);
    if (!file.name.toLowerCase().endsWith('.pdf') || !file.size || file.size > 25 * 1024 * 1024) {
      setError(de ? 'Bitte eine PDF-Datei zwischen 1 Byte und 25 MB auswählen.' : 'Выберите непустой PDF размером до 25 МБ.');
      return;
    }
    setBusy(studentId);
    try {
      const saved = await lessonPreparationApi.uploadPersonalWorkbook(eventId, studentId, file);
      if (currentEvent.current !== eventId) return;
      if (!saved.hasWorkbook || saved.studentId !== studentId) throw new Error(de ? 'Die Speicherung wurde nicht bestätigt.' : 'Сервер не подтвердил сохранение листа.');
      setData(current => current?.eventId === eventId ? {
        eventId, value: { ...current.value, students: current.value.students.map(row => row.studentId === studentId ? saved : row) },
      } : current);
      setNotice(de ? `Arbeitsblatt für ${saved.studentName} gespeichert.` : `Лист для ${saved.studentName} сохранён.`);
      window.dispatchEvent(new Event('mc-workbook-updated'));
    } catch (failure) {
      if (currentEvent.current === eventId) setError(failure instanceof Error ? failure.message : (de ? 'Upload fehlgeschlagen.' : 'Не удалось загрузить лист.'));
    } finally {
      if (currentEvent.current === eventId) setBusy(null);
    }
  }

  async function open(studentId: string) {
    setError(null);
    // Open the tab during the click so that browsers do not block the PDF after fetching.
    const tab = window.open('about:blank', '_blank');
    if (tab) tab.opener = null;
    try {
      const url = await lessonPreparationApi.personalWorkbookUrl(eventId, studentId);
      if (currentEvent.current !== eventId || !tab) {
        URL.revokeObjectURL(url);
        tab?.close();
        if (!tab) throw new Error(de ? 'Bitte Pop-ups für die PDF-Vorschau erlauben.' : 'Разрешите открытие новой вкладки для просмотра PDF.');
        return;
      }
      tab.location.href = url;
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (failure) {
      tab?.close();
      if (currentEvent.current === eventId) setError(failure instanceof Error ? failure.message : (de ? 'PDF konnte nicht geöffnet werden.' : 'Не удалось открыть PDF.'));
    }
  }

  return <section className="panel" style={{ padding: 20, marginBottom: 18 }} aria-labelledby="personal-workbooks-title">
    <h2 id="personal-workbooks-title" style={{ marginTop: 0 }}>{de ? 'Persönliche Arbeitsblätter' : 'Персональные листы'}</h2>
    <p className="muted">{de
      ? 'Das gemeinsame Material bleibt für alle auf der gemeinsamen Tafel. Ein persönliches PDF erscheint zusätzlich nur beim ausgewählten Schüler unter „Persönliches Arbeitsblatt“ und ist auch für dich sichtbar.'
      : 'Общий материал остаётся у всех на общей доске. У выбранного ученика появится отдельная кнопка «Персональный лист». Его PDF и записи будут доступны только ему и тебе; «Моя доска» сохранится отдельно.'}</p>
    {!value.students.length && <p className="muted">{de ? 'Diesem Unterricht sind noch keine Schüler zugeordnet.' : 'К этому уроку ещё не привязаны ученики.'}</p>}
    <div style={{ display: 'grid', gap: 12 }}>
      {value.students.map(student => <div key={student.studentId} role="group" aria-label={student.studentName}
        style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', border: '1px solid #e5e7eb', borderRadius: 12, padding: 12 }}>
        <div style={{ flex: '1 1 180px', overflowWrap: 'anywhere' }}>
          <strong>{student.studentName}</strong>
          <div className="muted" style={{ fontSize: 13 }}>{student.hasWorkbook ? student.filename : (de ? 'Kein persönliches Arbeitsblatt' : 'Персональный лист ещё не добавлен')}</div>
        </div>
        {student.hasWorkbook && <button type="button" className="button secondary" onClick={() => void open(student.studentId)}>{de ? 'PDF ansehen' : 'Посмотреть PDF'}</button>}
        <label className="button secondary" style={{ cursor: busy ? 'wait' : 'pointer' }}>
          {busy === student.studentId ? (de ? 'Wird hochgeladen…' : 'Загрузка…') : student.hasWorkbook ? (de ? 'PDF ersetzen' : 'Заменить PDF') : (de ? 'PDF hochladen' : 'Загрузить PDF')}
          <input type="file" accept="application/pdf,.pdf" disabled={busy !== null}
            aria-label={`${de ? 'Arbeitsblatt für' : 'Лист для'} ${student.studentName}`}
            style={{ display: 'none' }} onChange={event => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void upload(student.studentId, file);
            }} />
        </label>
      </div>)}
    </div>
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert" style={{ color: '#b91c1c' }}>{error}</p>}
  </section>;
}
