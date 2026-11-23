import { useState } from 'react';
import { HomeworkMathText } from './HomeworkMathText';
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
      <span className="morning-homework-remaining">{de ? 'Noch nicht abgegeben: ' : 'Не сдано: '}{rows.reduce((sum, row) => sum + row.pending, 0)}</span>
    </div>
    <div className="morning-homework-track" role="progressbar" aria-label={de ? 'Abgegebene Hausaufgaben insgesamt' : 'Сданная домашняя работа, всего'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={totalPercent}>
      <span style={{width: totalPercent + '%'}} />
    </div>
    {rows.map(row => <div className="morning-homework-row" key={row.student}>
      <div className="morning-homework-row-heading">
        <strong>{row.student}</strong>
        <span>{row.submitted}/{row.assigned} · {homeworkPercent(row.assigned, row.submitted)}% · {de ? 'offen' : 'не сдано'} {row.pending}</span>
      </div>
      <div className="morning-homework-track morning-homework-track--student" role="progressbar" aria-label={(de ? 'Hausaufgaben: ' : 'Домашка: ') + row.student} aria-valuemin={0} aria-valuemax={100} aria-valuenow={homeworkPercent(row.assigned, row.submitted)}>
        <span style={{width: homeworkPercent(row.assigned, row.submitted) + '%'}} />
      </div>
    </div>)}
  </div>;
}

function compareDifference(student: string, correct: string): {wrong: string; right: string} | null {
  const a = student.trim().replace(/−/g, '-').replace(/\s+/g, '');
  const b = correct.trim().replace(/−/g, '-').replace(/\s+/g, '');
  if (!a || !b || a === b) return null;
  const left = a.match(/^(.*?)([+-])(\d+(?:[.,]\d+)?[a-zA-Z]*)$/);
  const right = b.match(/^(.*?)([+-])(\d+(?:[.,]\d+)?[a-zA-Z]*)$/);
  if (left && right && left[1] === right[1] && left[3] === right[3] && left[2] !== right[2])
    return {wrong: left[2] + left[3], right: right[2] + right[3]};
  return null;
}
function HomeworkIssueCard({issue, de, index, total, onNavigate}: {
  issue: Issue;
  de: boolean;
  index: number;
  total: number;
  onNavigate: (direction: -1 | 1) => void;
}) {
  const diff = compareDifference(issue.studentAnswer, issue.correctAnswer);
  const date = /20\d{2}-(\d{2})-(\d{2})/.exec(issue.source);
  const taskNumber = /(?:Aufgabe|Задание|№)\s*(\d+)/i.exec(issue.page);
  const signError = /знак|vorzeichen/i.test(issue.difficulty);
  return <article className="morning-error-card">
    <div className="morning-error-heading">
      <strong>{issue.student}</strong>
      <div className="morning-error-navigation" role="group"
        aria-label={de ? 'Fehler wechseln' : 'Переключение ошибок'}>
        {total > 1 && <button type="button" className="morning-error-nav-button"
          aria-label={de ? 'Vorheriger Fehler' : 'Предыдущая ошибка'}
          title={de ? 'Vorheriger Fehler' : 'Предыдущая ошибка'}
          onClick={() => onNavigate(-1)}>←</button>}
        <span className="morning-error-counter" aria-live="polite">
          {de ? 'Fehler' : 'Ошибка'} {index + 1} {de ? 'von' : 'из'} {total}
        </span>
        {total > 1 && <button type="button" className="morning-error-nav-button"
          aria-label={de ? 'Nächster Fehler' : 'Следующая ошибка'}
          title={de ? 'Nächster Fehler' : 'Следующая ошибка'}
          onClick={() => onNavigate(1)}>→</button>}
      </div>
    </div>
    <div className="morning-error-topic"><span className="morning-error-alert" aria-hidden="true">!</span>{signError ? (de ? 'Vorzeichenfehler' : 'Ошибка со знаком') : issue.difficulty}</div>
    <div className="morning-error-section">
      <span className="morning-error-label">{de ? 'Aufgabe' : 'Задание'}{taskNumber ? ' ' + taskNumber[1] : ''}</span>
      <p><HomeworkMathText value={issue.task} /></p>
    </div>
    <div className="morning-error-answer">
      <div className="morning-error-answer-box morning-error-answer-box--wrong">
        <span className="morning-error-answer-caption"><span aria-hidden="true">×</span>{de ? 'Schüler' : 'Ученик'}</span>
        <strong><HomeworkMathText value={issue.studentAnswer} /></strong>
      </div>
      <div className="morning-error-answer-box morning-error-answer-box--right">
        <span className="morning-error-answer-caption"><span aria-hidden="true">✓</span>{de ? 'Richtig' : 'Правильно'}</span>
        <strong><HomeworkMathText value={issue.correctAnswer} /></strong>
      </div>
    </div>
    {diff && <div className="morning-error-difference"><span aria-hidden="true">→</span> {de ? 'Unterschied:' : 'Разница:'} <b className="morning-error-wrong"><HomeworkMathText value={diff.wrong} /></b> {de ? 'statt' : 'вместо'} <b className="morning-error-right"><HomeworkMathText value={diff.right} /></b></div>}
    <div className="morning-error-footer"><span>{de ? 'Hausaufgabe' : 'Домашняя работа'}{date ? ' · ' + date[2] + '.' + date[1] : ''}</span><span>{de ? 'Im Unterricht besprechen' : 'Разобрать на уроке'}</span></div>
    <details className="morning-error-source-details"><summary>{de ? 'PDF-Quelle' : 'Источник PDF'}</summary><p>{issue.source}{issue.page ? ' · ' + issue.page : ''}</p></details>
  </article>;
}

