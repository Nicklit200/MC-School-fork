import type { ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useI18n } from '../i18n/I18nContext';
import '../student-theme.css';

type IconName = 'home' | 'cards' | 'book' | 'calendar' | 'video' | 'skills' | 'settings' | 'logout';

function StudentIcon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    home: <path d="m3 10 9-7 9 7v10h-6v-7H9v7H3Z" />,
    cards: <><rect x="7" y="6" width="13" height="15" rx="2" /><path d="M16 3H5a2 2 0 0 0-2 2v12m8-6h5m-5 4h5" /></>,
    book: <path d="M12 5c-3-2-6-2-10-1v15c4-1 7-1 10 1 3-2 6-2 10-1V4c-4-1-7-1-10 1Zm0 0v15" />,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 11h18m-13 5h2m4 0h2" /></>,
    video: <><rect x="3" y="6" width="12" height="12" rx="2" /><path d="m15 10 6-3v10l-6-3Z" /></>,
    skills: <><circle cx="6" cy="6" r="3" /><circle cx="18" cy="6" r="3" /><circle cx="12" cy="18" r="3" /><path d="M9 6h6m-7.5 2.6 3 6.8m6-6.8-3 6.8" /></>,
    settings: <><path d="m9 3-1 3-3 1v3l-2 2 2 2v3l3 1 1 3h6l1-3 3-1v-3l2-2-2-2V7l-3-1-1-3Z" /><circle cx="12" cy="12" r="3" /></>,
    logout: <><path d="M9 3H4v18h5M10 12h11m-4-4 4 4-4 4" /></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

type Props = {
  name: string;
  children: ReactNode;
  variant?: 'student' | 'parent';
  isImpersonating: boolean;
  returningToAdmin: boolean;
  onlineClassesAvailable?: boolean;
  onReturnToAdmin: () => void;
  onLogout: () => void;
};

/** Visual shell only: access control, API calls and logout remain in Layout. */
export function StudentShell({ name, children, variant = 'student', isImpersonating, returningToAdmin, onlineClassesAvailable = false, onReturnToAdmin, onLogout }: Props) {
  const { t, language } = useI18n();
  const { pathname } = useLocation();
  const de = language === 'DE';
  const isParent = variant === 'parent';
  const homePath = isParent ? '/parent' : '/today';
  const settingsPath = isParent ? '/parent/settings' : '/settings';
  const links: { to: string; label: string; icon: IconName; active: boolean }[] = isParent ? [
    { to: '/parent', label: de ? 'Hausaufgaben' : 'Домашние задания', icon: 'book', active: pathname === '/parent' },
    { to: '/parent/skills', label: de ? 'Kompetenzkarte' : 'Карта навыков', icon: 'skills', active: pathname.startsWith('/parent/skills') },
    { to: '/parent/settings', label: t('nav.settings'), icon: 'settings', active: pathname.startsWith('/parent/settings') },
  ] : [
    { to: '/today', label: t('nav.today'), icon: 'home', active: pathname === '/today' },
    { to: '/my-cards', label: t('nav.myCards'), icon: 'cards', active: pathname.startsWith('/my-cards') || pathname.startsWith('/session/') },
    { to: '/student/homeworks', label: de ? 'Hausaufgaben' : 'Домашка', icon: 'book', active: pathname.startsWith('/student/homeworks') },
    { to: '/student/lessons', label: de ? 'Mein Unterricht' : 'Мои уроки', icon: 'calendar', active: pathname.startsWith('/student/lessons') || pathname.startsWith('/lesson-notebook/') || pathname.startsWith('/lesson-board/') },
    ...(onlineClassesAvailable ? [{ to: '/online-classes', label: t('nav.onlineClasses'), icon: 'video' as const, active: pathname.startsWith('/online-classes') }] : []),
    { to: '/settings', label: t('nav.settings'), icon: 'settings', active: pathname === '/settings' },
  ];
  const current = links.find(link => link.active)?.label ?? t('app.name');
  const initial = (name.trim().charAt(0) || 'M').toLocaleUpperCase();
  const brand = <><img src="/brand/Mindcrafti_Logo_M_OFFICIAL.webp" alt="Mindcrafti School" /><span>Mindcrafti<small>SCHOOL</small></span></>;

  return (
    <div className={`student-shell${isParent ? ' student-shell--parent' : ''}`} data-variant={variant}>
      <a className="student-shell__skip" href="#student-main">{de ? 'Zum Inhalt' : 'К содержимому'}</a>
      <aside className="student-shell__sidebar">
        <NavLink className="student-shell__brand" to={homePath}>{brand}</NavLink>
        <div className="student-shell__nav-label">{isParent ? (de ? 'ELTERNBEREICH' : 'КАБИНЕТ РОДИТЕЛЯ') : (de ? 'DEIN BEREICH' : 'ТВОЙ КАБИНЕТ')}</div>
        <nav className="student-shell__nav" aria-label={de ? 'Hauptnavigation' : 'Основная навигация'}>
          {links.map(link => <Link key={link.to} to={link.to} aria-label={link.label} title={link.label} aria-current={link.active ? 'page' : undefined}
            className={`student-shell__link${link.active ? ' is-active' : ''}`}>
            <StudentIcon name={link.icon} /><span>{link.label}</span>
          </Link>)}
        </nav>
        <div className="student-shell__account">
          <span className="student-shell__avatar">{initial}</span>
          <div><strong>{name}</strong><small>{isParent ? (de ? 'Elternkonto' : 'Родитель') : (de ? 'Schülerkonto' : 'Ученик')}</small></div>
          <button type="button" onClick={onLogout} aria-label={t('common.logout')} title={t('common.logout')}><StudentIcon name="logout" /></button>
        </div>
      </aside>
      <div className="student-shell__body">
        {isImpersonating && <div className="student-shell__admin">
          <span>{de ? 'Administratoransicht' : 'Просмотр администратором'} · {name}</span>
          <button className="btn btn--secondary" type="button" disabled={returningToAdmin} onClick={onReturnToAdmin}>
            {returningToAdmin ? (de ? 'Zurück…' : 'Возвращаемся…') : (de ? 'Zur Administration' : 'Вернуться в админку')}
          </button>
        </div>}
        <header className="student-shell__topbar">
          <NavLink className="student-shell__brand student-shell__mobile-brand" to={homePath}>{brand}</NavLink>
          <div className="student-shell__breadcrumb">Mindcrafti <span>/ {current}</span></div>
          <NavLink to={settingsPath} className="student-shell__avatar" aria-label={de ? 'Kontoeinstellungen öffnen' : 'Открыть настройки аккаунта'}>{initial}</NavLink>
        </header>
        <main className="content student-shell__main" id="student-main" tabIndex={-1}>{children}</main>
      </div>
    </div>
  );
}
