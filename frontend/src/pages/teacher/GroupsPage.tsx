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
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
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
    () => students.filter((student) => !selectedStudentIds.includes(student.id)),
    [students, selectedStudentIds],
  );

  const selectedStudents = useMemo(
    () => selectedStudentIds.map((id) => students.find((student) => student.id === id)).filter((student): student is StudentListItem => Boolean(student)),
    [students, selectedStudentIds],
  );

  const totalStudentsInGroups = useMemo(() => {
    const ids = new Set<string>();
    groups.forEach((group) => group.students.forEach((student) => ids.add(student.id)));
    return ids.size;
  }, [groups]);

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || selectedStudentIds.length === 0 || creating) return;
    setCreating(true);
    setError(null);
    try {
      await api.groups.create(name.trim(), selectedStudentIds);
      setName('');
      setSelectedStudentIds([]);
      await reload();
    } catch (e) {
      setError(toErrorMessage(e, t));
    } finally {
      setCreating(false);
    }
  }

  function addStudent(studentId: string) {
    if (!studentId || selectedStudentIds.includes(studentId)) return;
    setSelectedStudentIds((current) => [...current, studentId]);
  }

  function removeStudent(studentId: string) {
    setSelectedStudentIds((current) => current.filter((item) => item !== studentId));
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
            {selectedStudents.length > 0 && (
              <div className="teacher-group-chips">
                {selectedStudents.map((student) => (
                  <span className="teacher-group-chip" key={student.id}>
                    {student.fullName}
                    <button type="button" onClick={() => removeStudent(student.id)} aria-label={`Удалить ${student.fullName}`}>×</button>
                  </span>
                ))}
              </div>
            )}

            <div className="teacher-student-picker">
              <select
                className="select teacher-student-picker__select"
                value=""
                onChange={(e) => addStudent(e.target.value)}
                disabled={creating || availableStudents.length === 0}
                aria-label="Выбрать существующего ученика"
              >
                <option value="">Выбрать ученика</option>
                {availableStudents.map((student) => (
                  <option key={student.id} value={student.id}>
                    {student.fullName}{student.username ? ` — ${student.username}` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <p className="teacher-form-hint">
            <span>ⓘ</span>
            Выберите существующих учеников преподавателя. Email для добавления в группу не нужен.
          </p>

          <button className="btn teacher-primary-btn" type="submit" disabled={creating || selectedStudentIds.length === 0}>
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
