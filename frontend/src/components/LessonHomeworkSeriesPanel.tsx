import { useEffect, useMemo, useState } from 'react';
import type { GroupLesson } from '../api/types';
import type { HomeworkSeriesResult } from '../api/lessonPreparation';
import { GoogleDrivePdfPicker } from '../pages/teacher/GoogleDrivePdfPicker';

type Props = {
  lesson: GroupLesson | null;
  onAssign: (startDate: string, days: number, files: File[]) => Promise<HomeworkSeriesResult>;
};

export function LessonHomeworkSeriesPanel({ lesson, onAssign }: Props) {
  const [startDate, setStartDate] = useState('');
  const [days, setDays] = useState(7);
  const [files, setFiles] = useState<File[]>([]);
  const [assigning, setAssigning] = useState(false);
  const [result, setResult] = useState<HomeworkSeriesResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!lesson?.startsAt) return;
    const date = new Date(lesson.startsAt);
    date.setDate(date.getDate() + 1);
    setStartDate(toInputDate(date));
  }, [lesson?.startsAt]);

  useEffect(() => {
    setResult(null);
    setError(null);
    if (files.length > 1 && files.length !== days) setFiles([]);
  }, [days]); // eslint-disable-line react-hooks/exhaustive-deps

  const targetLabel = useMemo(() => {
    if (!lesson) return 'уроку';
    if (lesson.groupName) return `группе «${lesson.groupName}»`;
    if (lesson.studentName) return `ученику ${lesson.studentName}`;
    return 'уроку';
  }, [lesson]);

  const canAssign = Boolean(
    lesson &&
    (lesson.groupId || lesson.studentId) &&
    startDate &&
    (files.length === 1 || files.length === days) &&
    !assigning,
  );

  function acceptFiles(next: File[]) {
    setError(null);
    setResult(null);
    const pdfs = next.filter((file) => file.name.toLowerCase().endsWith('.pdf'));
    if (pdfs.length !== next.length) {
      setError('Можно загружать только PDF-файлы.');
      return;
    }
    if (pdfs.length !== 1 && pdfs.length !== days) {
      setError(`Выберите либо 1 PDF на все ${days} дн., либо ровно ${days} PDF — по одному на каждый день.`);
      return;
    }
    setFiles(pdfs);
  }

  async function assign() {
    if (!canAssign) return;
    setAssigning(true);
    setError(null);
    setResult(null);
    try {
      const response = await onAssign(startDate, days, files);
      setResult(response);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAssigning(false);
    }
  }

  return (
    <section className="panel" style={{ padding: 20, margin: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0 }}>Домашка после урока</h2>
          <div className="muted" style={{ marginTop: 4, fontSize: 13 }}>
            Сразу выдайте {targetLabel} PDF-домашку на несколько дней вперёд. Для группы система создаст отдельную домашку каждому ученику.
          </div>
        </div>
        <span className="pill pill--active">до 7 дней</span>
      </div>

      {!lesson?.groupId && !lesson?.studentId ? (
        <div className="banner banner--error" style={{ marginTop: 16 }}>
          Сначала привяжите этот урок к группе или ученику.
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 1fr) minmax(160px, 1fr)', gap: 12, marginTop: 16 }}>
            <label className="field" style={{ marginBottom: 0 }}>
              <span className="field__label">Первый день домашки</span>
              <input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </label>
            <label className="field" style={{ marginBottom: 0 }}>
              <span className="field__label">На сколько дней</span>
              <select className="select" value={days} onChange={(e) => setDays(Number(e.target.value))}>
                {[1, 2, 3, 4, 5, 6, 7].map((value) => <option key={value} value={value}>{value} {dayWord(value)}</option>)}
              </select>
            </label>
          </div>

          <div style={{ marginTop: 16, border: '1px solid var(--border)', borderRadius: 14, padding: 14, background: '#fff' }}>
            <strong>PDF для домашки</strong>
            <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
              Можно выбрать 1 PDF — он будет выдан каждый день, или ровно {days} PDF — первый на {formatDate(startDate, 0)}, второй на следующий день и так далее.
            </div>

            <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
              <GoogleDrivePdfPicker
                disabled={assigning}
                maxFiles={days}
                onSelect={(file) => acceptFiles([file])}
                onSelectMany={(selected) => acceptFiles(selected)}
              />
              <label className="btn btn--ghost" style={{ cursor: assigning ? 'default' : 'pointer' }}>
                Выбрать с компьютера
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  multiple={days > 1}
                  hidden
                  disabled={assigning}
                  onChange={(e) => {
                    acceptFiles(Array.from(e.target.files ?? []));
                    e.currentTarget.value = '';
                  }}
                />
              </label>
              {files.length > 0 && (
                <button className="btn btn--ghost" type="button" disabled={assigning} onClick={() => { setFiles([]); setResult(null); }}>
                  Очистить
                </button>
              )}
            </div>

            {files.length > 0 && (
              <div style={{ display: 'grid', gap: 7, marginTop: 12 }}>
                {files.length === 1 ? (
                  <div className="banner banner--info" style={{ margin: 0 }}>
                    <strong>{files[0].name}</strong> — будет выдаваться все {days} {dayWord(days)}.
                  </div>
                ) : files.map((file, index) => (
                  <div key={`${file.name}-${index}`} style={{ display: 'grid', gridTemplateColumns: '120px minmax(0, 1fr)', gap: 10, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 10 }}>
                    <strong>{formatDate(startDate, index)}</strong>
                    <span style={{ overflowWrap: 'anywhere' }}>{file.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {error && <div className="banner banner--error" style={{ marginTop: 12 }}>{error}</div>}
          {result && (
            <div className="banner banner--success" style={{ marginTop: 12 }}>
              Готово: создано {result.created} домашних заданий. Уже существовало и пропущено: {result.skippedExisting}.
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
            <button className="btn" type="button" onClick={() => void assign()} disabled={!canAssign} style={{ minWidth: 260 }}>
              {assigning ? 'Выдаём домашку…' : `Выдать домашку на ${days} ${dayWord(days)}`}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function toInputDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDate(startDate: string, offset: number) {
  if (!startDate) return '—';
  const [year, month, day] = startDate.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + offset);
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit' }).format(date);
}

function dayWord(value: number) {
  if (value === 1) return 'день';
  if (value >= 2 && value <= 4) return 'дня';
  return 'дней';
}
