import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { CardSummary, DailyReviewHistoryItem, GroupLesson, Homework, StudentListItem } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';

export function StudentProfilePage() {
  const { studentId = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { language } = useI18n();
  const tr = (ru: string, de: string) => language === 'DE' ? de : ru;
  const base = `/students/${studentId}`;
  const overview = location.pathname.replace(/\/$/, '') === base;
  const [student, setStudent] = useState<StudentListItem | null>(null);
  const [homeworks, setHomeworks] = useState<Homework[]>([]);
  const [summary, setSummary] = useState<CardSummary | null>(null);
  const [history, setHistory] = useState<DailyReviewHistoryItem[]>([]);
  const [lessons, setLessons] = useState<GroupLesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    Promise.all([api.students.get(studentId), api.homeworks.listForStudent(studentId), api.cards.summaryForStudent(studentId), api.students.reviewHistory(studentId), api.lessons.groupLessons()])
      .then(([pupil, work, cards, reviews, events]) => {
        if (cancelled) return;
        setStudent(pupil); setHomeworks(work); setSummary(cards); setHistory(reviews);
        setLessons(events.filter(e => e.studentId === studentId || (e.participantStudentIds ?? []).includes(studentId)));
      }).catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [studentId, revision, overview]);
  const pdfs = homeworks.filter(h => h.hasWorksheet).sort((a, b) => b.startDate.localeCompare(a.startDate));
  const next = lessons.filter(e => new Date(e.startsAt).getTime() > Date.now()).sort((a,b) => a.startsAt.localeCompare(b.startsAt))[0];
  const tabs = [['', tr('Обзор', 'Übersicht')], ['lessons', tr('Уроки', 'Unterricht')], ['homeworks', tr('Домашние задания', 'Hausaufgaben')], ['cards', tr('Карточки', 'Karten')], ['month-plan', tr('План на месяц', 'Monatsplan')], ['drive', 'Google Drive']];
  const date = (value: string) => new Intl.DateTimeFormat(language === 'DE' ? 'de-DE' : 'ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Berlin' }).format(new Date(value.length === 10 ? `${value}T12:00:00` : value));
  return <div className="group-detail-dashboard">
    <Link className="group-detail-back" to="/students">← {tr('К ученикам', 'Schüler')}</Link>
    <div className="group-detail-heading"><div><h1>{student?.fullName ?? tr('Ученик', 'Schüler')}</h1><p>{tr('Логин', 'Login')}: {student?.username ?? '—'} · {tr('Родитель', 'Elternteil')}: {student?.parentFullName ?? '—'}</p></div><Link to={`${base}/lessons`} className="btn btn--secondary">{tr('История уроков', 'Unterrichtsverlauf')}</Link></div>
    {error && <div className="banner banner--error">{error} <button className="btn btn--secondary" onClick={() => setRevision(n => n + 1)}>{tr('Повторить', 'Erneut versuchen')}</button></div>}
    <div className="group-summary-grid">
      <button className="group-summary-card" onClick={() => navigate(`${base}/cards`)}><div className="group-summary-card__icon group-summary-card__icon--orange">▤</div><div><strong>{loading || error ? '—' : summary?.total ?? 0}</strong><span>{tr('карточек', 'Karten')}</span></div><small>{tr('Перейти к карточкам', 'Karten öffnen')} →</small></button>
      <button className="group-summary-card" onClick={() => navigate(`${base}/homeworks`)}><div className="group-summary-card__icon group-summary-card__icon--yellow">▤</div><div><strong>{loading || error ? '—' : pdfs.filter(h => !h.submitted).length}</strong><span>{tr('ДЗ ожидают сдачи', 'offene Hausaufgaben')}</span></div><small>{tr('Перейти к домашним заданиям', 'Hausaufgaben öffnen')} →</small></button>
      <div className="group-summary-card group-summary-card--lesson"><div className="group-summary-card__icon group-summary-card__icon--green">▣</div><div><span>{tr('Следующий урок', 'Nächster Unterricht')}</span><strong className="group-summary-card__lesson">{loading || error || !next ? '—' : date(next.startsAt)}</strong></div><small>{next && !loading && !error ? <Link to={`/teacher/lessons/${encodeURIComponent(next.eventId)}`}>{next.title} →</Link> : loading ? tr('Загрузка…', 'Laden…') : error ? '—' : tr('Ближайших уроков нет', 'Kein Unterricht geplant')}</small></div>
    </div>
    <nav className="group-detail-tabs" aria-label={tr('Разделы ученика', 'Schülerbereiche')}>
      {tabs.map(([path, label]) => { const url = `${base}${path ? `/${path}` : ''}`; const active = location.pathname.replace(/\/$/, '') === url; return <button key={path} type="button" className={active ? 'active' : ''} aria-current={active ? 'page' : undefined} onClick={() => navigate(url)}><span>{label}</span></button>; })}
    </nav>
    {overview ? loading ? <p className="muted">{tr('Загружаем данные ученика…', 'Laden…')}</p> : !error && <div className="group-overview-grid">
      <section className="group-overview-card"><div className="group-overview-card__header"><h2>{tr('Обзор домашних заданий', 'Hausaufgabenübersicht')}</h2><button className="group-refresh-btn" onClick={() => setRevision(n => n + 1)}>{tr('Обновить', 'Aktualisieren')}</button></div>
        {pdfs.length === 0 ? <p className="muted">{tr('Домашних заданий пока нет.', 'Keine Hausaufgaben.')}</p> : pdfs.slice(0, 7).map(h => <Link key={h.id} className="list-row" to={`/teacher/students/${studentId}/homeworks/${h.id}`} style={{ color: 'inherit', textDecoration: 'none', gap: 12 }}><span>{date(h.startDate)} · {h.worksheetFilename}</span><span aria-label={h.submitted ? tr('Сдано', 'Abgegeben') : tr('Не сдано', 'Offen')} className={`group-status-dot ${h.submitted ? 'is-done' : 'is-missed'}`}>{h.submitted ? '✓' : '×'}</span></Link>)}
        <Link className="btn btn--secondary group-show-all" to={`${base}/homeworks`}>{tr('Все домашние задания', 'Alle Hausaufgaben')} →</Link>
      </section>
      <section className="group-overview-card"><div className="group-overview-card__header"><h2>{tr('Обзор карточек', 'Kartenübersicht')}</h2></div>
        {history.length === 0 ? <p className="muted">{tr('Повторений пока нет.', 'Noch keine Wiederholungen.')}</p> : [...history].sort((a,b) => b.date.localeCompare(a.date)).slice(0,7).map(day => <div key={day.date} className="list-row"><span>{date(day.date)}</span><span>{day.completedCount}/{day.dueCount}</span><span className={`group-status-dot ${day.status === 'COMPLETED' ? 'is-done' : 'is-missed'}`}>{day.status === 'COMPLETED' ? '✓' : day.status === 'PARTIAL' ? '◐' : '×'}</span></div>)}
        <Link className="btn btn--secondary group-show-all" to={`${base}/cards`}>{tr('Все карточки и ответы', 'Alle Karten und Antworten')} →</Link>
      </section>
    </div> : <Outlet />}
  </div>;
}
