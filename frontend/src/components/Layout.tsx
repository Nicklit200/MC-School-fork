import { NavLink, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/I18nContext';
import type { TranslationKey } from '../i18n/translations';

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const { language, t } = useI18n();
  const navigate = useNavigate();

  const isStudent = user?.role === 'STUDENT';
  const links: { to: string; label: TranslationKey }[] = isStudent
    ? [
        { to: '/today', label: 'nav.today' },
        { to: '/my-cards', label: 'nav.myCards' },
        { to: '/settings', label: 'nav.settings' },
      ]
    : user?.role === 'ADMIN'
      ? [{ to: '/teachers', label: 'nav.teachers' }]
      : [{ to: '/students', label: 'nav.students' }];

  return (
    <div className="app" data-variant={isStudent ? 'student' : 'staff'}>
      <header className="topbar">
        <div className="topbar__brand">{t('app.name')}</div>
        <nav className="topbar__nav">
          {links.map((link) => (
            <NavLink key={link.to} to={link.to} className="topbar__link">
              {t(link.label)}
            </NavLink>
          ))}
          {isStudent && (
            <NavLink to="/student/homeworks" end className="topbar__link">
              {language === 'DE' ? 'Hausaufgaben' : 'Домашка'}
            </NavLink>
          )}
          {user?.role === 'TEACHER' && (
            <NavLink to="/groups" className="topbar__link">Группы</NavLink>
          )}
        </nav>
        <div className="topbar__spacer" />
        {user && (
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => {
              logout();
              navigate('/login');
            }}
          >
            {t('common.logout')}
          </button>
        )}
      </header>
      <main className="content">{children}</main>
    </div>
  );
}
