import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { homePathForRole } from '../auth/roleRoutes';
import { useI18n } from '../i18n/I18nContext';
import { LanguageToggle } from '../components/LanguageToggle';

/** Invitation acceptance. Students use the generated school login; email is not required. */
export function ActivatePage() {
  const { activate } = useAuth();
  const { language, t } = useI18n();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [token, setToken] = useState(searchParams.get('token') ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(false);
    setSubmitting(true);
    try {
      const activated = await activate(token.trim(), '', password);
      navigate(homePathForRole(activated.role), { replace: true });
    } catch {
      setError(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth">
      <form className="auth__card" onSubmit={onSubmit}>
        <div className="auth__brand">{t('app.name')}</div>
        <h1>{t('activate.title')}</h1>
        <p className="muted">
          {language === 'DE'
            ? 'Nach der Aktivierung meldet sich der Schüler mit seinem Schul-Login an. Eine E-Mail ist nicht erforderlich.'
            : 'После активации ученик входит по школьному логину. Email не нужен.'}
        </p>
        {error && <div className="banner banner--error">{t('activate.error')}</div>}
        <label className="field">
          <span className="field__label">{t('activate.tokenLabel')}</span>
          <input
            className="input"
            type="text"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            required
          />
        </label>
        <label className="field">
          <span className="field__label">{t('common.password')}</span>
          <input
            className="input"
            type="password"
            value={password}
            autoComplete="new-password"
            minLength={8}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <button className="btn btn--block" type="submit" disabled={submitting}>
          {t('activate.submit')}
        </button>
        <p className="muted center" style={{ marginTop: 16, fontSize: 14 }}>
          <Link to="/login">{t('login.title')}</Link>
        </p>
        <div className="center" style={{ marginTop: 8 }}>
          <LanguageToggle />
        </div>
      </form>
    </div>
  );
}
