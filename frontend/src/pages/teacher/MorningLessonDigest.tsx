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
export function MorningHomeworkSummary({raw, de}: {raw: string | null | undefined; de: boolean}) {
  const rows = getHomeworkSummary(raw);
  if (!rows.length) return <p className="muted">{de ? 'Hausaufgabenübersicht wird bei der morgendlichen Vorbereitung erstellt.' : 'Сводка заданной и сданной домашки появится после утренней подготовки.'}</p>;
  return <div className="morning-homework">
    <p className="morning-digest-caption">{de ? 'Automatische Übersicht seit der letzten Stunde' : 'Автоматическая сводка после прошлого занятия'}</p>
    {rows.map(row => <div className="morning-homework-row" key={row.student}>
      <strong>{row.student}</strong>
      <div className="morning-homework-metrics">
        <span>{de ? 'Aufgegeben' : 'Задано'}: <b>{row.assigned}</b></span>
        <span>{de ? 'Abgegeben' : 'Сдано'}: <b>{row.submitted}</b></span>
        <span>{de ? 'Offen' : 'Ожидается'}: <b>{row.pending}</b></span>
      </div>
    </div>)}
  </div>;
}

export function MorningDifficulties({raw, de}: {raw: string | null | undefined; de: boolean}) {
  const issues = getIssues(raw);
  if (issues === null) return <p className="muted">{de
    ? 'Die wichtigsten Fehler aus überprüfbaren Hausaufgaben erscheinen hier nach der morgendlichen Vorbereitung.'
    : 'Здесь появятся только основные ошибки из проверяемых домашних работ после утренней подготовки.'}</p>;
  if (!issues.length) return <div className="morning-digest-neutral">{de
    ? 'Keine ausreichend belegten Aufgabenfehler gefunden.'
    : 'Нет надёжно подтверждённых ошибок для показа. Это не означает, что все задания решены правильно.'}</div>;
  return <div className="morning-difficulties">
    <p className="morning-digest-caption">{de
      ? 'Wichtigste Schwierigkeiten: echte Aufgaben und Schülerantworten'
      : 'Только основные затруднения: реальные задания и ответы учеников'}</p>
    {issues.map((issue, i) => <article className="morning-error-card" key={issue.source + ':' + issue.page + ':' + i}>
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
    </article>)}
  </div>;
}
