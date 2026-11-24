import { lazy, useState, useCallback, type ComponentProps } from 'react';
import type { WhiteboardPanel as WhiteboardPanelType } from './WhiteboardPanel';
import { useBoardDocumentState } from './useBoardDocument';
import { personalBoardId, personalBoardOwner, personalWorkbookBoardId } from './boards';
import type { PdfDoc } from './pdfDocument';
import { useI18n } from '../../i18n/I18nContext';
import { SavedPageAnalysis } from './SavedPageAnalysis';

const WhiteboardPanel = lazy(() => import('./WhiteboardPanel').then(module => ({ default: module.WhiteboardPanel })));

type BoardProps = Omit<ComponentProps<typeof WhiteboardPanelType>, 'document'> & {
  sharedDocument: PdfDoc | null;
  /** Teacher capability comes from the server; pupils use an authorized probe. */
  personalWorkbooksEnabled?: boolean;
  observedPages?: Readonly<Record<string, number>>;
  automaticPageAnalysisEnabled?: boolean;
};

function MyWhiteboardPanel({ sharedDocument, personalWorkbooksEnabled, observedPages, automaticPageAnalysisEnabled = false, ...props }: BoardProps) {
  const { language } = useI18n();
  const owner = personalBoardOwner(props.targetId!);
  const candidate = personalWorkbookBoardId(owner!);
  const own = useBoardDocumentState(props.classId, candidate, personalWorkbooksEnabled !== false && (props.active ?? true));
  const inherited = personalWorkbooksEnabled === false || own.status === 'empty';
  const targetId = inherited ? personalBoardId(owner!) : candidate;
  const [selected, setSelected] = useState<{ boardId: string; index: number }>();
  const onPageChange = useCallback((index: number) => {
    setSelected(previous => previous?.boardId === targetId && previous.index === index ? previous : { boardId: targetId, index });
    props.onPageChange?.(index);
  }, [targetId, props.onPageChange]);
  if (!inherited && !own.document) return <div className="whiteboard__document-loading" role="status" aria-busy={own.status === 'loading'}>
    {own.status === 'error'
      ? (language === 'DE' ? 'Die Tafel konnte nicht geladen werden. Erneuter Versuch folgt…' : 'Не удалось загрузить доску. Повторяем попытку…')
      : (language === 'DE' ? 'Tafel wird geladen…' : 'Загружаем доску…')}
  </div>;
  const board = <WhiteboardPanel {...props} key={`${props.classId}:${props.targetType ?? 'WHITEBOARD'}:${targetId}`}
    targetId={targetId} observedPage={observedPages ? observedPages[targetId] : props.observedPage}
    onPageChange={props.isHost ? onPageChange : props.onPageChange}
    document={inherited ? sharedDocument : own.document} />;
  if (!props.isHost) return board;
  const showAnalysis = automaticPageAnalysisEnabled && !props.compactPreview;
  const pageNumber = selected?.boardId === targetId ? selected.index + 1 : (observedPages?.[targetId] ?? props.observedPage ?? 0) + 1;
  return <div className="kolyn-board-review-layout">
    <div className="kolyn-board-review-canvas">{board}</div>
    {showAnalysis && <SavedPageAnalysis classId={props.classId} studentId={owner!}
      boardId={targetId} pageNumber={pageNumber} de={language === 'DE'} enabled={props.active ?? true} inline />}
  </div>;
}

/** The UI has one My board. Its durable source stays in the legacy namespace
 * that owns the selected PDF and ink, without migrating or merging drawings. */
export function DocumentWhiteboardPanel({ sharedDocument, personalWorkbooksEnabled, observedPages, automaticPageAnalysisEnabled, ...props }: BoardProps) {
  const personal = personalBoardOwner(props.targetId ?? '');
  return personal && (props.targetType ?? 'WHITEBOARD') === 'WHITEBOARD'
    ? <MyWhiteboardPanel {...props} sharedDocument={sharedDocument} personalWorkbooksEnabled={personalWorkbooksEnabled} observedPages={observedPages} automaticPageAnalysisEnabled={automaticPageAnalysisEnabled} />
    : <WhiteboardPanel {...props} key={`${props.classId}:${props.targetType ?? 'WHITEBOARD'}:${props.targetId}`}
      document={sharedDocument} />;
}
