import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { Homework, StudentListItem } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import { toErrorMessage } from '../../lib/errors';
import { homeworkHistoryText, resolveHomeworkHistoryStatus } from '../../lib/homeworkHistory';
import { HomeworkHistoryCalendar } from '../../components/HomeworkHistoryCalendar';
import { GoogleDrivePdfPicker } from './GoogleDrivePdfPicker';
import { GoogleDriveMultiPdfPicker } from './GoogleDriveMultiPdfPicker';

export function StudentHomeworksPage() {
  const { studentId = '' } = useParams();
  const { language, t } = useI18n();
  const [student, setStudent] = useState<StudentListItem | null>(null);
  const [homeworks, setHomeworks] = useState<Homework[]>([]);
  const [startDate, setStartDate] = useState(() => localDateString(new Date()));
  const [daysCount, setDaysCount] = useState(1);
  const [pdfFiles, setPdfFiles] = useState<Array<File | null>>([null]);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Homework | null>(null);
  const [deleting, setDeleting] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!openMenuId) return;
    const onOutsidePointer = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setOpenMenuId(null);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenMenuId(null);
    };
    document.addEventListener('pointerdown', onOutsidePointer);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('pointerdown', onOutsidePointer);
      document.removeEventListener('keydown', onEscape);
    };
  }, [openMenuId]);

  useEffect(() => {
    if (!pendingDelete || deleting) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPendingDelete(null);
    };
    document.addEventListener('keydown', onEscape);
    return () => document.removeEventListener('keydown', onEscape);
  }, [pendingDelete, deleting]);

  async function reload() {
    const [studentPayload, homeworkPayload] = await Promise.all([
      api.students.get(studentId),
      api.homeworks.listForStudent(studentId),
    ]);
    setStudent(studentPayload);
    setHomeworks(homeworkPayload);
    setLoading(false);
  }

  useEffect(() => {
    reload().catch((e) => {
      setError(toErrorMessage(e, t));
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId]);

  const worksheetHomeworks = useMemo(
    () => homeworks
      .filter((homework) => homework.hasWorksheet)
      .sort((a, b) => b.startDate.localeCompare(a.startDate) || (b.createdAt ?? '').localeCompare(a.createdAt ?? '')),
    [homeworks],
  );

  const plannedDates = useMemo(
    () => Array.from({ length: daysCount }, (_, index) => addDays(startDate, index)),
    [startDate, daysCount],
  );

  const allFilesSelected = pdfFiles.length === daysCount && pdfFiles.every((file) => file !== null);

  function changeDaysCount(value: number) {
    const next = Math.max(1, Math.min(31, value || 1));
    setDaysCount(next);
    setPdfFiles((current) => Array.from({ length: next }, (_, index) => current[index] ?? null));
  }

  function setPdfForDay(index: number, file: File | null) {
    setPdfFiles((current) => current.map((existing, currentIndex) => currentIndex === index ? file : existing));
  }

  function applyPdfBatch(files: File[]) {
    if (files.length === 0) return;
    const nextDays = Math.max(daysCount, Math.min(31, files.length));
    setDaysCount(nextDays);
    setPdfFiles((current) => Array.from(
      { length: nextDays },
      (_, index) => files[index] ?? current[index] ?? null,
    ));
  }

  function removePdf(index: number) {
    setPdfForDay(index, null);
    const input = document.getElementById(`homework-pdf-${index}`) as HTMLInputElement | null;
    if (input) input.value = '';
  }

  function movePdf(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= pdfFiles.length) return;
    setPdfFiles((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function deleteHomework() {
    if (!pendingDelete || deleting) return;
    const homeworkId = pendingDelete.id;
    setDeleting(true);
    setError(null);
    setMessage(null);
    try {
      await api.homeworks.remove(homeworkId);
      await reload();
      setPendingDelete(null);
      setMessage(language === 'DE' ? 'Hausaufgabe wurde gelöscht.' : 'Домашнее задание удалено.');
    } catch (e) {
      setError(toErrorMessage(e, t));
    } finally {
      setDeleting(false);
    }
  }

  async function createHomework(event: FormEvent) {
    event.preventDefault();
    if (!allFilesSelected || creating) return;
    setCreating(true);
    setError(null);
    setMessage(null);
    try {
      for (let index = 0; index < pdfFiles.length; index += 1) {
        const file = pdfFiles[index];
        if (!file) continue;
        await api.homeworks.createPdf(studentId, plannedDates[index], file);
      }
      setPdfFiles(Array.from({ length: daysCount }, () => null));
      await reload();
      setMessage(language === 'DE'
        ? `${daysCount} Hausaufgaben wurden erstellt.`
        : `Создано ${daysCount} домашних работ: по одному PDF на каждый день.`);
    } catch (e) {
      setError(toErrorMessage(e, t));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <p><Link to="/students" className="muted">← {t('common.back')}</Link></p>
      <h1>{language === 'DE' ? 'Hausaufgaben' : 'Домашка'}{student ? ` — ${student.fullName}` : ''}</h1>
      {error && <div className="banner banner--error">{error}</div>}
      {message && <div className="banner banner--success">{message}</div>}

      <div className="panel">
        <h2>{language === 'DE' ? 'Hausaufgabe erstellen' : 'Создать домашку'}</h2>
        <form className="stack" onSubmit={createHomework}>
          <div className="row" style={{ alignItems: 'end', gap: 12, flexWrap: 'wrap' }}>
            <label className="field" style={{ margin: 0, flex: '1 1 220px' }}>
              <span className="field__label">{language === 'DE' ? 'Erster Tag' : 'Первый день'}</span>
              <input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} disabled={creating} required />
            </label>
            <label className="field" style={{ margin: 0, flex: '0 1 180px' }}>
              <span className="field__label">{language === 'DE' ? 'Anzahl Tage' : 'На сколько дней'}</span>
              <input className="input" type="number" min={1} max={31} value={daysCount} onChange={(e) => changeDaysCount(Number(e.target.value))} disabled={creating} required />
            </label>
          </div>

          <div className="panel" style={{ padding: 12, margin: 0 }}>
            <strong>{language === 'DE' ? 'PDF für jeden Tag' : 'PDF на каждый день'}</strong>
            <p className="muted" style={{ marginTop: 6, marginBottom: 12, fontSize: 13 }}>
              {language === 'DE'
                ? 'Jede Zeile gehört zu einem Datum. Dateien können ersetzt, gelöscht oder nach oben/unten verschoben werden.'
                : 'Каждая строка привязана к своей дате. Файл можно заменить, удалить или передвинуть выше/ниже на другую дату.'}
            </p>
            <div className="panel" style={{ padding: 12, margin: '0 0 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 360px' }}>
                <strong>{language === 'DE' ? 'Mehrere Tage schnell ausfüllen' : 'Быстро заполнить несколько дней'}</strong>
                <p className="muted" style={{ margin: '5px 0 0', fontSize: 13 }}>
                  {language === 'DE'
                    ? 'Wähle mehrere PDFs in Google Drive in der gewünschten Reihenfolge. Die Reihenfolge wird Tag 1, Tag 2 usw. zugeordnet.'
                    : 'Выберите несколько PDF в Google Drive в нужном порядке. Первый файл станет Днём 1, второй — Днём 2 и так далее.'}
                </p>
              </div>
              <GoogleDriveMultiPdfPicker disabled={creating} maxFiles={31} buttonLabel={language === 'DE' ? 'Mehrere PDFs aus Google Drive' : 'Выбрать несколько PDF из Google Drive'} onSelect={applyPdfBatch} />
            </div>

            <div style={{ display: 'grid', gap: 12 }}>
              {plannedDates.map((date, index) => {
                const file = pdfFiles[index];
                return (
                  <div key={`${date}-${index}`} className="panel" style={{ padding: 12, margin: 0, border: '1px solid var(--border-color, var(--teacher-border, #ddd))' }}>
                    <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <div><strong>{language === 'DE' ? `Tag ${index + 1}` : `День ${index + 1}`}</strong><div className="muted">{formatDate(date, language)}</div></div>
                      {file && (
                        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                          <button type="button" className="btn btn--secondary" disabled={creating || index === 0} onClick={() => movePdf(index, -1)} title={language === 'DE' ? 'Eine Position nach oben' : 'Перенести на предыдущую дату'}>↑</button>
                          <button type="button" className="btn btn--secondary" disabled={creating || index === daysCount - 1} onClick={() => movePdf(index, 1)} title={language === 'DE' ? 'Eine Position nach unten' : 'Перенести на следующую дату'}>↓</button>
                          <button type="button" className="btn btn--danger" disabled={creating} onClick={() => removePdf(index)}>{language === 'DE' ? 'Löschen' : 'Удалить'}</button>
                        </div>
                      )}
                    </div>
                    <div className="row" style={{ alignItems: 'end', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
                      <label className="field" style={{ margin: 0, flex: '1 1 360px' }}>
                        <span className="field__label">{file ? (language === 'DE' ? 'PDF vom Computer ersetzen' : 'Заменить PDF с компьютера') : (language === 'DE' ? 'PDF vom Computer auswählen' : 'Выбрать PDF с компьютера')}</span>
                        <input id={`homework-pdf-${index}`} className="input" type="file" accept="application/pdf,.pdf" disabled={creating} onChange={(event) => setPdfForDay(index, event.target.files?.[0] ?? null)} />
                      </label>
                      <div style={{ paddingBottom: 1 }}><GoogleDrivePdfPicker disabled={creating} onSelect={(driveFile) => setPdfForDay(index, driveFile)} /></div>
                    </div>
                    <div style={{ marginTop: 8, overflowWrap: 'anywhere' }}>
                      {file ? <span><strong>{file.name}</strong> <span className="pill pill--learned">PDF ✓</span></span> : <span className="muted">{language === 'DE' ? 'Noch keine Datei' : 'Файл пока не выбран'}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {!allFilesSelected && <div className="banner banner--info">{language === 'DE' ? `Bitte für alle ${daysCount} Tage eine PDF vom Computer oder aus Google Drive auswählen.` : `Нужно выбрать PDF для каждого из ${daysCount} дней — с компьютера или из Google Drive.`}</div>}
          <button className="btn" type="submit" disabled={!allFilesSelected || creating} style={{ minWidth: 220, alignSelf: 'flex-start' }}>
            {creating ? (language === 'DE' ? 'Wird erstellt…' : 'Создаём домашки…') : (language === 'DE' ? `${daysCount} Hausaufgaben erstellen` : `Создать на ${daysCount} дн.`)}
          </button>
        </form>
      </div>

      <h2>{language === 'DE' ? 'Hausaufgaben-Historie' : 'История домашки'}</h2>
      {loading ? <p className="muted">{t('common.loading')}</p> : (
        <HomeworkHistoryCalendar key={studentId} homeworks={worksheetHomeworks} language={language}
          onSelectionChange={() => setOpenMenuId(null)} renderHomework={(homework) => {
            const status = resolveHomeworkHistoryStatus(homework);
            const detailUrl = `/teacher/students/${studentId}/homeworks/${homework.id}`;
            const menuOpen = openMenuId === homework.id;
            return (
              <div key={homework.id} className="history-row homework-history-row">
                <span className="homework-history-date">{formatDate(homework.startDate, language)}</span>
                <Link className="homework-history-file" to={`${detailUrl}?section=preview`}>
                  <strong className="homework-history-name">
                    {homework.worksheetFilename ?? (language === 'DE' ? 'PDF-Hausaufgabe' : 'Домашка в PDF')}
                  </strong>
                  {homework.worksheetPageCount && (
                    <span className="muted homework-history-pages"> · {homework.worksheetPageCount} {language === 'DE' ? 'Seiten' : 'стр.'}</span>
                  )}
                </Link>
                <span className={`pill homework-history-status homework-history-status--${status.toLowerCase()}`}>
                  {homeworkHistoryText(status, language)}
                </span>
                <div className="homework-history-actions" ref={menuOpen ? menuRef : undefined}>
                  <button type="button" className="homework-history-menu-button"
                    aria-label={language === 'DE' ? `Aktionen für Hausaufgabe vom ${formatDate(homework.startDate, language)}` : `Действия с домашкой за ${formatDate(homework.startDate, language)}`}
                    title={language === 'DE' ? 'Hausaufgaben-Aktionen' : 'Действия с домашкой'}
                    aria-haspopup="menu" aria-expanded={menuOpen} aria-controls={menuOpen ? `homework-actions-${homework.id}` : undefined}
                    onClick={() => setOpenMenuId(current => current === homework.id ? null : homework.id)}>
                    <span aria-hidden="true">•••</span>
                  </button>
                  {menuOpen && (
                    <div className="homework-history-menu" id={`homework-actions-${homework.id}`} role="menu">
                      <Link role="menuitem" to={`${detailUrl}?section=preview`} onClick={() => setOpenMenuId(null)}>
                        {language === 'DE' ? 'Ansehen' : 'Посмотреть'}
                      </Link>
                      <Link role="menuitem" to={`${detailUrl}?section=edit`} onClick={() => setOpenMenuId(null)}>
                        {language === 'DE' ? 'Bearbeiten' : 'Редактировать'}
                      </Link>
                      <button role="menuitem" type="button" className="homework-history-delete-action"
                        onClick={() => { setOpenMenuId(null); setPendingDelete(homework); }}>
                        {language === 'DE' ? 'Löschen' : 'Удалить'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          }} />
      )}

      {pendingDelete && (
        <div className="homework-history-dialog-backdrop"
          onMouseDown={event => {
            if (!deleting && event.target === event.currentTarget) setPendingDelete(null);
          }}>
          <section className="panel homework-history-dialog" role="alertdialog" aria-modal="true"
            aria-labelledby="homework-delete-title" aria-describedby="homework-delete-description">
            <h2 id="homework-delete-title">{language === 'DE' ? 'Hausaufgabe löschen?' : 'Удалить домашнее задание?'}</h2>
            <p id="homework-delete-description">
              {language === 'DE'
                ? `Die Hausaufgabe vom ${formatDate(pendingDelete.startDate, language)} wird dauerhaft gelöscht. Auch eine bereits abgegebene Lösung kann verloren gehen.`
                : `Домашка за ${formatDate(pendingDelete.startDate, language)} будет удалена без возможности восстановления. Если ученик уже сдал работу, его ответ тоже будет удалён.`}
            </p>
            <p className="muted homework-history-delete-name">{pendingDelete.worksheetFilename}</p>
            <div className="homework-history-dialog-actions">
              <button type="button" className="btn btn--secondary" autoFocus disabled={deleting}
                onClick={() => setPendingDelete(null)}>
                {language === 'DE' ? 'Abbrechen' : 'Отмена'}
              </button>
              <button type="button" className="btn homework-history-delete-confirm" disabled={deleting}
                onClick={() => { void deleteHomework(); }}>
                {deleting ? (language === 'DE' ? 'Wird gelöscht…' : 'Удаляем…') : (language === 'DE' ? 'Endgültig löschen' : 'Удалить')}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function addDays(dateString: string, days: number) {
  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  return localDateString(date);
}

function localDateString(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDate(date: string, language: 'DE' | 'RU') {
  return new Intl.DateTimeFormat(language === 'DE' ? 'de-DE' : 'ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(`${date}T00:00:00`));
}
