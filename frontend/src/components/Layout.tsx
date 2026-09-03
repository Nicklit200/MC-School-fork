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
  const isTeacher = user?.role === 'TEACHER';
  const isParent = user?.role === 'PARENT';

  if (isTeacher) {
    const teacherLinks = [
      { to: '/students', label: 'Мои ученики', icon: '◉', end: true },
      { to: '/groups', label: 'Мои группы', icon: '◎' },
      { to: '/students', label: 'Уроки', icon: '⌘', disabled: true },
      { to: '/students', label: 'Домашние задания', icon: '▣', disabled: true },
      { to: '/students', label: 'Материалы', icon: '▤', disabled: true },
      { to: '/students', label: 'Карточки', icon: '⌁', disabled: true },
      { to: '/students', label: 'Прогресс', icon: '⌁', disabled: true },
      { to: '/students', label: 'Сообщения', icon: '✉', disabled: true },
      { to: '/students', label: 'Уведомления', icon: '♧', disabled: true },
      { to: '/students', label: 'Настройки', icon: '⚙', disabled: true },
    ];

    return (
      <div className="app teacher-shell" data-variant="staff">
        <aside className="teacher-sidebar">
          <div className="teacher-brand">
            <div className="teacher-brand__mark">M</div>
            <div className="teacher-brand__text"><span>MindCrafti</span> School</div>
          </div>

          <nav className="teacher-sidebar__nav">
            {teacherLinks.map((link, index) => link.disabled ? (
              <div key={`${link.label}-${index}`} className="teacher-nav-item teacher-nav-item--disabled" title="Раздел появится позже">
                <span className="teacher-nav-item__icon">{link.icon}</span>
                <span>{link.label}</span>
              </div>
            ) : (
              <NavLink key={link.to} to={link.to} end={link.end} className="teacher-nav-item">
                <span className="teacher-nav-item__icon">{link.icon}</span>
                <span>{link.label}</span>
              </NavLink>
            ))}
          </nav>

          <div className="teacher-help">
            <div className="teacher-help__icon">◌</div>
            <div>
              <strong>Нужна помощь?</strong>
              <span>Свяжитесь с поддержкой</span>
            </div>
          </div>
        </aside>

        <section className="teacher-workspace">
          <header className="teacher-topbar">
            <div />
            <div className="teacher-topbar__right">
              <button type="button" className="teacher-bell" title="Уведомления">♧<span /></button>
              <div className="teacher-profile">
                <div className="teacher-profile__avatar">{initials(user.fullName)}</div>
                <div className="teacher-profile__text">
                  <strong>{user.fullName}</strong>
                  <span>Преподаватель</span>
                </div>
                <button
                  type="button"
                  className="teacher-profile__logout"
                  title={t('common.logout')}
                  onClick={() => {
                    logout();
                    navigate('/login');
                  }}
                >
                  ⌄
                </button>
              </div>
            </div>
          </header>
          <main className="content teacher-content">{children}</main>
        </section>
      </div>
    );
  }

  const links: { to: string; label: TranslationKey | string }[] = isStudent
    ? [
        { to: '/today', label: 'nav.today' },
        { to: '/my-cards', label: 'nav.myCards' },
        { to: '/settings', label: 'nav.settings' },
      ]
    : isParent
      ? [
          { to: '/parent', label: language === 'DE' ? 'Mein Kind' : 'Мой ребёнок' },
          { to: '/parent/settings', label: language === 'DE' ? 'Einstellungen' : 'Настройки' },
        ]
      : [{ to: '/teachers', label: 'nav.teachers' }];

  return (
    <div className="app" data-variant={isStudent ? 'student' : 'staff'}>
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
          <button type="button" className="btn btn--ghost" onClick={() => { logout(); navigate('/login'); }}>
            {t('common.logout')}
          </button>
        )}
      </header>
      <main className="content">{children}</main>
    </div>
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'T';
}
