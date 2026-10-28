import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, getPersistentAccessToken, setSessionAccessToken } from '../../api/client';
import type { AdminAccount, TeacherAssignmentOption, User } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { homePathForRole } from '../../auth/roleRoutes';
import { saveAdminImpersonation } from '../../auth/adminImpersonation';
import { useI18n } from '../../i18n/I18nContext';
import { toErrorMessage } from '../../lib/errors';

type ManagedRole = 'STUDENT' | 'PARENT';
type LoadState = 'loading' | 'ready' | 'failed';
type AccountResources = 'students' | 'parents' | 'teachers' | 'teacherOptions';
const resourceLabels: Record<AccountResources, string> = {
  students: 'ученики', parents: 'родители', teachers: 'действующие учителя', teacherOptions: 'учителя для передачи',
};
const loadingResources: Record<AccountResources, LoadState> = {
  students: 'loading', parents: 'loading', teachers: 'loading', teacherOptions: 'loading',
};

export function AdminAccountsPage() {
  const { t } = useI18n();
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeRole: ManagedRole = searchParams.get('role') === 'PARENT' ? 'PARENT' : 'STUDENT';
  const [students, setStudents] = useState<AdminAccount[]>([]);
  const [parents, setParents] = useState<AdminAccount[]>([]);
  const [teachers, setTeachers] = useState<User[]>([]);
  const [teacherOptions, setTeacherOptions] = useState<TeacherAssignmentOption[]>([]);
  const [teacherSelections, setTeacherSelections] = useState<Record<string, string>>({});
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [bulkFromTeacherId, setBulkFromTeacherId] = useState('');
  const [bulkToTeacherId, setBulkToTeacherId] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [loadState, setLoadState] = useState(loadingResources);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [enteringId, setEnteringId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadState(loadingResources);
    Promise.allSettled([
      api.adminAccounts.list('STUDENT'),
      api.adminAccounts.list('PARENT'),
      api.teachers.list(),
      api.adminAccounts.teacherOptions(),
    ])
      .then(([studentAccounts, parentAccounts, teacherAccounts, allTeacherOptions]) => {
        if (cancelled) return;
        if (studentAccounts.status === 'fulfilled') {
          setStudents(studentAccounts.value);
          setTeacherSelections((current) => Object.fromEntries(studentAccounts.value.map((student) =>
            [student.id, current[student.id] ?? student.teacherId ?? ''])));
        }
        if (parentAccounts.status === 'fulfilled') setParents(parentAccounts.value);
        if (teacherAccounts.status === 'fulfilled') {
          setTeachers(teacherAccounts.value.filter((teacher) => teacher.role === 'TEACHER' && teacher.status === 'ACTIVE'));
        }
        if (allTeacherOptions.status === 'fulfilled') {
          setTeacherOptions(allTeacherOptions.value);
          const activeTeachers = allTeacherOptions.value.filter((teacher) => !teacher.archived && teacher.status === 'ACTIVE');
          setBulkToTeacherId((current) => current || activeTeachers[0]?.id || '');
        }
        setLoadState({
          students: studentAccounts.status === 'fulfilled' ? 'ready' : 'failed',
          parents: parentAccounts.status === 'fulfilled' ? 'ready' : 'failed',
          teachers: teacherAccounts.status === 'fulfilled' ? 'ready' : 'failed',
          teacherOptions: allTeacherOptions.status === 'fulfilled' ? 'ready' : 'failed',
        });
      });
    return () => { cancelled = true; };
  }, [t, loadAttempt]);

  const failedResources = (Object.keys(resourceLabels) as AccountResources[])
    .filter((resource) => loadState[resource] === 'failed');
  const accountLoadState = activeRole === 'STUDENT' ? loadState.students : loadState.parents;
  const singleTransferReady = loadState.students === 'ready' && loadState.teachers === 'ready';
  const bulkTransferReady = loadState.students === 'ready' && loadState.teacherOptions === 'ready';
  const transferBusy = bulkBusy || Boolean(assigningId);

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
    if (!singleTransferReady || !teacherId || teacherId === account.teacherId || assigningId || bulkBusy) return;
    const teacherName = teachers.find((teacher) => teacher.id === teacherId)?.fullName ?? 'выбранному учителю';
    if (!window.confirm(`Передать ученика «${account.fullName}» учителю «${teacherName}»? История прошлых уроков сохранится.`)) return;
    setAssigningId(account.id); setError(null); setSuccess(null);
    try {
      const result = await api.adminAccounts.assignTeacher(account.id, teacherId);
      const updated = result.student;
      setStudents((current) => current.map((student) => student.id === updated.id ? updated : student));
      setTeacherSelections((current) => ({ ...current, [updated.id]: updated.teacherId ?? '' }));
      const groupWarning = result.futureGroupLessonsNotTransferred > 0
        ? ` Групповых будущих уроков не перенесено: ${result.futureGroupLessonsNotTransferred}. Перенесите всю группу, чтобы сохранить её расписание.`
        : '';
      setSuccess(`Ученик «${updated.fullName}» передан учителю «${updated.teacherFullName ?? teacherName}». Будущих уроков в расписание Mindcrafti перенесено: ${result.copiedFutureLessons}. Google Calendar не изменялся.${groupWarning}`);
      void api.adminAccounts.list('PARENT').then(setParents).catch(() => undefined);
    } catch (e) { setError(toErrorMessage(e, t)); }
    finally { setAssigningId(null); }
  }

  async function transferAllStudents() {
    if (!bulkTransferReady || !bulkFromTeacherId || !bulkToTeacherId || bulkFromTeacherId === bulkToTeacherId || bulkBusy || assigningId) return;
    const from = teacherOptions.find((teacher) => teacher.id === bulkFromTeacherId);
    const to = teacherOptions.find((teacher) => teacher.id === bulkToTeacherId);
    const count = students.filter((student) => student.teacherId === bulkFromTeacherId).length;
    if (!window.confirm(`Передать всех ${count} учеников от «${from?.fullName ?? 'преподавателя'}» к «${to?.fullName ?? 'новому преподавателю'}»?\n\nГруппы и будущие уроки, которые можно перенести, будут назначены новому учителю. История прошлых уроков сохранится.`)) return;
    setBulkBusy(true); setError(null); setSuccess(null);
    try {
      const result = await api.adminAccounts.transferStudents(bulkFromTeacherId, bulkToTeacherId);
      setStudents((current) => current.map((student) => student.teacherId === result.fromTeacherId
        ? { ...student, teacherId: result.toTeacherId, teacherFullName: result.toTeacherName }
        : student));
      setTeacherSelections((current) => Object.fromEntries(Object.entries(current).map(([id, teacherId]) => [id, teacherId === result.fromTeacherId ? result.toTeacherId : teacherId])));
      const warning = result.groupsWithLessonsNotTransferred > 0
        ? ` Групп с будущими уроками, которые не удалось перенести: ${result.groupsWithLessonsNotTransferred}.`
        : '';
      setSuccess(`Готово: перенесено учеников: ${result.transferredStudents}; групп: ${result.transferredGroups}; будущих уроков в расписание Mindcrafti: ${result.copiedFutureLessons}. События Google Calendar не изменялись.${warning}`);
      void api.adminAccounts.list('PARENT').then(setParents).catch(() => undefined);
    } catch (e) { setError(toErrorMessage(e, t)); }
    finally { setBulkBusy(false); }
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
            Ученики ({loadState.students === 'ready' ? students.length : loadState.students === 'loading' ? '…' : '—'})
          </button>
          <button type="button" className={activeRole === 'PARENT' ? 'btn' : 'btn btn--ghost'} onClick={() => selectRole('PARENT')}>
            Родители ({loadState.parents === 'ready' ? parents.length : loadState.parents === 'loading' ? '…' : '—'})
          </button>
        </div>
      </div>

      {error && <div className="banner banner--error" style={{ marginTop: 16 }}>{error}</div>}
      {failedResources.length > 0 && <div className="banner banner--error" role="alert" style={{ marginTop: 16 }}>
        <div>Не удалось загрузить: {failedResources.map((resource) => resourceLabels[resource]).join(', ')}. Проверьте соединение и повторите загрузку.</div>
        <button type="button" className="btn btn--ghost" style={{ marginTop: 8 }} disabled={transferBusy} onClick={() => setLoadAttempt((current) => current + 1)}>Повторить загрузку</button>
      </div>}
      {success && <div className="banner banner--success" style={{ marginTop: 16 }}>{success}</div>}

      {activeRole === 'STUDENT' && (
        <div className="panel stack" style={{ marginTop: 18 }}>
          <h2 style={{ margin: 0 }}>Массовая передача учеников</h2>
          <p className="muted" style={{ margin: 0 }}>
            Для ухода преподавателя можно перенести всех его учеников и группы одним действием. Будущие уроки, уже сохранённые в истории Mindcrafti, копируются в расписание сайта; события Google Calendar автоматически не создаются.
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
            <label className="field" style={{ margin: 0, flex: '1 1 240px' }}>
              <span className="field__label">От кого передаём</span>
              <select className="input" value={bulkFromTeacherId} onChange={(event) => setBulkFromTeacherId(event.target.value)} disabled={!bulkTransferReady || transferBusy}>
                <option value="">Выберите прежнего учителя</option>
                {teacherOptions.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.fullName}{teacher.archived ? ' (архивный)' : ''}</option>)}
              </select>
            </label>
            <label className="field" style={{ margin: 0, flex: '1 1 240px' }}>
              <span className="field__label">Кому передаём</span>
              <select className="input" value={bulkToTeacherId} onChange={(event) => setBulkToTeacherId(event.target.value)} disabled={!bulkTransferReady || transferBusy}>
                <option value="">Выберите нового учителя</option>
                {teacherOptions.filter((teacher) => !teacher.archived && teacher.status === 'ACTIVE').map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.fullName}</option>)}
              </select>
            </label>
            <button type="button" className="btn" disabled={!bulkTransferReady || transferBusy || !bulkFromTeacherId || !bulkToTeacherId || bulkFromTeacherId === bulkToTeacherId} onClick={() => void transferAllStudents()}>
              {bulkBusy ? 'Передаём учеников…' : loadState.students !== 'ready' ? 'Передать учеников' : `Передать ${students.filter((student) => student.teacherId === bulkFromTeacherId).length} учеников`}
            </button>
          </div>
        </div>
      )}

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

      {accountLoadState === 'loading' ? (
        <p className="muted">{t('common.loading')}</p>
      ) : accountLoadState === 'failed' ? (
        <div className="panel"><p className="muted" style={{ margin: 0 }}>{activeRole === 'STUDENT' ? 'Список учеников не загружен.' : 'Список родителей не загружен.'}</p></div>
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
              {activeRole === 'STUDENT' && account.teacherFullName && <div className="muted">Учитель: {account.teacherFullName}</div>}
            </div>
            <span className={`pill ${account.status === 'ACTIVE' ? 'pill--learned' : 'pill--active'}`}>{account.status}</span>
            {activeRole === 'STUDENT' && <div style={{ display: 'flex', alignItems: 'end', gap: 8, flex: '1 1 340px', flexWrap: 'wrap' }}>
              <label className="field" style={{ margin: 0, minWidth: 210, flex: '1 1 210px' }}>
                <span className="field__label">Назначенный учитель</span>
                <select className="input" value={teacherSelections[account.id] ?? account.teacherId ?? ''} onChange={(event) => setTeacherSelections((current) => ({ ...current, [account.id]: event.target.value }))} disabled={!singleTransferReady || transferBusy}>
                  <option value="">Выберите учителя</option>
                  {teachers.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.fullName}</option>)}
                </select>
              </label>
              <button type="button" className="btn btn--ghost" disabled={!singleTransferReady || transferBusy || !(teacherSelections[account.id] ?? account.teacherId) || (teacherSelections[account.id] ?? account.teacherId) === account.teacherId} onClick={() => void assignTeacher(account)}>
                {assigningId === account.id ? 'Передаём…' : 'Передать ученика'}
              </button>
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
