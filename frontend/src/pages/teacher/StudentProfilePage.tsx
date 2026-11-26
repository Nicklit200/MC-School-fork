import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, request } from '../../api/client';
import type { CardSummary, GroupLesson, Homework, SchoolType, StudentListItem } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import { askStudentUsername, studentUsernameError } from '../../lib/studentUsername';

export function StudentProfilePage() {
  const { studentId = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { language } = useI18n();
  const tr = (ru: string, de: string) => language === 'DE' ? de : ru;
  const base = `/students/${studentId}`;
  const overview = location.pathname.replace(/\/$/, '') === base;
  const [editingUsername, setEditingUsername] = useState(false);
  const [usernameMessage, setUsernameMessage] = useState<string | null>(null);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [student, setStudent] = useState<StudentListItem | null>(null);
  const [homeworks, setHomeworks] = useState<Homework[]>([]);
  const [summary, setSummary] = useState<CardSummary | null>(null);
  const [lessons, setLessons] = useState<GroupLesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [timeReport, setTimeReport] = useState<import('../../api/types').StudentTimeReport | null>(null);
  const [sharingParentLink, setSharingParentLink] = useState(false);
  const [parentShareUrl, setParentShareUrl] = useState<string | null>(null);
  const [parentShareStatus, setParentShareStatus] = useState<string | null>(null);
  const [parentShareError, setParentShareError] = useState<string | null>(null);
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
  useEffect(() => { let live = true; api.learningTime.student(studentId,30).then(r => { if(live) setTimeReport(r); }).catch(()=>{}); return () => { live = false; }; }, [studentId]);
  useEffect(() => {
    setUsernameMessage(null);
    setUsernameError(null);
    setParentShareUrl(null);
    setParentShareStatus(null);
    setParentShareError(null);
  }, [studentId]);

  async function renameUsername() {
    if (!student || editingUsername || student.id !== studentId) return;
    const username = askStudentUsername(student.username, language);
    if (!username) return;
    setEditingUsername(true);
    setUsernameMessage(null);
    setUsernameError(null);
    try {
      const updated = await api.students.renameUsername(student.id, username);
      setStudent(current => current?.id === updated.id ? { ...current, username: updated.username } : current);
      setUsernameMessage(tr('Новый логин: ', 'Neuer Login: ') + updated.username);
    } catch (e) {
      setUsernameError(studentUsernameError(e, language));
    } finally {
      setEditingUsername(false);
    }
  }

  async function copyParentProgressLink() {
    if (!student || sharingParentLink) return;
    setSharingParentLink(true);
    setParentShareStatus(null);
    setParentShareError(null);
    setParentShareUrl(null);
    try {
      if (student.grade == null) {
        throw new Error(tr(
          'Сначала укажите класс ученика в учебном профиле.',
          'Bitte zuerst die Klassenstufe im Lernprofil angeben.',
        ));
      }
      const availableBoards = await request<Array<{ id: string; grade: number }>>('GET', '/skill-boards/catalog');
      const board = availableBoards.find((item) => Number(item.grade) === Number(student.grade));
      if (!board) {
        throw new Error(tr(
          'Для этого класса карта навыков пока не создана.',
          'Für diese Klassenstufe gibt es noch keine Kompetenzkarte.',
        ));
      }
      const issued = await request<{ token: string }>(
        'POST',
        `/skill-boards/${encodeURIComponent(board.id)}/students/${encodeURIComponent(student.id)}/parent-share`,
      );
      if (!issued?.token) throw new Error(tr('Сервер не вернул ссылку.', 'Der Server hat keinen Link zurückgegeben.'));

      // The root/hash URL works on hosts without SPA fallback and is restored
      // to /skill-progress#token=... by restorePublicSkillProgressRoute().
      const url = `${window.location.origin}/#skillProgress=${encodeURIComponent(issued.token)}`;
      setParentShareUrl(url);
      try {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(url);
        setParentShareStatus(tr(
          'Ссылка скопирована. Родитель может просматривать только навыки и историю этого ученика.',
          'Link kopiert. Eltern können nur die Kompetenzen und den Verlauf dieses Kindes ansehen.',
        ));
      } catch {
        setParentShareStatus(tr(
          'Ссылка создана. Выделите её в поле ниже и скопируйте вручную.',
          'Link erstellt. Bitte den Link im Feld unten markieren und manuell kopieren.',
        ));
      }
    } catch (error) {
      setParentShareError(error instanceof Error ? error.message : String(error));
    } finally {
      setSharingParentLink(false);
    }
  }

  const pdfs = homeworks.filter(h => h.hasWorksheet).sort((a, b) => b.startDate.localeCompare(a.startDate));
  const next = lessons.filter(e => new Date(e.startsAt).getTime() > Date.now()).sort((a,b) => a.startsAt.localeCompare(b.startsAt))[0];
  const tabs = [['', tr('Обзор', 'Übersicht')], ['homeworks', tr('Уроки и домашка', 'Unterricht und Hausaufgaben')], ['cards', tr('Карточки', 'Karten')], ['month-plan', tr('План на месяц', 'Monatsplan')], ['drive', 'Google Drive']];
  const date = (value: string) => new Intl.DateTimeFormat(language === 'DE' ? 'de-DE' : 'ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Berlin' }).format(new Date(value.length === 10 ? `${value}T12:00:00` : value));
  return <div className="group-detail-dashboard">
    <Link className="group-detail-back" to="/students">← {tr('К ученикам', 'Schüler')}</Link>
    <div className="group-detail-heading"><div><h1>{student?.fullName ?? tr('Ученик', 'Schüler')}</h1><p>{tr('Логин', 'Login')}: {student?.username ?? '—'} · {tr('Родитель', 'Elternteil')}: {student?.parentFullName ?? '—'}</p></div><div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
      <button className="btn btn--secondary" type="button" disabled={!student || loading || editingUsername} onClick={() => void renameUsername()}>{tr('Изменить логин', 'Login ändern')}</button>
      <button className="btn" type="button" onClick={() => void copyParentProgressLink()} disabled={!student || sharingParentLink}>
        {sharingParentLink ? tr('Создаём ссылку…', 'Link wird erstellt…') : tr('🔗 Скопировать ссылку для родителя', '🔗 Eltern-Link kopieren')}
      </button>
      <Link to={`${base}/homeworks`} className="btn btn--secondary">{tr('Календарь занятий', 'Unterrichtskalender')}</Link>
    </div></div>
    {usernameMessage && <div className="banner banner--success" role="status">{usernameMessage}</div>}
    {usernameError && <div className="banner banner--error" role="alert">{usernameError}</div>}
    {parentShareError && <div className="banner banner--error" role="alert" style={{ marginBottom: 12 }}>{parentShareError}</div>}
    {parentShareStatus && <div className="banner banner--success" role="status" style={{ marginBottom: 12 }}>{parentShareStatus}</div>}
    {parentShareUrl && (
      <div className="panel" style={{ marginBottom: 14, padding: 14 }}>
        <label className="field" style={{ margin: 0 }}>
          <span className="field__label">{tr('Родительская ссылка (только просмотр)', 'Eltern-Link (nur Leserechte)')}</span>
          <input
            className="input"
            type="url"
            readOnly
            value={parentShareUrl}
            onFocus={(event) => event.currentTarget.select()}
            aria-label={tr('Ссылка для просмотра прогресса', 'Link zum Lernfortschritt')}
          />
        </label>
        <p className="muted" style={{ margin: '8px 0 0', fontSize: 12 }}>
          {tr('Отправляйте только родителю. Любой, у кого есть ссылка, сможет увидеть прогресс ребёнка. При необходимости отзовите ссылку в разделе «Навыки».',
              'Nur an die Eltern weitergeben. Wer den Link hat, kann den Fortschritt sehen. Den Link können Sie unter „Kompetenzen“ widerrufen.')}
        </p>
      </div>
    )}
    {error && <div className="banner banner--error">{error} <button className="btn btn--secondary" onClick={() => setRevision(n => n + 1)}>{tr('Повторить', 'Erneut versuchen')}</button></div>}
    <div className="group-summary-grid">
      <button className="group-summary-card" onClick={() => navigate(`${base}/cards`)}><div className="group-summary-card__icon group-summary-card__icon--orange">▤</div><div><strong>{loading || error ? '—' : summary?.total ?? 0}</strong><span>{tr('карточек', 'Karten')}</span></div><small>{tr('Перейти к карточкам', 'Karten öffnen')} →</small></button>
      <button className="group-summary-card" onClick={() => navigate(`${base}/homeworks`)}><div className="group-summary-card__icon group-summary-card__icon--yellow">▤</div><div><strong>{loading || error ? '—' : pdfs.filter(h => !h.submitted).length}</strong><span>{tr('ДЗ ожидают сдачи', 'offene Hausaufgaben')}</span></div><small>{tr('Открыть календарь', 'Kalender öffnen')} →</small></button>
      <div className="group-summary-card group-summary-card--lesson"><div className="group-summary-card__icon group-summary-card__icon--green">▣</div><div><span>{tr('Следующий урок', 'Nächster Unterricht')}</span><strong className="group-summary-card__lesson">{loading || error || !next ? '—' : date(next.startsAt)}</strong></div><small>{next && !loading && !error ? <Link to={`/teacher/lessons/${encodeURIComponent(next.eventId)}`}>{next.title} →</Link> : loading ? tr('Загрузка…', 'Laden…') : error ? '—' : tr('Ближайших уроков нет', 'Kein Unterricht geplant')}</small></div>
    </div>
    {timeReport && <div className="panel row" style={{gap:24,justifyContent:'space-around',flexWrap:'wrap',marginBottom:16}}>
      <div><strong>{Math.round(timeReport.summary.cardSeconds/60)} мин</strong><div className="muted">{tr('Карточки за 30 дней','Karten, letzte 30 Tage')}</div></div>
      <div><strong>{Math.round(timeReport.summary.homeworkSeconds/60)} мин</strong><div className="muted">{tr('Домашка за 30 дней','Hausaufgaben, letzte 30 Tage')}</div></div>
      <div><strong>{timeReport.summary.activeDays}</strong><div className="muted">{tr('Активных дней','Aktive Tage')}</div></div>
    </div>}
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

      <div className="teacher-profile-fields">
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

      <div className="teacher-profile-notes">
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
