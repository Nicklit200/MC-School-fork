import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  onlineClassesApi,
  type AnnotationDocument,
  type AnnotationOperation,
  type OnlineClass,
  type OnlineClassBoardContext,
} from '../../api/onlineClasses';
import { foldOperations, type Operation } from '../../features/online-classes/annotations';
import { WhiteboardCanvas } from '../../features/online-classes/WhiteboardCanvas';

type BoardKind = 'shared' | 'mine';

export function StudentLessonHistoryPage() {
  const { classId = '' } = useParams();
  const [onlineClass, setOnlineClass] = useState<OnlineClass | null>(null);
  const [context, setContext] = useState<OnlineClassBoardContext | null>(null);
  const [documents, setDocuments] = useState<AnnotationDocument[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [boardKind, setBoardKind] = useState<BoardKind>('shared');
  const [operations, setOperations] = useState<AnnotationOperation[]>([]);
  const [backgroundUrl, setBackgroundUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    Promise.all([
      onlineClassesApi.get(classId),
      onlineClassesApi.boardContext(classId),
      onlineClassesApi.listAnnotationDocuments(classId),
    ])
      .then(([lesson, boardContext, docs]) => {
        if (!active) return;
        setOnlineClass(lesson);
        setContext(boardContext);
        setDocuments(docs);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [classId]);

  const ownId = context?.students[0]?.id ?? null;
  const targetId = boardKind === 'shared' ? 'shared' : ownId ? `student:${ownId}` : null;
  const currentDocument = useMemo(
    () => documents.find((doc) => doc.targetId === targetId && doc.pageIndex === pageIndex) ?? null,
    [documents, pageIndex, targetId],
  );

  useEffect(() => {
    let active = true;
    if (!currentDocument) {
      setOperations([]);
      return () => { active = false; };
    }
    onlineClassesApi.replayAnnotations(classId, currentDocument.id, 0)
      .then((items) => {
        if (active) setOperations(items);
      })
      .catch(() => {
        if (active) setOperations([]);
      });
    return () => { active = false; };
  }, [classId, currentDocument]);

  useEffect(() => {
    let active = true;
    let url: string | null = null;
    if (!context?.workbook.hasWorkbook) {
      setBackgroundUrl(null);
      return () => { active = false; };
    }
    onlineClassesApi.workbookPageUrl(classId, pageIndex)
      .then((value) => {
        url = value;
        if (active) setBackgroundUrl(value);
        else URL.revokeObjectURL(value);
      })
      .catch(() => {
        if (active) setBackgroundUrl(null);
      });
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [classId, context?.workbook.hasWorkbook, pageIndex]);

  if (loading) return <p>Загружаем урок…</p>;
  if (!onlineClass || !context) return <p>Урок не найден.</p>;

  const sourceAspect =
    context.workbook.pageWidth > 0 && context.workbook.pageHeight > 0
      ? context.workbook.pageWidth / context.workbook.pageHeight
      : null;
  const docPageCount = documents.length > 0
    ? Math.max(...documents.map((doc) => doc.pageIndex)) + 1
    : 1;
  const pageCount = Math.max(context.workbook.pageCount || 0, docPageCount, 1);
  const shapes = foldOperations(operations as unknown as Operation[]);

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      <Link to="/online-classes" className="muted">← Назад к урокам</Link>
      <div style={{ margin: '10px 0 16px' }}>
        <h1 style={{ marginBottom: 4 }}>{onlineClass.title}</h1>
        <div className="muted">
          {new Date(onlineClass.scheduledStartAt).toLocaleString('ru-RU')}
        </div>
      </div>

      <div className="board-workspace__tabs" role="tablist">
        <button type="button" aria-selected={boardKind === 'shared'} onClick={() => setBoardKind('shared')}>
          Общая
        </button>
        <button type="button" aria-selected={boardKind === 'mine'} onClick={() => setBoardKind('mine')}>
          Моя работа
        </button>
      </div>

      <div className="board-workspace__document-bar">
        <div className="board-workspace__document-name">
          {context.workbook.filename ?? 'Материалы урока'}
        </div>
        <div className="board-workspace__pages">
          <button type="button" disabled={pageIndex === 0} onClick={() => setPageIndex((value) => Math.max(0, value - 1))}>←</button>
          <span>{pageIndex + 1} / {pageCount}</span>
          <button type="button" disabled={pageIndex >= pageCount - 1} onClick={() => setPageIndex((value) => Math.min(pageCount - 1, value + 1))}>→</button>
        </div>
      </div>

      <section className="whiteboard">
        <WhiteboardCanvas
          shapes={shapes}
          tool="pen"
          color="#111111"
          strokeWidth={0.004}
          sourceAspect={sourceAspect}
          backgroundImageUrl={backgroundUrl}
          readOnly
          onCommit={() => undefined}
        />
      </section>

      {!currentDocument && !backgroundUrl && (
        <div className="banner banner--info" style={{ marginTop: 12 }}>
          На этой странице не было записей.
        </div>
      )}
    </div>
  );
}
