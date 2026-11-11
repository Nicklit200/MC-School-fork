import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { trialInvitationsApi, type TrialGuestInvitation } from '../api/trialInvitations';
import { setSessionAccessToken } from '../api/client';
import { useAuth } from '../auth/AuthContext';

export function TrialGuestJoinPage() {
  const { token = '' } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { setUser } = useAuth();
  const [info, setInfo] = useState<TrialGuestInvitation | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    trialInvitationsApi.info(token)
      .then(value => { if (active) setInfo(value); })
      .catch(() => { if (active) setError('Ссылка недействительна или срок её действия истёк. Попросите преподавателя отправить новую.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !info?.canJoin) return;
    setBusy(true); setError('');
    try {
      const joined = await trialInvitationsApi.join(token, name.trim());
      // Scope to this tab: never replace the teacher/parent login in localStorage.
      setSessionAccessToken(joined.auth.accessToken);
      setUser(joined.auth.user);
      navigate('/online-classes/' + encodeURIComponent(joined.classId), { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось войти. Свяжитесь с преподавателем.');
    } finally { setBusy(false); }
  }

  return <main style={{ minHeight: '100vh', background: '#fff8f1', display: 'grid', placeItems: 'center', padding: 20 }}>
    <section className="panel stack" style={{ width: 'min(440px, 100%)', padding: 28 }}>
      <div style={{ fontWeight: 900, fontSize: 22, color: '#f36b21' }}>MINDCRAFTI SCHOOL</div>
      <h1 style={{ marginBottom: 0 }}>Пробный урок математики</h1>
      {loading ? <p role="status">Проверяем приглашение...</p> : info && <>
        <p>Урок: {new Intl.DateTimeFormat('ru-RU', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Europe/Berlin' }).format(new Date(info.startsAt))} (время Германии).</p>
        {info.claimed ? <p>По этой ссылке уже вошёл ученик. Если это вы, вернитесь к открытой вкладке урока. Иначе попросите новую ссылку.</p>
        : !info.canJoin ? <p>Вход откроется за 60 минут до начала. Вернитесь по этой ссылке ближе к уроку.</p>
        : <form onSubmit={event => void submit(event)} className="stack">
          <label htmlFor="trial-student-name" style={{ fontWeight: 700 }}>Как тебя зовут?</label>
          <input id="trial-student-name" className="input" autoComplete="given-name"
            placeholder="Твоё имя" maxLength={80} minLength={2} required value={name}
            onChange={event => setName(event.target.value)} />
          <button className="btn" type="submit" disabled={busy || name.trim().length < 2}>
            {busy ? 'Подключаем...' : 'Войти на урок'}
          </button>
          <p className="muted" style={{ fontSize: 13 }}>Регистрация, почта и пароль не нужны. Видеокамеру и микрофон можно включить перед входом.</p>
        </form>}
      </>}
      {error && <p role="alert" className="banner banner--error">{error}</p>}
      <Link to="/login" className="muted" style={{ fontSize: 13 }}>Войти в обычный аккаунт школы</Link>
    </section>
  </main>;
}
