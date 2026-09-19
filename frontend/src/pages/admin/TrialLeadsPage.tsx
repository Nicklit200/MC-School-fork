import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { trialLeadsApi, type SiteVisit, type TrialLead, type TrialLeadStatus } from '../../api/trialLeads';
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
const AUTO_REFRESH_MS = 10_000;

export function TrialLeadsPage() {
  const [leads, setLeads] = useState<TrialLead[]>([]);
  const [visits, setVisits] = useState<SiteVisit[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [savingId, setSavingId] = useState('');
  const [deletingId, setDeletingId] = useState('');

  async function load({ silent = false }: { silent?: boolean } = {}) {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const [nextLeads, nextVisits] = await Promise.all([
        trialLeadsApi.list(),
        trialLeadsApi.listVisits().catch(() => []),
      ]);
      setLeads(nextLeads);
      setVisits(nextVisits);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить заявки');
    } finally {
      if (silent) setRefreshing(false);
      else setLoading(false);
    }
  }

  useEffect(() => {
    void load();

    const refresh = () => {
      if (document.visibilityState === 'visible') void load({ silent: true });
    };

    const intervalId = window.setInterval(refresh, AUTO_REFRESH_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    const onFocus = () => refresh();

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onFocus);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  const summary = useMemo(() => ({
    total: leads.length,
    newCount: leads.filter((lead) => !['CALENDAR_OPENED', 'BOOKED', 'CONTACTED', 'CONTRACT', 'DECLINED'].includes(lead.status)).length,
    calendar: leads.filter((lead) => lead.status === 'CALENDAR_OPENED').length,
    booked: leads.filter((lead) => lead.status === 'BOOKED').length,
  }), [leads]);

  async function changeStatus(lead: TrialLead, status: TrialLeadStatus) {
    if (lead.status === status) return;
    setSavingId(lead.id);
    setError('');
    try {
      await trialLeadsApi.setStatus(lead.id, status);
      setLeads((current) => current.map((item) => item.id === lead.id ? { ...item, status } : item));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось изменить статус');
    } finally {
      setSavingId('');
    }
  }

  async function deleteLead(lead: TrialLead) {
    const confirmed = window.confirm(`Удалить заявку ${lead.phone}?\n\nЭто действие нельзя отменить.`);
    if (!confirmed) return;

    setDeletingId(lead.id);
    setError('');
    try {
      await trialLeadsApi.delete(lead.id);
      setLeads((current) => current.filter((item) => item.id !== lead.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось удалить заявку');
    } finally {
      setDeletingId('');
    }
  }

  return (
    <div className="trial-leads-page">
      <div className="trial-leads-heading">
        <div>
          <p className="trial-leads-eyebrow">Продажи</p>
          <h1>Заявки и попытки на сайте</h1>
          <p>Сохраняем каждый уникальный заход: устройство, систему, браузер и этап воронки. Если человек оставил номер, попытка связывается с заявкой.</p>
        </div>
        <div className="trial-lead-actions">
          <Link className="btn btn--secondary" to="/admin/settings">Уведомления</Link>
          <button type="button" className="btn" onClick={() => void load({ silent: true })} disabled={loading || refreshing}>{refreshing ? 'Обновляем…' : 'Обновить'}</button>
        </div>
      </div>

      <div className="trial-leads-summary">
        <div><span>Всего заявок</span><strong>{summary.total}</strong></div>
        <div><span>В процессе</span><strong>{summary.newCount}</strong></div>
        <div><span>Открыли календарь</span><strong>{summary.calendar}</strong></div>
        <div><span>Забронировано</span><strong>{summary.booked}</strong></div>
      </div>

      {error && <div className="trial-leads-error">{error}</div>}

      {!loading && <section className="site-visits-panel">
        <div className="site-visits-heading">
          <div>
            <h2>Попытки посетителей</h2>
            <p>До 200 последних уникальных заходов. Видно, с какого телефона или компьютера зашли, до какого шага дошли и оставили ли номер.</p>
          </div>
          <span>{visits.length}</span>
        </div>

        {visits.length === 0 && <div className="trial-leads-empty">Новые посещения начнут появляться после обновления сайта.</div>}

        {visits.length > 0 && <div className="site-visits-list">
          {visits.map((visit) => {
            const device = [visit.deviceModel || visit.deviceType, joinVersion(visit.osName, visit.osVersion)].filter(Boolean).join(' · ');
            const browser = joinVersion(visit.browserName, visit.browserVersion);
            const converted = Boolean(visit.leadStatus);
            return <article className="site-visit-card" key={visit.id}>
              <div className="site-visit-card__top">
                <div>
                  <strong>{device || 'Неизвестное устройство'}</strong>
                  <span className={converted ? 'site-visit-result site-visit-result--ok' : 'site-visit-result'}>
                    {visit.leadStatus ? STATUS_LABELS[visit.leadStatus] : visitStageLabel(visit.funnelStage)}
                  </span>
                </div>
                <time>{formatDate(visit.createdAt)}</time>
              </div>

              <div className="site-visit-meta">
                <span><b>Устройство:</b> {device || '—'}</span>
                <span><b>Браузер:</b> {browser || '—'}</span>
                <span><b>Экран:</b> {visit.screenSize || '—'}</span>
                <span><b>Окно:</b> {visit.viewportSize || '—'}</span>
                <span><b>Язык:</b> {visit.language || '—'}</span>
                <span><b>Страница:</b> {visit.path || '/'}</span>
                <span><b>Источник:</b> {visit.source || visit.referrer || 'Прямой переход'}</span>
                <span><b>Класс:</b> {visit.grade || '—'}</span>
                <span><b>Проблема:</b> {visit.goal || '—'}</span>
                <span><b>Что важно:</b> {visit.priority || '—'}</span>
              </div>

              <div className="site-visit-phone">{visit.leadPhone ? <>Контактный номер: {visit.leadPhone}</> : <>Контактный номер: не оставил</>}</div>
            </article>;
          })}
        </div>}
      </section>}

      {loading && <div className="trial-leads-empty">Загружаем заявки…</div>}
      {!loading && leads.length === 0 && <div className="trial-leads-empty">Пока нет заявок.</div>}

      {!loading && leads.length > 0 && <div className="trial-leads-list">
        {leads.map((lead) => {
          const whatsapp = `https://wa.me/${lead.phone.replace(/\D/g, '')}`;
          const busy = savingId === lead.id || deletingId === lead.id;
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
                disabled={busy}
                onChange={(event) => void changeStatus(lead, event.target.value as TrialLeadStatus)}
                aria-label={`Статус заявки ${lead.phone}`}
              >
                {STATUS_OPTIONS.map((status) => <option value={status} key={status}>{STATUS_LABELS[status]}</option>)}
              </select>
              <button
                type="button"
                className="btn trial-lead-delete"
                disabled={busy}
                onClick={() => void deleteLead(lead)}
              >
                {deletingId === lead.id ? 'Удаляем…' : 'Удалить'}
              </button>
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

function visitStageLabel(stage?: string | null) {
  switch (stage) {
    case 'TRIAL_PAGE_LOADED': return 'Анкета открылась';
    case 'GRADE_OPTIONS_VISIBLE': return 'Видит выбор класса';
    case 'GRADE_TAP': return 'Нажал на класс';
    case 'GRADE_SELECTED': return 'Ответил: класс';
    case 'GOAL_SELECTED': return 'Ответил: проблема';
    case 'PRIORITY_SELECTED': return 'Ответил: что важно';
    case 'PHONE_STEP': return 'Дошёл до телефона';
    default: return 'Только открыл сайт';
  }
}

function joinVersion(name?: string | null, version?: string | null) {
  if (!name) return '';
  return version ? `${name} ${version}` : name;
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
