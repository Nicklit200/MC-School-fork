import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import type { CardSummary, StudentInvitation, StudentListItem } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import { toErrorMessage } from '../../lib/errors';
import { InvitationNotice } from '../../components/InvitationNotice';

/** Teacher home: the list of their students with each student's active-card count. */
export function StudentsPage() {
  const { language, t } = useI18n();
  const [students, setStudents] = useState<StudentListItem[]>([]);
  const [summaries, setSummaries] = useState<Record<string, CardSummary>>({});
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [invitation, setInvitation] = useState<StudentInvitation | null>(null);
  const [copiedStudentId, setCopiedStudentId] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function reload() {
    const list = await api.students.list();
    setStudents(list);
    const entries = await Promise.all(
      list.map(async (s) => [s.id, await api.cards.summaryForStudent(s.id)] as const),
    );
    setSummaries(Object.fromEntries(entries));
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
      const created = await api.students.create(fullName.trim(), email.trim());
      setInvitation(created);
      setFullName('');
      setEmail('');
      await reload();
    } catch (e) {
      setError(toErrorMessage(e, t));
    }
  }

  function activeCount(summary?: CardSummary): number {
    return summary ? summary.dueNow + summary.awaitingRepetition : 0;
  }

  async function copyInvitationLink(student: StudentListItem) {
    if (!student.invitationToken) return;
    const link = `${window.location.origin}/activate?token=${encodeURIComponent(student.invitationToken)}`;
    await navigator.clipboard.writeText(link);
    setCopiedStudentId(student.id);
    setOpenMenuId(null);
    window.setTimeout(() => setCopiedStudentId((current) => (current === student.id ? null : current)), 2000);
  }

  async function renameStudent(student: StudentListItem) {
    const nextName = window.prompt(
      language === 'DE' ? 'Neuer Schülername' : 'Новое имя ученика',
      student.fullName,
    );
    if (!nextName || nextName.trim() === student.fullName) {
      setOpenMenuId(null);
      return;
    }
    setError(null);
    try {
      await api.students.rename(student.id, nextName.trim());
      setOpenMenuId(null);
      await reload();
    } catch (e) {
      setError(toErrorMessage(e, t));
    }
  }

  async function deleteStudent(student: StudentListItem) {
    if (!window.confirm(t('students.deleteConfirm', { name: student.fullName }))) return;
    setError(null);
    try {
      await api.students.remove(student.id);
      setOpenMenuId(null);
      await reload();
    } catch (e) {
      setError(toErrorMessage(e, t));
    }
  }

  return (
    <div className="teacher-students-page" onClick={() => openMenuId && setOpenMenuId(null)}>
      <div className="teacher-page-heading">
        <h1>{language === 'DE' ? 'Meine Schüler' : 'Мои ученики'}</h1>
        <p>{language === 'DE' ? 'Verwalte Schüler und ihren Zugriff auf Materialien' : 'Управляйте своими учениками и их доступом к материалам'}</p>
      </div>

      {error && <div className="banner banner--error">{error}</div>}

      <section className="teacher-create-student">
        <h2>{language === 'DE' ? 'Neuen Schüler hinzufügen' : 'Добавить нового ученика'}</h2>
        <form onSubmit={onCreate}>
          <div className="teacher-create-grid">
            <label className="field">
              <span className="field__label">{language === 'DE' ? 'Name des Schülers' : 'Имя ученика'}</span>
              <input
                className="input"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder={language === 'DE' ? 'Name eingeben' : 'Введите имя ученика'}
                required
              />
            </label>
            <label className="field">
              <span className="field__label">{language === 'DE' ? 'E-Mail (optional)' : 'Эл. почта (необязательно)'}</span>
              <input
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="example@email.com"
              />
            </label>
          </div>
          <p className="teacher-form-hint">
            <span>ⓘ</span>
            {language === 'DE'
              ? 'Ohne E-Mail wird trotzdem ein Einladungslink erstellt. Der Schüler gibt seine E-Mail beim Öffnen des Links ein.'
              : 'Если email не указан, система предложит его позже создать. Ученик в любой момент получит доступ по ссылке.'}
          </p>
          <button className="btn teacher-primary-btn" type="submit">
            {language === 'DE' ? 'Schüler hinzufügen' : 'Добавить ученика'}
          </button>
        </form>
        {invitation && <InvitationNotice message={t('students.inviteCreated')} token={invitation.invitationToken} />}
      </section>

      {loading ? (
        <p className="muted">{t('common.loading')}</p>
      ) : students.length === 0 ? (
        <div className="teacher-empty-state">{t('students.empty')}</div>
      ) : (
        <div className="teacher-student-list">
          {students.map((student, index) => (
            <article key={student.id} className="teacher-student-card">
              <div className={`teacher-student-avatar teacher-student-avatar--${index % 4}`}>
                {studentInitial(student.fullName)}
              </div>

              <div className="teacher-student-main">
                <div className="teacher-student-name">{student.fullName}</div>
                <div className="teacher-student-email">
                  {student.email ?? (language === 'DE' ? 'E-Mail noch nicht angegeben' : 'Email не указан')}
                </div>
                <div className="teacher-student-meta">Google вход не настроен</div>
              </div>

              <div className="teacher-student-stats">
                <div>{activeCount(summaries[student.id])} {language === 'DE' ? 'aktive Karten' : 'активных карточек'}</div>
                <span>{language === 'DE' ? 'Letzte Aktivität:' : 'Последняя активность:'}</span>
                <strong>—</strong>
              </div>

              <div className="teacher-student-actions">
                <div className="teacher-student-actions__top">
                  <Link to={`/students/${student.id}`} className="teacher-action-chip">
                    <span>▣</span>{language === 'DE' ? 'Karten' : 'Карточки'}
                  </Link>
                  <Link to={`/students/${student.id}/homeworks`} className="teacher-action-chip">
                    <span>▤</span>{language === 'DE' ? 'Hausaufgabe' : 'Домашка'}
                  </Link>
                  <Link to={`/students/${student.id}/drive`} className="teacher-action-chip">
                    <span>△</span>Google Drive
                  </Link>

                  <div className="teacher-student-menu-wrap" onClick={(event) => event.stopPropagation()}>
                    <button
                      type="button"
                      className="teacher-more-btn"
                      aria-label="Дополнительные действия"
                      aria-expanded={openMenuId === student.id}
                      onClick={() => setOpenMenuId((current) => current === student.id ? null : student.id)}
                    >
                      ⋮
                    </button>

                    {openMenuId === student.id && (
                      <div className="teacher-student-menu">
                        <button
                          type="button"
                          disabled={!student.invitationToken}
                          onClick={() => void copyInvitationLink(student)}
                        >
                          <span>⌁</span>
                          {copiedStudentId === student.id
                            ? (language === 'DE' ? 'Link kopiert' : 'Ссылка скопирована')
                            : (language === 'DE' ? 'Link speichern' : 'Сохранить ссылку')}
                        </button>
                        <button type="button" onClick={() => void renameStudent(student)}>
                          <span>✎</span>{language === 'DE' ? 'Name ändern' : 'Изменить имя'}
                        </button>
                        <button type="button" className="is-danger" onClick={() => void deleteStudent(student)}>
                          <span>♧</span>{language === 'DE' ? 'Löschen' : 'Удалить'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function studentInitial(name: string) {
  return name.trim().charAt(0).toUpperCase() || '?';
}
