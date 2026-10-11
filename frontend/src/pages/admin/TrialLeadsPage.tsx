import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { trialLeadsApi, type TrialLead, type TrialLeadStatus, type MetaContractConversion } from '../../api/trialLeads';
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
  NO_RESPONSE: 'Не ответили',
  DECLINED: 'Отказ',
};

const STATUS_OPTIONS = Object.keys(STATUS_LABELS) as TrialLeadStatus[];
const AUTO_REFRESH_MS = 10_000;

export function TrialLeadsPage() {
  const [leads, setLeads] = useState<TrialLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [savingId, setSavingId] = useState('');
  const [deletingId, setDeletingId] = useState('');
  const [metaContracts, setMetaContracts] = useState<MetaContractConversion[]>([]);
  const [metaEnabled, setMetaEnabled] = useState(false);
  const [metaSavingId, setMetaSavingId] = useState('');
  const [contractDates, setContractDates] = useState<Record<string,string>>({});
  const [confirmedBases, setConfirmedBases] = useState<Record<string,boolean>>({});
  const [metaMessages, setMetaMessages] = useState<Record<string,string>>({});


  async function load({ silent = false }: { silent?: boolean } = {}) {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      setLeads(await trialLeadsApi.list());
      try {
        const availability = await trialLeadsApi.metaStatus();
        setMetaEnabled(availability.enabled);
        setMetaContracts(await trialLeadsApi.listMetaContracts());
      } catch {
        setMetaEnabled(false);
      }
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
    inProgress: leads.filter((lead) => !['NO_RESPONSE', 'CONTRACT', 'DECLINED'].includes(lead.status)).length,
    noResponse: leads.filter((lead) => lead.status === 'NO_RESPONSE').length,
    calendar: leads.filter((lead) => lead.status === 'CALENDAR_OPENED').length,
    booked: leads.filter((lead) => lead.status === 'BOOKED').length,
    contracts: leads.filter((lead) => lead.status === 'CONTRACT').length,
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

  async function reportContract(lead: TrialLead) {
    const localDate = contractDates[lead.id];
    if (!localDate || !confirmedBases[lead.id]) {
      setMetaMessages(current => ({...current,[lead.id]:'Укажите фактическую дату и подтвердите правовое основание.'}));
      return;
    }
    const date = new Date(localDate);
    if (Number.isNaN(date.getTime())) {
      setMetaMessages(current => ({...current,[lead.id]:'Неверная дата договора.'}));
      return;
    }
    if (!window.confirm('Подтверждаете, что договор действительно подписан, и разрешена передача события в Meta?')) return;
    setMetaSavingId(lead.id);
    setMetaMessages(current => ({...current,[lead.id]:'Проверяем событие...'}));
    try {
      const result = await trialLeadsApi.reportSignedContract(lead.id,date.toISOString(),true);
      setMetaMessages(current => ({...current,[lead.id]:result.alreadySent
        ? 'Эта сделка уже передана в Meta.'
        : result.test ? 'Тестовое событие принято Meta.' : 'Событие договора принято Meta.'}));
      setMetaContracts(current => [...current.filter(item => item.leadId !== lead.id),
        {leadId:lead.id,eventName:'ContractSigned',occurredAt:date.toISOString(),status:result.test?'TEST_SENT':'SENT',sentAt:new Date().toISOString()}]);
    } catch(err) {
      setMetaMessages(current => ({...current,[lead.id]:err instanceof Error?err.message:'Не удалось передать договор в Meta.'}));
    } finally { setMetaSavingId(''); }
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
          <h1>Заявки на пробный урок</h1>
          <p>Здесь только люди, которые уже оставили номер. Анонимные заходы вынесены в отдельную вкладку «Попытки посетителей».</p>
        </div>
        <div className="trial-lead-actions">
          <Link className="btn btn--secondary" to="/admin/site-visits">Попытки посетителей</Link>
          <Link className="btn btn--secondary" to="/admin/settings">Уведомления</Link>
          <button type="button" className="btn" onClick={() => void load({ silent: true })} disabled={loading || refreshing}>{refreshing ? 'Обновляем…' : 'Обновить'}</button>
        </div>
      </div>

      <div className="trial-leads-summary">
        <div><span>Всего заявок</span><strong>{summary.total}</strong></div>
        <div><span>В процессе</span><strong>{summary.inProgress}</strong></div>
        <div><span>Не ответили</span><strong>{summary.noResponse}</strong></div>
        <div><span>Открыли календарь</span><strong>{summary.calendar}</strong></div>
        <div><span>Забронировано</span><strong>{summary.booked}</strong></div>
        <div><span>Контракты</span><strong>{summary.contracts}</strong></div>
      </div>

      {error && <div className="trial-leads-error">{error}</div>}
      {loading && <div className="trial-leads-empty">Загружаем заявки…</div>}
      {!loading && leads.length === 0 && <div className="trial-leads-empty">Пока нет заявок.</div>}

      {!loading && leads.length > 0 && <div className="trial-leads-list">
        {leads.map((lead) => {
          const whatsapp = `https://wa.me/${lead.phone.replace(/\D/g, '')}`;
          const busy = savingId === lead.id || deletingId === lead.id || metaSavingId === lead.id;
          const sentToMeta = metaContracts.some(x => x.leadId === lead.id && x.eventName === 'ContractSigned' && x.status === 'SENT');
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
              <Detail label="Источник" value={lead.source || 'Источник не передан'} wide />
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
            {lead.status === 'CONTRACT' && <div className="trial-meta-contract">
              <h3>Договор подписан — обратная связь для Meta</h3>
              {sentToMeta ? <p className="trial-meta-success">Договор уже передан в Meta. Повторно отправлять не нужно.</p> : <>
                <label>Фактическая дата и время подписания
                  <input type="datetime-local" value={contractDates[lead.id] || ''}
                    onChange={event=>setContractDates(current=>({...current,[lead.id]:event.target.value}))} />
                </label>
                <label className="trial-meta-consent">
                  <input type="checkbox" checked={confirmedBases[lead.id] || false}
                    onChange={event=>setConfirmedBases(current=>({...current,[lead.id]:event.target.checked}))} />
                  Подтверждаю документированное законное основание для передачи данных контакта родителя в Meta.
                </label>
                <button type="button" className="btn btn--primary"
                  disabled={busy || !metaEnabled || !contractDates[lead.id] || !confirmedBases[lead.id]}
                  onClick={()=>void reportContract(lead)}>
                    {metaSavingId===lead.id?'Отправляем…':'Передать подписанный договор в Meta'}
                </button>
                {!metaEnabled && <p className="trial-meta-note">Настройка Meta ещё не включена на сервере школы.</p>}
              </>}
              {metaMessages[lead.id] && <p className="trial-meta-note" role="status">{metaMessages[lead.id]}</p>}
              <p className="trial-meta-note">Указывайте реальную дату, не дату сегодняшней отправки. Meta принимает недавние события; уже состоявшиеся старые сделки не следует датировать заново.</p>
            </div>}
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
