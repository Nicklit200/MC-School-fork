import { useEffect, useMemo, useState } from 'react';
import { trialLeadsApi, type TrialLead, type TrialLeadStatus } from '../../api/trialLeads';
import '../../trial-leads.css';

const STATUS_LABELS: Record<TrialLeadStatus, string> = {
  NEW: 'Оставил телефон',
  GRADE_SELECTED: 'Ответил: класс',
  SCHOOL_SELECTED: 'Ответил: школа',
  SUBJECT_SELECTED: 'Ответил: предмет',
  GOAL_SELECTED: 'Ответил: задача',
  PRIORITY_SELECTED: 'Ответил: что важно',
  FORM_COMPLETED: 'Анкета заполнена',
  TEACHER_SELECTED: 'Выбран преподаватель',
  CALENDAR_OPENED: 'Открыл календарь',
  BOOKED: 'Забронирован',
  CONTACTED: 'Связались',
  CONTRACT: 'Контракт',
  DECLINED: 'Отказ',
};

const STATUS_OPTIONS = Object.keys(STATUS_LABELS) as TrialLeadStatus[];

export function TrialLeadsPage() {
  const [leads, setLeads] = useState<TrialLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingId, setSavingId] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      setLeads(await trialLeadsApi.list());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить заявки');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const summary = useMemo(() => ({
    total: leads.length,
    newCount: leads.filter((lead) => !['CALENDAR_OPENED', 'BOOKED', 'CONTACTED', 'CONTRACT', 'DECLINED'].includes(lead.status)).length,
    calendar: leads.filter((lead) => lead.status === 'CALENDAR_OPENED').length,
    booked: leads.filter((lead) => lead.status === 'BOOKED').length,
  }), [leads]);

  async function changeStatus(lead: TrialLead, status: TrialLeadStatus) {
    if (lead.status === status) return;
    setSavingId(lead.id);
    try {
      await trialLeadsApi.setStatus(lead.id, status);
      setLeads((current) => current.map((item) => item.id === lead.id ? { ...item, status } : item));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось изменить статус');
    } finally {
      setSavingId('');
    }
  }

  return (
    <div className="trial-leads-page">
      <div className="trial-leads-heading">
        <div>
          <p className="trial-leads-eyebrow">Продажи</p>
          <h1>Заявки на пробный урок</h1>
          <p>Телефон сохраняется до анкеты. Статус показывает последний этап, до которого человек дошёл.</p>
        </div>
        <button type="button" className="btn" onClick={() => void load()} disabled={loading}>Обновить</button>
      </div>

      <div className="trial-leads-summary">
        <div><span>Всего</span><strong>{summary.total}</strong></div>
        <div><span>В процессе</span><strong>{summary.newCount}</strong></div>
        <div><span>Открыли календарь</span><strong>{summary.calendar}</strong></div>
        <div><span>Забронировано</span><strong>{summary.booked}</strong></div>
      </div>

      {error && <div className="trial-leads-error">{error}</div>}
      {loading && <div className="trial-leads-empty">Загружаем заявки…</div>}
      {!loading && leads.length === 0 && <div className="trial-leads-empty">Пока нет заявок.</div>}

      {!loading && leads.length > 0 && <div className="trial-leads-list">
        {leads.map((lead) => {
          const whatsapp = `https://wa.me/${lead.phone.replace(/\D/g, '')}`;
          return <article className="trial-lead-card" key={lead.id}>
            <div className="trial-lead-card__top">
              <div>
                <a className="trial-lead-phone" href={whatsapp} target="_blank" rel="noreferrer">{lead.phone}</a>
                <span className={`trial-lead-status trial-lead-status--${lead.status.toLowerCase()}`}>{STATUS_LABELS[lead.status]}</span>
              </div>
              <time>{formatDate(lead.createdAt)}</time>
            </div>

            <div className="trial-lead-details">
              <Detail label="Класс" value={lead.grade} />
              <Detail label="Школа" value={lead.schoolType} />
              <Detail label="Предмет" value={lead.subject} />
              <Detail label="Преподаватель" value={lead.teacherName} />
              <Detail label="Главная задача" value={lead.goal} wide />
              <Detail label="Что важно" value={lead.priority} wide />
              <Detail label="Источник" value={lead.source || 'Прямой переход'} wide />
            </div>

            <div className="trial-lead-actions">
              <a className="btn btn--primary" href={whatsapp} target="_blank" rel="noreferrer">WhatsApp</a>
              <select
                value={lead.status}
                disabled={savingId === lead.id}
                onChange={(event) => void changeStatus(lead, event.target.value as TrialLeadStatus)}
                aria-label={`Статус заявки ${lead.phone}`}
              >
                {STATUS_OPTIONS.map((status) => <option value={status} key={status}>{STATUS_LABELS[status]}</option>)}
              </select>
            </div>
          </article>;
        })}
      </div>}
    </div>
  );
}

function Detail({ label, value, wide = false }: { label: string; value?: string | null; wide?: boolean }) {
  return <div className={wide ? 'trial-lead-detail trial-lead-detail--wide' : 'trial-lead-detail'}>
    <span>{label}</span>
    <strong>{value || '—'}</strong>
  </div>;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Berlin',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}
