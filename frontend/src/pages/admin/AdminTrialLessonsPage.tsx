import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminLessonsApi, type AdminTrialLesson } from '../../api/adminLessons';

export function AdminTrialLessonsPage() {
  const [items, setItems] = useState<AdminTrialLesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [teacherFilter, setTeacherFilter] = useState('all');
  const [onlyWithTranscript, setOnlyWithTranscript] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    adminLessonsApi.trialLessons()
      .then((result) => {
        if (!cancelled) setItems(result);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Не удалось загрузить пробные уроки');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const teachers = useMemo(() => {
    const map = new Map<string, string>();
    items.forEach((item) => map.set(item.teacherId, item.teacherName));
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], 'ru'));
  }, [items]);

  const filtered = useMemo(() => items.filter((item) => {
    if (teacherFilter !== 'all' && item.teacherId !== teacherFilter) return false;
    if (onlyWithTranscript && !item.hasTranscript) return false;
    return true;
  }), [items, teacherFilter, onlyWithTranscript]);

  const withTranscript = items.filter((item) => item.hasTranscript).length;

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h1 style={{ marginBottom: 6 }}>Пробные уроки</h1>
          <div className="muted">
            Все пробные занятия школы. Транскрипции сохраняются в конкретный урок и доступны администратору.
          </div>
        </div>
        <Link className="btn btn--ghost" to="/admin/lessons">Все уроки школы</Link>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, marginBottom: 16 }}>
        <section className="panel" style={{ padding: 16, margin: 0 }}>
          <div className="muted" style={{ fontSize: 12 }}>Всего пробных</div>
          <div style={{ fontSize: 30, fontWeight: 900, marginTop: 4 }}>{items.length}</div>
        </section>
        <section className="panel" style={{ padding: 16, margin: 0 }}>
          <div className="muted" style={{ fontSize: 12 }}>С транскрипцией</div>
          <div style={{ fontSize: 30, fontWeight: 900, marginTop: 4 }}>{withTranscript}</div>
        </section>
        <section className="panel" style={{ padding: 16, margin: 0 }}>
          <div className="muted" style={{ fontSize: 12 }}>Без транскрипции</div>
          <div style={{ fontSize: 30, fontWeight: 900, marginTop: 4 }}>{Math.max(0, items.length - withTranscript)}</div>
        </section>
      </div>

      <section className="panel" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <label className="field" style={{ margin: 0, minWidth: 260 }}>
            <span className="field__label">Преподаватель</span>
            <select className="select" value={teacherFilter} onChange={(e) => setTeacherFilter(e.target.value)}>
              <option value="all">Все преподаватели</option>
              {teachers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 20, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={onlyWithTranscript}
              onChange={(e) => setOnlyWithTranscript(e.target.checked)}
            />
            <span>Только с транскрипцией</span>
          </label>
        </div>
      </section>

      {error && <div className="banner banner--error" style={{ marginBottom: 14 }}>{error}</div>}
      {loading ? <p className="muted">Загрузка…</p> : filtered.length === 0 ? (
        <div className="panel" style={{ padding: 24 }}>
          <strong>Пробных уроков по этому фильтру нет.</strong>
        </div>
      ) : (
        <div className="stack" style={{ gap: 10 }}>
          {filtered.map((item) => (
            <article key={`${item.teacherId}:${item.eventId}`} className="panel" style={{ padding: 16, margin: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ minWidth: 260, flex: 1 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: 17 }}>{item.title || 'Пробный урок'}</strong>
                    <span
                      style={{
                        borderRadius: 999,
                        padding: '4px 8px',
                        fontSize: 12,
                        fontWeight: 800,
                        background: item.hasTranscript ? '#eaf8ef' : '#fff3ec',
                        color: item.hasTranscript ? '#24713b' : '#a44b14',
                      }}
                    >
                      {item.hasTranscript ? 'Транскрипция загружена' : 'Транскрипции нет'}
                    </span>
                  </div>
                  <div className="muted" style={{ marginTop: 5 }}>
                    {item.teacherName} · {item.startsAt ? formatDateTime(item.startsAt) : 'дата неизвестна'}
                  </div>
                  {item.transcriptFilename && (
                    <div className="muted" style={{ marginTop: 3, fontSize: 12 }}>{item.transcriptFilename}</div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <Link
                    className="btn"
                    to={`/admin/teachers/${item.teacherId}/lessons/${encodeURIComponent(item.eventId)}`}
                  >
                    Открыть пробный
                  </Link>
                  {item.calendarUrl && (
                    <a className="btn btn--ghost" href={item.calendarUrl} target="_blank" rel="noreferrer">Календарь</a>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Berlin',
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}
