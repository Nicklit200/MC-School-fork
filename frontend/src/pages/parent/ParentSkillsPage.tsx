import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n/I18nContext';
import './parent-dashboard.css';

export function ParentSkillsPage() {
  const { language } = useI18n();
  const de = language === 'DE';
  return <div className="stack parent-dashboard">
    <header className="parent-dashboard__heading"><div><h1>{de ? 'Kompetenzkarte' : 'Карта навыков'}</h1><p className="muted">{de ? 'Fortschritt Ihres Kindes nach Themen' : 'Прогресс ребёнка по темам'}</p></div></header>
    <section className="panel parent-dashboard__skills">
      <span className="parent-dashboard__file-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4v16h16M8 16v-4m4 4V8m4 8v-6" /></svg></span>
      <h2>{de ? 'Die Kompetenzkarte wird vorbereitet' : 'Готовим карту навыков'}</h2>
      <p className="muted">{de ? 'Hier wird sichtbar, welche Themen Ihr Kind bereits beherrscht und was noch geübt werden sollte. Die Ergebnisse der Hausaufgaben finden Sie schon jetzt im Aufgabenbereich.' : 'Здесь будет видно, какие темы ребёнок уже освоил и что ещё нужно закрепить. Выполнение заданий уже можно посмотреть в разделе домашней работы.'}</p>
      <Link className="btn btn--secondary" to="/parent">{de ? 'Zu den Hausaufgaben' : 'Домашние задания'}</Link>
    </section>
  </div>;
}
