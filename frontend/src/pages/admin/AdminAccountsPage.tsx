import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, getPersistentAccessToken, setSessionAccessToken } from '../../api/client';
import type { AdminAccount, User } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { homePathForRole } from '../../auth/roleRoutes';
import { saveAdminImpersonation } from '../../auth/adminImpersonation';
import { useI18n } from '../../i18n/I18nContext';
import { toErrorMessage } from '../../lib/errors';

type ManagedRole = 'STUDENT' | 'PARENT';

export function AdminAccountsPage() {
  const { t } = useI18n();
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeRole: ManagedRole = searchParams.get('role') === 'PARENT' ? 'PARENT' : 'STUDENT';
  const [students, setStudents] = useState<AdminAccount[]>([]);
  const [parents, setParents] = useState<AdminAccount[]>([]);
  const [teachers, setTeachers] = useState<User[]>([]);
  const [teacherSelections, setTeacherSelections] = useState<Record<string, string>>({});
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [enteringId, setEnteringId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([api.adminAccounts.list('STUDENT'), api.adminAccounts.list('PARENT'), api.teachers.list()])
      .then(([studentAccounts, parentAccounts, teacherAccounts]) => {
        if (!cancelled) {
          setStudents(studentAccounts);
          setParents(parentAccounts);
          setTeachers(teacherAccounts.filter((teacher) => teacher.role === 'TEACHER'));
          setTeacherSelections(Object.fromEntries(studentAccounts.map((student) => [student.id, student.teacherId ?? ''])));
        }
      })
      .catch((e) => { if (!cancelled) setError(toErrorMessage(e, t)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [t]);

  const accounts = activeRole === 'STUDENT' ? students : parents;
  const visibleAccounts = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return accounts;
    return accounts.filter((account) =>
      [account.fullName, account.username, account.email, account.teacherFullName]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase().includes(query)),
    );
  }, [accounts, search]);

  async function assignTeacher(account: AdminAccount) {
    const teacherId = teacherSelections[account.id] ?? '';
    if (!teacherId || teacherId === account.teacherId || assigningId) return;
    const teacherName = teachers.find((teacher) => teacher.id === teacherId)?.fullName ?? 'выбранному учителю';
    if (!window.confirm(`Передать ученика «${account.fullName}» учителю «${teacherName}»? История прошлых уроков сохранится.`)) return;
    setAssigningId(account.id); setError(null); setSuccess(null);
    try {
      const updated = await api.adminAccounts.assignTeacher(account.id, teacherId);
      setStudents((current) => current.map((student) => student.id === updated.id ? updated : student));
      setTeacherSelections((current) => ({ ...current, [updated.id]: updated.teacherId ?? '' }));
      setSuccess(`Ученик «${updated.fullName}» передан учителю «${updated.teacherFullName ?? teacherName}».`);
    } catch (e) { setError(toErrorMessage(e, t)); }
    finally { setAssigningId(null); }
  }

  async function enterAs(account: User) {
    if (enteringId) return;
    const adminToken = getPersistentAccessToken();
    if (!adminToken) {
      setError('Административная сессия не найдена. Войдите в аккаунт администратора снова.');
      return;
    }
    setEnteringId(account.id);
    setError(null);
    try {
      const auth = account.role === 'STUDENT'
        ? await api.auth.impersonateStudent(account.id)
        : await api.auth.impersonateParent(account.id);
      saveAdminImpersonation(adminToken, account, `/admin/accounts?role=${account.role}`);
      setSessionAccessToken(auth.accessToken);
      setUser(auth.user);
      navigate(homePathForRole(auth.user.role));
    } catch (e) {
      setError(toErrorMessage(e, t));
    } finally {
      setEnteringId(null);
    }
  }

  function selectRole(role: ManagedRole) {
    setSearchParams({ role });
    setSearch('');
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'end', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ marginBottom: 6 }}>Ученики и родители</h1>
          <div className="muted">Откройте настоящий кабинет пользователя без его пароля.</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className={activeRole === 'STUDENT' ? 'btn' : 'btn btn--ghost'} onClick={() => selectRole('STUDENT')}>
            Ученики ({students.length})
          </button>
          <button type="button" className={activeRole === 'PARENT' ? 'btn' : 'btn btn--ghost'} onClick={() => selectRole('PARENT')}>
            Родители ({parents.length})
          </button>
        </div>
      </div>

      {error && <div className="banner banner--error" style={{ marginTop: 16 }}>{error}</div>}
      {success && <div className="banner banner--success" style={{ marginTop: 16 }}>{success}</div>}

      <div className="panel" style={{ marginTop: 18 }}>
        <label className="field" style={{ maxWidth: 520 }}>
          <span className="field__label">Поиск</span>
          <input
            className="input"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={activeRole === 'STUDENT' ? 'Имя или логин ученика' : 'Имя, логин или e-mail родителя'}
          />
        </label>
      </div>

      {loading ? (
        <p className="muted">{t('common.loading')}</p>
      ) : visibleAccounts.length === 0 ? (
        <div className="panel">
          <p className="muted" style={{ margin: 0 }}>
            {search.trim() ? 'По вашему запросу ничего не найдено.' : activeRole === 'STUDENT' ? 'Учеников пока нет.' : 'Родителей пока нет.'}
          </p>
        </div>
      ) : (
        visibleAccounts.map((account) => (
          <div className="list-row" key={account.id} style={{ gap: 14, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 320px' }}>
              <div className="list-row__title">{account.fullName}</div>
              <div className="muted">{account.username ? `Логин: ${account.username}` : account.email || 'Логин ещё не задан'}</div>
              {account.username && account.email && <div className="muted">{account.email}</div>}
            </div>
            <span className={`pill ${account.status === 'ACTIVE' ? 'pill--learned' : 'pill--active'}`}>{account.status}</span>
            {activeRole === 'STUDENT' && <div style={{display:'flex',alignItems:'end',gap:8,flex:'1 1 340px',flexWrap:'wrap'}}>
              <label className="field" style={{margin:0,minWidth:210,flex:'1 1 210px'}}>
                <span className="field__label">Назначенный учитель</span>
                <select className="input" value={teacherSelections[account.id] ?? account.teacherId ?? ''} onChange={event => setTeacherSelections(current => ({...current,[account.id]:event.target.value}))} disabled={Boolean(assigningId)}>
                  <option value="">Выберите учителя</option>{teachers.map(teacher => <option key={teacher.id} value={teacher.id}>{teacher.fullName}</option>)}
                </select>
              </label>
              <button type="button" className="btn btn--ghost" disabled={Boolean(assigningId) || !(teacherSelections[account.id] ?? account.teacherId) || (teacherSelections[account.id] ?? account.teacherId) === account.teacherId} onClick={() => void assignTeacher(account)}>{assigningId === account.id ? 'Передаём…' : 'Передать ученика'}</button>
            </div>}
            <button type="button" className="btn" disabled={Boolean(enteringId)} onClick={() => void enterAs(account)}>
              {enteringId === account.id ? 'Входим…' : account.role === 'STUDENT' ? 'Войти как ученик' : 'Войти как родитель'}
            </button>
          </div>
        ))
      )}
    </div>
  );
}
