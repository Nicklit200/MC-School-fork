import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import type { StudentGroup } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import { toErrorMessage } from '../../lib/errors';

export function GroupsPage() {
  const { t } = useI18n();
  const [groups, setGroups] = useState<StudentGroup[]>([]);
  const [name, setName] = useState('');
  const [emails, setEmails] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function reload() {
    setGroups(await api.groups.list());
    setLoading(false);
  }

  useEffect(() => {
    reload().catch((e) => setError(toErrorMessage(e, t)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const parsedEmails = emails
      .split(/[\n,;]+/)
      .map((email) => email.trim())
      .filter(Boolean);
    try {
      await api.groups.create(name.trim(), parsedEmails);
      setName('');
      setEmails('');
      await reload();
    } catch (e) {
      setError(toErrorMessage(e, t));
    }
  }

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Группы учеников</h1>
        <Link className="btn btn--secondary" to="/students">Ученики</Link>
      </div>
      {error && <div className="banner banner--error">{error}</div>}

      <div className="panel">
        <h2>Создать группу</h2>
        <form onSubmit={onCreate}>
          <label className="field">
            <span className="field__label">Название группы</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label className="field">
            <span className="field__label">Email учеников</span>
            <textarea
              className="textarea"
              value={emails}
              onChange={(e) => setEmails(e.target.value)}
              placeholder={'sofia@example.com\nvitalina@example.com\nmilana@example.com'}
              required
            />
          </label>
          <p className="muted" style={{ fontSize: 13 }}>
            Уже существующие ученики просто добавятся в группу. Для новых аккаунтов автоматически отправится приглашение.
          </p>
          <button className="btn" type="submit">Создать группу</button>
        </form>
      </div>

      {loading ? (
        <p className="muted">{t('common.loading')}</p>
      ) : groups.length === 0 ? (
        <p className="muted">Групп пока нет</p>
      ) : (
        groups.map((group) => (
          <div className="list-row" key={group.id}>
            <div>
              <div className="list-row__title">{group.name}</div>
              <div className="muted">Учеников: {group.students.length}</div>
            </div>
            <Link className="btn btn--secondary" to={`/groups/${group.id}`}>Открыть группу</Link>
          </div>
        ))
      )}
    </div>
  );
}
