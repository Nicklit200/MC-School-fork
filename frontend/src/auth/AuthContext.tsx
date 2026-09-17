import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, getAccessToken, setAccessToken } from '../api/client';
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [initializing, setInitializing] = useState(true);
  const { setLanguage } = useI18n();

  const applyUser = useCallback(
    (next: User) => {
      setUser(next);
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
      .catch(() => setAccessToken(null))
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
