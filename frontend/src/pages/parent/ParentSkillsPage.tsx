import { useEffect, useState } from 'react';
import { parentApi, type ParentSkillsDashboard } from '../../api/parent';
import { useI18n } from '../../i18n/I18nContext';
import './parent-dashboard.css';

type Language = 'RU' | 'DE';
const say = (language: Language, ru: string, de: string) => language === 'DE' ? de : ru;
const percent = (n: number | null | undefined) => n == null ? '—' : `${n}%`;
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
        const improvementCount = data.lessons.find(l=>l.id===point.lessonId)?.improvements?.length ?? 0;
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
          {improvementCount > 0 && <circle cx={point.x} cy={point.y} r="11.5"
            className="parent-progress__improvement-halo"/>}
          <circle cx={point.x} cy={point.y} r={chosen ? 7 : 5.5}
            className={point.confirmedPercent == null
              ? 'parent-progress__dot parent-progress__dot--unassessed'
              : 'parent-progress__dot'}/>
          <text x={point.x} y={Math.max(20, point.y - 18)} textAnchor="middle"
            className={`parent-progress__point-value ${chosen ? 'parent-progress__point-value--active' : ''}`}
            aria-hidden="true">
            {point.confirmedPercent == null ? '—' : percent(point.confirmedPercent)}
          </text>
          <text className={`parent-progress__point-date ${chosen ? 'parent-progress__point-date--active' : ''}`}
            x={point.x} y="213" textAnchor="middle">
            {new Intl.DateTimeFormat(language === 'DE' ? 'de-DE' : 'ru-RU',
              {day:'2-digit',month:'2-digit',timeZone:'Europe/Berlin'}).format(new Date(point.endedAt))}
          </text>
          <title>{description}{improvementCount > 0
            ? `, ${say(language, 'есть подтверждённый прогресс по транскрипции',
                  'belegter Fortschritt aus dem Transkript')}` : ''}</title>
        </g>;
      })}
    </svg>
  </div>;
}

