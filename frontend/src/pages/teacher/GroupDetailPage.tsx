import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { Homework, ImportPreview, StudentGroup } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import { toErrorMessage } from '../../lib/errors';

type CardTab = 'manual' | 'import';
type PageTab = 'overview' | 'students' | 'homework' | 'cards';
type HomeworkByStudent = Record<string, Homework[]>;

type GroupHomeworkRow = {
  key: string;
  startDate: string;
  filename: string;
  pageCount: number | null;
};

export function GroupDetailPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const { t } = useI18n();
  const [group, setGroup] = useState<StudentGroup | null>(null);
  const [pageTab, setPageTab] = useState<PageTab>('overview');
  const [memberEmails, setMemberEmails] = useState('');
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [cardTab, setCardTab] = useState<CardTab>('manual');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [rawText, setRawText] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [homeworkStartDate, setHomeworkStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [homeworkDays, setHomeworkDays] = useState(1);
  const [homeworkFiles, setHomeworkFiles] = useState<Array<File | null>>([null]);
  const [creatingHomework, setCreatingHomework] = useState(false);
  const [homeworkByStudent, setHomeworkByStudent] = useState<HomeworkByStudent>({});
  const [loadingHomeworkStatus, setLoadingHomeworkStatus] = useState(false);

  useEffect(() => {
    if (!groupId) return;
    api.groups.get(groupId)
      .then(async (payload) => {
        setGroup(payload);
        await loadHomeworkStatuses(payload);
      })
      .catch((e) => setError(toErrorMessage(e, t)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, t]);

  async function loadHomeworkStatuses(currentGroup: StudentGroup | null = group) {
    if (!currentGroup || currentGroup.students.length === 0) {
      setHomeworkByStudent({});
      return;
    }
    setLoadingHomeworkStatus(true);
    try {
      const entries = await Promise.all(
        currentGroup.students.map(async (student) => [student.id, await api.homeworks.listForStudent(student.id)] as const),
      );
      setHomeworkByStudent(Object.fromEntries(entries));
    } finally {
      setLoadingHomeworkStatus(false);
    }
  }

  const homeworkDates = useMemo(
    () => Array.from({ length: homeworkDays }, (_, index) => addDays(homeworkStartDate, index)),
    [homeworkStartDate, homeworkDays],
  );

  const allHomeworkFilesSelected = homeworkFiles.length === homeworkDays && homeworkFiles.every((file) => file !== null);

  const groupHomeworkRows = useMemo<GroupHomeworkRow[]>(() => {
    if (!group || group.students.length === 0) return [];
    const rows = new Map<string, GroupHomeworkRow>();
    for (const student of group.students) {
      for (const homework of homeworkByStudent[student.id] ?? []) {
        if (!homework.hasWorksheet) continue;
        const filename = homework.worksheetFilename ?? 'Домашка в PDF';
        const key = `${homework.startDate}::${filename}::${homework.worksheetPageCount ?? ''}`;
        if (!rows.has(key)) {
          rows.set(key, { key, startDate: homework.startDate, filename, pageCount: homework.worksheetPageCount ?? null });
        }
      }
    }
    return Array.from(rows.values())
      .filter((row) => {
        const matches = group.students.filter((student) => findHomeworkForRow(homeworkByStudent[student.id] ?? [], row)).length;
        return group.students.length === 1 || matches >= 2;
      })
      .sort((a, b) => b.startDate.localeCompare(a.startDate) || a.filename.localeCompare(b.filename));
  }, [group, homeworkByStudent]);

  const activeHomeworkCount = useMemo(() => {
    const today = localDateString(new Date());
    return groupHomeworkRows.filter((row) => row.startDate >= today).length;
  }, [groupHomeworkRows]);

  if (!groupId) return <div className="banner banner--error">Группа не найдена</div>;

  async function addMembers(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    const emails = memberEmails.split(/[\n,;]+/).map((email) => email.trim()).filter(Boolean);
    if (emails.length === 0) return;
    try {
      const updated = await api.groups.addMembers(groupId!, emails);
      setGroup(updated);
      setMemberEmails('');
      setMessage(`Добавлено учеников: ${updated.students.length}.`);
      await loadHomeworkStatuses(updated);
    } catch (e) {
      setError(toErrorMessage(e, t));
    }
  }

  function changeHomeworkDays(value: number) {
    const next = Math.max(1, Math.min(31, value || 1));
    setHomeworkDays(next);
    setHomeworkFiles((current) => Array.from({ length: next }, (_, index) => current[index] ?? null));
  }

  function setHomeworkFile(index: number, file: File | null) {
    setHomeworkFiles((current) => current.map((existing, currentIndex) => currentIndex === index ? file : existing));
  }

  function removeHomeworkFile(index: number) {
    setHomeworkFile(index, null);
    const input = document.getElementById(`group-homework-pdf-${index}`) as HTMLInputElement | null;
    if (input) input.value = '';
  }

  function moveHomeworkFile(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= homeworkFiles.length) return;
    setHomeworkFiles((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function createGroupHomework(event: FormEvent) {
    event.preventDefault();
    if (!group || group.students.length === 0 || !allHomeworkFilesSelected || creatingHomework) return;
    setCreatingHomework(true);
    setError(null);
    setMessage(null);
    try {
      for (let index = 0; index < homeworkFiles.length; index += 1) {
        const file = homeworkFiles[index];
        if (!file) continue;
        await api.groups.createPdfHomework(groupId!, homeworkDates[index], file);
      }
      setHomeworkFiles(Array.from({ length: homeworkDays }, () => null));
      setMessage(`Готово: ${homeworkDays} домашних работ выдано всей группе.`);
      await loadHomeworkStatuses(group);
    } catch (e) {
      setError(toErrorMessage(e, t));
    } finally {
      setCreatingHomework(false);
    }
  }

  async function createCard(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    try {
      const count = await api.groups.createCard(groupId!, startDate, question.trim(), answer.trim());
      setQuestion('');
      setAnswer('');
      setMessage(`Карточка создана для ${count} учеников.`);
    } catch (e) {
      setError(toErrorMessage(e, t));
    }
  }

  async function makePreview(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    try {
      setPreview(await api.cards.importPreview(rawText, '->', '\n'));
    } catch (e) {
      setError(toErrorMessage(e, t));
    }
  }

  async function importCards() {
    if (!preview || preview.cards.length === 0) return;
    setError(null);
    setMessage(null);
    try {
      const created = await api.groups.importCards(groupId!, startDate, preview.cards);
      const studentCount = group?.students.length ?? 0;
      setMessage(`Готово: ${preview.cards.length} карточек выдано ${studentCount} ученикам (${created} индивидуальных карточек).`);
      setPreview(null);
      setRawText('');
    } catch (e) {
      setError(toErrorMessage(e, t));
    }
  }

  return (
    <div className="group-detail-dashboard">
      <Link className="group-detail-back" to="/groups">← <span>Назад к группам</span></Link>

      <div className="group-detail-heading">
        <div>
          <h1>{group?.name ?? 'Группа'}</h1>
          <p>Управляйте учениками, домашними заданиями и карточками для всей группы.</p>
        </div>
      </div>

      {error && <div className="banner banner--error">{error}</div>}
      {message && <div className="banner banner--success">{message}</div>}

      <div className="group-summary-grid">
        <button type="button" className="group-summary-card" onClick={() => setPageTab('students')}>
          <div className="group-summary-card__icon group-summary-card__icon--orange">♙</div>
          <div><strong>{group?.students.length ?? 0}</strong><span>ученика</span></div>
          <small>Перейти к ученикам →</small>
        </button>
        <button type="button" className="group-summary-card" onClick={() => setPageTab('homework')}>
          <div className="group-summary-card__icon group-summary-card__icon--yellow">▤</div>
          <div><strong>{activeHomeworkCount}</strong><span>активное ДЗ</span></div>
          <small>Перейти к домашним заданиям →</small>
        </button>
        <div className="group-summary-card group-summary-card--lesson">
          <div className="group-summary-card__icon group-summary-card__icon--green">▣</div>
          <div><span>Следующий урок</span><strong className="group-summary-card__lesson">—</strong></div>
          <small>Расписание появится позже →</small>
        </div>
      </div>

      <div className="group-detail-tabs">
        <button className={pageTab === 'overview' ? 'active' : ''} onClick={() => setPageTab('overview')}>▤ <span>Обзор</span></button>
        <button className={pageTab === 'students' ? 'active' : ''} onClick={() => setPageTab('students')}>♙ <span>Ученики</span></button>
        <button className={pageTab === 'homework' ? 'active' : ''} onClick={() => setPageTab('homework')}>▣ <span>Домашние задания</span></button>
        <button className={pageTab === 'cards' ? 'active' : ''} onClick={() => setPageTab('cards')}>▥ <span>Карточки</span></button>
        <div className="group-detail-tabs__spacer" />
        <button className="group-message-btn" type="button" disabled>✉ <span>Написать группе</span></button>
        <button className="teacher-more-btn" type="button" title="Дополнительно">⋮</button>
      </div>

      {pageTab === 'overview' && (
        <>
          <section className="group-overview-card">
            <div className="group-overview-card__header">
              <div>
                <h2>Обзор домашних заданий</h2>
                <p>✓ — ученик сдал PDF, ✕ — ещё не сдал.</p>
              </div>
              <button className="group-refresh-btn" type="button" onClick={() => loadHomeworkStatuses()} disabled={loadingHomeworkStatus}>
                {loadingHomeworkStatus ? 'Обновляем…' : 'Обновить'}
              </button>
            </div>

            {!group || loadingHomeworkStatus ? (
              <p className="muted">{t('common.loading')}</p>
            ) : groupHomeworkRows.length === 0 ? (
              <div className="teacher-empty-state">Групповых PDF-домашек пока нет.</div>
            ) : (
              <div className="group-homework-table-wrap">
                <table className="group-homework-table">
                  <thead>
                    <tr>
                      <th>Название задания</th>
                      <th>Дата задания</th>
                      {group.students.map((student) => (
                        <th key={student.id}>
                          <span className="group-table-avatar">{student.fullName.charAt(0).toUpperCase()}</span>
                          <span>{student.fullName}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {groupHomeworkRows.slice(0, 5).map((row) => (
                      <tr key={row.key}>
                        <td><span className="group-pdf-icon">PDF</span><span>{row.filename}</span></td>
                        <td>{formatDate(row.startDate)}</td>
                        {group.students.map((student) => {
                          const homework = findHomeworkForRow(homeworkByStudent[student.id] ?? [], row);
                          return (
                            <td key={student.id}>
                              {homework ? (
                                <Link className={`group-status-dot ${homework.submitted ? 'is-done' : 'is-missed'}`} to={`/teacher/students/${student.id}/homeworks/${homework.id}`}>
                                  {homework.submitted ? '✓' : '✕'}
                                </Link>
                              ) : <span className="muted">—</span>}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {groupHomeworkRows.length > 5 && (
              <button className="group-show-all" type="button" onClick={() => setPageTab('homework')}>Показать все задания</button>
            )}
          </section>

          <div className="group-tip">💡 <strong>Совет:</strong>&nbsp; используйте вкладки выше, чтобы управлять учениками, домашними заданиями и карточками отдельно.</div>
        </>
      )}

      {pageTab === 'students' && (
        <section className="group-members-card">
          <div className="group-members-card__header">
            <div>
              <h2>Ученики группы</h2>
              <p>Все ученики этой группы. Здесь можно открыть профиль ученика или добавить нового.</p>
            </div>
            <span>{group?.students.length ?? 0} учеников</span>
          </div>
          <div className="group-member-list">
            {group?.students.map((student, index) => (
              <div className="group-member-row" key={student.id}>
                <span className={`teacher-member-avatar teacher-member-avatar--${index % 4}`}>{student.fullName.charAt(0).toUpperCase()}</span>
                <div><strong>{student.fullName}</strong><span>{student.email ?? 'Email не указан'}</span></div>
                <Link to={`/students/${student.id}`} className="group-member-open">Открыть ученика</Link>
              </div>
            ))}
          </div>
          <form className="group-add-member" onSubmit={addMembers}>
            <input className="input" value={memberEmails} onChange={(e) => setMemberEmails(e.target.value)} placeholder="Email нового ученика" required />
            <button className="btn" type="submit">Добавить</button>
          </form>
        </section>
      )}

      {pageTab === 'homework' && (
        <div className="group-tab-stack">
          <section className="group-overview-card">
            <div className="group-overview-card__header">
              <div><h2>Сдача домашки по группе</h2><p>Статус каждого ученика по всем выданным PDF.</p></div>
              <button className="group-refresh-btn" type="button" onClick={() => loadHomeworkStatuses()} disabled={loadingHomeworkStatus}>Обновить</button>
            </div>
            <div className="group-homework-table-wrap">
              <table className="group-homework-table">
                <thead><tr><th>Название задания</th><th>Дата задания</th>{group?.students.map((student) => <th key={student.id}>{student.fullName}</th>)}</tr></thead>
                <tbody>{groupHomeworkRows.map((row) => <tr key={row.key}><td><span className="group-pdf-icon">PDF</span>{row.filename}</td><td>{formatDate(row.startDate)}</td>{group?.students.map((student) => { const homework = findHomeworkForRow(homeworkByStudent[student.id] ?? [], row); return <td key={student.id}>{homework ? <Link className={`group-status-dot ${homework.submitted ? 'is-done' : 'is-missed'}`} to={`/teacher/students/${student.id}/homeworks/${homework.id}`}>{homework.submitted ? '✓' : '✕'}</Link> : '—'}</td>; })}</tr>)}</tbody>
              </table>
            </div>
          </section>

          <section className="group-work-card">
            <h2>Задать PDF-домашку всей группе</h2>
            <form className="stack" onSubmit={createGroupHomework}>
              <div className="group-homework-options">
                <label className="field"><span className="field__label">Первый день</span><input className="input" type="date" value={homeworkStartDate} onChange={(e) => setHomeworkStartDate(e.target.value)} disabled={creatingHomework} required /></label>
                <label className="field"><span className="field__label">На сколько дней</span><input className="input" type="number" min={1} max={31} value={homeworkDays} onChange={(e) => changeHomeworkDays(Number(e.target.value))} disabled={creatingHomework} required /></label>
              </div>
              <div className="group-day-grid">
                {homeworkDates.map((date, index) => {
                  const file = homeworkFiles[index];
                  return <div key={`${date}-${index}`} className="group-day-card"><div className="group-day-card__head"><div><strong>День {index + 1}</strong><span>{formatDate(date)}</span></div>{file && <div><button type="button" className="mini-icon-btn" disabled={index === 0} onClick={() => moveHomeworkFile(index, -1)}>↑</button><button type="button" className="mini-icon-btn" disabled={index === homeworkDays - 1} onClick={() => moveHomeworkFile(index, 1)}>↓</button><button type="button" className="mini-delete-btn" onClick={() => removeHomeworkFile(index)}>Удалить</button></div>}</div><label className="field"><span className="field__label">{file ? 'Заменить PDF' : 'Выбрать PDF'}</span><input id={`group-homework-pdf-${index}`} className="input" type="file" accept="application/pdf,.pdf" disabled={creatingHomework} onChange={(event) => setHomeworkFile(index, event.target.files?.[0] ?? null)} /></label><span className="group-day-card__file">{file?.name ?? 'Файл пока не выбран'}</span></div>;
                })}
              </div>
              {!allHomeworkFilesSelected && <div className="banner banner--info">Нужно выбрать PDF для каждого дня.</div>}
              <button className="btn group-submit-btn" type="submit" disabled={!group || group.students.length === 0 || !allHomeworkFilesSelected || creatingHomework}>{creatingHomework ? 'Создаём домашки…' : `Задать группе на ${homeworkDays} дн.`}</button>
            </form>
          </section>
        </div>
      )}

      {pageTab === 'cards' && (
        <section className="group-work-card">
          <h2>Выдать карточки всей группе</h2>
          <label className="field"><span className="field__label">Дата начала</span><input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required /></label>
          <div className="group-card-tabs"><button type="button" className={cardTab === 'manual' ? 'active' : ''} onClick={() => setCardTab('manual')}>Вручную</button><button type="button" className={cardTab === 'import' ? 'active' : ''} onClick={() => setCardTab('import')}>Импорт</button></div>
          {cardTab === 'manual' ? (
            <form onSubmit={createCard}><label className="field"><span className="field__label">Вопрос</span><input className="input" value={question} onChange={(e) => setQuestion(e.target.value)} required /></label><label className="field"><span className="field__label">Правильный ответ</span><input className="input" value={answer} onChange={(e) => setAnswer(e.target.value)} required /></label><button className="btn" type="submit" disabled={!group || group.students.length === 0}>Добавить всей группе</button></form>
          ) : (
            <div><form onSubmit={makePreview}><label className="field"><span className="field__label">Текст для импорта</span><textarea className="textarea" value={rawText} onChange={(e) => setRawText(e.target.value)} placeholder={'2 + 2 -> 4 | 3 | 5 | 6\n3 + 3 -> 6 | 5 | 7 | 9'} required /></label><button className="btn btn--secondary" type="submit">Предпросмотр</button></form>{preview && <div className="group-preview"><h3>Карточек: {preview.cards.length}</h3>{preview.cards.map((card, index) => <div className="list-row" key={index}><div><div className="list-row__title">{card.question}</div><div className="muted">Ответ: {card.correctAnswer}</div></div></div>)}<button className="btn" type="button" onClick={importCards} disabled={!group || group.students.length === 0 || preview.cards.length === 0}>Выдать {preview.cards.length} карточек всей группе</button></div>}</div>
          )}
        </section>
      )}
    </div>
  );
}

function findHomeworkForRow(homeworks: Homework[], row: GroupHomeworkRow) {
  return homeworks.find((homework) => homework.hasWorksheet && homework.startDate === row.startDate && (homework.worksheetFilename ?? 'Домашка в PDF') === row.filename && (homework.worksheetPageCount ?? null) === row.pageCount);
}

function addDays(dateString: string, days: number) {
  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  return localDateString(date);
}

function localDateString(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(`${date}T00:00:00`));
}
