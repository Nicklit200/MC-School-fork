import { useEffect, useState } from 'react';
import { parentApi } from '../../api/parent';
import type { ParentChildStatus } from '../../api/types';
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
        <h1>{language === 'DE' ? 'Mein Kind' : 'Мой ребёнок'}</h1>
        <p className="muted">
          {language === 'DE'
            ? 'Hier siehst du, ob die heutigen Aufgaben erledigt sind.'
            : 'Здесь видно, выполнены ли задания ребёнка на сегодня.'}
        </p>
      </div>

      {error && <div className="banner banner--error">{error}</div>}
      {loading ? <p className="muted">Загрузка…</p> : children.length === 0 ? (
        <div className="panel">Ребёнок пока не привязан к этому аккаунту.</div>
      ) : children.map((child) => (
        <div className="panel" key={child.studentId}>
          <h2 style={{ marginTop: 0 }}>{child.studentName}</h2>
          <div className="stack">
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
