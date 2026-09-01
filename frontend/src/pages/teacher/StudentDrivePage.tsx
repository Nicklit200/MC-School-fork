import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { StudentListItem } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import { toErrorMessage } from '../../lib/errors';

/** Teacher-controlled destination for this student's automatic review exports. */
export function StudentDrivePage() {
  const { studentId = '' } = useParams();
  const { t } = useI18n();
  const [student, setStudent] = useState<StudentListItem | null>(null);
  const [folderUrl, setFolderUrl] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.students.get(studentId)
      .then((loaded) => {
        setStudent(loaded);
        setFolderUrl(loaded.googleDriveFolderUrl ?? '');
        setLoading(false);
      })
      .catch((e) => {
        setError(toErrorMessage(e, t));
        setLoading(false);
      });
  }, [studentId, t]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    try {
      const updated = await api.students.updateDriveFolder(studentId, folderUrl.trim());
      setStudent(updated);
      setFolderUrl(updated.googleDriveFolderUrl ?? '');
      setSaved(true);
    } catch (e) {
      setError(toErrorMessage(e, t));
    }
  }

  return (
    <div>
      <p><Link to={`/students/${studentId}`} className="muted">← {t('common.back')}</Link></p>
      <h1>Google Drive — {student?.fullName ?? 'ученик'}</h1>

      {error && <div className="banner banner--error">{error}</div>}
      {saved && <div className="banner banner--success">Папка сохранена.</div>}

      <div className="panel">
        {loading ? (
          <p className="muted">{t('common.loading')}</p>
        ) : (
          <form onSubmit={save}>
            <label className="field">
              <span className="field__label">Папка Google Drive для таблиц ученика</span>
              <input
                className="input"
                type="url"
                value={folderUrl}
                onChange={(e) => setFolderUrl(e.target.value)}
                placeholder="https://drive.google.com/drive/folders/..."
              />
            </label>
            <p className="muted" style={{ fontSize: 13 }}>
              Вставь ссылку именно на папку. Позже после каждой завершённой сессии сайт будет складывать сюда новый файл с ответами ученика, не перезаписывая предыдущие.
            </p>
            <div className="row">
              <button className="btn" type="submit">Сохранить путь</button>
              {folderUrl && (
                <button className="btn btn--secondary" type="button" onClick={() => setFolderUrl('')}>
                  Очистить
                </button>
              )}
              {student?.googleDriveFolderUrl && (
                <a className="btn btn--ghost" href={student.googleDriveFolderUrl} target="_blank" rel="noreferrer">
                  Открыть папку
                </a>
              )}
            </div>
          </form>
        )}
      </div>

      <div className="panel">
        <h2>Как будут сохраняться файлы</h2>
        <p className="muted" style={{ marginBottom: 0 }}>
          Один файл на одну завершённую сессию. Например: <strong>2026-09-01_18-40_review.csv</strong>. Внутри: вопрос, ответ ученика, правильный ответ и результат.
        </p>
      </div>
    </div>
  );
}
