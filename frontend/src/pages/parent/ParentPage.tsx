import { useEffect, useState } from 'react';
import { parentApi } from '../../api/parent';
import type { ParentChildStatus, ParentHomeworkStatus } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';

export function ParentPage() {
  const { language } = useI18n();
  const [children, setChildren] = useState<ParentChildStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    parentApi.children()
      .then(setChildren)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="stack">
      <div>
        <h1>{language === 'DE' ? 'Meine Kinder' : 'Мои дети'}</h1>
        <p className="muted">
          {language === 'DE'
            ? 'Hier siehst du den aktuellen Stand und ob Hausaufgaben rechtzeitig abgegeben wurden.'
            : 'Здесь видно, что выполнено сегодня и сдавалась ли домашка вовремя.'}
        </p>
      </div>

      {error && <div className="banner banner--error">{error}</div>}
      {loading ? <p className="muted">Загрузка…</p> : children.length === 0 ? (
        <div className="panel">Ребёнок пока не привязан к этому аккаунту.</div>
      ) : children.map((child) => (
        <div className="panel stack" key={child.studentId}>
          <h2 style={{ marginTop: 0 }}>{child.studentName}</h2>
          <ParentStatusRow
            label={language === 'DE' ? 'Hausaufgabe heute' : 'Домашка сегодня'}
            status={child.homeworkAssignedToday === 0 ? 'none' : child.homeworkOpenToday === 0 ? 'done' : 'pending'}
            language={language}
          />
          <ParentStatusRow
            label={language === 'DE' ? 'Karten heute' : 'Карточки сегодня'}
            status={child.cardsDueToday === 0 ? 'done' : 'pending'}
            language={language}
          />

          <div>
            <h3 style={{ marginBottom: 8 }}>{language === 'DE' ? 'Hausaufgaben-Verlauf' : 'История домашки'}</h3>
            {child.homeworks.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>{language === 'DE' ? 'Noch keine PDF-Hausaufgaben.' : 'Домашек пока нет.'}</p>
            ) : (
              <div className="history-list">
                {child.homeworks.map((homework) => (
                  <div className="history-row" key={homework.homeworkId}>
                    <span>{formatDate(homework.startDate, language)}</span>
                    <span>{homework.filename ?? (language === 'DE' ? 'PDF-Hausaufgabe' : 'Домашка в PDF')}</span>
                    <span className={`pill ${statusClass(homework)}`}>{statusText(homework, language)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function ParentStatusRow({ label, status, language }: { label: string; status: 'done' | 'pending' | 'none'; language: 'RU' | 'DE' }) {
  const icon = status === 'done' ? '✓' : status === 'pending' ? '✕' : '—';
  const text = status === 'done'
    ? (language === 'DE' ? 'erledigt' : 'сделано')
    : status === 'pending'
      ? (language === 'DE' ? 'noch offen' : 'ещё не сделано')
      : (language === 'DE' ? 'nicht aufgegeben' : 'не задано');
  return (
    <div className={`teacher-today-status teacher-today-status--${status}`}>
      <span className="teacher-today-status__icon">{icon}</span>
      <strong>{label}</strong>
      <span className="muted">{text}</span>
    </div>
  );
}

function statusClass(homework: ParentHomeworkStatus) {
  if (homework.submittedLate) return 'pill--danger';
  if (homework.overdue) return 'pill--danger';
  if (homework.submitted) return 'pill--learned';
  return 'pill--pending';
}

function statusText(homework: ParentHomeworkStatus, language: 'RU' | 'DE') {
  if (homework.submittedLate) {
    return language === 'DE'
      ? `Verspätet abgegeben · ${formatDateTime(homework.submittedAt, language)}`
      : `Сдано с опозданием · ${formatDateTime(homework.submittedAt, language)}`;
  }
  if (homework.overdue) return language === 'DE' ? 'Überfällig' : 'Просрочено';
  if (homework.submitted) {
    return language === 'DE'
      ? `Rechtzeitig abgegeben · ${formatDateTime(homework.submittedAt, language)}`
      : `Сдано вовремя · ${formatDateTime(homework.submittedAt, language)}`;
  }
  return language === 'DE' ? 'Heute noch offen' : 'Сегодня ещё не сдано';
}

function formatDate(date: string, language: 'RU' | 'DE') {
  return new Intl.DateTimeFormat(language === 'DE' ? 'de-DE' : 'ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(new Date(`${date}T00:00:00`));
}

function formatDateTime(value: string | null, language: 'RU' | 'DE') {
  if (!value) return '—';
  return new Intl.DateTimeFormat(language === 'DE' ? 'de-DE' : 'ru-RU', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    timeZone: 'Europe/Berlin',
  }).format(new Date(value));
}
