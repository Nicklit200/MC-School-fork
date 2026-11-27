import { useEffect, useState } from 'react';
import { adminKolinUsageApi, type AdminKolinUsageLesson, type KolinPageUsageResponse } from '../../api/kolin';

const money = (value: number | null, complete: boolean) =>
  value == null ? 'Неизвестно' : (complete ? '' : '≥ ') + '$' + value.toFixed(4);
const lessonDate = (value: string) => new Date(value).toLocaleString('ru-RU', {
  timeZone: 'Europe/Berlin', dateStyle: 'short', timeStyle: 'short',
});
const keyFor = (row: AdminKolinUsageLesson) => row.classId + ':' + row.teacherId;
const cell = { padding: '8px 10px', textAlign: 'left' as const, verticalAlign: 'top' as const };

export function AdminKolinUsagePage() {
  const [days, setDays] = useState(30);
  const [refresh, setRefresh] = useState(0);
  const [lessons, setLessons] = useState<AdminKolinUsageLesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<AdminKolinUsageLesson>();
  const [detail, setDetail] = useState<KolinPageUsageResponse>();
  const [detailError, setDetailError] = useState(false);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(false); setLessons([]);
    adminKolinUsageApi.lessons(days).then(rows => {
      if (active) setLessons(rows);
    }).catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [days, refresh]);
  useEffect(() => {
    let active = true;
    setDetail(undefined); setDetailError(false);
    if (selected) adminKolinUsageApi.detail(selected.classId, selected.teacherId).then(data => {
      if (active) setDetail(data);
    }).catch(() => { if (active) setDetailError(true); });
    return () => { active = false; };
  }, [selected, refresh]);
  const groups = new Map<string, KolinPageUsageResponse['pages']>();
  for (const page of detail?.pages ?? []) {
    const pages = groups.get(page.studentId) ?? [];
    pages.push(page); groups.set(page.studentId, pages);
  }
  const total = (rows: { costUsd: number | null; costComplete: boolean }[]) => {
    const values = rows.map(row => row.costUsd).filter((value): value is number => value !== null);
    return money(values.length ? values.reduce((a,b) => a+b,0) : null, rows.every(row => row.costComplete));
  };
  return <div className="stack">
    <h1>Статистика Kolyn</h1>
    <p className="muted">Внутренний учёт проверок тетрадей. Только администрация. Не включает чат, домашние задания и другие функции. Неизвестная стоимость не считается нулевой.</p>
    <div className="row" style={{ alignItems:'center', flexWrap:'wrap', gap:12 }}>
      <label className="field">Период <select className="input" value={days} onChange={e=>{setDays(Number(e.target.value));setSelected(undefined);setDetail(undefined);}}>
        <option value={7}>7 дней</option><option value={30}>30 дней</option><option value={90}>90 дней</option><option value={365}>365 дней</option>
      </select></label>
      <button type="button" className="btn" onClick={()=>setRefresh(n=>n+1)}>Обновить</button>
    </div>
    {loading && <p>Загрузка…</p>}
    {error && <p role="alert">Не удалось загрузить статистику.</p>}
    {!loading && !error && !lessons.length && <p>За выбранный период нет учтённых проверок.</p>}
    {!loading && !error && lessons.length>0 && <>
      <div className="panel row" style={{ flexWrap:'wrap', gap:24 }}>
        <div><strong>{lessons.length}</strong><div className="muted">Уроков в таблице</div></div>
        <div><strong>{lessons.reduce((n,row)=>n+row.aiRequests,0)}</strong><div className="muted">Вызовы ИИ</div></div>
        <div><strong>{lessons.reduce((n,row)=>n+row.cacheHits,0)}</strong><div className="muted">Кэш</div></div>
        <div><strong>{total(lessons)}</strong><div className="muted">Учтённая стоимость</div></div>
      </div>
      <p className="muted">Последние 500 уроков с учтёнными проверками за выбранный период. Нажмите на урок для детализации.</p>
      <div className="panel" style={{overflowX:'auto'}}>
        <table style={{width:'100%',borderCollapse:'collapse'}}><thead><tr>
          {['Урок / преподаватель','Запросы','Ревизии','Вызовы ИИ','Ответы ИИ','Кэш','Токены','Стоимость'].map(label=><th key={label} style={cell}>{label}</th>)}
        </tr></thead><tbody>{lessons.map(row=><tr key={keyFor(row)}>
          <td style={cell}><button type="button" className="btn" aria-pressed={selected ? keyFor(selected)===keyFor(row) : false}
            onClick={()=>{setDetail(undefined);setSelected({...row});}}>{row.title} · {lessonDate(row.scheduledStartAt)}</button><div className="muted">{row.teacherName}</div></td>
          <td style={cell}>{row.checks}</td><td style={cell}>{row.uniqueRevisions}</td><td style={cell}>{row.aiRequests}</td>
          <td style={cell}>{row.aiResponses}</td><td style={cell}>{row.cacheHits}</td><td style={cell}>{row.inputTokens+row.outputTokens}</td>
          <td style={cell}>{money(row.costUsd,row.costComplete)}</td>
        </tr>)}</tbody></table>
      </div>
    </>}
    {selected && <section className="panel stack" aria-label="Детализация урока">
      <h2>{selected.title} · {selected.teacherName}</h2>
      {detailError ? <p role="alert">Не удалось загрузить детализацию.</p> : !detail ? <p>Загрузка…</p> : <>
        <p>Всего: {detail.totals.checks} запросов, {detail.totals.uniqueRevisions} ревизий, {detail.totals.aiRequests} вызовов ИИ, {detail.totals.aiResponses} ответов ИИ, {detail.totals.cacheHits} из кэша. Стоимость: {money(detail.totals.costUsd,detail.totals.costComplete)}.</p>
        {Array.from(groups.entries()).map(([id,pages])=><section key={id} className="stack">
          <h3>{pages[0].studentName} · {total(pages)}</h3>
          <p className="muted">Запросы: {pages.reduce((n,p)=>n+p.checks,0)} · Вызовы ИИ: {pages.reduce((n,p)=>n+p.aiRequests,0)} · Кэш: {pages.reduce((n,p)=>n+p.cacheHits,0)}</p>
          <div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse'}}><thead><tr>
            {['Лист','Запросы','Ревизии','Вызовы ИИ','Ответы ИИ','Кэш','Токены','Стоимость'].map(label=><th key={label} style={cell}>{label}</th>)}
          </tr></thead><tbody>{pages.map(page=><tr key={page.boardId+':'+page.pageNumber}>
            <td style={cell}>{page.pageNumber}</td><td style={cell}>{page.checks}</td><td style={cell}>{page.uniqueRevisions}</td>
            <td style={cell}>{page.aiRequests}</td><td style={cell}>{page.aiResponses}</td><td style={cell}>{page.cacheHits}</td>
            <td style={cell}>{page.inputTokens+page.outputTokens}</td><td style={cell}>{money(page.costUsd,page.costComplete)}</td>
          </tr>)}</tbody></table></div>
        </section>)}
      </>}
    </section>}
  </div>;
}
