import { NavLink, useNavigate } from 'react-router-dom';
import { useState, type ReactNode } from 'react';
import { TeacherShell } from './TeacherShell';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/I18nContext';
import { api, setAccessToken, setSessionAccessToken } from '../api/client';
import type { TranslationKey } from '../i18n/translations';
import { clearAdminImpersonation, readAdminImpersonation } from '../auth/adminImpersonation';

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout, setUser } = useAuth();
  const { language, t } = useI18n();
  const navigate = useNavigate();
  const [returningToAdmin, setReturningToAdmin] = useState(false);

  const isStudent = user?.role === 'STUDENT';
  const isTeacher = user?.role === 'TEACHER';
  const isParent = user?.role === 'PARENT';
  const isAdmin = user?.role === 'ADMIN';
  const impersonation = !isAdmin ? readAdminImpersonation() : null;
  const isImpersonating = Boolean(user && impersonation?.adminToken);

  async function returnToAdmin() {
    if (!impersonation || returningToAdmin) return;
    const returnTo = impersonation.returnTo || '/teachers';
    setReturningToAdmin(true);
    try {
      // Normal path: drop the tab-local impersonation token and reveal the
      // persistent admin token that never left localStorage.
      setSessionAccessToken(null);
      let admin = await api.auth.me();

      // Backward-compatible recovery for tabs that were opened before this fix.
      if (admin.role !== 'ADMIN' && impersonation.adminToken) {
        setAccessToken(impersonation.adminToken);
        admin = await api.auth.me();
      }
      if (admin.role !== 'ADMIN') throw new Error('Admin session is unavailable');

      setUser(admin);
      clearAdminImpersonation();
      navigate(returnTo);
    } catch {
      clearAdminImpersonation();
      logout();
      navigate('/login');
    } finally {
      setReturningToAdmin(false);
    }
  }

  function fullLogout() {
    clearAdminImpersonation();
    logout();
    navigate('/login');
  }

  if (isTeacher) {
    return <TeacherShell user={user} isImpersonating={isImpersonating} returningToAdmin={returningToAdmin}
      onReturnToAdmin={() => void returnToAdmin()} onLogout={fullLogout}>{children}</TeacherShell>;
  }

  const links: { to: string; label: TranslationKey | string }[] = isStudent
    ? [
        { to: '/today', label: 'nav.today' },
        { to: '/my-cards', label: 'nav.myCards' },
        { to: '/student/lessons', label: language === 'DE' ? 'Mein Unterricht' : 'Мои уроки' },
        { to: '/settings', label: 'nav.settings' },
      ]
    : isParent
      ? [
          { to: '/parent', label: language === 'DE' ? 'Mein Kind' : 'Мой ребёнок' },
          { to: '/parent/settings', label: language === 'DE' ? 'Einstellungen' : 'Настройки' },
        ]
      : isAdmin
        ? [
            { to: '/teachers', label: language === 'DE' ? 'Lehrer' : 'Учителя' },
            { to: '/admin/accounts', label: language === 'DE' ? 'Konten' : 'Ученики и родители' },
            { to: '/admin/learning-time', label: language === 'DE' ? 'Lernzeit' : 'Время обучения' },
            { to: '/admin/lessons', label: language === 'DE' ? 'Unterricht' : 'Уроки школы' },
            { to: '/admin/trial-lessons', label: language === 'DE' ? 'Probestunden' : 'Пробные уроки' },
            { to: '/admin/leads', label: language === 'DE' ? 'Anfragen' : 'Заявки' },
            { to: '/admin/site-visits', label: language === 'DE' ? 'Besuche' : 'Попытки посетителей' },
            { to: '/admin/stories', label: 'Шаблоны Stories' },
            { to: '/admin/prompts', label: language === 'DE' ? 'Prompts' : 'Промты школы' },
            { to: '/skills', label: language === 'DE' ? 'Kompetenzen' : 'Навыки' },
          ]
        : [{ to: '/teachers', label: 'nav.teachers' }];

  return (
    <div className="app" data-variant={isStudent ? 'student' : 'staff'}>
      {isImpersonating && (
        <div style={{ background: '#fff3ec', borderBottom: '1px solid #ffd5bd', padding: '10px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontWeight: 750, color: '#9a3e00' }}>
            Режим администратора: вы вошли как {impersonation?.userName || user?.fullName}.
          </div>
          <button className="btn" type="button" disabled={returningToAdmin} onClick={() => void returnToAdmin()}>
            {returningToAdmin ? 'Возвращаемся…' : 'Вернуться в админку'}
          </button>
        </div>
      )}
      <header className="topbar">
        <div className="topbar__brand">{t('app.name')}</div>
        <nav className="topbar__nav">
          {links.map((link) => (
            <NavLink key={link.to} to={link.to} className="topbar__link">
              {typeof link.label === 'string' && link.label.startsWith('nav.')
                ? t(link.label as TranslationKey)
                : link.label}
            </NavLink>
          ))}
          {isStudent && (
            <NavLink to="/student/homeworks" end className="topbar__link">
              {language === 'DE' ? 'Hausaufgaben' : 'Домашка'}
            </NavLink>
          )}
        </nav>
        <div className="topbar__spacer" />
        {user && (
          <button type="button" className="btn btn--ghost" onClick={fullLogout}>
            {t('common.logout')}
          </button>
        )}
      </header>
      <main className="content">{children}</main>
    </div>
  );
}
