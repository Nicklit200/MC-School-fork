import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { CardSummary, GroupLesson, Homework, SchoolType, StudentListItem } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';

export function StudentProfilePage() {
  const { studentId = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { language } = useI18n();
  const tr = (ru: string, de: string) => language === 'DE' ? de : ru;
  const base = `/students/${studentId}`;
  const overview = location.pathname.replace(/\/$/, '') === base;
  const [student, setStudent] = useState<StudentListItem | null>(null);
  const [homeworks, setHomeworks] = useState<Homework[]>([]);
  const [summary, setSummary] = useState<CardSummary | null>(null);
  const [lessons, setLessons] = useState<GroupLesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    Promise.all([api.students.get(studentId), api.homeworks.listForStudent(studentId), api.cards.summaryForStudent(studentId), api.lessons.groupLessons()])
      .then(([pupil, work, cards, events]) => {
        if (cancelled) return;
        setStudent(pupil); setHomeworks(work); setSummary(cards);
        setLessons(events.filter(e => e.studentId === studentId || (e.participantStudentIds ?? []).includes(studentId)));
      }).catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [studentId, revision, overview]);
  const pdfs = homeworks.filter(h => h.hasWorksheet).sort((a, b) => b.startDate.localeCompare(a.startDate));
  const next = lessons.filter(e => new Date(e.startsAt).getTime() > Date.now()).sort((a,b) => a.startsAt.localeCompare(b.startsAt))[0];
  const tabs = [['', tr('Обзор', 'Übersicht')], ['lessons', tr('Уроки', 'Unterricht')], ['homeworks', tr('Домашние задания', 'Hausaufgaben')], ['cards', tr('Карточки', 'Karten')], ['month-plan', tr('План на месяц', 'Monatsplan')], ['drive', 'Google Drive']];
  const date = (value: string) => new Intl.DateTimeFormat(language === 'DE' ? 'de-DE' : 'ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Berlin' }).format(new Date(value.length === 10 ? `${value}T12:00:00` : value));
  return <div className="group-detail-dashboard">
    <Link className="group-detail-back" to="/students">← {tr('К ученикам', 'Schüler')}</Link>
    <div className="group-detail-heading"><div><h1>{student?.fullName ?? tr('Ученик', 'Schüler')}</h1><p>{tr('Логин', 'Login')}: {student?.username ?? '—'} · {tr('Родитель', 'Elternteil')}: {student?.parentFullName ?? '—'}</p></div><Link to={`${base}/lessons`} className="btn btn--secondary">{tr('История уроков', 'Unterrichtsverlauf')}</Link></div>
    {error && <div className="banner banner--error">{error} <button className="btn btn--secondary" onClick={() => setRevision(n => n + 1)}>{tr('Повторить', 'Erneut versuchen')}</button></div>}
    <div className="group-summary-grid">
      <button className="group-summary-card" onClick={() => navigate(`${base}/cards`)}><div className="group-summary-card__icon group-summary-card__icon--orange">▤</div><div><strong>{loading || error ? '—' : summary?.total ?? 0}</strong><span>{tr('карточек', 'Karten')}</span></div><small>{tr('Перейти к карточкам', 'Karten öffnen')} →</small></button>
      <button className="group-summary-card" onClick={() => navigate(`${base}/homeworks`)}><div className="group-summary-card__icon group-summary-card__icon--yellow">▤</div><div><strong>{loading || error ? '—' : pdfs.filter(h => !h.submitted).length}</strong><span>{tr('ДЗ ожидают сдачи', 'offene Hausaufgaben')}</span></div><small>{tr('Перейти к домашним заданиям', 'Hausaufgaben öffnen')} →</small></button>
      <div className="group-summary-card group-summary-card--lesson"><div className="group-summary-card__icon group-summary-card__icon--green">▣</div><div><span>{tr('Следующий урок', 'Nächster Unterricht')}</span><strong className="group-summary-card__lesson">{loading || error || !next ? '—' : date(next.startsAt)}</strong></div><small>{next && !loading && !error ? <Link to={`/teacher/lessons/${encodeURIComponent(next.eventId)}`}>{next.title} →</Link> : loading ? tr('Загрузка…', 'Laden…') : error ? '—' : tr('Ближайших уроков нет', 'Kein Unterricht geplant')}</small></div>
    </div>
    <nav className="group-detail-tabs" aria-label={tr('Разделы ученика', 'Schülerbereiche')}>
      {tabs.map(([path, label]) => { const url = `${base}${path ? `/${path}` : ''}`; const active = location.pathname.replace(/\/$/, '') === url; return <button key={path} type="button" className={active ? 'active' : ''} aria-current={active ? 'page' : undefined} onClick={() => navigate(url)}><span>{label}</span></button>; })}
    </nav>
    {overview ? loading ? <p className="muted">{tr('Загружаем данные ученика…', 'Laden…')}</p> : !error && student && <LearningProfileCard student={student} language={language} onSaved={setStudent} /> : <Outlet />}
  </div>;
}

