import './morning-lesson-digest.css';

type Issue = {
  student: string;
  task: string;
  studentAnswer: string;
  correctAnswer: string;
  difficulty: string;
  source: string;
  page: string;
};
type Summary = { student: string; assigned: number; submitted: number; pending: number };

function getIssues(raw: string | null | undefined): Issue[] | null {
  if (!raw) return null;
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== 'object' || !('kind' in data) || !('issues' in data)) return null;
    const result = data as {kind?: unknown; issues?: unknown};
    if (result.kind !== 'homework_errors_v1' || !Array.isArray(result.issues)) return null;
    const issues: Issue[] = [];
    for (const rawIssue of result.issues) {
      if (!rawIssue || typeof rawIssue !== 'object') continue;
      const item = rawIssue as Record<string, unknown>;
      const fields = ['student', 'task', 'studentAnswer', 'correctAnswer', 'difficulty', 'source', 'page'];
      if (!fields.every(key => typeof item[key] === 'string')) continue;
      if (['student', 'task', 'studentAnswer', 'correctAnswer', 'difficulty', 'source'].some(key => !(item[key] as string).trim())) continue;
      issues.push(Object.fromEntries(fields.map(key => [key, (item[key] as string).slice(0,700)])) as Issue);
      if (issues.length === 5) break;
    }
    return issues;
  } catch {
    return null;
  }
}

function getHomeworkSummary(raw: string | null | undefined): Summary[] {
  if (!raw) return [];
  return raw.split('\n').flatMap(line => {
    const match = /^(.+?): задано (\d+), сдано (\d+), ещё не сдано (\d+)\./.exec(line.trim());
    if (!match) return [];
    return [{student: match[1], assigned: Number(match[2]), submitted: Number(match[3]), pending: Number(match[4])}];
  });
}

/** Derived data only: never treat an absent submitted PDF as a student's mistake. */
function homeworkPercent(assigned: number, submitted: number): number {
  if (assigned <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((submitted / assigned) * 100)));
}

export function MorningHomeworkSummary({raw, de}: {raw: string | null | undefined; de: boolean}) {
  const rows = getHomeworkSummary(raw);
  if (!rows.length) return <div className="morning-homework-pending">
    <div className="morning-homework-track morning-homework-track--pending" aria-hidden="true" />
    <p className="muted">{de
      ? 'Übersicht folgt nach der morgendlichen Vorbereitung.'
      : 'Статистика появится после утренней подготовки.'}</p>
  </div>;

  const totalAssigned = rows.reduce((sum, row) => sum + row.assigned, 0);
  const totalSubmitted = rows.reduce((sum, row) => sum + row.submitted, 0);
  const totalPercent = homeworkPercent(totalAssigned, totalSubmitted);
  return <div className="morning-homework morning-homework--compact">
    <div className="morning-homework-overview">
      <span>{de ? 'Hausaufgaben abgegeben' : 'Домашка сдана'}</span>
      <strong>{totalSubmitted}/{totalAssigned} · {totalPercent}%</strong>
    </div>
    <div className="morning-homework-track" role="progressbar" aria-label={de ? 'Abgegebene Hausaufgaben insgesamt' : 'Сданная домашняя работа, всего'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={totalPercent}>
      <span style={{width: totalPercent + '%'}} />
    </div>
    {rows.map(row => <div className="morning-homework-row" key={row.student}>
      <div className="morning-homework-row-heading">
        <strong>{row.student}</strong>
        <span>{row.submitted}/{row.assigned} · {homeworkPercent(row.assigned, row.submitted)}%</span>
      </div>
      <div className="morning-homework-track morning-homework-track--student" role="progressbar" aria-label={(de ? 'Hausaufgaben: ' : 'Домашка: ') + row.student} aria-valuemin={0} aria-valuemax={100} aria-valuenow={homeworkPercent(row.assigned, row.submitted)}>
        <span style={{width: homeworkPercent(row.assigned, row.submitted) + '%'}} />
      </div>
    </div>)}
  </div>;
}

function HomeworkIssueCard({issue, de}: {issue: Issue; de: boolean}) {
  return <article className="morning-error-card">
    <div className="morning-error-heading">
      <strong>{issue.student}</strong>
      <span>{de ? 'Wiederholen' : 'Нужно разобрать'}</span>
    </div>
    <div className="morning-error-topic">{issue.difficulty}</div>
    <div className="morning-error-section">
      <span className="morning-error-label">{de ? 'Aufgabe' : 'Задание'}</span>
      <p>{issue.task}</p>
    </div>
    <div className="morning-error-answer">
      <span><b>{de ? 'Antwort des Kindes:' : 'Ответ ученика:'}</b> {issue.studentAnswer}</span>
      <span><b>{de ? 'Richtig:' : 'Правильно:'}</b> {issue.correctAnswer}</span>
    </div>
    <p className="morning-error-source">{de ? 'Quelle' : 'Источник'}: {issue.source}{issue.page ? ' · ' + issue.page : ''}</p>
  </article>;
}

export function MorningDifficulties({raw, de}: {raw: string | null | undefined; de: boolean}) {
  const issues = getIssues(raw);
  if (issues === null) return <p className="muted morning-difficulties-pending">{de
    ? 'Die wichtigsten nachweisbaren Hausaufgabenfehler folgen nach der morgendlichen Prüfung.'
    : 'Главные ошибки из проверенной домашки появятся после утренней подготовки.'}</p>;
  if (!issues.length) return <div className="morning-digest-neutral">{de
    ? 'Keine nachweisbaren Aufgabenfehler zum Anzeigen.'
    : 'Нет подтверждённых ошибок для показа.'}</div>;
  return <div className="morning-difficulties morning-difficulties--compact">
    <HomeworkIssueCard key={issues[0].source + ':0'} issue={issues[0]} de={de} />
    {issues.length > 1 && <details className="morning-difficulties-more">
      <summary>{de ? 'Weitere Fehler anzeigen: ' : 'Показать остальные ошибки: '}{issues.length - 1}</summary>
      <div className="morning-difficulties-expanded">
        {issues.slice(1).map((issue, index) => <HomeworkIssueCard key={issue.source + ':' + issue.page + ':' + index} issue={issue} de={de} />)}
      </div>
    </details>}
  </div>;
}