/** Shows the curriculum topics that genuinely changed at the chosen lesson. */
function SelectedLessonSkills({ data, language, lessonId }: {
  data: ParentSkillsDashboard; language: Language; lessonId: string | null;
}) {
  const point = data.lessonProgress?.find(x => x.lessonId === lessonId);
  const lesson = data.lessons.find(x => x.id === lessonId);
  if (!point || !lesson) return <p className="parent-progress__muted">
    {say(language, 'Выберите точку на графике, чтобы посмотреть изменения конкретного урока.',
      'Wählen Sie einen Punkt aus, um Änderungen dieser Stunde zu sehen.')}
  </p>;
  const gradedSkills = new Set((lesson.improvements ?? [])
    .filter(item => item.scoreStatus === 'SCORED' && item.masteryAfter != null)
    .map(item => item.skillId));
  const recordedChanges = (point.changes ?? []).filter(x => x.previous !== x.current);
  const updates = recordedChanges.filter(change => !gradedSkills.has(change.skillId));
  const currentIndex = (data.lessonProgress ?? []).findIndex(x => x.lessonId === lessonId);
  const lastPoint = currentIndex > 0 ? data.lessonProgress[currentIndex-1] : null;
  const grouped = data.topics.map(topic => ({
    topic, updates: updates.filter(x => data.skills.some(s => s.id === x.skillId && s.topicId === topic.id)),
  })).filter(group => group.updates.length);
  const ungrouped = updates.filter(x => !data.skills.some(s => s.id === x.skillId && s.topicId));
  const renderChange = (change: (typeof updates)[number]) => {
    const direction = change.previous == null ? 'initial' : change.current > change.previous ? 'up' : 'down';
    const text = direction === 'initial' ? say(language,'Первая оценка','Erste Bewertung')
      : direction === 'up' ? say(language,'Рост','Anstieg') : say(language,'Снижение','Rückgang');
    return <div className="parent-progress__dated-change" key={change.skillId}>
      <div className="parent-progress__dated-change-title">
        <strong>{change.skillTitle}</strong>
        <span className={`parent-progress__dated-change-value parent-progress__dated-change-value--${direction}`}>
          {change.previous == null ? '—' : percent(change.previous)} → {percent(change.current)}
          <small>{text}</small>
        </span>
      </div>
      <p className="parent-progress__dated-change-explanation">{change.explanation}</p>
      {change.excerpt && <p className="parent-progress__source">
        <strong>{say(language,'Основание:','Nachweis:')}</strong> {change.excerpt}
      </p>}
      {change.sourceType === 'HISTORY' && <small className="parent-progress__muted">
        {say(language, 'Источник: история карты навыков; ссылка на работу не сохранена.',
          'Quelle: Kompetenzverlauf; kein direkter Arbeitsnachweis gespeichert.')}
      </small>}
    </div>;
  };
  return <div className="parent-progress__dated-skills">
    <div className="parent-progress__selected-heading">
      <div><small className="parent-progress__muted">{day(point.endedAt,language)}</small>
        <h3>{point.lessonTitle}</h3></div>
      <div className="parent-progress__lesson-totals">
        <span className="parent-progress__muted">
          {recordedChanges.length > 0
            ? recordedChanges.map(c => c.skillTitle).join(' · ')
            : say(language, 'Изменений процентов нет', 'Keine Prozentänderungen')}
        </span>
        {point.confirmedPercent != null && <span className="parent-progress__total-score">
          {say(language,'Освоение класса:','Lernplan:')} {lastPoint?.confirmedPercent == null
            ? percent(point.confirmedPercent)
            : `${percent(lastPoint.confirmedPercent)} → ${percent(point.confirmedPercent)}`}
        </span>}
      </div>
    </div>
    {(lesson.improvements ?? []).some(item => item.scoreStatus === 'SCORED'
      && item.skillId && recordedChanges.some(c => c.skillId === item.skillId)) &&
      <section className="parent-progress__improvements">
      <h3>{say(language, 'Что действительно улучшилось', 'Was sich nachweislich verbessert hat')}</h3>
      {lesson.improvements.filter(item => item.scoreStatus === 'SCORED'
        && item.skillId && recordedChanges.some(c => c.skillId === item.skillId)).map((item,index) => {
        const scoredChange = recordedChanges.find(c => c.skillId === item.skillId &&
          c.sourceType === 'LESSON');
        const earlier = scoredChange?.previous ?? item.masteryBefore;
        const later = scoredChange?.current ?? item.masteryAfter;
        const hasScore = later != null && (item.scoreStatus === 'SCORED' || scoredChange != null);
        return <article key={`${item.topic}-${index}`} className="parent-progress__improvement">
          <div className="parent-progress__dated-change-title">
            <strong>{data.skills.find(skill => skill.id === item.skillId)?.title ?? item.topic}</strong>
            <span className="parent-progress__observation-tag parent-progress__observation-tag--independent">
              {item.comparison === 'BETWEEN_LESSONS'
                ? say(language,'С прошлого урока','Seit der letzten Stunde')
                : say(language,'В ходе урока','Während der Stunde')}
            </span>
          </div>
          <div className="parent-progress__improvement-compare">
            <div>
              <small>{say(language,'Было','Vorher')}</small>
              <strong>{hasScore
                ? earlier == null ? say(language,'Не оценено','Nicht bewertet') : percent(earlier)
                : '—'}</strong>
            </div>
            <div>
              <small>{say(language,'Стало','Nachher')}</small>
              <strong>{hasScore ? percent(later) : '—'}</strong>
            </div>
          </div>
          <p className="parent-progress__improvement-description">
            <strong>{say(language,'Что изменилось:','Was sich geändert hat:')}</strong>
            {' '}{item.before} → {item.after}
          </p>
          <p>{item.explanation}</p>
          {!hasScore && <small className="parent-progress__muted">
            {say(language, 'Наблюдение подтверждено, но численная оценка навыка пока не обновлена.',
              'Die Beobachtung ist belegt, aber der Kompetenzwert wurde noch nicht geändert.')}
          </small>}
          <details className="parent-progress__improvement-proof">
            <summary>{say(language,'Показать подтверждение из транскрипции',
              'Belege aus dem Transkript anzeigen')}</summary>
            <p><strong>{say(language,'Ранее:','Früher:')}</strong> {item.beforeQuote}</p>
            <p><strong>{say(language,'Позже:','Später:')}</strong> {item.afterQuote}</p>
          </details>
        </article>;
      })}
    </section>}
    {grouped.length || ungrouped.length
      ? <div className="parent-progress__dated-topic-list">
        {grouped.map(group => <section className="parent-progress__dated-topic" key={group.topic.id}>
          <h3>{group.topic.title}</h3>
          {group.updates.map(renderChange)}
        </section>)}
        {ungrouped.length>0 && <section className="parent-progress__dated-topic">
          {ungrouped.map(renderChange)}
        </section>}
      </div>
      : <p className="parent-progress__muted">
        {recordedChanges.length > 0
          ? say(language, 'Остальных изменений процентов за этот урок нет.',
              'Es gibt keine weiteren Prozentänderungen für diese Stunde.')
          : say(language,'За этот урок в карте навыков не записано изменений процентов.',
              'Für diese Stunde sind keine Prozentänderungen in der Kompetenzkarte gespeichert.')}
      </p>}
  </div>;
}

