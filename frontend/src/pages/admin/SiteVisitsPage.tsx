import { useEffect, useState } from 'react';
import { trialLeadsApi, type FunnelAnalytics, type SiteVisit, type TrialLeadStatus } from '../../api/trialLeads';
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
  const [analytics, setAnalytics] = useState<FunnelAnalytics | null>(null);
  const [rangeDays, setRangeDays] = useState(7);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  async function load({ silent = false }: { silent?: boolean } = {}) {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const { fromDate, toDate } = analyticsRange(rangeDays);
      const [visitsResult, analyticsResult] = await Promise.all([
        trialLeadsApi.listVisits(),
        trialLeadsApi.funnelAnalytics(fromDate, toDate, 50),
      ]);
      setVisits(visitsResult);
      setAnalytics(analyticsResult);
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
  }, [rangeDays]);

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

      <div className="funnel-range" aria-label="Период аналитики">
        {[1, 7, 30].map((days) => (
          <button
            key={days}
            type="button"
            className={rangeDays === days ? 'funnel-range__button funnel-range__button--active' : 'funnel-range__button'}
            onClick={() => setRangeDays(days)}
          >
            {days === 1 ? 'Сегодня' : days + ' дней'}
          </button>
        ))}
      </div>

      {error && <div className="trial-leads-error">{error}</div>}
      {loading && <div className="trial-leads-empty">Загружаем аналитику…</div>}

      {!loading && analytics && <FunnelOverview analytics={analytics} />}

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
                    {visit.leadStatus ? STATUS_LABELS[visit.leadStatus] : anonymousVisitLabel(visit)}
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
                <span><b>Страна:</b> {countryLabel(visit.countryCode)}</span>
                <span><b>Класс:</b> {visit.grade || '—'}</span>
                <span><b>Предмет:</b> {visit.subject || '—'}</span>
                <span><b>Проблема:</b> {visit.goal || '—'}</span>
                <span><b>Что важно:</b> {visit.priority || '—'}</span>
                <span><b>Взаимодействие:</b> {visit.firstInteractionAt ? 'да' : 'нет'}</span>
                <span><b>Первое действие:</b> {visit.firstInteractionLabel || '—'}</span>
                <span><b>Доскроллил до:</b> {visit.furthestSectionLabel || '—'}</span>
                <span><b>На странице:</b> {visit.maxActiveSeconds != null ? formatDuration(visit.maxActiveSeconds) : '—'}</span>
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

