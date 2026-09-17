import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { homePathForRole } from '../auth/roleRoutes';
import { setAccessToken } from '../api/client';
import type { User } from '../api/types';
import { useI18n } from '../i18n/I18nContext';
import { LanguageToggle } from '../components/LanguageToggle';
import '../login-page.css';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080/api/v1';

type StagingProfile = {
  id: string;
  name: string;
  role: string;
};

type StagingAuthResponse = {
  accessToken: string;
  user: User;
};

export function LoginPage() {
  const { user, login, setUser } = useAuth();
  const { language, t } = useI18n();
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [stagingProfiles, setStagingProfiles] = useState<StagingProfile[]>([]);
  const [stagingSubmitting, setStagingSubmitting] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE_URL}/auth/staging-profiles`)
      .then(async (response) => {
        if (!response.ok) return [];
        return await response.json() as StagingProfile[];
      })
      .then((profiles) => {
        if (!cancelled) setStagingProfiles(profiles);
      })
      .catch(() => {
        if (!cancelled) setStagingProfiles([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (user) {
    return <Navigate to={homePathForRole(user.role)} replace />;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(false);
    setSubmitting(true);
    try {
      const loggedIn = await login(identifier, password);
      navigate(homePathForRole(loggedIn.role), { replace: true });
    } catch {
      setError(true);
    } finally {
      setSubmitting(false);
    }
  }

  async function loginAsStagingProfile(profileId: string) {
    setError(false);
    setStagingSubmitting(profileId);
    try {
      const response = await fetch(`${API_BASE_URL}/auth/staging-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: profileId }),
      });
      if (!response.ok) throw new Error('Staging login failed');
      const auth = await response.json() as StagingAuthResponse;
      setAccessToken(auth.accessToken);
      setUser(auth.user);
      navigate(homePathForRole(auth.user.role), { replace: true });
    } catch {
      setError(true);
    } finally {
      setStagingSubmitting(null);
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

        {stagingProfiles.length > 0 && (
          <div style={{ marginBottom: 20, padding: 14, borderRadius: 14, background: '#f5f8ff', border: '1px solid #dde7ff' }}>
            <div style={{ fontWeight: 800, marginBottom: 4 }}>
              {language === 'DE' ? 'Testzugang ohne Passwort' : 'Тестовый вход без пароля'}
            </div>
            <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
              {language === 'DE'
                ? 'Nur auf der Testseite verfügbar.'
                : 'Работает только на тестовом сайте.'}
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              {stagingProfiles.map((profile) => (
                <button
                  key={profile.id}
                  className="login-submit"
                  type="button"
                  disabled={stagingSubmitting !== null || submitting}
                  onClick={() => void loginAsStagingProfile(profile.id)}
                  style={{ minHeight: 46 }}
                >
                  {stagingSubmitting === profile.id
                    ? (language === 'DE' ? 'Anmeldung…' : 'Входим…')
                    : profile.role === 'TEACHER'
                      ? (language === 'DE' ? 'Als Testlehrer anmelden' : 'Войти как тестовый учитель')
                      : (language === 'DE' ? 'Als Testschüler anmelden' : 'Войти как тестовый ученик')}
                </button>
              ))}
            </div>
          </div>
        )}

        <label className="field login-field">
          <span className="field__label">{language === 'DE' ? 'Login oder E-Mail' : 'Логин или email'}</span>
          <input
            className="input"
            type="text"
            value={identifier}
            autoComplete="username"
            placeholder={language === 'DE' ? 'z. B. Mark124' : 'например Марк124'}
            onChange={(e) => setIdentifier(e.target.value)}
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

        <button className="login-submit" type="submit" disabled={submitting || stagingSubmitting !== null}>
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
