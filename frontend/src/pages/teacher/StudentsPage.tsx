import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import type { CardSummary, DailyReviewHistoryItem, Homework, StudentInvitation, StudentListItem } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import { toErrorMessage } from '../../lib/errors';
import { TeacherIcon } from '../../components/TeacherIcon';

type TodayCompletion = {
  cards: 'done' | 'pending' | 'none';
  homework: 'done' | 'pending' | 'none';
};

export function StudentsPage() {
  const { language, t } = useI18n();
  const [students, setStudents] = useState<StudentListItem[]>([]);
  const [summaries, setSummaries] = useState<Record<string, CardSummary>>({});
  const [todayCompletion, setTodayCompletion] = useState<Record<string, TodayCompletion>>({});
  const [fullName, setFullName] = useState('');
  const [createdStudent, setCreatedStudent] = useState<StudentInvitation | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  async function reload() {
    const list = await api.students.list();
    setStudents(list);
    const today = localDateString(new Date());
    const activeStudents = list.filter((student) => student.status !== 'INACTIVE');
    const details = await Promise.all(
      activeStudents.map(async (student) => {
        const [summary, homeworks, reviewHistory] = await Promise.all([
          api.cards.summaryForStudent(student.id),
          api.homeworks.listForStudent(student.id),
          api.students.reviewHistory(student.id),
        ]);
        return {
          studentId: student.id,
          summary,
          completion: buildTodayCompletion(today, summary, homeworks, reviewHistory),
        };
      }),
    );
    setSummaries(Object.fromEntries(details.map((item) => [item.studentId, item.summary])));
    setTodayCompletion(Object.fromEntries(details.map((item) => [item.studentId, item.completion])));
    setLoading(false);
  }

  useEffect(() => {
    reload().catch((e) => { setError(toErrorMessage(e, t)); setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      const created = await api.students.create(fullName.trim(), '');
      setCreatedStudent(created);
      setFullName('');
      setCreateOpen(false);
      await reload();
    } catch (e) {
      setError(toErrorMessage(e, t));
    } finally {
      setCreating(false);
    }
  }

  function activeCount(summary?: CardSummary): number {
    return summary ? summary.dueNow + summary.awaitingRepetition : 0;
  }

  async function renameStudent(student: StudentListItem) {
    const nextName = window.prompt(language === 'DE' ? 'Neuer Schülername' : 'Новое имя ученика', student.fullName);
    if (!nextName || nextName.trim() === student.fullName) {
      setOpenMenuId(null);
      return;
    }
    setError(null);
    try {
      await api.students.rename(student.id, nextName.trim());
      setOpenMenuId(null);
      await reload();
    } catch (e) {
      setError(toErrorMessage(e, t));
    }
  }

  async function resetStudentPassword(student: StudentListItem) {
    const password = window.prompt(
      language === 'DE'
        ? `Neues Passwort für ${student.fullName} (mindestens 6 Zeichen)`
        : `Новый пароль для ${student.fullName} (минимум 6 символов)`,
      '',
    );
    if (password == null) return;
    if (password.length < 6) {
      window.alert(language === 'DE' ? 'Das Passwort muss mindestens 6 Zeichen haben.' : 'Пароль должен содержать минимум 6 символов.');
      return;
    }
    setError(null);
    try {
      await api.students.resetPassword(student.id, password);
      setOpenMenuId(null);
      window.alert(language === 'DE'
        ? `Passwort geändert. Login: ${student.username ?? '—'}`
        : `Пароль изменён. Логин: ${student.username ?? '—'}`);
    } catch (e) {
      setError(toErrorMessage(e, t));
    }
  }

  async function deactivateStudent(student: StudentListItem) {
    const confirmed = window.confirm(
      language === 'DE'
        ? `${student.fullName} deaktivieren? Der Schüler kann sich nicht mehr anmelden und erhält keine neuen Gruppenaufgaben oder Erinnerungen. Alle bisherigen Daten bleiben erhalten.`
        : `Сделать ${student.fullName} неактивным? Ученик больше не сможет войти и не будет получать новые групповые задания и напоминания. Вся история сохранится.`,
    );
    if (!confirmed) return;
    setError(null);
    try {
      await api.students.deactivate(student.id);
      setOpenMenuId(null);
      await reload();
    } catch (e) {
      setError(toErrorMessage(e, t));
    }
  }

  async function reactivateStudent(student: StudentListItem) {
    setError(null);
    try {
      await api.students.reactivate(student.id);
      setOpenMenuId(null);
      setShowInactive(false);
      await reload();
    } catch (e) {
      setError(toErrorMessage(e, t));
    }
  }

  async function deleteStudent(student: StudentListItem) {
    if (!window.confirm(t('students.deleteConfirm', { name: student.fullName }))) return;
    setError(null);
    try {
      await api.students.remove(student.id);
      setOpenMenuId(null);
      await reload();
    } catch (e) {
      setError(toErrorMessage(e, t));
    }
  }

  const activeStudents = students.filter((student) => student.status !== 'INACTIVE');
  const inactiveStudents = students.filter((student) => student.status === 'INACTIVE');
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleStudents = (showInactive ? inactiveStudents : activeStudents).filter((student) =>
    [student.fullName, student.username, student.grade, schoolTypeLabel(student.schoolType, language)]
      .filter(Boolean).join(' ').toLocaleLowerCase().includes(normalizedQuery),
  );

  return (
    <div className="teacher-students-page" onClick={() => openMenuId && setOpenMenuId(null)}>
      <div className="teacher-page-heading teacher-heading-row">
        <div><h1>{language === 'DE' ? 'Meine Schüler' : 'Мои ученики'}</h1>
        <p>{language === 'DE' ? 'Alles für die Arbeit mit jedem Schüler' : 'Всё для работы с каждым учеником'}</p></div>
        <button className="btn" type="button" aria-expanded={createOpen} aria-controls="teacher-add-student" onClick={() => setCreateOpen(!createOpen)}>
          {createOpen ? (language === 'DE' ? 'Schließen' : 'Закрыть') : (language === 'DE' ? '+ Schüler hinzufügen' : '+ Добавить ученика')}
        </button>
      </div>
      <div className="teacher-students-toolbar">
        <div className="teacher-filter-tabs" role="group" aria-label={language === 'DE' ? 'Schülerstatus' : 'Статус учеников'}>
          <button type="button" aria-pressed={!showInactive} onClick={() => setShowInactive(false)}>{language === 'DE' ? 'Aktiv' : 'Активные'} · {activeStudents.length}</button>
          <button type="button" aria-pressed={showInactive} onClick={() => setShowInactive(true)}>{language === 'DE' ? 'Inaktiv' : 'Неактивные'} · {inactiveStudents.length}</button>
        </div>
        <label className="teacher-student-search"><TeacherIcon name="search" />
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} aria-label={language === 'DE' ? 'Schüler suchen' : 'Поиск учеников'} placeholder={language === 'DE' ? 'Nach Name oder Klasse suchen' : 'Поиск по имени или классу'} />
        </label>
      </div>

      {error && <div className="banner banner--error">{error}</div>}

      {createOpen && <section className="teacher-create-student" id="teacher-add-student">
        <h2>{language === 'DE' ? 'Neuen Schüler hinzufügen' : 'Добавить нового ученика'}</h2>
        <form onSubmit={onCreate}>
          <div className="teacher-create-grid">
            <label className="field">
              <span className="field__label">{language === 'DE' ? 'Name des Schülers' : 'Имя ученика'}</span>
              <input className="input" autoFocus disabled={creating} value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder={language === 'DE' ? 'Name eingeben' : 'Введите имя ученика'} required />
            </label>
          </div>
          <p className="teacher-form-hint"><span>ⓘ</span>{language === 'DE' ? 'Der Schüler ist sofort vollständig im System verfügbar. Login und Passwort können später weitergegeben werden.' : 'Ученик сразу полностью доступен в системе. Логин и пароль можно передать ему позже.'}</p>
          <button className="btn teacher-primary-btn" type="submit" disabled={creating}>{language === 'DE' ? 'Schüler hinzufügen' : 'Добавить ученика'}</button>
        </form>
      </section>}
      {createdStudent && <div className="banner banner--success" role="status">
        {language === 'DE' ? 'Schüler erstellt. Login' : 'Ученик создан. Логин'}: <strong>{createdStudent.student.username}</strong>.{' '}
        {language === 'DE' ? 'Das Passwort kann über das Menü festgelegt werden.' : 'Пароль можно задать через меню ученика.'}
      </div>}
      <div className="teacher-section-label"><span>{visibleStudents.length} {language === 'DE' ? 'Schüler' : studentCountWord(visibleStudents.length)}</span><span>{language === 'DE' ? 'Aufgabenstatus heute' : 'Статус заданий на сегодня'}</span></div>

      {loading ? <p className="muted">{t('common.loading')}</p> : visibleStudents.length === 0 ? (
        <div className="teacher-empty-state">
          {query.trim() ? (language === 'DE' ? 'Keine Schüler gefunden.' : 'Ученики не найдены.') : showInactive
            ? (language === 'DE' ? 'Keine inaktiven Schüler.' : 'Неактивных учеников нет.')
            : t('students.empty')}
        </div>
      ) : (
        <div className="teacher-student-list teacher-student-list--cards">
          {visibleStudents.map((student, index) => {
            const completion = todayCompletion[student.id] ?? { cards: 'none', homework: 'none' };
            return (
              <article key={student.id} className="teacher-student-card">
                <div className={`teacher-student-avatar teacher-student-avatar--${index % 4}`}>{studentInitial(student.fullName)}</div>
                <div className="teacher-student-main">
                  <div className="teacher-student-name">
                    <Link to={`/students/${student.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>{student.fullName}</Link>
                    {student.status === 'INACTIVE' && (
                      <span className="pill pill--pending" style={{ marginLeft: 10, verticalAlign: 'middle' }}>
                        {language === 'DE' ? 'Inaktiv' : 'Неактивен'}
                      </span>
                    )}
                  </div>
                  <div className="teacher-student-meta">
                    {student.grade ? `${student.grade} ${language === 'DE' ? 'Klasse' : 'класс'}` : (language === 'DE' ? 'Klasse nicht angegeben' : 'Класс не указан')}
                    {student.schoolType && <> · {schoolTypeLabel(student.schoolType, language)}</>}
                  </div>
                </div>

                <div className="teacher-student-stats">
                  {student.status === 'INACTIVE' ? (
                    <div className="muted">
                      {language === 'DE'
                        ? 'Historie bleibt erhalten. Keine neuen Aufgaben oder Erinnerungen.'
                        : 'История сохранена. Новые задания и напоминания не отправляются.'}
                    </div>
                  ) : (
                    <>
                      <div className="teacher-today-statuses">
                        <TodayStatusBadge label={language === 'DE' ? 'Karten heute' : 'Карточки сегодня'} status={completion.cards} language={language} />
                        <TodayStatusBadge label={language === 'DE' ? 'Hausaufgabe heute' : 'Домашка сегодня'} status={completion.homework} language={language} />
                      </div>
                    </>
                  )}
                </div>

                <div className="teacher-student-menu-wrap" onClick={(event) => event.stopPropagation()}>
                      <button type="button" className="teacher-more-btn" aria-label="Дополнительные действия" aria-expanded={openMenuId === student.id} onClick={() => setOpenMenuId((current) => current === student.id ? null : student.id)}>⋮</button>
                      {openMenuId === student.id && (
                        <div className="teacher-student-menu">
                          <button type="button" onClick={() => void resetStudentPassword(student)}>
                            <span>⌘</span>{language === 'DE' ? 'Passwort festlegen/ändern' : 'Задать/изменить пароль'}
                          </button>
                          <button type="button" onClick={() => void renameStudent(student)}><span>✎</span>{language === 'DE' ? 'Name ändern' : 'Изменить имя'}</button>
                          {student.status === 'INACTIVE' ? (
                            <button type="button" onClick={() => void reactivateStudent(student)}>
                              <span>✓</span>{language === 'DE' ? 'Aktivieren' : 'Сделать активным'}
                            </button>
                          ) : (
                            <button type="button" onClick={() => void deactivateStudent(student)}>
                              <span>◌</span>{language === 'DE' ? 'Deaktivieren' : 'Сделать неактивным'}
                            </button>
                          )}
                          <button type="button" className="is-danger" onClick={() => void deleteStudent(student)}><span>♧</span>{language === 'DE' ? 'Löschen' : 'Удалить'}</button>
                        </div>
                      )}
                    </div>
                <div className="teacher-student-footer">
                  <span>{language === 'DE' ? 'Aktive Karten' : 'Карточек в работе'}: {activeCount(summaries[student.id])}</span>
                  <Link to={`/students/${student.id}`}>{language === 'DE' ? 'Profil öffnen' : 'Открыть профиль'} →</Link>
                </div>
                <details className="teacher-student-extra"><summary>{language === 'DE' ? 'Zugang und Eltern' : 'Доступ и родитель'}</summary>
                  <p>{language === 'DE' ? 'Login' : 'Логин'}: {student.username ?? '—'}</p>
                  <p>{student.parentFullName ?? (language === 'DE' ? 'Elternteil im Bereich „Eltern“ verknüpfen' : 'Родителя можно привязать в разделе «Родители»')}</p>
                </details>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TodayStatusBadge({ label, status, language }: { label: string; status: TodayCompletion['cards']; language: 'DE' | 'RU' }) {
  const text = status === 'done' ? (language === 'DE' ? 'Erledigt' : 'Выполнено') : status === 'pending' ? (language === 'DE' ? 'Offen' : 'Не выполнено') : (language === 'DE' ? 'Nicht geplant' : 'Не задано');
  return <div className={`teacher-today-status teacher-today-status--${status}`}><span>{label}</span><span className="teacher-today-status__value">{text}</span></div>;
}

function buildTodayCompletion(today: string, summary: CardSummary, homeworks: Homework[], reviewHistory: DailyReviewHistoryItem[]): TodayCompletion {
  const todayPdf = homeworks.filter((homework) => homework.startDate === today && homework.hasWorksheet);
  const homework: TodayCompletion['homework'] = todayPdf.length === 0 ? 'none' : todayPdf.every((item) => item.submitted) ? 'done' : 'pending';
  const todayReview = reviewHistory.find((item) => item.date === today && item.dueCount > 0);
  const todayCardBatches = homeworks.filter((homework) => homework.startDate === today && homework.totalCards > 0);
  const hasCardsToday = Boolean(todayReview) || todayCardBatches.length > 0 || summary.dueNow > 0;
  const cardsDoneByReview = todayReview?.status === 'COMPLETED';
  const cardsDoneByBatch = todayCardBatches.length > 0 && todayCardBatches.every((item) => item.status === 'COMPLETED');
  const cards: TodayCompletion['cards'] = !hasCardsToday ? 'none' : (cardsDoneByReview || cardsDoneByBatch) ? 'done' : 'pending';
  return { cards, homework };
}

function localDateString(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function schoolTypeLabel(schoolType: StudentListItem['schoolType'], language: 'DE' | 'RU') {
  if (!schoolType) return '—';
  const labels: Record<NonNullable<StudentListItem['schoolType']>, string> = {
    GYMNASIUM: 'Gymnasium',
    REALSCHULE: 'Realschule',
    MITTELSCHULE: 'Mittelschule',
    WIRTSCHAFTSSCHULE: 'Wirtschaftsschule',
    FACHOBERSCHULE: 'Fachoberschule (FOS)',
    GESAMTSCHULE: 'Gesamtschule',
    WERKREALSCHULE: 'Werkrealschule',
    OTHER: language === 'DE' ? 'Andere' : 'Другой',
  };
  return labels[schoolType];
}

function studentInitial(name: string) {
  return name.trim().charAt(0).toUpperCase() || '?';
}

function studentCountWord(count: number) {
  const mod10 = count % 10, mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return 'ученик';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'ученика';
  return 'учеников';
}
