import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import type { StudentGroup, StudentListItem } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import { toErrorMessage } from '../../lib/errors';

export function GroupsPage() {
  const { t } = useI18n();
  const [groups, setGroups] = useState<StudentGroup[]>([]);
  const [students, setStudents] = useState<StudentListItem[]>([]);
  const [name, setName] = useState('');
  const [selectedEmails, setSelectedEmails] = useState<string[]>([]);
  const [emailInput, setEmailInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  async function reload() {
    const [groupList, studentList] = await Promise.all([
      api.groups.list(),
      api.students.list(),
    ]);
    setGroups(groupList);
    setStudents(studentList);
    setLoading(false);
  }

  useEffect(() => {
    reload().catch((e) => {
      setError(toErrorMessage(e, t));
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const availableStudents = useMemo(
    () => students.filter((student) => student.email && !selectedEmails.includes(student.email)),
    [students, selectedEmails],
  );

  const totalStudentsInGroups = useMemo(() => {
    const ids = new Set<string>();
    groups.forEach((group) => group.students.forEach((student) => ids.add(student.id)));
    return ids.size;
  }, [groups]);

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || selectedEmails.length === 0 || creating) return;
    setCreating(true);
    setError(null);
    try {
      await api.groups.create(name.trim(), selectedEmails);
      setName('');
      setSelectedEmails([]);
      setEmailInput('');
      await reload();
    } catch (e) {
      setError(toErrorMessage(e, t));
    } finally {
      setCreating(false);
    }
  }

  function addEmail(raw: string) {
    const email = raw.trim().toLowerCase();
    if (!email || selectedEmails.includes(email)) return;
    setSelectedEmails((current) => [...current, email]);
    setEmailInput('');
  }

  function removeEmail(email: string) {
    setSelectedEmails((current) => current.filter((item) => item !== email));
  }

  function handleEmailKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',' || event.key === ';') {
      event.preventDefault();
      addEmail(emailInput);
    }
  }

  return (
    <div className="teacher-groups-page">
      <div className="teacher-page-heading">
        <h1>Мои группы</h1>
        <p>Создавайте группы, добавляйте учеников и быстро переходите к материалам</p>
      </div>

      {error && <div className="banner banner--error">{error}</div>}

      <section className="teacher-group-create">
        <h2>Создать новую группу</h2>
        <form onSubmit={onCreate}>
          <label className="field">
            <span className="field__label">Название группы</span>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Введите название группы"
              disabled={creating}
              required
            />
          </label>

          <div className="field">
            <span className="field__label">Ученики</span>
            {selectedEmails.length > 0 && (
              <div className="teacher-group-chips">
                {selectedEmails.map((email) => (
                  <span className="teacher-group-chip" key={email}>
                    {email}
                    <button type="button" onClick={() => removeEmail(email)} aria-label={`Удалить ${email}`}>×</button>
                  </span>
                ))}
              </div>
            )}

            <div className="teacher-student-picker">
              <input
                className="input"
                type="email"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                onKeyDown={handleEmailKeyDown}
                onBlur={() => { if (emailInput.trim()) addEmail(emailInput); }}
                placeholder="Введите email или выберите существующего ученика"
                disabled={creating}
              />
              <select
                className="select teacher-student-picker__select"
                value=""
                onChange={(e) => addEmail(e.target.value)}
                disabled={creating || availableStudents.length === 0}
                aria-label="Выбрать существующего ученика"
              >
                <option value="">Выбрать ученика</option>
                {availableStudents.map((student) => (
                  <option key={student.id} value={student.email ?? ''}>
                    {student.fullName}{student.email ? ` — ${student.email}` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <p className="teacher-form-hint">
            <span>ⓘ</span>
            Существующие ученики будут добавлены в группу. Для новых аккаунтов автоматически отправится приглашение.
          </p>

          <button className="btn teacher-primary-btn" type="submit" disabled={creating || selectedEmails.length === 0}>
            {creating ? 'Создаём…' : 'Создать группу'}
          </button>
        </form>
      </section>

      <section className="teacher-group-stats">
        <div className="teacher-stat-card">
          <div className="teacher-stat-card__icon teacher-stat-card__icon--blue">◎</div>
          <div><span>Всего групп</span><strong>{groups.length}</strong><small>Создано в школе</small></div>
        </div>
        <div className="teacher-stat-card">
          <div className="teacher-stat-card__icon teacher-stat-card__icon--orange">◉</div>
          <div><span>Всего учеников в группах</span><strong>{totalStudentsInGroups}</strong><small>Уникальных учеников</small></div>
        </div>
        <div className="teacher-stat-card">
          <div className="teacher-stat-card__icon teacher-stat-card__icon--green">▣</div>
          <div><span>Всего учеников</span><strong>{students.length}</strong><small>Доступно преподавателю</small></div>
        </div>
      </section>

      {loading ? (
        <p className="muted">{t('common.loading')}</p>
      ) : groups.length === 0 ? (
        <div className="teacher-empty-state">Групп пока нет. Создай первую группу выше.</div>
      ) : (
        <section className="teacher-groups-list">
          {groups.map((group, index) => (
            <div className="teacher-group-row" key={group.id}>
              <div className={`teacher-group-avatar teacher-group-avatar--${index % 3}`}>{groupInitials(group.name)}</div>

              <div className="teacher-group-info">
                <strong>{group.name}</strong>
                <span>{group.students.length} {studentWord(group.students.length)}</span>
              </div>

              <div className="teacher-group-members" aria-label="Ученики группы">
                {group.students.slice(0, 4).map((student, studentIndex) => (
                  <div
                    key={student.id}
                    className={`teacher-member-avatar teacher-member-avatar--${studentIndex % 4}`}
                    title={student.fullName}
                  >
                    {student.fullName.trim().charAt(0).toUpperCase() || '?'}
                  </div>
                ))}
                {group.students.length > 4 && <div className="teacher-member-avatar teacher-member-avatar--more">+{group.students.length - 4}</div>}
              </div>

              <div className="teacher-group-row__spacer" />

              <Link className="teacher-open-group-btn" to={`/groups/${group.id}`}>Открыть группу</Link>
              <button type="button" className="teacher-more-btn" title="Дополнительно">⋮</button>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function groupInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'Г';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0] ?? ''}${words[1][0] ?? ''}`.toUpperCase();
}

function studentWord(count: number) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return 'ученик';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'ученика';
  return 'учеников';
}
