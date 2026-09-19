import { useEffect, useState } from 'react';
import { trialLeadsApi, type SiteVisit, type TrialLeadStatus } from '../../api/trialLeads';
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

const AUTO_REFRESH_MS = 10_000;

export function SiteVisitsPage() {
  const [visits, setVisits] = useState<SiteVisit[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  async function load({ silent = false }: { silent?: boolean } = {}) {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      setVisits(await trialLeadsApi.listVisits());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить попытки посетителей');
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

  return (
    <div className="trial-leads-page">
      <div className="trial-leads-heading">
        <div>
          <p className="trial-leads-eyebrow">Продажи</p>
          <h1>Попытки посетителей</h1>
          <p>Каждый уникальный заход на сайт: устройство, браузер, источник и последний этап воронки. Если человек оставил номер, он привязывается к попытке.</p>
        </div>
        <div className="trial-lead-actions">
          <button type="button" className="btn" onClick={() => void load({ silent: true })} disabled={loading || refreshing}>
            {refreshing ? 'Обновляем…' : 'Обновить'}
          </button>
        </div>
      </div>

      {error && <div className="trial-leads-error">{error}</div>}
      {loading && <div className="trial-leads-empty">Загружаем попытки…</div>}

      {!loading && <section className="site-visits-panel">
        <div className="site-visits-heading">
          <div>
            <h2>Последние посещения</h2>
            <p>До 200 последних уникальных сессий.</p>
          </div>
          <span>{visits.length}</span>
        </div>

        {visits.length === 0 && <div className="trial-leads-empty">Пока нет посещений.</div>}

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
                <span><b>Источник:</b> {visit.source || visit.referrer || 'Источник не передан'}</span>
                <span><b>Класс:</b> {visit.grade || '—'}</span>
                <span><b>Проблема:</b> {visit.goal || '—'}</span>
                <span><b>Что важно:</b> {visit.priority || '—'}</span>
                <span><b>Взаимодействие:</b> {visit.firstInteractionAt ? 'да' : 'нет'}</span>
                <span><b>Первое действие:</b> {visit.firstInteractionLabel || '—'}</span>
                <span><b>Скролл:</b> {visit.maxScrollPercent != null ? `${visit.maxScrollPercent}%` : '—'}</span>
                <span><b>На странице:</b> {visit.maxActiveSeconds != null ? `не менее ${visit.maxActiveSeconds} сек.` : '—'}</span>
                <span><b>Выбор класса показался:</b> {visit.gradeOptionsVisibleAt ? 'да' : visit.trialPageLoadedAt ? 'нет' : '—'}</span>
                <span><b>Последняя диагностика:</b> {diagnosticLabel(visit.diagnosticStage)}</span>
                {visit.clientError && <span><b>Ошибка JavaScript:</b> {visit.clientError}</span>}
              </div>

              <div className="site-visit-phone">
                {visit.leadPhone ? <>Контактный номер: {visit.leadPhone}</> : <>Контактный номер: не оставил</>}
              </div>
            </article>;
          })}
        </div>}
      </section>}
    </div>
  );
}

function visitStageLabel(stage?: string | null) {
  switch (stage) {
    case 'TRIAL_CTA_CLICK': return 'Нажал «Записаться»';
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

function diagnosticLabel(stage?: string | null) {
  switch (stage) {
    case 'FIRST_INTERACTION': return 'касался/нажимал';
    case 'SCROLLED': return 'скроллил';
    case 'ACTIVE': return 'оставался на странице';
    case 'PAGE_HIDDEN': return 'ушёл со страницы';
    case 'JS_ERROR': return 'ошибка JavaScript';
    case 'UNHANDLED_REJECTION': return 'ошибка Promise';
    default: return '—';
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
