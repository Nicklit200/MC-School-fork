import { useEffect, useRef, useState, type ReactNode, type KeyboardEvent } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import type { User } from '../api/types';
import { useI18n } from '../i18n/I18nContext';
import { TeacherIcon, type TeacherIconName } from './TeacherIcon';

type Props = {
  children: ReactNode;
  user: User;
  isImpersonating: boolean;
  returningToAdmin: boolean;
  onReturnToAdmin: () => void;
  onLogout: () => void;
};

function Brand() {
  return <div className="teacher-brand">
    <img className="teacher-brand__logo" src="/brand/Mindcrafti_Logo_M_OFFICIAL.webp" alt="Mindcrafti School" />
    <div className="teacher-brand__text"><span>Mindcrafti</span><small>School</small></div>
  </div>;
}

export function TeacherShell({ children, user, isImpersonating, returningToAdmin, onReturnToAdmin, onLogout }: Props) {
  const { language, t } = useI18n();
  const de = language === 'DE';
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const moreButton = useRef<HTMLButtonElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const links: { to: string; label: string; icon: TeacherIconName; end?: boolean }[] = [
    { to: '/students', label: de ? 'Meine Schüler' : 'Мои ученики', icon: 'students' },
    { to: '/parents', label: de ? 'Eltern' : 'Родители', icon: 'parents' },
    { to: '/groups', label: de ? 'Meine Gruppen' : 'Мои группы', icon: 'groups' },
    { to: '/teacher/lessons', label: de ? 'Unterricht' : 'Уроки', icon: 'lessons' },
    ...(user.id === '14e3c7c1-1fc8-41bd-858a-6c20efdd957a' && import.meta.env.VITE_MINDCRAFTI_LIVEKIT_ENABLED === 'true'
      ? [{ to: '/teacher/online-classes', label: de ? 'Online-Unterricht' : 'Онлайн-уроки', icon: 'video' as const }] : []),
    { to: '/skills', label: de ? 'Kompetenzen' : 'Карта навыков', icon: 'skills' },
    { to: '/teacher/settings', label: de ? 'Einstellungen' : 'Настройки', icon: 'settings' },
  ];
  const mainLinks = [links[0], links[2], links[3]];
  const otherLinks = links.filter((link) => !mainLinks.includes(link));
  const otherActive = otherLinks.some((link) => location.pathname.startsWith(link.to));
  const nameInitials = user.fullName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'T';

  useEffect(() => { setMenuOpen(false); }, [location.pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    closeButton.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; moreButton.current?.focus(); };
  }, [menuOpen]);

  function handleSheetKeys(event: KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); setMenuOpen(false); }
    if (event.key !== 'Tab') return;
    const focusable = sheet.current?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)');
    if (!focusable?.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  return <div className="app teacher-shell" data-variant="staff">
    <a className="teacher-skip-link" href="#teacher-main">{de ? 'Zum Inhalt' : 'К содержимому'}</a>
    <aside className="teacher-sidebar">
      <Brand />
      <nav className="teacher-sidebar__nav" aria-label={de ? 'Hauptnavigation' : 'Основная навигация'}>
        {links.map((link) => <NavLink key={link.to} to={link.to} className="teacher-nav-item" title={link.label}>
          <TeacherIcon name={link.icon} /><span>{link.label}</span>
        </NavLink>)}
      </nav>
      <div className="teacher-account">
        <div className="teacher-profile__avatar">{nameInitials}</div>
        <div className="teacher-profile__text"><strong>{user.fullName}</strong><span>{de ? 'Lehrkraft' : 'Преподаватель'}</span></div>
        <button type="button" className="teacher-icon-button" title={t('common.logout')} aria-label={t('common.logout')} onClick={onLogout}><TeacherIcon name="logout" /></button>
      </div>
    </aside>
    <section className="teacher-workspace">
      {isImpersonating && <div className="teacher-impersonation">
        <span>{de ? 'Administratoransicht' : 'Просмотр администратором'} · {user.fullName}</span>
        <button type="button" className="btn btn--secondary" disabled={returningToAdmin} onClick={onReturnToAdmin}>
          {returningToAdmin ? (de ? 'Zurück…' : 'Возвращаемся…') : (de ? 'Zur Administration' : 'Вернуться в админку')}
        </button>
      </div>}
      <header className="teacher-topbar">
        <div className="teacher-breadcrumb">Mindcrafti <span>/</span> {de ? 'Lehrkraft' : 'Преподаватель'}</div>
        <div className="teacher-mobile-brand"><Brand /><span>{de ? 'Lehrkraft' : 'Преподаватель'}</span></div>
        <div className="teacher-topbar-avatar" title={user.fullName}>{nameInitials}</div>
      </header>
      <main id="teacher-main" tabIndex={-1} className="content teacher-content">{children}</main>
    </section>
    <nav className="teacher-mobile-nav" aria-label={de ? 'Mobile Navigation' : 'Мобильная навигация'}>
      {mainLinks.map((link) => <NavLink key={link.to} to={link.to}>
        <TeacherIcon name={link.icon} /><span>{link.icon === 'students' ? (de ? 'Schüler' : 'Ученики') : link.icon === 'groups' ? (de ? 'Gruppen' : 'Группы') : link.label}</span>
      </NavLink>)}
      <button type="button" ref={moreButton} className={menuOpen || otherActive ? 'active' : ''} aria-expanded={menuOpen} aria-controls="teacher-more-menu" aria-label={de ? 'Mehr Bereiche' : 'Показать меню'} onClick={() => setMenuOpen(true)}>
        <TeacherIcon name="more" /><span>{de ? 'Mehr' : 'Ещё'}</span>
      </button>
    </nav>
    {menuOpen && <div className="teacher-sheet-backdrop" onClick={() => setMenuOpen(false)}>
      <div id="teacher-more-menu" className="teacher-more-sheet" role="dialog" aria-modal="true" aria-labelledby="teacher-more-title" ref={sheet} onClick={(event) => event.stopPropagation()} onKeyDown={handleSheetKeys}>
        <div className="teacher-more-sheet__heading"><h2 id="teacher-more-title">{de ? 'Weitere Bereiche' : 'Разделы кабинета'}</h2><button type="button" ref={closeButton} className="teacher-icon-button" aria-label={de ? 'Menü schließen' : 'Закрыть меню'} onClick={() => setMenuOpen(false)}>×</button></div>
        <nav aria-label={de ? 'Weitere Bereiche' : 'Дополнительные разделы'}>
          {otherLinks.map((link) => <NavLink key={link.to} to={link.to} className="teacher-nav-item"><TeacherIcon name={link.icon} /><span>{link.label}</span></NavLink>)}
        </nav>
        <div className="teacher-more-sheet__account"><span>{user.fullName}</span><button type="button" className="btn btn--ghost" onClick={onLogout}>{t('common.logout')}</button></div>
      </div>
    </div>}
  </div>;
}
