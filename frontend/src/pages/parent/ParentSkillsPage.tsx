import { useEffect, useMemo, useState } from 'react';
import { parentApi, type ParentSkillsDashboard, type ParentSkillEvidence, type ParentSkillPractice } from '../../api/parent';
import { useI18n } from '../../i18n/I18nContext';
import './parent-dashboard.css';

type Language = 'RU' | 'DE';
const sourceNames: Record<string, { RU: string; DE: string }> = {
  LESSON: { RU: 'Урок', DE: 'Unterricht' },
  HOMEWORK: { RU: 'Домашняя работа', DE: 'Hausaufgabe' },
  TEST: { RU: 'Контрольная', DE: 'Test' },
  TEACHER_OBSERVATION: { RU: 'Оценка преподавателя', DE: 'Lehrerbeobachtung' },
};
const say = (language: Language, ru: string, de: string) => language === 'DE' ? de : ru;
const percent = (n: number | null | undefined) => n == null ? '—' : `${n}%`;
const schoolType = (s: string | null) => ({
  GYMNASIUM: 'Gymnasium', REALSCHULE: 'Realschule', MITTELSCHULE: 'Mittelschule',
  WIRTSCHAFTSSCHULE: 'Wirtschaftsschule', GESAMTSCHULE: 'Gesamtschule',
}[s ?? ''] ?? s ?? '');
const day = (v: string, language: Language) => new Intl.DateTimeFormat(language === 'DE' ? 'de-DE' : 'ru-RU', {
  day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Berlin',
}).format(new Date(v));

/** Every point is from persisted mastery history, not simulated chart data. */
function ProgressGraph({ data, language }: { data: ParentSkillsDashboard; language: Language }) {
  const points = data.trend;
  if (!points.length) return <div className="parent-progress__chart-empty">
    {say(language, 'Первые подтверждённые результаты появятся здесь после проверки работы.', 'Die ersten belegten Lernfortschritte erscheinen nach der Auswertung.')}
  </div>;
  const start = points[0].at;
  const series = [{ at: start, confirmedPercent: 0 }, ...points].map((p, i) => ({
    x: 48 + (i / Math.max(1, points.length)) * 665,
    y: 182 - (p.confirmedPercent / 100) * 145,
    value: p.confirmedPercent,
    at: p.at,
  }));
  const path = series.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  return <div className="parent-progress__graph">
    <svg viewBox="0 0 760 224" role="img" aria-label={say(language, 'График подтверждённого прогресса по классу', 'Diagramm des nachgewiesenen Lernfortschritts')} preserveAspectRatio="xMidYMid meet">
      {[0,25,50,75,100].map(n => <g key={n}>
        <line x1="48" x2="714" y1={182 - n*1.45} y2={182 - n*1.45} className="parent-progress__gridline"/>
        <text x="34" y={187 - n*1.45} textAnchor="end" className="parent-progress__axis">{n}%</text>
      </g>)}
      <path d={path} className="parent-progress__line" />
      {series.slice(1).map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={i === series.length - 2 ? 5 : 3.7}
        className="parent-progress__dot"><title>{`${day(p.at,language)}: ${p.value}%`}</title></circle>)}
      <text x="48" y="213" className="parent-progress__axis">{day(points[0].at,language)}</text>
      <text x="713" y="213" className="parent-progress__axis" textAnchor="end">{day(points[points.length-1].at,language)}</text>
    </svg>
  </div>;
}

function Evidence({ item, language }: { item: ParentSkillEvidence | ParentSkillPractice; language: Language }) {
  return <div className="parent-progress__proof">
    <div className="parent-progress__proof-top">
      <strong>{item.skillTitle}</strong>
      {item.changed && item.previous != null && item.current != null
        ? <span className="parent-progress__change">{item.previous}% → {item.current}%</span>
        : <span className="parent-progress__muted">{say(language, 'Наблюдение без изменения оценки', 'Beobachtung ohne Wertänderung')}</span>}
    </div>
    <p>{item.explanation}</p>
    {item.excerpt && <div className="parent-progress__source">
      <span>{say(language, 'На основании:', 'Nachweis:')}</span> {item.excerpt}
    </div>}
    {item.autonomy && <small className="parent-progress__muted">{{
      FIRST_TRY: say(language,'Самостоятельно с первого раза','Beim ersten Versuch'),
      INDEPENDENT: say(language,'Самостоятельно','Selbstständig'),
      HINTED: say(language,'С подсказкой','Mit Hinweis'),
      AFTER_EXPLANATION: say(language,'После объяснения','Nach Erklärung'),
      NOT_YET: say(language,'Пока не освоено','Noch nicht beherrscht'),
      UNKNOWN: say(language,'Самостоятельность не определена','Selbstständigkeit unbekannt'),
    }[item.autonomy] ?? ''}</small>}
  </div>;
}

