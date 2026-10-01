import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import { useI18n } from '../../i18n/I18nContext';
import { toErrorMessage } from '../../lib/errors';

type TargetType = 'STUDENT' | 'GROUP';
type LessonStatus = 'PLANNED' | 'DONE' | 'MOVED';

type PlanLesson = {
  id: string;
  number: number;
  title: string;
  goal: string;
  topics: string;
  homeworkFocus: string;
  notes: string;
  status: LessonStatus;
};

type PlanData = {
  mainGoal: string;
  monthNotes: string;
  lessons: PlanLesson[];
};

export function MonthlyPlanPage({ targetType }: { targetType: TargetType }) {
  const { studentId, groupId } = useParams<{ studentId: string; groupId: string }>();
  const targetId = targetType === 'STUDENT' ? studentId ?? '' : groupId ?? '';
  const { language, t } = useI18n();
  const [targetName, setTargetName] = useState(targetType === 'STUDENT' ? 'Ученик' : 'Группа');
  const [month, setMonth] = useState(currentMonth());
  const [plan, setPlan] = useState<PlanData>(() => defaultPlan());
  const [version, setVersion] = useState(0);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const backPath = targetType === 'STUDENT' ? '/students' : '/groups';
  const monthLabel = useMemo(() => formatMonth(month, language), [month, language]);

  useEffect(() => {
    if (!targetId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setMessage(null);

    const targetRequest = targetType === 'STUDENT'
      ? api.students.get(targetId).then((item) => item.fullName)
      : api.groups.get(targetId).then((item) => item.name);

    Promise.all([
      targetRequest,
      api.monthlyPlans.get(targetType, targetId, month),
    ])
      .then(([name, response]) => {
        if (cancelled) return;
        setTargetName(name);
        setPlan(parsePlan(response.planJson));
        setVersion(response.version);
        setUpdatedAt(response.updatedAt);
      })
      .catch((e) => {
        if (!cancelled) setError(toErrorMessage(e, t));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [targetId, targetType, month, t]);

  function updateLesson(id: string, patch: Partial<PlanLesson>) {
    setPlan((current) => ({
      ...current,
      lessons: current.lessons.map((lesson) => lesson.id === id ? { ...lesson, ...patch } : lesson),
    }));
  }

  function addLesson() {
    setPlan((current) => ({
      ...current,
      lessons: [...current.lessons, blankLesson(current.lessons.length + 1)],
    }));
  }

  function removeLesson(id: string) {
    setPlan((current) => ({
      ...current,
      lessons: current.lessons
        .filter((lesson) => lesson.id !== id)
        .map((lesson, index) => ({ ...lesson, number: index + 1 })),
    }));
  }

  async function savePlan() {
    if (!targetId || saving) return;
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const normalized = normalizePlan(plan);
      const response = await api.monthlyPlans.save(targetType, targetId, month, JSON.stringify(normalized));
      setPlan(normalized);
      setVersion(response.version);
      setUpdatedAt(response.updatedAt);
      setMessage(language === 'DE' ? 'Monatsplan gespeichert.' : 'План на месяц сохранён.');
    } catch (e) {
      setError(toErrorMessage(e, t));
    } finally {
      setSaving(false);
    }
  }

  function downloadPlan() {
    const lines = [
      targetName + ' — ' + monthLabel,
      '',
      (language === 'DE' ? 'Monatsziel: ' : 'Цель месяца: ') + (plan.mainGoal || '—'),
      (language === 'DE' ? 'Notizen: ' : 'Заметки месяца: ') + (plan.monthNotes || '—'),
      '',
      ...plan.lessons.flatMap((lesson) => [
        (language === 'DE' ? 'Unterricht ' : 'Урок ') + lesson.number + ': ' + (lesson.title || '—'),
        (language === 'DE' ? 'Ziel: ' : 'Цель: ') + (lesson.goal || '—'),
        (language === 'DE' ? 'Inhalte: ' : 'Темы: ') + (lesson.topics || '—'),
        (language === 'DE' ? 'Hausaufgaben-Fokus: ' : 'Фокус домашки: ') + (lesson.homeworkFocus || '—'),
        (language === 'DE' ? 'Status: ' : 'Статус: ') + statusLabel(lesson.status, language),
        (language === 'DE' ? 'Notizen: ' : 'Заметки: ') + (lesson.notes || '—'),
        '',
      ]),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `plan-${month}-${safeFilename(targetName)}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="teacher-students-page">
      <p><Link to={backPath} className="muted">← {language === 'DE' ? 'Zurück' : 'Назад'}</Link></p>
      <div className="teacher-page-heading">
        <h1>{language === 'DE' ? 'Monatsplan' : 'План на месяц'}</h1>
        <p>{targetName} · {monthLabel}</p>
      </div>

      {error && <div className="banner banner--error">{error}</div>}
      {message && <div className="banner banner--success">{message}</div>}

      {loading ? <p className="muted">{t('common.loading')}</p> : (
        <div className="stack" style={{ gap: 18 }}>
          <section className="panel stack" style={{ gap: 14 }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'end', gap: 14, flexWrap: 'wrap' }}>
              <div>
                <h2 style={{ margin: 0 }}>{targetName}</h2>
                <p className="muted" style={{ margin: '5px 0 0' }}>{monthLabel}</p>
              </div>
              <label className="field" style={{ margin: 0, minWidth: 190 }}>
                <span className="field__label">{language === 'DE' ? 'Monat' : 'Месяц'}</span>
                <input className="input" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
              </label>
            </div>

            <label className="field">
              <span className="field__label">{language === 'DE' ? 'Hauptziel des Monats' : 'Главная цель месяца'}</span>
              <textarea
                className="input"
                style={{ minHeight: 84, resize: 'vertical' }}
                value={plan.mainGoal}
                onChange={(e) => setPlan((current) => ({ ...current, mainGoal: e.target.value }))}
                placeholder={language === 'DE' ? 'Was soll bis Monatsende sicher sitzen?' : 'Что должно уверенно получаться к концу месяца?'}
              />
            </label>

            <label className="field">
              <span className="field__label">{language === 'DE' ? 'Monatsnotizen' : 'Заметки на месяц'}</span>
              <textarea
                className="input"
                style={{ minHeight: 70, resize: 'vertical' }}
                value={plan.monthNotes}
                onChange={(e) => setPlan((current) => ({ ...current, monthNotes: e.target.value }))}
                placeholder={language === 'DE' ? 'Schule, Klassenarbeit, Besonderheiten…' : 'Что идёт в школе, контрольные, важные замечания…'}
              />
            </label>
          </section>

          {plan.lessons.map((lesson) => (
            <section className="panel stack" style={{ gap: 12 }} key={lesson.id}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <h2 style={{ margin: 0 }}>{language === 'DE' ? 'Unterricht' : 'Урок'} {lesson.number}</h2>
                <div className="row" style={{ gap: 8 }}>
                  <select
                    className="select"
                    value={lesson.status}
                    onChange={(e) => updateLesson(lesson.id, { status: e.target.value as LessonStatus })}
                  >
                    <option value="PLANNED">{language === 'DE' ? 'Geplant' : 'Запланирован'}</option>
                    <option value="DONE">{language === 'DE' ? 'Erledigt' : 'Проведён'}</option>
                    <option value="MOVED">{language === 'DE' ? 'Verschoben' : 'Перенесён'}</option>
                  </select>
                  {plan.lessons.length > 1 && (
                    <button type="button" className="btn btn--ghost" onClick={() => removeLesson(lesson.id)}>
                      {language === 'DE' ? 'Entfernen' : 'Удалить'}
                    </button>
                  )}
                </div>
              </div>

              <label className="field">
                <span className="field__label">{language === 'DE' ? 'Thema' : 'Тема'}</span>
                <input className="input" value={lesson.title} onChange={(e) => updateLesson(lesson.id, { title: e.target.value })} />
              </label>
              <label className="field">
                <span className="field__label">{language === 'DE' ? 'Ziel' : 'Цель урока'}</span>
                <textarea className="input" style={{ minHeight: 66, resize: 'vertical' }} value={lesson.goal} onChange={(e) => updateLesson(lesson.id, { goal: e.target.value })} />
              </label>
              <label className="field">
                <span className="field__label">{language === 'DE' ? 'Inhalte / Aufgaben' : 'Темы / что отработать'}</span>
                <textarea className="input" style={{ minHeight: 92, resize: 'vertical' }} value={lesson.topics} onChange={(e) => updateLesson(lesson.id, { topics: e.target.value })} />
              </label>
              <label className="field">
                <span className="field__label">{language === 'DE' ? 'Hausaufgaben-Fokus' : 'Фокус домашней работы'}</span>
                <input className="input" value={lesson.homeworkFocus} onChange={(e) => updateLesson(lesson.id, { homeworkFocus: e.target.value })} />
              </label>
              <label className="field">
                <span className="field__label">{language === 'DE' ? 'Notizen / Änderungen' : 'Заметки / изменения'}</span>
                <textarea className="input" style={{ minHeight: 66, resize: 'vertical' }} value={lesson.notes} onChange={(e) => updateLesson(lesson.id, { notes: e.target.value })} />
              </label>
            </section>
          ))}

          <div className="row" style={{ justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btn--secondary" type="button" onClick={addLesson}>+ {language === 'DE' ? 'Unterricht hinzufügen' : 'Добавить урок'}</button>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn--ghost" type="button" onClick={downloadPlan}>↓ {language === 'DE' ? 'Herunterladen' : 'Скачать план'}</button>
              <button className="btn" type="button" onClick={() => void savePlan()} disabled={saving}>
                {saving ? (language === 'DE' ? 'Speichern…' : 'Сохраняем…') : (language === 'DE' ? 'Speichern' : 'Сохранить план')}
              </button>
            </div>
          </div>

          {(version > 0 || updatedAt) && (
            <p className="muted" style={{ fontSize: 12 }}>
              v{version}{updatedAt ? ' · ' + new Date(updatedAt).toLocaleString(language === 'DE' ? 'de-DE' : 'ru-RU') : ''}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function defaultPlan(): PlanData {
  return {
    mainGoal: '',
    monthNotes: '',
    lessons: [1, 2, 3, 4].map((number) => blankLesson(number, false)),
  };
}

function blankLesson(number: number, unique = true): PlanLesson {
  return {
    id: unique ? `lesson-${number}-${Date.now()}` : `lesson-${number}`,
    number,
    title: '',
    goal: '',
    topics: '',
    homeworkFocus: '',
    notes: '',
    status: 'PLANNED',
  };
}

function parsePlan(planJson: string): PlanData {
  if (!planJson || !planJson.trim()) return defaultPlan();
  try {
    const raw = JSON.parse(planJson) as Partial<PlanData>;
    const lessons = Array.isArray(raw.lessons) && raw.lessons.length > 0
      ? raw.lessons.map((item, index) => {
          const lesson = item as Partial<PlanLesson>;
          return {
            id: lesson.id || `lesson-${index + 1}`,
            number: index + 1,
            title: lesson.title || '',
            goal: lesson.goal || '',
            topics: lesson.topics || '',
            homeworkFocus: lesson.homeworkFocus || '',
            notes: lesson.notes || '',
            status: lesson.status === 'DONE' || lesson.status === 'MOVED' ? lesson.status : 'PLANNED',
          } satisfies PlanLesson;
        })
      : defaultPlan().lessons;
    return {
      mainGoal: typeof raw.mainGoal === 'string' ? raw.mainGoal : '',
      monthNotes: typeof raw.monthNotes === 'string' ? raw.monthNotes : '',
      lessons,
    };
  } catch {
    return defaultPlan();
  }
}

function normalizePlan(plan: PlanData): PlanData {
  return {
    ...plan,
    lessons: plan.lessons.map((lesson, index) => ({ ...lesson, number: index + 1 })),
  };
}

function formatMonth(month: string, language: 'DE' | 'RU') {
  const [year, monthNumber] = month.split('-').map(Number);
  if (!year || !monthNumber) return month;
  return new Intl.DateTimeFormat(language === 'DE' ? 'de-DE' : 'ru-RU', { month: 'long', year: 'numeric' })
    .format(new Date(year, monthNumber - 1, 1));
}

function statusLabel(status: LessonStatus, language: 'DE' | 'RU') {
  if (status === 'DONE') return language === 'DE' ? 'Erledigt' : 'Проведён';
  if (status === 'MOVED') return language === 'DE' ? 'Verschoben' : 'Перенесён';
  return language === 'DE' ? 'Geplant' : 'Запланирован';
}

function safeFilename(value: string) {
  return value.trim().replace(/[^\p{L}\p{N}_-]+/gu, '_') || 'plan';
}
