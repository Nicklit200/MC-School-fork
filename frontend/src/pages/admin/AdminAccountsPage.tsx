import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, getAccessToken, setAccessToken } from '../../api/client';
import type { User } from '../../api/types';
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
  const [students, setStudents] = useState<User[]>([]);
  const [parents, setParents] = useState<User[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [enteringId, setEnteringId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([api.adminAccounts.list('STUDENT'), api.adminAccounts.list('PARENT')])
      .then(([studentAccounts, parentAccounts]) => {
        if (!cancelled) {
          setStudents(studentAccounts);
          setParents(parentAccounts);
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
      [account.fullName, account.username, account.email]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase().includes(query)),
    );
  }, [accounts, search]);

  async function enterAs(account: User) {
    if (enteringId) return;
    const adminToken = getAccessToken();
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
      setAccessToken(auth.accessToken);
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
            <button type="button" className="btn" disabled={Boolean(enteringId)} onClick={() => void enterAs(account)}>
              {enteringId === account.id ? 'Входим…' : account.role === 'STUDENT' ? 'Войти как ученик' : 'Войти как родитель'}
            </button>
          </div>
        ))
      )}
    </div>
  );
}