function EventHistory({ data, language }: { data: ParentSkillsDashboard; language: Language }) {
  const events = useMemo(() => [
    ...data.lessons.map(x => ({ type: 'LESSON' as const, id: x.id, date: x.endedAt, title: x.title, lesson: x })),
    ...data.practice.filter(x => !x.cycleLessonId).map((x, i) => ({
      type: x.sourceType, id: `practice-${i}`, date: x.at,
      title: sourceNames[x.sourceType]?.[language] ?? sourceNames.HOMEWORK[language], practice: x,
    })),
  ].sort((a,b) => b.date.localeCompare(a.date)), [data, language]);
  const [open, setOpen] = useState<string | null>(null);
  if (!events.length) return <section className="panel parent-progress__empty" aria-label={say(language, 'История занятий', 'Unterrichtsverlauf')}>
    {say(language,'Здесь появятся уроки, домашние работы и их подтверждённые результаты.','Hier erscheinen Unterricht, Hausaufgaben und belegte Ergebnisse.')}
  </section>;
  return <div className="parent-progress__events">
    {events.map(event => {
      const cycleHomework = event.type === 'LESSON'
        ? data.practice.filter(x => x.cycleLessonId === event.id) : [];
      const details = event.type === 'LESSON' ? [...event.lesson.evidence, ...cycleHomework] : [event.practice];
      const changed = details.filter(item => item.changed).length;
      const active = open === event.id;
      return <article className="parent-progress__event" key={event.id}>
        <button type="button" className="parent-progress__event-button" aria-expanded={active}
          onClick={() => setOpen(active ? null : event.id)}>
          <span className="parent-progress__event-marker" aria-hidden="true">{event.type === 'LESSON' ? '●' : '◆'}</span>
          <span className="parent-progress__event-main">
            <strong>{event.title}</strong><small>{day(event.date,language)} · {sourceNames[event.type]?.[language] ?? event.type}</small>
          </span>
          <span className="parent-progress__event-count">{changed > 0 ? `${changed} ${say(language,'изм.','Änd.')}` :
            say(language,'Без изменений','Keine Änderung')}</span>
          <span className="parent-progress__chevron" aria-hidden="true">{active ? '⌃' : '⌄'}</span>
        </button>
        {active && <div className="parent-progress__event-details">
          {event.type === 'LESSON' && <section className="parent-progress__recap">
            <strong>{say(language,'Что проходили','Unterrichtsinhalte')}</strong>
            <p>{event.lesson.summary || say(language,
              'Краткий подтверждённый пересказ пока отсутствует. Данные урока не подменяются предположениями.',
              'Noch keine belegte Zusammenfassung. Fehlende Daten werden nicht erfunden.')}</p>
          </section>}
          {cycleHomework.length > 0 && <p className="parent-progress__muted">
            {say(language, 'Домашняя работа, заданная после предыдущего занятия и проверенная до этого урока:',
              'Hausaufgaben aus dem Zeitraum nach der vorigen und vor dieser Stunde:')}
          </p>}
          <div className="parent-progress__evidence-list">
            {details.length > 0
              ? details.map((x,i) => <Evidence key={`${x.skillId}-${i}`} item={x} language={language} />)
              : <p className="parent-progress__muted">{say(language,
                'Подтверждённых изменений навыков пока нет.', 'Noch keine belegten Kompetenzänderungen.')}</p>}
          </div>
        </div>}
      </article>;
    })}
  </div>;
}

