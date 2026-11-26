import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { trialInvitationsApi, type TrialGuestInvitation } from '../api/trialInvitations';
import { setSessionAccessToken } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { PrejoinPanel, type PrejoinChoice } from '../features/online-classes/PrejoinPanel';

export function TrialGuestJoinPage() {
  const { token = '' } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { setUser } = useAuth();
  const [info, setInfo] = useState<TrialGuestInvitation | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [waitingRequested, setWaitingRequested] = useState(false);
  const [previewVersion, setPreviewVersion] = useState(0);
  const [mediaChoice, setMediaChoice] = useState<PrejoinChoice | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    trialInvitationsApi.info(token)
      .then(value => { if (active) setInfo(value); })
      .catch(() => { if (active) setError('Ссылка недействительна или срок её действия истёк. Попросите преподавателя отправить новую.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token]);

  useEffect(() => {
    if (!waitingRequested) return;
    const timer = window.setInterval(() => {
      void trialInvitationsApi.info(token).then(setInfo).catch(() => {
        setError('Приглашение больше не действует. Свяжитесь с преподавателем.');
        setWaitingRequested(false);
      });
    }, 15000);
    return () => window.clearInterval(timer);
  }, [waitingRequested, token]);

  useEffect(() => {
    if (waitingRequested && info?.canJoin && name.trim().length >= 2 && !busy && mediaChoice) {
      setWaitingRequested(false);
      void enterClass(mediaChoice);
    }
  }, [waitingRequested, info?.canJoin]);

  async function enterClass(choice: PrejoinChoice) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const joined = await trialInvitationsApi.join(token, name.trim());
      // Scope to this tab: never replace the teacher/parent login in localStorage.
      setSessionAccessToken(joined.auth.accessToken);
      setUser(joined.auth.user);
      navigate('/online-classes/' + encodeURIComponent(joined.classId), { replace: true, state: { trialMedia: choice, trialClassId: joined.classId } });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '';
      setError(/same name/i.test(message)
        ? 'Введи то же имя, что и при первом входе на этот урок.'
        : /no longer accept/i.test(message)
          ? 'Эта комната больше не принимает гостей. Попроси преподавателя отправить новую ссылку.'
          : 'Не удалось войти. Попробуй ещё раз или свяжись с преподавателем.');
      setPreviewVersion(value => value + 1);
    } finally { setBusy(false); }
  }

  async function submit(choice: PrejoinChoice) {
    if (busy || name.trim().length < 2) return;
    setMediaChoice(choice);
    if (!info?.canJoin) {
      setWaitingRequested(true);
      return;
    }
    await enterClass(choice);
  }

  return <main style={{ minHeight: '100vh', background: '#fff8f1', display: 'grid', placeItems: 'center', padding: 20 }}>
    <section className="panel stack" style={{ width: 'min(850px, 100%)', padding: 28 }}>
      <div style={{ fontWeight: 900, fontSize: 22, color: '#f36b21' }}>MINDCRAFTI SCHOOL</div>
      <h1 style={{ marginBottom: 0 }}>Пробный урок математики</h1>
      {loading ? <p role="status">Проверяем приглашение...</p> : info && <>
        <p>Урок: {new Intl.DateTimeFormat('ru-RU', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Europe/Berlin' }).format(new Date(info.startsAt))} (время Германии).</p>
        {info.claimed && <p>Если ты уже подключался, введи то же имя, чтобы вернуться в урок.</p>}
        {!info.canJoin && <p>Ты можешь оставить эту страницу открытой. Подключение станет доступно за 60 минут до начала, даже если учитель ещё не вошёл.</p>}
        <form onSubmit={event => event.preventDefault()} className="stack">
          <label htmlFor="trial-student-name" style={{ fontWeight: 700 }}>Как тебя зовут?</label>
          <input id="trial-student-name" className="input" autoComplete="given-name"
            placeholder="Твоё имя" maxLength={80} minLength={2} required value={name}
            onChange={event => setName(event.target.value)} />
          {!waitingRequested && <PrejoinPanel key={previewVersion} joinDisabled={busy || name.trim().length < 2}
            onJoin={choice => void submit(choice)} />}
          {busy && <p role="status">Подключаем...</p>}
          <p className="muted" style={{ fontSize: 13 }}>Регистрация, почта и пароль не нужны. Видеокамеру и микрофон можно включить перед входом.</p>
        </form>
        {waitingRequested && <><p role="status">Ты в комнате ожидания. Страница сама проверит, когда можно подключиться к уроку.</p><button className="btn" type="button" onClick={() => { setWaitingRequested(false); setPreviewVersion(value => value + 1); }}>Проверить устройства снова</button></>}
      </>}
      {error && <p role="alert" className="banner banner--error">{error}</p>}
      <Link to="/login" className="muted" style={{ fontSize: 13 }}>Войти в обычный аккаунт школы</Link>
    </section>
  </main>;
}
