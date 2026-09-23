import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import {
  onlineClassesApi,
  type OnlineClassBoardContext,
  type OnlineClassBoardStudent,
} from '../../api/onlineClasses';

const WhiteboardPanel = lazy(() =>
  import('./WhiteboardPanel').then((module) => ({ default: module.WhiteboardPanel })),
);

type BoardSelection =
  | { kind: 'shared' }
  | { kind: 'all' }
  | { kind: 'student'; student: OnlineClassBoardStudent };

export function BoardWorkspace({
  classId,
  currentUserId,
  isHost,
  canAnnotate,
  context,
}: {
  classId: string;
  currentUserId: string;
  isHost: boolean;
  canAnnotate: boolean;
  context: OnlineClassBoardContext;
}) {
  const [selection, setSelection] = useState<BoardSelection>({ kind: 'shared' });
  const [pageIndex, setPageIndex] = useState(0);
  const [backgroundUrl, setBackgroundUrl] = useState<string | null>(null);
  const [backgroundLoading, setBackgroundLoading] = useState(false);
  const [backgroundError, setBackgroundError] = useState(false);
  const [renderZoom, setRenderZoom] = useState(1);

  const workbook = context.workbook;
  const sourceAspect =
    workbook.hasWorkbook && workbook.pageWidth > 0 && workbook.pageHeight > 0
      ? workbook.pageWidth / workbook.pageHeight
      : null;

  const renderDpi = useMemo(
    () => Math.round(Math.max(120, Math.min(576, 144 * renderZoom))),
    [renderZoom],
  );

  useEffect(() => {
    // Every new lesson opens on the shared board and on page 1 of the PDF that
    // was prepared for that exact calendar/native lesson.
    setSelection({ kind: 'shared' });
    setPageIndex(0);
    setRenderZoom(1);
  }, [classId]);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;

    if (!workbook.hasWorkbook) {
      setBackgroundUrl(null);
      setBackgroundLoading(false);
      setBackgroundError(false);
      return () => undefined;
    }

    setBackgroundLoading(true);
    setBackgroundError(false);
    setBackgroundUrl(null);

    onlineClassesApi
      .workbookPageUrl(classId, pageIndex, renderDpi)
      .then((url) => {
        objectUrl = url;
        if (!active) {
          URL.revokeObjectURL(url);
          return;
        }
        setBackgroundUrl(url);
        setBackgroundLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setBackgroundUrl(null);
        setBackgroundLoading(false);
        setBackgroundError(true);
      });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [classId, pageIndex, renderDpi, workbook.hasWorkbook]);

  const ownStudent = useMemo(
    () => context.students.find((student) => student.id === currentUserId) ?? context.students[0],
    [context.students, currentUserId],
  );

  const selectStudent = (student: OnlineClassBoardStudent) => {
    setSelection({ kind: 'student', student });
  };

  const renderBoard = (
    targetId: string,
    heading: string,
    studentId?: string,
    compact = false,
    editable = canAnnotate,
  ) => (
    <WhiteboardPanel
      key={`${targetId}:${pageIndex}`}
      classId={classId}
      actorId={currentUserId}
      isHost={isHost}
      targetId={targetId}
      pageIndex={pageIndex}
      sourceAspect={sourceAspect}
      backgroundImageUrl={backgroundUrl}
      privateUserIds={studentId ? [context.teacherId, studentId] : undefined}
      canAnnotate={editable}
      showToolbar={!compact}
      compact={compact}
      heading={heading}
      onZoomChange={compact ? undefined : setRenderZoom}
    />
  );

  return (
    <section className="board-workspace">
      <div className="board-workspace__tabs" role="tablist" aria-label="Доски урока">
        <button
          type="button"
          role="tab"
          aria-selected={selection.kind === 'shared'}
          onClick={() => setSelection({ kind: 'shared' })}
        >
          Общая
        </button>

        {isHost && (
          <button
            type="button"
            role="tab"
            aria-selected={selection.kind === 'all'}
            onClick={() => setSelection({ kind: 'all' })}
          >
            Все
          </button>
        )}

        {isHost
          ? context.students.map((student) => (
              <button
                key={student.id}
                type="button"
                role="tab"
                aria-selected={selection.kind === 'student' && selection.student.id === student.id}
                onClick={() => selectStudent(student)}
                title={student.fullName}
              >
                {student.fullName}
              </button>
            ))
          : ownStudent && (
              <button
                type="button"
                role="tab"
                aria-selected={selection.kind === 'student'}
                onClick={() => selectStudent(ownStudent)}
              >
                Моя работа
              </button>
            )}
      </div>

      {workbook.hasWorkbook && (
        <div className="board-workspace__document-bar">
          <div className="board-workspace__document-name">
            {workbook.filename ?? 'Рабочая тетрадь'}
          </div>
          <div className="board-workspace__pages">
            <button
              type="button"
              onClick={() => setPageIndex((page) => Math.max(0, page - 1))}
              disabled={pageIndex === 0}
              aria-label="Предыдущая страница"
            >
              ←
            </button>
            <span>
              {pageIndex + 1} / {Math.max(1, workbook.pageCount)}
            </span>
            <button
              type="button"
              onClick={() =>
                setPageIndex((page) => Math.min(Math.max(0, workbook.pageCount - 1), page + 1))
              }
              disabled={pageIndex >= workbook.pageCount - 1}
              aria-label="Следующая страница"
            >
              →
            </button>
          </div>
        </div>
      )}

      {workbook.hasWorkbook && backgroundLoading ? (
        <div className="board-workspace__loading">
          Открываем PDF «{workbook.filename ?? 'Рабочая тетрадь'}»…
        </div>
      ) : workbook.hasWorkbook && backgroundError ? (
        <div className="banner banner--error" style={{ marginBottom: 12 }}>
          PDF прикреплён к уроку, но страницу не удалось загрузить. Обнови урок — файл останется привязан к этому занятию.
        </div>
      ) : (
      <Suspense fallback={<div className="board-workspace__loading">Открываем доску…</div>}>
        {selection.kind === 'shared' &&
          renderBoard('shared', workbook.hasWorkbook ? 'Общая рабочая тетрадь' : 'Общая доска')}

        {selection.kind === 'student' &&
          renderBoard(
            `student:${selection.student.id}`,
            isHost ? selection.student.fullName : 'Моя работа',
            selection.student.id,
          )}

        {selection.kind === 'all' && isHost && (
          <div className="board-workspace__grid">
            {context.students.map((student) => (
              <button
                type="button"
                key={student.id}
                className="board-workspace__student-preview"
                onClick={() => selectStudent(student)}
                aria-label={`Открыть доску: ${student.fullName}`}
              >
                <div className="board-workspace__student-name">{student.fullName}</div>
                <div className="board-workspace__student-board">
                  {renderBoard(
                    `student:${student.id}`,
                    student.fullName,
                    student.id,
                    true,
                    false,
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </Suspense>
      )}
    </section>
  );
}
