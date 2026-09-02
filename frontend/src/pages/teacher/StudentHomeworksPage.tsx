import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { Homework, StudentListItem } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import { toErrorMessage } from '../../lib/errors';

export function StudentHomeworksPage() {
  const { studentId = '' } = useParams();
  const navigate = useNavigate();
  const { language, t } = useI18n();
  const [student, setStudent] = useState<StudentListItem | null>(null);
  const [homeworks, setHomeworks] = useState<Homework[]>([]);
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
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
      <h1>Домашка{student ? ` — ${student.fullName}` : ''}</h1>
      {error && <div className="banner banner--error">{error}</div>}

      <div className="panel">
        <h2>Создать домашку</h2>
        <form className="row" onSubmit={createHomework}>
          <label className="field" style={{ margin: 0 }}>
            <span className="field__label">Дата</span>
            <input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
          </label>
          <button className="btn" type="submit">Создать</button>
        </form>
        <p className="muted" style={{ marginBottom: 0, fontSize: 13 }}>
          После создания откроется страница домашки, где можно загрузить PDF для ученика.
        </p>
      </div>

      <h2>Домашние задания</h2>
      {loading ? (
        <p className="muted">{t('common.loading')}</p>
      ) : homeworks.length === 0 ? (
        <div className="panel"><p className="muted" style={{ margin: 0 }}>Домашек пока нет.</p></div>
      ) : (
        <div className="panel stack">
          {homeworks.map((homework) => (
            <Link
              key={homework.id}
              className="list-row"
              to={`/teacher/students/${studentId}/homeworks/${homework.id}`}
              style={{ textDecoration: 'none' }}
            >
              <div>
                <div className="list-row__title">{formatDate(homework.startDate, language)}</div>
                <div className="muted">
                  {homework.hasWorksheet ? `PDF: ${homework.worksheetFilename ?? 'загружен'}` : 'PDF ещё не загружен'}
                  {homework.submitted ? ' · Сдано' : ''}
                </div>
              </div>
              <span className={`pill ${homework.submitted ? 'pill--learned' : 'pill--pending'}`}>
                {homework.submitted ? 'Сдано' : 'Открыть'}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function formatDate(date: string, language: 'DE' | 'RU') {
  return new Intl.DateTimeFormat(language === 'DE' ? 'de-DE' : 'ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(new Date(`${date}T00:00:00`));
}
