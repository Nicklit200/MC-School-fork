import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiRequestError, getAccessToken, hasSessionAccessToken, setAccessToken } from '../api/client';
import type { User } from '../api/types';
import { useI18n } from '../i18n/I18nContext';

interface AuthValue {
  user: User | null;
  /** True until the initial "am I logged in?" check finishes. */
  initializing: boolean;
  login: (email: string, password: string) => Promise<User>;
  activate: (invitationToken: string, email: string, password: string) => Promise<User>;
  logout: () => void;
  setUser: (user: User) => void;
}

const AuthContext = createContext<AuthValue | undefined>(undefined);
const CACHED_USER_KEY = 'authUser';
const SESSION_CACHED_USER_KEY = 'mindcrafti.impersonation.user';

function getCachedUser(): User | null {
  if (!getAccessToken()) return null;
  try {
    const raw = hasSessionAccessToken()
      ? sessionStorage.getItem(SESSION_CACHED_USER_KEY)
      : localStorage.getItem(CACHED_USER_KEY);
    return raw ? JSON.parse(raw) as User : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => getCachedUser());
  const [initializing, setInitializing] = useState(true);
  const { setLanguage } = useI18n();

  const applyUser = useCallback(
    (next: User) => {
      setUser(next);
      if (hasSessionAccessToken()) {
        sessionStorage.setItem(SESSION_CACHED_USER_KEY, JSON.stringify(next));
      } else {
        localStorage.setItem(CACHED_USER_KEY, JSON.stringify(next));
        sessionStorage.removeItem(SESSION_CACHED_USER_KEY);
      }
      setLanguage(next.preferredLanguage);
    },
    [setLanguage],
  );

  useEffect(() => {
    if (!getAccessToken()) {
      setInitializing(false);
      return;
    }
    api.auth
      .me()
      .then(applyUser)
      .catch((error) => {
        // Keep the saved session during temporary backend/network failures.
        // Only remove the token when the server explicitly says it is invalid.
        if (error instanceof ApiRequestError && (error.status === 401 || error.status === 403)) {
          setAccessToken(null);
          localStorage.removeItem(CACHED_USER_KEY);
          sessionStorage.removeItem(SESSION_CACHED_USER_KEY);
          setUser(null);
        }
      })
      .finally(() => setInitializing(false));
  }, [applyUser]);

  const login = useCallback(
    async (email: string, password: string) => {
      const auth = await api.auth.login(email, password);
      setAccessToken(auth.accessToken);
      applyUser(auth.user);
      return auth.user;
    },
    [applyUser],
  );

  const activate = useCallback(
    async (invitationToken: string, email: string, password: string) => {
      const auth = await api.auth.activate(invitationToken, email, password);
      setAccessToken(auth.accessToken);
      applyUser(auth.user);
      return auth.user;
    },
    [applyUser],
  );

  const logout = useCallback(() => {
    setAccessToken(null);
    localStorage.removeItem(CACHED_USER_KEY);
    sessionStorage.removeItem(SESSION_CACHED_USER_KEY);
    setUser(null);
  }, []);

  const value = useMemo<AuthValue>(
    () => ({ user, initializing, login, activate, logout, setUser: applyUser }),
    [user, initializing, login, activate, logout, applyUser],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
