import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { Homework, ImportPreview, StudentGroup } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import { toErrorMessage } from '../../lib/errors';

type CardTab = 'manual' | 'import';
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
        currentGroup.students.map(async (student) => [
          student.id,
          await api.homeworks.listForStudent(student.id),
        ] as const),
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
          rows.set(key, {
            key,
            startDate: homework.startDate,
            filename,
            pageCount: homework.worksheetPageCount ?? null,
          });
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

  if (!groupId) {
    return <div className="banner banner--error">Группа не найдена</div>;
  }

  async function addMembers(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    const emails = memberEmails
      .split(/[\n,;]+/)
      .map((email) => email.trim())
      .filter(Boolean);
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
    <div>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>{group?.name ?? 'Группа'}</h1>
          <div className="muted">Задания выдаются всей группе, но каждый ученик выполняет и сдаёт их отдельно.</div>
        </div>
        <Link className="btn btn--secondary" to="/groups">Назад к группам</Link>
      </div>

      {error && <div className="banner banner--error">{error}</div>}
      {message && <div className="banner banner--success">{message}</div>}

      <div className="panel">
        <h2>Добавить учеников</h2>
        <form onSubmit={addMembers}>
          <label className="field">
            <span className="field__label">Email учеников</span>
            <textarea
              className="textarea"
              value={memberEmails}
              onChange={(e) => setMemberEmails(e.target.value)}
              placeholder={'student1@example.com\nstudent2@example.com'}
              required
            />
          </label>
          <div className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
            Можно вставить несколько email через новую строку, запятую или точку с запятой.
          </div>
          <button className="btn" type="submit">Добавить в группу</button>
        </form>
      </div>

      <div className="panel">
        <h2>Ученики группы</h2>
        {!group ? (
          <p className="muted">{t('common.loading')}</p>
        ) : group.students.length === 0 ? (
          <p className="muted">В группе пока нет учеников</p>
        ) : (
          group.students.map((student) => (
            <div className="list-row" key={student.id}>
              <div>
                <div className="list-row__title">{student.fullName}</div>
                <div className="muted">{student.email ?? 'Email не указан'}</div>
              </div>
              <Link className="btn btn--secondary" to={`/students/${student.id}`}>Ошибки и карточки</Link>
            </div>
          ))
        )}
      </div>

      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ marginBottom: 4 }}>Сдача домашки по группе</h2>
            <div className="muted">✓ — ученик сдал PDF, ✕ — ещё не сдал.</div>
          </div>
          <button className="btn btn--secondary" type="button" onClick={() => loadHomeworkStatuses()} disabled={loadingHomeworkStatus}>
            {loadingHomeworkStatus ? 'Обновляем…' : 'Обновить'}
          </button>
        </div>

        {!group || loadingHomeworkStatus ? (
          <p className="muted">{t('common.loading')}</p>
        ) : groupHomeworkRows.length === 0 ? (
          <p className="muted">Групповых PDF-домашек пока нет.</p>
        ) : (
          <div style={{ overflowX: 'auto', marginTop: 12 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
              <thead>
                <tr>
                  <th style={tableHeaderStyle}>Домашка</th>
                  {group.students.map((student) => (
                    <th key={student.id} style={{ ...tableHeaderStyle, textAlign: 'center', minWidth: 120 }}>
                      {student.fullName}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groupHomeworkRows.map((row) => (
                  <tr key={row.key}>
                    <td style={tableCellStyle}>
                      <strong>{formatDate(row.startDate)}</strong>
                      <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                        {row.filename}{row.pageCount ? ` · ${row.pageCount} стр.` : ''}
                      </div>
                    </td>
                    {group.students.map((student) => {
                      const homework = findHomeworkForRow(homeworkByStudent[student.id] ?? [], row);
                      return (
                        <td key={student.id} style={{ ...tableCellStyle, textAlign: 'center' }}>
                          {homework ? (
                            <Link
                              to={`/teacher/students/${student.id}/homeworks/${homework.id}`}
                              title={homework.submitted ? 'Сдано — открыть' : 'Не сдано — открыть'}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                width: 34,
                                height: 34,
                                borderRadius: '50%',
                                textDecoration: 'none',
                                fontSize: 22,
                                fontWeight: 800,
                                color: homework.submitted ? '#15803d' : '#b91c1c',
                                background: homework.submitted ? '#dcfce7' : '#fee2e2',
                              }}
                            >
                              {homework.submitted ? '✓' : '✕'}
                            </Link>
                          ) : (
                            <span className="muted" title="Эта домашка не найдена у ученика">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel">
        <h2>Задать PDF-домашку всей группе</h2>
        <form className="stack" onSubmit={createGroupHomework}>
          <div className="row" style={{ alignItems: 'end', gap: 12, flexWrap: 'wrap' }}>
            <label className="field" style={{ margin: 0, flex: '1 1 220px' }}>
              <span className="field__label">Первый день</span>
              <input className="input" type="date" value={homeworkStartDate} onChange={(e) => setHomeworkStartDate(e.target.value)} disabled={creatingHomework} required />
            </label>
            <label className="field" style={{ margin: 0, flex: '0 1 180px' }}>
              <span className="field__label">На сколько дней</span>
              <input className="input" type="number" min={1} max={31} value={homeworkDays} onChange={(e) => changeHomeworkDays(Number(e.target.value))} disabled={creatingHomework} required />
            </label>
          </div>

          <div className="panel" style={{ padding: 12, margin: 0 }}>
            <strong>PDF на каждый день</strong>
            <p className="muted" style={{ marginTop: 6, marginBottom: 12, fontSize: 13 }}>
              Каждый PDF будет выдан каждому ученику группы на указанную дату. Файлы можно заменить, удалить или передвинуть на другую дату.
            </p>
            <div style={{ display: 'grid', gap: 12 }}>
              {homeworkDates.map((date, index) => {
                const file = homeworkFiles[index];
                return (
                  <div key={`${date}-${index}`} className="panel" style={{ padding: 12, margin: 0 }}>
                    <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <div><strong>День {index + 1}</strong><div className="muted">{formatDate(date)}</div></div>
                      {file && (
                        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                          <button type="button" className="btn btn--secondary" disabled={creatingHomework || index === 0} onClick={() => moveHomeworkFile(index, -1)}>↑</button>
                          <button type="button" className="btn btn--secondary" disabled={creatingHomework || index === homeworkDays - 1} onClick={() => moveHomeworkFile(index, 1)}>↓</button>
                          <button type="button" className="btn btn--danger" disabled={creatingHomework} onClick={() => removeHomeworkFile(index)}>Удалить</button>
                        </div>
                      )}
                    </div>
                    <label className="field" style={{ margin: '10px 0 0' }}>
                      <span className="field__label">{file ? 'Заменить PDF' : 'Выбрать PDF'}</span>
                      <input id={`group-homework-pdf-${index}`} className="input" type="file" accept="application/pdf,.pdf" disabled={creatingHomework} onChange={(event) => setHomeworkFile(index, event.target.files?.[0] ?? null)} />
                    </label>
                    <div style={{ marginTop: 8, overflowWrap: 'anywhere' }}>{file ? <strong>{file.name}</strong> : <span className="muted">Файл пока не выбран</span>}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {!allHomeworkFilesSelected && <div className="banner banner--info">Нужно выбрать PDF для каждого дня.</div>}

          <button className="btn" type="submit" disabled={!group || group.students.length === 0 || !allHomeworkFilesSelected || creatingHomework}>
            {creatingHomework ? 'Создаём домашки…' : `Задать группе на ${homeworkDays} дн.`}
          </button>
        </form>
      </div>

      <div className="panel">
        <h2>Выдать карточки всей группе</h2>
        <label className="field"><span className="field__label">Дата начала</span><input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required /></label>

        <div className="row" style={{ marginBottom: 16 }}>
          <button type="button" className={`btn ${cardTab === 'manual' ? '' : 'btn--ghost'}`} onClick={() => setCardTab('manual')}>Вручную</button>
          <button type="button" className={`btn ${cardTab === 'import' ? '' : 'btn--ghost'}`} onClick={() => setCardTab('import')}>Импорт</button>
        </div>

        {cardTab === 'manual' ? (
          <form onSubmit={createCard}>
            <label className="field"><span className="field__label">Вопрос</span><input className="input" value={question} onChange={(e) => setQuestion(e.target.value)} required /></label>
            <label className="field"><span className="field__label">Правильный ответ</span><input className="input" value={answer} onChange={(e) => setAnswer(e.target.value)} required /></label>
            <button className="btn" type="submit" disabled={!group || group.students.length === 0}>Добавить всей группе</button>
          </form>
        ) : (
          <div>
            <form onSubmit={makePreview}>
              <label className="field">
                <span className="field__label">Текст для импорта</span>
                <textarea className="textarea" value={rawText} onChange={(e) => setRawText(e.target.value)} placeholder={'2 + 2 -> 4 | 3 | 5 | 6\n3 + 3 -> 6 | 5 | 7 | 9'} required />
              </label>
              <div className="muted" style={{ fontSize: 13, marginBottom: 12 }}>Формат такой же, как у отдельного ученика: вопрос -&gt; правильный ответ | неверный 1 | неверный 2 | неверный 3</div>
              <button className="btn btn--secondary" type="submit">Предпросмотр</button>
            </form>

            {preview && (
              <div style={{ marginTop: 16 }}>
                <h3>Карточек: {preview.cards.length}</h3>
                {preview.cards.map((card, index) => (
                  <div className="list-row" key={index}>
                    <div>
                      <div className="list-row__title">{card.question}</div>
                      <div className="muted">Ответ: {card.correctAnswer}</div>
                      <div className="muted">Неверные: {card.wrongAnswer1} · {card.wrongAnswer2} · {card.wrongAnswer3}</div>
                    </div>
                  </div>
                ))}
                {preview.warnings.length > 0 && (
                  <div className="banner banner--info">
                    <strong>Предупреждения:</strong>
                    <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>{preview.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
                  </div>
                )}
                <button className="btn" type="button" onClick={importCards} disabled={!group || group.students.length === 0 || preview.cards.length === 0}>
                  Выдать {preview.cards.length} карточек всей группе
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const tableHeaderStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderBottom: '1px solid rgba(0,0,0,.12)',
  textAlign: 'left',
  verticalAlign: 'bottom',
  whiteSpace: 'nowrap',
};

const tableCellStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderBottom: '1px solid rgba(0,0,0,.08)',
  verticalAlign: 'middle',
};

function findHomeworkForRow(homeworks: Homework[], row: GroupHomeworkRow) {
  return homeworks.find((homework) =>
    homework.hasWorksheet
    && homework.startDate === row.startDate
    && (homework.worksheetFilename ?? 'Домашка в PDF') === row.filename
    && (homework.worksheetPageCount ?? null) === row.pageCount,
  );
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