function SelectedLessonRecap({ data, language, lessonId }: {
  data: ParentSkillsDashboard; language: Language; lessonId: string | null;
}) {
  if (!lessonId) return null;
  const lesson = data.lessons.find(x => x.id === lessonId);
  if (!lesson) return null;
  return <section className="panel parent-progress__covered">
    <div className="parent-progress__section-title">
      <h2>{say(language,'Что проходили','Unterrichtsinhalte')}</h2>
      <span className="parent-progress__muted">{day(lesson.endedAt, language)}</span>
    </div>
    <p>{lesson.summary || say(language,
      'Содержание этого урока ещё не обработано. Проценты без подтверждённой записи не изменяются.',
      'Der Inhalt wurde noch nicht ausgewertet. Es werden keine unbelegten Bewertungen vergeben.')}</p>
  </section>;
}

export function ParentSkillsPage() {
  const { language } = useI18n();
  const [children, setChildren] = useState<{ studentId:string; studentName:string }[]>([]);
  const [selected, setSelected] = useState('');
  const [data, setData] = useState<ParentSkillsDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
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
    setLoading(true);setError('');setData(null);setSelectedLessonId(null);
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
        <section className="panel parent-progress__chart-panel">
          <div className="parent-progress__section-title"><h2>{say(language,'Как растут знания','Lernfortschritt im Zeitverlauf')}</h2>
            <span className="parent-progress__muted">{say(language,'Одна точка = один урок','Ein Punkt = eine Stunde')}</span></div>
          <ProgressGraph data={data} language={language} selectedId={selectedLessonId}
            onSelect={id => setSelectedLessonId(current => current === id ? null : id)} />

        </section>
        {selectedLessonId && <section className="parent-progress__topics">
          <div className="parent-progress__section-title">
            <h2>{say(language,'Изменившиеся навыки','Veränderte Kompetenzen')}</h2>
            <span className="parent-progress__muted">
              {say(language,'Только реальные изменения из карты навыков','Nur nachgewiesene Änderungen der Kompetenzkarte')}
            </span>
          </div>
          <SelectedLessonSkills data={data} language={language} lessonId={selectedLessonId} />
        </section>}
        <SelectedLessonRecap data={data} language={language} lessonId={selectedLessonId} />
        <p className="parent-progress__footnote">{say(language,
          'Проценты основаны на сохранённых проверках Mindcrafti. История изменений и доказательства показываются отдельно. Отсутствие оценки не означает отсутствие знаний.',
          'Werte stammen aus gespeicherten Prüfungen von Mindcrafti. Ohne Bewertung bedeutet nicht ohne Kenntnisse.')}</p>
      </>}
  </div>;
}
