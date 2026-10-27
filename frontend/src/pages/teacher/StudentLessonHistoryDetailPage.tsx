import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { StudentLessonHistoryDetail, StudentLessonHistoryDocument } from '../../api/types';
import { toErrorMessage } from '../../lib/errors';

type DocumentKind = 'workbook' | 'answers' | 'transcript';
type CompletedDocumentLink = StudentLessonHistoryDocument & { url: string };

export function StudentLessonHistoryDetailPage() {
  const { studentId = '', sourceTeacherId = '', eventId = '' } = useParams();
  const [detail, setDetail] = useState<StudentLessonHistoryDetail | null>(null);
  const [files, setFiles] = useState<Partial<Record<DocumentKind, string>>>({});
  const [completedFiles, setCompletedFiles] = useState<CompletedDocumentLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const objectUrls: string[] = [];

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [payload, savedDocuments] = await Promise.all([
          api.students.lessonHistoryDetail(studentId, sourceTeacherId, eventId),
          api.students.lessonHistoryCompletedDocuments(studentId, sourceTeacherId, eventId),
        ]);
        if (cancelled) return;
        setDetail(payload);

        const kinds: DocumentKind[] = [];
        if (payload.hasWorkbook) kinds.push('workbook');
        if (payload.hasAnswers) kinds.push('answers');
        if (payload.hasTranscript && payload.transcriptFilename) kinds.push('transcript');

        const fileEntries = await Promise.all(kinds.map(async (kind) => {
          const blob = await api.students.lessonHistoryFile(studentId, sourceTeacherId, eventId, kind);
          const url = URL.createObjectURL(blob);
          objectUrls.push(url);
          return [kind, url] as const;
        }));

        const completedEntries = await Promise.all(savedDocuments.map(async (document) => {
          const blob = await api.students.lessonHistoryCompletedDocument(
            studentId, sourceTeacherId, eventId, document.id,
          );
          const url = URL.createObjectURL(blob);
          objectUrls.push(url);
          return { ...document, url };
        }));

        if (!cancelled) {
          setFiles(Object.fromEntries(fileEntries));
          setCompletedFiles(completedEntries);
        }
      } catch (e) {
        if (!cancelled) setError(toErrorMessage(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [studentId, sourceTeacherId, eventId]);

  const date = detail ? new Intl.DateTimeFormat('ru-RU', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Europe/Berlin',
  }).format(new Date(detail.startsAt)) : '';
  const time = detail ? [
    new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' }).format(new Date(detail.startsAt)),
    new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' }).format(new Date(detail.endsAt)),
  ].join('–') : '';

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <p><Link to={`/students/${encodeURIComponent(studentId)}/lessons`} className="muted">← Назад к истории уроков</Link></p>
      {loading && <p className="muted">Загружаем историю урока…</p>}
      {error && <div className="banner banner--error">{error}</div>}
      {detail && (
        <>
          <h1 style={{ marginBottom: 6 }}>{detail.title}</h1>
          <p className="muted" style={{ marginTop: 0 }}>
            {date} · {time}{detail.groupName ? ` · Группа: ${detail.groupName}` : ''}
          </p>
          <div className="banner banner--info">
            Исторический урок у преподавателя {detail.sourceTeacherName}. Просмотр без редактирования.
          </div>

          <section className="panel stack">
            <h2>Содержание урока</h2>
            <HistoryText title="Пройденный материал" value={detail.coveredMaterial} />
            <HistoryText title="План урока" value={detail.lessonPlan} />
            <HistoryText title="Трудности ученика" value={detail.difficulties} />
            <HistoryText title="Домашнее задание и заметки" value={detail.homeworkNotes} />
          </section>

          <section className="panel stack" style={{ marginTop: 16 }}>
            <h2>Материалы урока</h2>
            {files.workbook && <p><a href={files.workbook} target="_blank" rel="noreferrer">Рабочий лист: {detail.workbookFilename ?? 'PDF'}</a></p>}
            {files.answers && <p><a href={files.answers} target="_blank" rel="noreferrer">Ответы: {detail.answersFilename ?? 'PDF'}</a></p>}
            {files.transcript && <p><a href={files.transcript} target="_blank" rel="noreferrer">Транскрипция: {detail.transcriptFilename ?? 'PDF'}</a></p>}
            {detail.transcriptText && <HistoryText title="Текст транскрипции" value={detail.transcriptText} />}
            {completedFiles.length > 0 && (
              <div>
                <h3>Сохранённые документы урока</h3>
                {completedFiles.map((document) => (
                  <p key={document.id}>
                    <a href={document.url} target="_blank" rel="noreferrer">{document.filename}</a>
                    <span className="muted"> · {document.boardId === 'board-1'
                      ? 'общая доска'
                      : document.boardId === 'manual-shared'
                        ? 'документ урока'
                        : 'тетрадь ученика'}</span>
                  </p>
                ))}
              </div>
            )}
            {!files.workbook && !files.answers && !files.transcript && !detail.transcriptText && completedFiles.length === 0 && (
              <p className="muted">Сохранённых файлов или транскрипции для этого урока нет.</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function HistoryText({ title, value }: { title: string; value: string | null }) {
  if (!value) return null;
  return (
    <div>
      <h3>{title}</h3>
      <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{value}</div>
    </div>
  );
}