function FunnelOverview({ analytics }: { analytics: FunnelAnalytics }) {
  return (
    <>
      <section className="funnel-kpis">
        <Kpi label="Посещения" value={analytics.totals.visits} />
        <Kpi label="Оставили WhatsApp" value={analytics.totals.leads} hint={analytics.totals.leadConversionPct + '%'} />
        <Kpi label="Записались" value={analytics.totals.bookings} hint={analytics.totals.bookingConversionPct + '%'} />
        <Kpi label="Контракты" value={analytics.totals.contracts} hint={analytics.totals.contractConversionPct + '%'} />
        <Kpi label="Среднее активное время" value={analytics.totals.averageActiveMinutes != null ? analytics.totals.averageActiveMinutes + ' мин' : '—'} />
      </section>

      <section className="site-visits-panel">
        <div className="site-visits-heading">
          <div>
            <h2>Конверсия по шагам</h2>
            <p>{formatSimpleDate(analytics.fromDate)} – {formatSimpleDate(analytics.toDate)}. Видно, после какого шага люди уходят чаще всего.</p>
          </div>
        </div>
        <div className="funnel-table">
          <div className="funnel-table__row funnel-table__row--head">
            <span>Шаг</span><span>Людей</span><span>Конверсия</span><span>Ушло</span><span>Время</span>
          </div>
          {analytics.funnel.map((stage) => {
            const timing = analytics.stepTiming.find((item) => item.stage === stage.stage);
            return <div className="funnel-table__row" key={stage.stage}>
              <strong>{stage.label}</strong>
              <span>{stage.sessions}</span>
              <span>{stage.conversionFromPreviousPct}%</span>
              <span>{stage.dropOffFromPrevious}</span>
              <span>{timing?.averageMinutesToNext != null ? timing.averageMinutesToNext + ' мин' : '—'}</span>
            </div>;
          })}
        </div>
      </section>

      <section className="site-visits-panel">
        <div className="site-visits-heading">
          <div>
            <h2>Источники рекламы</h2>
            <p>Какие источники дают не только клики, но и WhatsApp и записи.</p>
          </div>
        </div>
        {analytics.sources.length === 0 ? <div className="trial-leads-empty">За этот период источников пока нет.</div> :
          <div className="funnel-source-list">
            {analytics.sources.map((source) => (
              <div className="funnel-source" key={source.source}>
                <strong>{source.source}</strong>
                <span>{source.visits} визитов</span>
                <span>{source.leads} WhatsApp · {source.leadConversionPct}%</span>
                <span>{source.bookings} записей</span>
              </div>
            ))}
          </div>}
      </section>

      <section className="site-visits-panel">
        <div className="site-visits-heading">
          <div>
            <h2>Страны</h2>
            <p>Приблизительная страна по сети посетителя. VPN и iCloud Private Relay могут искажать результат.</p>
          </div>
        </div>
        {analytics.countries.length === 0 ? <div className="trial-leads-empty">За этот период стран пока нет.</div> :
          <div className="funnel-source-list">
            {analytics.countries.map((country) => (
              <div className="funnel-source" key={country.countryCode}>
                <strong>{countryLabel(country.countryCode)}</strong>
                <span>{country.visits} визитов</span>
                <span>{country.leads} WhatsApp · {country.leadConversionPct}%</span>
                <span>{country.bookings} записей</span>
              </div>
            ))}
          </div>}
      </section>
    </>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return <div className="funnel-kpi">
    <span>{label}</span>
    <strong>{value}</strong>
    {hint && <small>{hint} от визитов</small>}
  </div>;
}

function analyticsRange(days: number) {
  const now = new Date();
  const berlinToday = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const end = new Date(berlinToday + 'T12:00:00Z');
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - Math.max(0, days - 1));
  return { fromDate: start.toISOString().slice(0, 10), toDate: berlinToday };
}

function formatDuration(seconds: number) {
  if (seconds < 60) return seconds + ' сек.';
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? minutes + ' мин ' + rest + ' сек' : minutes + ' мин';
}

function formatSimpleDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
  }).format(new Date(value + 'T12:00:00Z'));
}

function anonymousVisitLabel(visit: SiteVisit) {
  if (visit.priority) return 'Анкета заполнена · телефон не оставил';
  if (visit.funnelStage === 'PHONE_STEP') return 'Дошёл до телефона · не оставил';
  if (visit.goal) return 'Заполнил класс и проблему';
  if (visit.grade) return 'Выбрал класс';
  return visitStageLabel(visit.funnelStage);
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
    case 'SECTION_REACHED': return 'дошёл до раздела';
    case 'PAGE_END': return 'дошёл до конца страницы';
    case 'ACTIVE': return 'оставался на странице';
    case 'PAGE_HIDDEN': return 'ушёл со страницы';
    case 'JS_ERROR': return 'ошибка JavaScript';
    case 'UNHANDLED_REJECTION': return 'ошибка Promise';
    default: return '—';
  }
}

function countryLabel(code?: string | null) {
  if (!code || code === 'UNKNOWN') return 'Не определена';
  const normalized = code.toUpperCase();
  let name = normalized;
  try {
    name = new Intl.DisplayNames(['ru'], { type: 'region' }).of(normalized) || normalized;
  } catch {
    name = normalized;
  }
  const flag = /^[A-Z]{2}$/.test(normalized)
    ? String.fromCodePoint(...normalized.split('').map((char) => 127397 + char.charCodeAt(0)))
    : '';
  return flag ? flag + ' ' + name : name;
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
