import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import type { CardSummary, StudentInvitation, StudentListItem } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import { toErrorMessage } from '../../lib/errors';
import { InvitationNotice } from '../../components/InvitationNotice';

/** Teacher home: the list of their students with each student's active-card count. */
export function StudentsPage() {
  const { t } = useI18n();
  const [students, setStudents] = useState<StudentListItem[]>([]);
  const [summaries, setSummaries] = useState<Record<string, CardSummary>>({});
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [invitation, setInvitation] = useState<StudentInvitation | null>(null);
  const [copiedStudentId, setCopiedStudentId] = useState<string | null>(null);
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
    if (!student.invitationToken) {
      return;
    }
    const link = `${window.location.origin}/activate?token=${encodeURIComponent(student.invitationToken)}`;
    await navigator.clipboard.writeText(link);
    setCopiedStudentId(student.id);
    window.setTimeout(() => setCopiedStudentId((current) => (current === student.id ? null : current)), 2000);
  }

  async function deleteStudent(student: StudentListItem) {
    if (!window.confirm(t('students.deleteConfirm', { name: student.fullName }))) {
      return;
    }
    setError(null);
    try {
      await api.students.remove(student.id);
      await reload();
    } catch (e) {
      setError(toErrorMessage(e, t));
    }
  }

  return (
    <div>
      <h1>{t('students.title')}</h1>
      {error && <div className="banner banner--error">{error}</div>}

      <div className="panel">
        <h2>{t('students.create')}</h2>
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
          <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>{t('students.emailHint')}</p>
          <button className="btn" type="submit">{t('students.create')}</button>
        </form>
        {invitation && (
          <InvitationNotice message={t('students.inviteCreated')} token={invitation.invitationToken} />
        )}
      </div>

      {loading ? (
        <p className="muted">{t('common.loading')}</p>
      ) : students.length === 0 ? (
        <p className="muted">{t('students.empty')}</p>
      ) : (
        students.map((student) => (
          <div key={student.id} className="list-row">
            <div>
              <div className="list-row__title">{student.fullName}</div>
              <div className="muted">{student.email}</div>
              <div className="muted" style={{ fontSize: 12 }}>
                Google Drive: {student.googleDriveFolderUrl ? 'папка задана' : 'не настроен'}
              </div>
            </div>
            <div className="muted">
              {activeCount(summaries[student.id])} {t('students.activeCards')}
            </div>
            <div className="list-row__actions">
              <Link to={`/students/${student.id}`} className="btn btn--secondary">
                {t('students.cardsButton')}
              </Link>
              <Link to={`/students/${student.id}/homeworks`} className="btn btn--secondary">
                Домашка
              </Link>
              <Link to={`/students/${student.id}/drive`} className="btn btn--secondary">
                Google Drive
              </Link>
              {student.status === 'INVITED' && student.invitationToken && (
                <button className="btn btn--ghost" type="button" onClick={() => copyInvitationLink(student)}>
                  {copiedStudentId === student.id ? t('students.inviteCopied') : t('students.copyInvite')}
                </button>
              )}
              <button className="btn btn--danger" type="button" onClick={() => deleteStudent(student)}>
                {t('common.delete')}
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
