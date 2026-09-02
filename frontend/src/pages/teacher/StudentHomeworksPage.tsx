import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { Homework, StudentListItem } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import { toErrorMessage } from '../../lib/errors';

type HomeworkHistoryStatus = 'DONE' | 'MISSED' | 'TODAY' | 'UPCOMING';

export function StudentHomeworksPage() {
  const { studentId = '' } = useParams();
  const navigate = useNavigate();
  const { language, t } = useI18n();
  const [student, setStudent] = useState<StudentListItem | null>(null);
  const [homeworks, setHomeworks] = useState<Homework[]>([]);
  const [startDate, setStartDate] = useState(() => localDateString(new Date()));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    () => homeworks.filter((homework) => homework.hasWorksheet).sort((a, b) => b.startDate.localeCompare(a.startDate)),
    [homeworks],
  );

  async function createHomework(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const created = await api.homeworks.create(studentId, startDate);
      navigate(`/teacher/students/${studentId}/homeworks/${created.id}`);
    } catch (e) {
      setError(toErrorMessage(e, t));
    }
  }

  return (
    <div>
      <p><Link to="/students" className="muted">← {t('common.back')}</Link></p>
      <h1>{language === 'DE' ? 'Hausaufgaben' : 'Домашка'}{student ? ` — ${student.fullName}` : ''}</h1>
      {error && <div className="banner banner--error">{error}</div>}

      <div className="panel">
        <h2>{language === 'DE' ? 'Hausaufgabe erstellen' : 'Создать домашку'}</h2>
        <form className="row" onSubmit={createHomework}>
          <label className="field" style={{ margin: 0 }}>
            <span className="field__label">{language === 'DE' ? 'Datum' : 'Дата'}</span>
            <input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
          </label>
          <button className="btn" type="submit">{language === 'DE' ? 'Erstellen' : 'Создать'}</button>
        </form>
        <p className="muted" style={{ marginBottom: 0, fontSize: 13 }}>
          {language === 'DE'
            ? 'Nach dem Erstellen kannst du das PDF für den Schüler hochladen.'
            : 'После создания откроется страница домашки, где можно загрузить PDF для ученика.'}
        </p>
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
