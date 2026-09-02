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
  const [pdfFile, setPdfFile] = useState<File | null>(null);
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

  async function createHomework(event: FormEvent) {
    event.preventDefault();
    if (!pdfFile || creating) return;
    setCreating(true);
    setError(null);
    setMessage(null);
    try {
      const created = await api.homeworks.create(studentId, startDate);
      await api.homeworks.uploadWorksheet(created.id, pdfFile);
      setPdfFile(null);
      const fileInput = document.getElementById('homework-pdf-file') as HTMLInputElement | null;
      if (fileInput) fileInput.value = '';
      await reload();
      setMessage(language === 'DE' ? 'Hausaufgabe wurde erstellt.' : 'Домашка создана и добавлена в историю.');
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
            <label className="field" style={{ margin: 0, flex: '1 1 240px' }}>
              <span className="field__label">{language === 'DE' ? 'Datum' : 'Дата'}</span>
              <input
                className="input"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                disabled={creating}
                required
              />
            </label>
            <label className="field" style={{ margin: 0, flex: '2 1 360px' }}>
              <span className="field__label">PDF</span>
              <input
                id="homework-pdf-file"
                className="input"
                type="file"
                accept="application/pdf,.pdf"
                disabled={creating}
                onChange={(event) => setPdfFile(event.target.files?.[0] ?? null)}
                required
              />
            </label>
            <button className="btn" type="submit" disabled={!pdfFile || creating} style={{ minWidth: 180 }}>
              {creating
                ? (language === 'DE' ? 'Wird erstellt…' : 'Создаём…')
                : (language === 'DE' ? 'Erstellen' : 'Создать')}
            </button>
          </div>
          {pdfFile && <div className="muted" style={{ fontSize: 13 }}>{pdfFile.name}</div>}
          <p className="muted" style={{ marginBottom: 0, fontSize: 13 }}>
            {language === 'DE'
              ? 'Du kannst mehrere getrennte Hausaufgaben für dasselbe Datum erstellen.'
              : 'На одну дату можно создать несколько отдельных домашних работ.'}
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