export function MorningDifficulties({raw, de}: {raw: string | null | undefined; de: boolean}) {
  const issues = getIssues(raw);
  // Store the source with the index so a new lesson's results always start at error 1.
  const [selection, setSelection] = useState<{raw: string | null | undefined; index: number}>({raw, index: 0});
  if (issues === null) return <p className="muted morning-difficulties-pending">{de
    ? 'Die wichtigsten nachweisbaren Hausaufgabenfehler folgen nach der morgendlichen Prüfung.'
    : 'Главные ошибки из проверенной домашки появятся после утренней подготовки.'}</p>;
  if (!issues.length) return <div className="morning-digest-neutral">
    <strong>{de ? 'Belegte Fehler zur Besprechung: 0' : 'Подтверждённых ошибок для разбора: 0'}</strong>
    <p>{de ? 'Für diese Abgaben sind keine zuverlässig belegten Fehler erfasst. Das bedeutet nicht, dass alles korrekt ist.'
      : 'В проверенных материалах нет надёжно подтверждённых ошибок. Это не означает, что вся домашка решена верно.'}</p>
  </div>;
  const currentIndex = selection.raw === raw && selection.index < issues.length ? selection.index : 0;
  const navigate = (direction: -1 | 1) => {
    setSelection(previous => ({
      raw,
      index: ((previous.raw === raw ? previous.index : 0) + direction + issues.length) % issues.length,
    }));
  };
  return <div className="morning-difficulties morning-difficulties--compact">
    <div className="morning-difficulties-overview" role="status">
      <strong>{de ? 'Wichtige Fehler zur Besprechung: ' : 'Главных ошибок для разбора: '}{issues.length}</strong>
      <span>{de ? 'Ausgewählte, belegte Beispiele; keine Gesamtzahl aller Fehler.'
        : 'Только основные подтверждённые примеры, не общее число всех ошибок.'}</span>
    </div>
    <HomeworkIssueCard key={issues[currentIndex].source + ':' + currentIndex}
      issue={issues[currentIndex]} de={de} index={currentIndex} total={issues.length}
      onNavigate={navigate} />
  </div>;
}