function LearningProfileCard({ student, language, onSaved }: {
  student: StudentListItem;
  language: 'DE' | 'RU';
  onSaved: (student: StudentListItem) => void;
}) {
  const tr = (ru: string, de: string) => language === 'DE' ? de : ru;
  const [grade, setGrade] = useState(student.grade == null ? '' : String(student.grade));
  const [schoolType, setSchoolType] = useState<SchoolType | ''>(student.schoolType ?? '');
  const [learningDifficulties, setLearningDifficulties] = useState(student.learningDifficulties ?? '');
  const [explanationStyle, setExplanationStyle] = useState(student.explanationStyle ?? '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setGrade(student.grade == null ? '' : String(student.grade));
    setSchoolType(student.schoolType ?? '');
    setLearningDifficulties(student.learningDifficulties ?? '');
    setExplanationStyle(student.explanationStyle ?? '');
  }, [student]);

  async function saveProfile() {
    setSaving(true);
    setMessage(null);
    setSaveError(null);
    try {
      const saved = await api.students.updateLearningProfile(student.id, {
        grade: grade ? Number(grade) : null,
        schoolType: schoolType || null,
        learningPace: null,
        learningStrengths: student.learningStrengths ?? '',
        learningDifficulties,
        explanationStyle,
        learningNotes: student.learningNotes ?? '',
      });
      onSaved(saved);
      setMessage(tr('Учебный профиль сохранён.', 'Lernprofil gespeichert.'));
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  const schoolOptions: Array<[SchoolType, string]> = [
    ['GYMNASIUM', 'Gymnasium'],
    ['REALSCHULE', 'Realschule'],
    ['MITTELSCHULE', 'Mittelschule'],
    ['WIRTSCHAFTSSCHULE', 'Wirtschaftsschule'],
    ['FACHOBERSCHULE', 'Fachoberschule (FOS)'],
    ['GESAMTSCHULE', 'Gesamtschule'],
    ['WERKREALSCHULE', 'Werkrealschule'],
    ['OTHER', tr('Другая школа', 'Andere Schule')],
  ];

  return (
    <section className="group-overview-card" style={{ marginBottom: 18 }}>
      <div className="group-overview-card__header">
        <div>
          <h2>{tr('Учебный профиль', 'Lernprofil')}</h2>
          <p className="muted" style={{ margin: '5px 0 0' }}>
            {tr('Вся информация, которая помогает правильно учить этого ребёнка.', 'Alle Angaben, die helfen, diesen Schüler passend zu unterrichten.')}
          </p>
        </div>
        <button className="btn" type="button" onClick={() => void saveProfile()} disabled={saving}>
          {saving ? tr('Сохраняем…', 'Speichern…') : tr('Сохранить', 'Speichern')}
        </button>
      </div>

      {message && <div className="banner banner--success" style={{ marginBottom: 14 }}>{message}</div>}
      {saveError && <div className="banner banner--error" style={{ marginBottom: 14 }}>{saveError}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
        <label className="field">
          <span className="field__label">{tr('Класс', 'Klasse')}</span>
          <select className="input" value={grade} onChange={(e) => setGrade(e.target.value)}>
            <option value="">{tr('Не выбран', 'Nicht gewählt')}</option>
            {Array.from({ length: 13 }, (_, index) => index + 1).map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field__label">{tr('Тип школы', 'Schulart')}</span>
          <select className="input" value={schoolType} onChange={(e) => setSchoolType(e.target.value as SchoolType | '')}>
            <option value="">{tr('Не выбран', 'Nicht gewählt')}</option>
            {schoolOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>

      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))', gap: 14, marginTop: 14 }}>
        <label className="field">
          <span className="field__label">{tr('Что даётся тяжело', 'Schwierigkeiten')}</span>
          <textarea className="input" rows={4} value={learningDifficulties} onChange={(e) => setLearningDifficulties(e.target.value)} placeholder={tr('Например: теряется при скобках, путает знаки, боится текстовых задач…', 'Zum Beispiel: Klammern, Vorzeichen, Textaufgaben…')} />
        </label>

        <label className="field">
          <span className="field__label">{tr('Как лучше объяснять', 'Wie am besten erklären')}</span>
          <textarea className="input" rows={4} value={explanationStyle} onChange={(e) => setExplanationStyle(e.target.value)} placeholder={tr('Например: сначала один пример вместе, затем похожий самостоятельно; больше визуальных схем…', 'Zum Beispiel: erst ein Beispiel gemeinsam, dann selbstständig; mehr Visualisierung…')} />
        </label>

      </div>

      <p className="muted" style={{ margin: '12px 0 0', fontSize: 13 }}>
        {tr('Класс будет использоваться для автоматического выбора карты навыков ученика.', 'Die Klasse steuert künftig automatisch die passende Kompetenzkarte.')}
      </p>
    </section>
  );
}
