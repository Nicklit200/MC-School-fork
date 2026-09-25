import { Fragment, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, getAccessToken, setAccessToken } from '../../api/client';
import type { User } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import { useAuth } from '../../auth/AuthContext';
import { saveAdminImpersonation } from '../../auth/adminImpersonation';
import { toErrorMessage } from '../../lib/errors';
import { TeacherTrialTranscriptFolderPicker } from './TeacherTrialTranscriptFolderPicker';

/** Admin home: create teacher accounts and manage their school lessons. */
export function TeachersPage() {
  const { t } = useI18n();
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const [teachers, setTeachers] = useState<User[]>([]);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [enteringTeacherId, setEnteringTeacherId] = useState<string | null>(null);
  const [driveTeacherId, setDriveTeacherId] = useState<string | null>(null);

  async function reload() {
    setTeachers(await api.teachers.list());
    setLoading(false);
  }

  useEffect(() => {
    reload().catch((e) => setError(toErrorMessage(e, t)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await api.teachers.create(fullName.trim(), email.trim(), username.trim(), password);
      setFullName('');
      setEmail('');
      setUsername('');
      setPassword('');
      await reload();
    } catch (e) {
      setError(toErrorMessage(e, t));
    }
  }

  async function enterAsTeacher(teacher: User) {
    if (enteringTeacherId) return;
    const adminToken = getAccessToken();
    if (!adminToken) {
      setError('Административная сессия не найдена. Войдите в аккаунт администратора снова.');
      return;
    }

    setEnteringTeacherId(teacher.id);
    setError(null);
    try {
      const auth = await api.auth.impersonateTeacher(teacher.id);
      saveAdminImpersonation(adminToken, teacher, `/admin/lessons?teacherId=${teacher.id}`);
      setAccessToken(auth.accessToken);
      setUser(auth.user);
      navigate('/teacher/lessons');
    } catch (e) {
      setError(toErrorMessage(e, t));
    } finally {
      setEnteringTeacherId(null);
    }
  }

  function updateTeacher(updated: User) {
    setTeachers((current) => current.map((teacher) => teacher.id === updated.id ? updated : teacher));
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <h1>{t('teachers.title')}</h1>
        <Link className="btn" to="/admin/lessons">Уроки школы</Link>
      </div>
      {error && <div className="banner banner--error">{error}</div>}

      <div className="panel">
        <h2>{t('teachers.create')}</h2>
        <form onSubmit={onCreate}>
          <div className="row">
            <label className="field">
              <span className="field__label">{t('common.name')}</span>
              <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            </label>
            <label className="field">
              <span className="field__label">{t('common.email')}</span>
              <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
          </div>
          <div className="row">
            <label className="field">
              <span className="field__label">Логин</span>
              <input
                className="input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="off"
                required
              />
            </label>
            <label className="field">
              <span className="field__label">Пароль</span>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </label>
          </div>
          <button className="btn" type="submit">{t('teachers.create')}</button>
        </form>
      </div>

      {loading ? (
        <p className="muted">{t('common.loading')}</p>
      ) : teachers.length === 0 ? (
        <p className="muted">{t('teachers.empty')}</p>
      ) : (
        teachers.map((teacher) => (
          <Fragment key={teacher.id}>
            <div className="list-row" style={{ gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 260px' }}>
                <div className="list-row__title">{teacher.fullName}</div>
                <div className="muted">{teacher.email}</div>
                {teacher.googleDriveTrialTranscriptFolderId && <div style={{ marginTop: 4, fontSize: 12, fontWeight: 700, color: '#0f766e' }}>Папка пробных настроена</div>}
              </div>
              <Link className="btn btn--ghost" to={`/admin/lessons?teacherId=${teacher.id}`}>Уроки</Link>
              <button className="btn btn--ghost" type="button" onClick={() => setDriveTeacherId((current) => current === teacher.id ? null : teacher.id)}>
                Google Drive
              </button>
              <button
                className="btn"
                type="button"
                disabled={Boolean(enteringTeacherId)}
                onClick={() => void enterAsTeacher(teacher)}
              >
                {enteringTeacherId === teacher.id ? 'Входим…' : 'Войти как учитель'}
              </button>
              <span className={`pill ${teacher.status === 'ACTIVE' ? 'pill--learned' : 'pill--active'}`}>
                {teacher.status}
              </span>
            </div>
            {driveTeacherId === teacher.id && <TeacherTrialTranscriptFolderPicker teacher={teacher} onSaved={updateTeacher} />}
          </Fragment>
        ))
      )}
    </div>
  );
}
