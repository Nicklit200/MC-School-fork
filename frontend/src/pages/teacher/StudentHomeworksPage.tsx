import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { Homework, StudentListItem } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import { toErrorMessage } from '../../lib/errors';

type HomeworkHistoryStatus = 'DONE' | 'MISSED' | 'TODAY' | 'UPCOMING';

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
              <input
                className="input"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                disabled={creating}
                required
              />
            </label>

            <label className="field" style={{ margin: 0, flex: '0 1 180px' }}>
              <span className="field__label">{language === 'DE' ? 'Anzahl Tage' : 'На сколько дней'}</span>
              <input
                className="input"
                type="number"
                min={1}
                max={31}
                value={daysCount}
                onChange={(e) => changeDaysCount(Number(e.target.value))}
                disabled={creating}
                required
              />
            </label>
          </div>

          <div className="panel" style={{ padding: 12, margin: 0 }}>
            <strong>{language === 'DE' ? 'PDF für jeden Tag' : 'PDF на каждый день'}</strong>
            <p className="muted" style={{ marginTop: 6, marginBottom: 12, fontSize: 13 }}>
              {language === 'DE'
                ? 'Jede Zeile gehört zu einem Datum. Dateien können ersetzt, gelöscht oder nach oben/unten verschoben werden.'
                : 'Каждая строка привязана к своей дате. Файл можно заменить, удалить или передвинуть выше/ниже на другую дату.'}
            </p>

            <div style={{ display: 'grid', gap: 12 }}>
              {plannedDates.map((date, index) => {
                const file = pdfFiles[index];
                return (
                  <div
                    key={`${date}-${index}`}
                    className="panel"
                    style={{ padding: 12, margin: 0, border: '1px solid var(--border-color, #ddd)' }}
                  >
                    <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <div>
                        <strong>{language === 'DE' ? `Tag ${index + 1}` : `День ${index + 1}`}</strong>
                        <div className="muted">{formatDate(date, language)}</div>
                      </div>

                      {file && (
                        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            className="btn btn--secondary"
                            disabled={creating || index === 0}
                            onClick={() => movePdf(index, -1)}
                            title={language === 'DE' ? 'Eine Position nach oben' : 'Перенести на предыдущую дату'}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="btn btn--secondary"
                            disabled={creating || index === daysCount - 1}
                            onClick={() => movePdf(index, 1)}
                            title={language === 'DE' ? 'Eine Position nach unten' : 'Перенести на следующую дату'}
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            className="btn btn--danger"
                            disabled={creating}
                            onClick={() => removePdf(index)}
                          >
                            {language === 'DE' ? 'Löschen' : 'Удалить'}
                          </button>
                        </div>
                      )}
                    </div>

                    <label className="field" style={{ margin: '10px 0 0' }}>
                      <span className="field__label">
                        {file
                          ? (language === 'DE' ? 'PDF ersetzen' : 'Заменить PDF')
                          : (language === 'DE' ? 'PDF auswählen' : 'Выбрать PDF')}
                      </span>
                      <input
                        id={`homework-pdf-${index}`}
                        className="input"
                        type="file"
                        accept="application/pdf,.pdf"
                        disabled={creating}
                        onChange={(event) => setPdfForDay(index, event.target.files?.[0] ?? null)}
                      />
                    </label>

                    <div style={{ marginTop: 8, overflowWrap: 'anywhere' }}>
                      {file ? (
                        <span><strong>{file.name}</strong> <span className="pill pill--learned">PDF ✓</span></span>
                      ) : (
                        <span className="muted">{language === 'DE' ? 'Noch keine Datei' : 'Файл пока не выбран'}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {!allFilesSelected && (
            <div className="banner banner--info">
              {language === 'DE'
                ? `Bitte für alle ${daysCount} Tage eine PDF auswählen.`
                : `Нужно выбрать PDF для каждого из ${daysCount} дней.`}
            </div>
          )}

          <button className="btn" type="submit" disabled={!allFilesSelected || creating} style={{ minWidth: 220, alignSelf: 'flex-start' }}>
            {creating
              ? (language === 'DE' ? 'Wird erstellt…' : 'Создаём домашки…')
              : (language === 'DE' ? `${daysCount} Hausaufgaben erstellen` : `Создать на ${daysCount} дн.`)}
          </button>
        </form>
      </div>

      <h2>{language === 'DE' ? 'Hausaufgaben-Historie' : 'История домашки'}</h2>
      {loading ? (
        <p className="muted">{t('common.loading')}</p>
      ) : worksheetHomeworks.length === 0 ? (
        <div className="panel"><p className="muted" style={{ margin: 0 }}>{language === 'DE' ? 'Noch keine PDF-Hausaufgaben.' : 'PDF-домашек пока нет.'}</p></div>
      ) : (
        <div className="panel">
          <div className="history-list">
            {worksheetHomeworks.map((homework) => {
              const status = resolveHomeworkHistoryStatus(homework);
              return (
                <Link
                  key={homework.id}
                  className="history-row"
                  to={`/teacher/students/${studentId}/homeworks/${homework.id}`}
                  style={{ textDecoration: 'none', color: 'inherit' }}
                >
                  <span>{formatDate(homework.startDate, language)}</span>
                  <span>
                    {homework.worksheetFilename ?? (language === 'DE' ? 'PDF-Hausaufgabe' : 'Домашка в PDF')}
                    {homework.worksheetPageCount
                      ? ` · ${homework.worksheetPageCount} ${language === 'DE' ? 'Seiten' : 'стр.'}`
                      : ''}
                  </span>
                  <span className={`pill ${homeworkHistoryClass(status)}`}>
                    {homeworkHistoryText(status, language)}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function resolveHomeworkHistoryStatus(homework: Homework): HomeworkHistoryStatus {
  if (homework.submitted) return 'DONE';
  const today = localDateString(new Date());
  if (homework.startDate < today) return 'MISSED';
  if (homework.startDate === today) return 'TODAY';
  return 'UPCOMING';
}

function homeworkHistoryClass(status: HomeworkHistoryStatus) {
  switch (status) {
    case 'DONE': return 'pill--learned';
    case 'MISSED': return 'pill--danger';
    case 'TODAY': return 'pill--pending';
    case 'UPCOMING': return 'pill--active';
  }
}

function homeworkHistoryText(status: HomeworkHistoryStatus, language: 'DE' | 'RU') {
  if (language === 'DE') {
    switch (status) {
      case 'DONE': return 'Erledigt';
      case 'MISSED': return 'Nicht erledigt';
      case 'TODAY': return 'Heute fällig';
      case 'UPCOMING': return 'Geplant';
    }
  }
  switch (status) {
    case 'DONE': return 'Сделано';
    case 'MISSED': return 'Не сделано';
    case 'TODAY': return 'Нужно сделать сегодня';
    case 'UPCOMING': return 'Запланировано';
  }
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
  return new Intl.DateTimeFormat(language === 'DE' ? 'de-DE' : 'ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(new Date(`${date}T00:00:00`));
}
