import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { homePathForRole } from '../auth/roleRoutes';
import { useI18n } from '../i18n/I18nContext';
import { LanguageToggle } from '../components/LanguageToggle';
import '../login-page.css';

export function LoginPage() {
  const { user, login } = useAuth();
  const { language, t } = useI18n();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (user) {
    return <Navigate to={homePathForRole(user.role)} replace />;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(false);
    setSubmitting(true);
    try {
      const loggedIn = await login(email, password);
      navigate(homePathForRole(loggedIn.role), { replace: true });
    } catch {
      setError(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-decor-dots login-decor-dots--top" />
      <div className="login-decor-dots login-decor-dots--bottom" />

      <div className="login-brand" aria-label="MindCrafti School">
        <div className="login-brand__mark">M</div>
        <div className="login-brand__name"><span>MindCrafti</span> School</div>
      </div>

      <form className="login-card" onSubmit={onSubmit}>
        <h1 className="login-card__title">{language === 'DE' ? 'Anmeldung' : 'Вход'}</h1>
        <p className="login-card__subtitle">
          {language === 'DE'
            ? 'Melde dich an, um in der Schule weiterzuarbeiten.'
            : 'Войдите, чтобы продолжить работу в системе'}
        </p>

        {error && <div className="banner banner--error">{t('login.error')}</div>}

        <label className="field login-field">
          <span className="field__label">{t('common.email')}</span>
          <input
            className="input"
            type="email"
            value={email}
            autoComplete="username"
            placeholder="name@example.com"
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>

        <label className="field login-field">
          <span className="field__label">{t('common.password')}</span>
          <div className="login-password-wrap">
            <input
              className="input"
              type={showPassword ? 'text' : 'password'}
              value={password}
              autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button
              type="button"
              className="login-password-toggle"
              onClick={() => setShowPassword((current) => !current)}
              aria-label={showPassword
                ? (language === 'DE' ? 'Passwort verbergen' : 'Скрыть пароль')
                : (language === 'DE' ? 'Passwort anzeigen' : 'Показать пароль')}
            >
              {showPassword ? '◉' : '◎'}
            </button>
          </div>
        </label>

        <button className="login-submit" type="submit" disabled={submitting}>
          {submitting
            ? (language === 'DE' ? 'Anmeldung…' : 'Входим…')
            : t('login.submit')}
        </button>

        <div className="login-activate-link">
          <Link to="/activate">{t('activate.title')}</Link>
        </div>

        <div className="login-language-switch">
          <LanguageToggle />
        </div>
      </form>
    </div>
  );
}
