import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import type { TeacherInvitation, User } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import { toErrorMessage } from '../../lib/errors';
import { InvitationNotice } from '../../components/InvitationNotice';

/** Admin home: create teacher accounts and manage their school lessons. */
export function TeachersPage() {
  const { t } = useI18n();
  const [teachers, setTeachers] = useState<User[]>([]);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [invitation, setInvitation] = useState<TeacherInvitation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
      const created = await api.teachers.create(fullName.trim(), email.trim());
      setInvitation(created);
      setFullName('');
      setEmail('');
      await reload();
    } catch (e) {
      setError(toErrorMessage(e, t));
    }
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
          <button className="btn" type="submit">{t('teachers.create')}</button>
        </form>
        {invitation && (
          <InvitationNotice
            message={t('teachers.inviteCreated')}
            token={invitation.invitationToken}
          />
        )}
      </div>

      {loading ? (
        <p className="muted">{t('common.loading')}</p>
      ) : teachers.length === 0 ? (
        <p className="muted">{t('teachers.empty')}</p>
      ) : (
        teachers.map((teacher) => (
          <div key={teacher.id} className="list-row" style={{ gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div className="list-row__title">{teacher.fullName}</div>
              <div className="muted">{teacher.email}</div>
            </div>
            <Link className="btn btn--ghost" to={`/admin/lessons?teacherId=${teacher.id}`}>Уроки</Link>
            <span className={`pill ${teacher.status === 'ACTIVE' ? 'pill--learned' : 'pill--active'}`}>
              {teacher.status}
            </span>
          </div>
        ))
      )}
    </div>
  );
}
