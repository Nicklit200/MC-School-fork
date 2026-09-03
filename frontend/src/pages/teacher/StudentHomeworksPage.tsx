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
  const [pdfFiles, setPdfFiles] = useState<File[]>([]);
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

  const filesMatchDays = pdfFiles.length === daysCount;

  async function createHomework(event: FormEvent) {
    event.preventDefault();
    if (!filesMatchDays || creating) return;
    setCreating(true);
    setError(null);
    setMessage(null);
    try {
      for (let index = 0; index < pdfFiles.length; index += 1) {
        await api.homeworks.createPdf(studentId, plannedDates[index], pdfFiles[index]);
      }
      setPdfFiles([]);
      const fileInput = document.getElementById('homework-pdf-files') as HTMLInputElement | null;
      if (fileInput) fileInput.value = '';
      await reload();
      setMessage(language === 'DE'
        ? `${daysCount} Hausaufgaben wurden für aufeinanderfolgende Tage erstellt.`
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
                onChange={(e) => {
                  const next = Math.max(1, Math.min(31, Number(e.target.value) || 1));
                  setDaysCount(next);
                  setPdfFiles([]);
                  const fileInput = document.getElementById('homework-pdf-files') as HTMLInputElement | null;
                  if (fileInput) fileInput.value = '';
                }}
                disabled={creating}
                required
              />
            </label>

            <label className="field" style={{ margin: 0, flex: '2 1 360px' }}>
              <span className="field__label">
                {language === 'DE' ? `PDF-Dateien (${daysCount})` : `PDF-файлы (${daysCount})`}
              </span>
              <input
                id="homework-pdf-files"
                className="input"
                type="file"
                accept="application/pdf,.pdf"
                multiple={daysCount > 1}
                disabled={creating}
                onChange={(event) => setPdfFiles(Array.from(event.target.files ?? []))}
                required
              />
            </label>
          </div>

          {pdfFiles.length > 0 && (
            <div className="panel" style={{ padding: 12, margin: 0 }}>
              <strong>
                {language === 'DE'
                  ? `${pdfFiles.length} von ${daysCount} Dateien ausgewählt`
                  : `Выбрано ${pdfFiles.length} из ${daysCount} PDF`}
              </strong>
              {!filesMatchDays && (
                <div className="banner banner--error" style={{ marginTop: 8, marginBottom: 0 }}>
                  {language === 'DE'
                    ? `Bitte genau ${daysCount} PDF-Dateien auswählen.`
                    : `Нужно выбрать ровно ${daysCount} PDF-файлов — по одному на каждый день.`}
                </div>
              )}
              <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
                {plannedDates.map((date, index) => (
                  <div key={date} className="row" style={{ justifyContent: 'space-between', gap: 12 }}>
                    <span><strong>{formatDate(date, language)}</strong></span>
                    <span className="muted" style={{ overflowWrap: 'anywhere', textAlign: 'right' }}>
                      {pdfFiles[index]?.name ?? (language === 'DE' ? 'PDF fehlt' : 'PDF не выбран')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button className="btn" type="submit" disabled={!filesMatchDays || creating} style={{ minWidth: 220, alignSelf: 'flex-start' }}>
            {creating
              ? (language === 'DE' ? 'Wird erstellt…' : 'Создаём домашки…')
              : (language === 'DE' ? `${daysCount} Hausaufgaben erstellen` : `Создать на ${daysCount} дн.`)}
          </button>

          <p className="muted" style={{ marginBottom: 0, fontSize: 13 }}>
            {language === 'DE'
              ? 'Die Dateien werden in der ausgewählten Reihenfolge verteilt: die erste PDF für den ersten Tag, die zweite für den nächsten Tag usw.'
              : 'PDF распределяются по порядку выбора: первый файл — на первый день, второй — на следующий и так далее. Каждый день у ученика будет отдельная домашка.'}
          </p>
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
