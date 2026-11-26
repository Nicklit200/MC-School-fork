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

/** One selectable point for each actual finished class. The backend owns all percentages. */
function ProgressGraph({ data, language, selectedId, onSelect }: {
  data: ParentSkillsDashboard; language: Language;
  selectedId: string | null; onSelect: (lessonId: string) => void;
}) {
  const lessons = data.lessonProgress ?? [];
  if (!lessons.length) return <div className="parent-progress__chart-empty">
    {say(language, 'Завершённые уроки появятся на графике после проведения занятий.',
      'Abgeschlossene Unterrichtsstunden erscheinen nach dem Unterricht.')}
  </div>;
  const width = Math.max(760, (lessons.length - 1) * 100 + 112);
  const left = 54;
  const right = width - 43;
  const y = (value: number) => 182 - Math.max(0, Math.min(100, value)) * 1.45;
  const items = lessons.map((lesson, i) => ({
    ...lesson, x: lessons.length === 1 ? (left + right) / 2 : left + i * (right-left)/(lessons.length-1),
    y: lesson.confirmedPercent == null ? 182 : y(lesson.confirmedPercent),
  }));
  // Do not draw an invented zero baseline for lessons with no assessed work.
  let path = '';
  let drawing = false;
  items.forEach(item => {
    if (item.confirmedPercent == null) { drawing = false; return; }
    path += `${drawing ? 'L' : 'M'}${item.x.toFixed(1)},${item.y.toFixed(1)} `;
    drawing = true;
  });
  const select = (id: string) => onSelect(id);
  return <div className="parent-progress__graph" role="region"
    aria-label={say(language, 'Выберите точку урока на графике', 'Unterrichtspunkt im Diagramm wählen')}>
    <svg viewBox={`0 0 ${width} 230`} style={{ width, minWidth: '100%', maxWidth: 'none' }}
      aria-label={say(language, 'История прогресса по урокам', 'Lernfortschritt nach Unterricht')}
      role="img">
      {[0,25,50,75,100].map(n => <g key={n}>
        <line x1={left} x2={right} y1={y(n)} y2={y(n)} className="parent-progress__gridline"/>
        <text x="40" y={y(n)+5} textAnchor="end" className="parent-progress__axis">{n}%</text>
      </g>)}
      {path && <path d={path} className="parent-progress__line"/>}
      {items.map((point) => {
        const chosen = selectedId === point.lessonId;
        const description = `${point.lessonTitle}, ${day(point.endedAt, language)}, ${point.confirmedPercent == null
          ? say(language, 'нет оценки', 'keine Bewertung') : percent(point.confirmedPercent)}`;
        return <g key={point.lessonId} role="button" tabIndex={0} aria-label={description}
          aria-pressed={chosen} className={`parent-progress__graph-point ${chosen ? 'parent-progress__graph-point--active' : ''}`}
          onClick={() => select(point.lessonId)}
          onKeyDown={event => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault(); select(point.lessonId);
            }
          }}>
          {chosen && <line x1={point.x} x2={point.x} y1="36" y2="185"
            className="parent-progress__selected-guide"/>}
          <circle cx={point.x} cy={point.y} r="17" className="parent-progress__hit-target"/>
          <circle cx={point.x} cy={point.y} r={chosen ? 7 : 5.5}
            className={point.confirmedPercent == null
              ? 'parent-progress__dot parent-progress__dot--unassessed'
              : 'parent-progress__dot'}/>
          <text className={`parent-progress__point-date ${chosen ? 'parent-progress__point-date--active' : ''}`}
            x={point.x} y="213" textAnchor="middle">
            {new Intl.DateTimeFormat(language === 'DE' ? 'de-DE' : 'ru-RU',
              {day:'2-digit',month:'2-digit',timeZone:'Europe/Berlin'}).format(new Date(point.endedAt))}
          </text>
          <title>{description}</title>
        </g>;
      })}
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

/** The selected graph point expands the exact historical lesson below the chart. */
function SelectedLessonDetails({ data, language, lessonId }: {
  data: ParentSkillsDashboard; language: Language; lessonId: string | null;
}) {
  if (!lessonId) return <p className="parent-progress__muted">
    {say(language, 'Нажмите на дату или точку урока, чтобы увидеть подробности.',
      'Klicken Sie auf einen Unterrichtspunkt, um Details zu sehen.')}
  </p>;
  const lesson = data.lessons.find(item => item.id === lessonId);
  if (!lesson) return <p className="parent-progress__muted">
    {say(language, 'Детали урока пока недоступны.', 'Unterrichtsdetails sind noch nicht verfügbar.')}
  </p>;
  const homework = data.practice.filter(item => item.cycleLessonId === lessonId);
  const changes = [...lesson.evidence, ...homework];
  const point = data.lessonProgress?.find(item => item.lessonId === lessonId);
  return <section className="parent-progress__selected-lesson" aria-live="polite"
    aria-label={say(language, 'Подробности выбранного урока', 'Ausgewählte Unterrichtsdetails')}>
    <div className="parent-progress__selected-heading">
      <div><small className="parent-progress__muted">{day(lesson.endedAt, language)}</small>
        <h3>{lesson.title}</h3></div>
      <strong className="parent-progress__selected-score">
        {point?.confirmedPercent == null ? say(language, 'Не оценено', 'Nicht bewertet') : percent(point.confirmedPercent)}
      </strong>
    </div>
    <div className="parent-progress__recap">
      <strong>{say(language, 'Что проходили', 'Unterrichtsinhalte')}</strong>
      <p>{lesson.summary || say(language,
        'Краткий пересказ этого занятия пока не сохранён.',
        'Für diese Stunde wurde noch keine Zusammenfassung gespeichert.')}</p>
    </div>
    <div className="parent-progress__section-title">
      <h3>{say(language, 'Изменения навыков', 'Kompetenzänderungen')}</h3>
      <span className="parent-progress__muted">
        {changes.filter(item=>item.changed).length} {say(language, 'подтверждённых изменений', 'bestätigte Änderungen')}
      </span>
    </div>
    {lesson.evidence.length > 0
      ? lesson.evidence.map((item,i) => <Evidence key={`lesson-${i}`} item={item} language={language}/>)
      : <p className="parent-progress__muted">
        {say(language, 'По этому уроку подтверждённых изменений пока нет.',
          'Für diese Stunde liegen noch keine bestätigten Änderungen vor.')}
      </p>}
    <div className="parent-progress__recap">
      <strong>{say(language, 'Домашняя работа после предыдущего урока',
        'Hausaufgaben seit der vorigen Stunde')}</strong>
      {homework.length
        ? homework.map((item,i) => <Evidence key={`homework-${i}`} item={item} language={language}/>)
        : <p>{say(language,
            'Подтверждённых изменений по домашней работе за этот период пока нет.',
            'Für diesen Zeitraum sind noch keine bestätigten Hausaufgabenänderungen vorhanden.')}</p>}
    </div>
  </section>;
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
  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(null);

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
    setLoading(true);setError('');setData(null);setExpandedTopic(null);setSelectedLessonId(null);
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
            <span className="parent-progress__muted">{say(language,'Одна точка = один урок','Ein Punkt = eine Stunde')}</span></div>
          <ProgressGraph data={data} language={language} selectedId={selectedLessonId}
            onSelect={id => setSelectedLessonId(current => current === id ? null : id)} />
          <SelectedLessonDetails data={data} language={language} lessonId={selectedLessonId} />
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
