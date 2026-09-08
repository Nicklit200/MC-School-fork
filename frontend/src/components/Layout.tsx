import { NavLink, useNavigate } from 'react-router-dom';
import { useState, type ReactNode } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/I18nContext';
import type { TranslationKey } from '../i18n/translations';

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const { language, t } = useI18n();
  const navigate = useNavigate();
  const [teacherMenuOpen, setTeacherMenuOpen] = useState(true);

  const isStudent = user?.role === 'STUDENT';
  const isTeacher = user?.role === 'TEACHER';
  const isParent = user?.role === 'PARENT';
  const isAdmin = user?.role === 'ADMIN';

  if (isTeacher) {
    const teacherLinks = [
      { to: '/students', label: 'Мои ученики', end: true },
      { to: '/groups', label: 'Мои группы' },
      { to: '/teacher/lessons', label: 'Уроки' },
      { to: '/teacher/settings', label: 'Настройки' },
      { to: '/students', label: 'Домашние задания', disabled: true },
      { to: '/students', label: 'Материалы', disabled: true },
      { to: '/students', label: 'Карточки', disabled: true },
      { to: '/students', label: 'Прогресс', disabled: true },
      { to: '/students', label: 'Сообщения', disabled: true },
      { to: '/students', label: 'Уведомления', disabled: true },
    ];

    return (
      <div
        className="app teacher-shell"
        data-variant="staff"
        style={{ gridTemplateColumns: teacherMenuOpen ? undefined : 'minmax(0, 1fr)' }}
      >
        {teacherMenuOpen && (
          <aside className="teacher-sidebar">
            <div className="teacher-brand">
              <div className="teacher-brand__mark">M</div>
              <div className="teacher-brand__text"><span>MindCrafti</span> School</div>
              <button
                type="button"
                aria-label="Скрыть меню"
                onClick={() => setTeacherMenuOpen(false)}
                style={{
                  marginLeft: 'auto',
                  border: 0,
                  background: 'transparent',
                  color: '#59657d',
                  fontSize: 14,
                  fontWeight: 650,
                  cursor: 'pointer',
                  padding: '8px 4px',
                }}
              >
                Скрыть
              </button>
            </div>

            <nav className="teacher-sidebar__nav">
              {teacherLinks.map((link, index) => link.disabled ? (
                <div key={`${link.label}-${index}`} className="teacher-nav-item teacher-nav-item--disabled" title="Раздел появится позже">
                  <span>{link.label}</span>
                </div>
              ) : (
                <NavLink key={link.to} to={link.to} end={link.end} className="teacher-nav-item">
                  <span>{link.label}</span>
                </NavLink>
              ))}
            </nav>

            <div className="teacher-help">
              <div>
                <strong>Нужна помощь?</strong>
                <span>Свяжитесь с поддержкой</span>
              </div>
            </div>
          </aside>
        )}

        <section
          className="teacher-workspace"
          style={{ borderRadius: teacherMenuOpen ? undefined : 28 }}
        >
          <header className="teacher-topbar">
            <button
              type="button"
              aria-expanded={teacherMenuOpen}
              aria-label={teacherMenuOpen ? 'Скрыть меню' : 'Показать меню'}
              onClick={() => setTeacherMenuOpen((current) => !current)}
              style={{
                minHeight: 40,
                padding: '0 14px',
                borderRadius: 10,
                border: '1px solid #e1e5ec',
                background: teacherMenuOpen ? '#fff' : '#fff3ec',
                color: teacherMenuOpen ? '#273653' : '#ff5b00',
                fontSize: 14,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {teacherMenuOpen ? 'Скрыть меню' : 'Меню'}
            </button>
            <div className="teacher-topbar__right">
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
                  {t('common.logout')}
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
      : isAdmin
        ? [
            { to: '/teachers', label: language === 'DE' ? 'Lehrer' : 'Учителя' },
            { to: '/admin/lessons', label: language === 'DE' ? 'Unterricht' : 'Уроки школы' },
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