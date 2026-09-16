import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../api/client';
import { teacherParentApi } from '../../api/parent';
import type { ParentAccount, StudentListItem } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';

export function TeacherParentsPage() {
  const { language } = useI18n();
  const [parents, setParents] = useState<ParentAccount[]>([]);
  const [students, setStudents] = useState<StudentListItem[]>([]);
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [createdAccess, setCreatedAccess] = useState<{ username: string; password: string } | null>(null);
  const [selectedStudents, setSelectedStudents] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const [parentList, studentList] = await Promise.all([
      teacherParentApi.list(),
      api.students.list(),
    ]);
    setParents(parentList);
    setStudents(studentList);
    setLoading(false);
  }

  useEffect(() => {
    reload().catch((e) => {
      setError(errorMessage(e));
      setLoading(false);
    });
  }, []);

  async function createParent(event: FormEvent) {
    event.preventDefault();
    if (!fullName.trim() || password.length < 6) return;
    setCreating(true);
    setError(null);
    try {
      const chosenPassword = password;
      const created = await teacherParentApi.create(fullName.trim(), chosenPassword);
      setCreatedAccess({ username: created.username ?? '', password: chosenPassword });
      setFullName('');
      setPassword('');
      await reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setCreating(false);
    }
  }

  async function linkStudent(parent: ParentAccount) {
    const studentId = selectedStudents[parent.id];
    if (!studentId) return;
    const student = students.find((item) => item.id === studentId);
    if (!student) return;

    if (student.parentId && student.parentId !== parent.id) {
      const confirmed = window.confirm(
        language === 'DE'
          ? `${student.fullName} ist bereits mit ${student.parentFullName ?? 'einem anderen Elternkonto'} verknüpft. Elternkonto ersetzen?`
          : `${student.fullName} уже привязан(а) к ${student.parentFullName ?? 'другому родителю'}. Заменить родителя?`,
      );
      if (!confirmed) return;
    }

    setBusyId(parent.id);
    setError(null);
    try {
      await teacherParentApi.linkStudent(parent.id, studentId);
      setSelectedStudents((current) => ({ ...current, [parent.id]: '' }));
      await reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusyId(null);
    }
  }

  async function changePassword(parent: ParentAccount) {
    const nextPassword = window.prompt(
      language === 'DE'
        ? `Neues Passwort für ${parent.fullName} (mindestens 6 Zeichen)`
        : `Новый пароль для ${parent.fullName} (минимум 6 символов)`,
      '',
    );
    if (nextPassword == null) return;
    if (nextPassword.length < 6) {
      window.alert(language === 'DE'
        ? 'Das Passwort muss mindestens 6 Zeichen haben.'
        : 'Пароль должен содержать минимум 6 символов.');
      return;
    }

    setBusyId(parent.id);
    setError(null);
    try {
      const updated = await teacherParentApi.changePassword(parent.id, nextPassword);
      setCreatedAccess({ username: updated.username ?? '', password: nextPassword });
      await reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusyId(null);
    }
  }

  async function copyAccess() {
    if (!createdAccess?.username) return;
    const text = language === 'DE'
      ? `MindCrafti School\nLogin: ${createdAccess.username}\nPasswort: ${createdAccess.password}`
      : `MindCrafti School\nЛогин: ${createdAccess.username}\nПароль: ${createdAccess.password}`;
    await navigator.clipboard.writeText(text);
    window.alert(language === 'DE' ? 'Zugangsdaten kopiert.' : 'Логин и пароль скопированы.');
  }

  return (
    <div className="teacher-students-page">
      <div className="teacher-page-heading">
        <h1>{language === 'DE' ? 'Eltern' : 'Родители'}</h1>
        <p>
          {language === 'DE'
            ? 'Erstelle Elternkonten separat und verknüpfe sie nur mit den Schülern, für die sie benötigt werden.'
            : 'Создавайте аккаунты родителей отдельно и привязывайте их только к тем ученикам, кому это нужно.'}
        </p>
      </div>

      {error && <div className="banner banner--error">{error}</div>}

      {createdAccess && (
        <section className="panel stack" style={{ marginBottom: 24, border: '2px solid #ffb37f' }}>
          <div>
            <strong>{language === 'DE' ? 'Zugangsdaten für Eltern' : 'Данные для входа родителя'}</strong>
            <div className="muted" style={{ marginTop: 4 }}>
              {language === 'DE'
                ? 'Du hast das Passwort selbst festgelegt. Kopiere die Zugangsdaten und sende sie dem Elternteil.'
                : 'Пароль задан вами. Скопируйте логин и пароль и отправьте их родителю.'}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            <div className="panel" style={{ margin: 0 }}>
              <div className="muted">{language === 'DE' ? 'Login' : 'Логин'}</div>
              <div style={{ fontSize: 20, fontWeight: 800 }}>{createdAccess.username}</div>
            </div>
            <div className="panel" style={{ margin: 0 }}>
              <div className="muted">{language === 'DE' ? 'Passwort' : 'Пароль'}</div>
              <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: 1 }}>{createdAccess.password}</div>
            </div>
          </div>
          <div className="row">
            <button type="button" className="btn" onClick={() => void copyAccess()}>
              {language === 'DE' ? 'Login + Passwort kopieren' : 'Скопировать логин + пароль'}
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => setCreatedAccess(null)}>
              {language === 'DE' ? 'Schließen' : 'Закрыть'}
            </button>
          </div>
        </section>
      )}

      <section className="teacher-create-student">
        <h2>{language === 'DE' ? 'Elternkonto hinzufügen' : 'Добавить родителя'}</h2>
        <form onSubmit={createParent}>
          <div className="teacher-create-grid">
            <label className="field">
              <span className="field__label">{language === 'DE' ? 'Name des Elternteils' : 'Имя родителя'}</span>
              <input
                className="input"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                placeholder={language === 'DE' ? 'Name eingeben' : 'Введите имя родителя'}
                required
              />
            </label>
            <label className="field">
              <span className="field__label">{language === 'DE' ? 'Passwort' : 'Пароль'}</span>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={language === 'DE' ? 'Mindestens 6 Zeichen' : 'Минимум 6 символов'}
                minLength={6}
                required
              />
            </label>
          </div>
          <p className="teacher-form-hint">
            <span>ⓘ</span>
            {language === 'DE'
              ? 'Der Login wird automatisch erstellt. Das Passwort legst du selbst fest. E-Mail ist nicht erforderlich.'
              : 'Логин создаётся автоматически. Пароль вы задаёте сами. Email не нужен.'}
          </p>
          <button className="btn teacher-primary-btn" type="submit" disabled={creating}>
            {creating
              ? (language === 'DE' ? 'Wird erstellt…' : 'Создаём…')
              : (language === 'DE' ? 'Elternkonto hinzufügen' : 'Добавить родителя')}
          </button>
        </form>
      </section>

      <h2 style={{ marginTop: 28 }}>{language === 'DE' ? 'Elternkonten' : 'Аккаунты родителей'}</h2>
      {loading ? (
        <p className="muted">{language === 'DE' ? 'Laden…' : 'Загрузка…'}</p>
      ) : parents.length === 0 ? (
        <div className="teacher-empty-state">
          {language === 'DE' ? 'Noch keine Elternkonten.' : 'Родителей пока нет.'}
        </div>
      ) : (
        <div className="teacher-student-list">
          {parents.map((parent, index) => {
            const availableStudents = students.filter((student) => student.parentId !== parent.id);
            return (
              <article key={parent.id} className="teacher-student-card">
                <div className={`teacher-student-avatar teacher-student-avatar--${index % 4}`}>
                  {initial(parent.fullName)}
                </div>

                <div className="teacher-student-main">
                  <div className="teacher-student-name">{parent.fullName}</div>
                  <div className="teacher-student-email">
                    {language === 'DE' ? 'Login' : 'Логин'}: <strong>{parent.username ?? '—'}</strong>
                  </div>
                  {parent.email && <div className="teacher-student-email">{parent.email}</div>}
                  <div className="teacher-student-meta">
                    {parent.children.length > 0
                      ? `${language === 'DE' ? 'Kinder' : 'Дети'}: ${parent.children.map((child) => child.fullName).join(', ')}`
                      : (language === 'DE' ? 'Noch kein Schüler verknüpft' : 'Ученик ещё не привязан')}
                  </div>
                </div>

                <div className="teacher-student-stats" style={{ minWidth: 260 }}>
                  <label className="field" style={{ margin: 0 }}>
                    <span className="field__label">{language === 'DE' ? 'Schüler verknüpfen' : 'Привязать ученика'}</span>
                    <select
                      className="input"
                      value={selectedStudents[parent.id] ?? ''}
                      onChange={(event) => setSelectedStudents((current) => ({
                        ...current,
                        [parent.id]: event.target.value,
                      }))}
                    >
                      <option value="">{language === 'DE' ? 'Schüler auswählen…' : 'Выберите ученика…'}</option>
                      {availableStudents.map((student) => (
                        <option key={student.id} value={student.id}>
                          {student.fullName}{student.parentFullName ? ` — ${language === 'DE' ? 'aktuell' : 'сейчас'}: ${student.parentFullName}` : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="btn btn--secondary"
                    disabled={!selectedStudents[parent.id] || busyId === parent.id}
                    onClick={() => void linkStudent(parent)}
                  >
                    {language === 'DE' ? 'Verknüpfen' : 'Привязать'}
                  </button>
                </div>

                <div className="teacher-student-actions">
                  <button
                    type="button"
                    className="btn btn--ghost"
                    disabled={busyId === parent.id}
                    onClick={() => void changePassword(parent)}
                  >
                    {language === 'DE' ? 'Passwort ändern' : 'Изменить пароль'}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function initial(name: string): string {
  return name.trim()[0]?.toUpperCase() ?? 'P';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}