export function ParentSkillsPage() {
  const { language } = useI18n();
  const [children, setChildren] = useState<{ studentId:string; studentName:string }[]>([]);
  const [selected, setSelected] = useState('');
  const [data, setData] = useState<ParentSkillsDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedTopic, setExpandedTopic] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    parentApi.children().then(items => {
      if (!live) return;
      setChildren(items.map(item => ({ studentId: item.studentId, studentName: item.studentName })));
      if (items.length) setSelected(items[0].studentId);
      else setLoading(false);
    }).catch(e => { if (live) { setError(String(e?.message ?? e)); setLoading(false); } });
    return () => { live = false; };
  }, []);
  useEffect(() => {
    if (!selected) return;
    let live = true;
    setLoading(true);setError('');setData(null);setExpandedTopic(null);
    parentApi.skills(selected).then(result => { if(live) setData(result); })
      .catch(e => { if(live) setError(String(e?.message ?? e)); })
      .finally(() => { if(live) setLoading(false); });
    return () => { live = false; };
  }, [selected]);

  return <div className="stack parent-dashboard parent-progress">
    <header className="parent-dashboard__heading">
      <div><h1>{say(language,'Карта навыков','Kompetenzkarte')}</h1>
        <p className="muted">{say(language,'Прогресс ребёнка по школьной программе с подтверждениями из уроков и домашних заданий.','Lernfortschritt aus Unterricht und Hausaufgaben mit nachvollziehbaren Belegen.')}</p>
      </div>
    </header>
    {children.length > 1 && <label className="parent-dashboard__child-picker">
      <span className="muted">{say(language,'Выберите ребёнка','Kind auswählen')}</span>
      <select className="input" value={selected} onChange={e=>setSelected(e.target.value)}>
        {children.map(x=><option key={x.studentId} value={x.studentId}>{x.studentName}</option>)}
      </select>
    </label>}
    {error && <div className="banner banner--error" role="alert">{error}</div>}
    {loading ? <p className="muted" role="status">{say(language,'Загружаем карту навыков…','Kompetenzkarte wird geladen…')}</p> :
      !selected ? <section className="panel parent-progress__empty">{say(language,'К этому аккаунту пока не привязан ученик.','Diesem Konto ist noch kein Kind zugeordnet.')}</section> :
      data && !data.boardId ? <section className="panel parent-progress__empty">
        {say(language,'Для выбранного класса пока нет однозначно определённой карты. Проверьте учебный профиль ребёнка.','Für diese Klasse ist noch kein eindeutiger Lernplan hinterlegt.')}
      </section> : data && <>
        <section className="parent-progress__hero panel">
          <div className="parent-progress__hero-info">
            <span className="parent-progress__eyebrow">{data.studentName} · {data.grade} {say(language,'класс','Klasse')} · {schoolType(data.schoolType)}</span>
            <h2>{say(language,'Освоение программы','Lernplan-Fortschritt')}</h2>
            <div className="parent-progress__hero-number">{percent(data.confirmedPercent)}</div>
            <p className="parent-progress__muted">{say(language,
              'Подтверждённая часть всей программы. Неоценённые темы не считаются освоенными.',
              'Nachgewiesener Anteil des gesamten Lernplans. Nicht geprüfte Themen gelten nicht als beherrscht.')}</p>
          </div>
          <div className="parent-progress__hero-facts">
            <div><strong>{data.assessedSkills} / {data.totalSkills}</strong>
              <span>{say(language,'Навыков проверено','Kompetenzen bewertet')}</span></div>
            <div><strong>{percent(data.assessedAveragePercent)}</strong>
              <span>{say(language,'Среднее по проверенным','Ø bewertete Kompetenzen')}</span></div>
          </div>
        </section>
        <section className="panel parent-progress__chart-panel">
          <div className="parent-progress__section-title"><h2>{say(language,'Как растут знания','Lernfortschritt im Zeitverlauf')}</h2>
            <span className="parent-progress__muted">{say(language,'Данные из истории навыков','Echte Verlaufsdaten')}</span></div>
          <ProgressGraph data={data} language={language} />
        </section>
        <section className="parent-progress__topics">
          <div className="parent-progress__section-title"><h2>{say(language,'Темы и навыки','Themen und Kompetenzen')}</h2>
            <span className="parent-progress__muted">{data.totalSkills} {say(language,'навыков','Kompetenzen')}</span></div>
          {data.topics.map(topic => {
            const expanded=expandedTopic===topic.id;
            return <div className="parent-progress__topic" key={topic.id}>
              <button type="button" className="parent-progress__topic-heading" aria-expanded={expanded}
                onClick={()=>setExpandedTopic(expanded?null:topic.id)}>
                <span className="parent-progress__topic-name"><strong>{topic.title}</strong>
                  <small>{topic.assessedSkills} / {topic.totalSkills} {say(language,'проверено','bewertet')}</small></span>
                <span className="parent-progress__topic-bar"><span style={{ width: `${topic.confirmedPercent}%` }}/></span>
                <strong className="parent-progress__topic-value">{topic.assessedSkills ? percent(topic.confirmedPercent) : '—'}</strong>
                <span className="parent-progress__chevron" aria-hidden="true">{expanded?'⌃':'⌄'}</span>
              </button>
              {expanded && <div className="parent-progress__skill-list">
                {data.skills.filter(s=>s.topicId===topic.id).map(skill=>
                  <div className="parent-progress__skill" key={skill.id}>
                    <div><strong>{skill.title}</strong>{skill.germanTitle && <small>{skill.germanTitle}</small>}</div>
                    <span className="parent-progress__skill-bar"><span style={{width:`${skill.mastery??0}%`}}/></span>
                    <strong>{percent(skill.mastery)}</strong>
                  </div>)}
              </div>}
            </div>;
          })}
        </section>
        <section className="parent-progress__history">
          <div className="parent-progress__section-title"><h2>{say(language,'История обучения','Lernverlauf')}</h2>
            <span className="parent-progress__muted">{say(language,'Уроки · Домашка · Контрольные','Unterricht · Hausaufgaben · Tests')}</span></div>
          <EventHistory key={data.studentId} data={data} language={language}/>
        </section>
        <p className="parent-progress__footnote">{say(language,
          'Проценты основаны на сохранённых проверках Mindcrafti. История изменений и доказательства показываются отдельно. Отсутствие оценки не означает отсутствие знаний.',
          'Werte stammen aus gespeicherten Prüfungen von Mindcrafti. Ohne Bewertung bedeutet nicht ohne Kenntnisse.')}</p>
      </>}
  </div>;
}
