import { lazy, type ComponentProps } from 'react';
import type { WhiteboardPanel as WhiteboardPanelType } from './WhiteboardPanel';
import { useBoardDocumentState } from './useBoardDocument';
import { personalBoardId, personalBoardOwner, personalWorkbookBoardId } from './boards';
import type { PdfDoc } from './pdfDocument';
import { useI18n } from '../../i18n/I18nContext';

const WhiteboardPanel = lazy(() => import('./WhiteboardPanel').then(module => ({ default: module.WhiteboardPanel })));

type BoardProps = Omit<ComponentProps<typeof WhiteboardPanelType>, 'document'> & {
  sharedDocument: PdfDoc | null;
  /** Teacher capability comes from the server; pupils use an authorized probe. */
  personalWorkbooksEnabled?: boolean;
  observedPages?: Readonly<Record<string, number>>;
};

function MyWhiteboardPanel({ sharedDocument, personalWorkbooksEnabled, observedPages, ...props }: BoardProps) {
  const { language } = useI18n();
  const owner = personalBoardOwner(props.targetId!);
  const candidate = personalWorkbookBoardId(owner!);
  const own = useBoardDocumentState(props.classId, candidate, personalWorkbooksEnabled !== false && (props.active ?? true));
  const inherited = personalWorkbooksEnabled === false || own.status === 'empty';
  if (!inherited && !own.document) return <div className="whiteboard__document-loading" role="status" aria-busy={own.status === 'loading'}>
    {own.status === 'error'
      ? (language === 'DE' ? 'Die Tafel konnte nicht geladen werden. Erneuter Versuch folgt…' : 'Не удалось загрузить доску. Повторяем попытку…')
      : (language === 'DE' ? 'Tafel wird geladen…' : 'Загружаем доску…')}
  </div>;
  const targetId = inherited ? personalBoardId(owner!) : candidate;
  return <WhiteboardPanel {...props} key={`${props.classId}:${props.targetType ?? 'WHITEBOARD'}:${targetId}`}
    targetId={targetId} observedPage={observedPages ? observedPages[targetId] : props.observedPage}
    document={inherited ? sharedDocument : own.document} />;
}

/** The UI has one My board. Its durable source stays in the legacy namespace
 * that owns the selected PDF and ink, without migrating or merging drawings. */
export function DocumentWhiteboardPanel({ sharedDocument, personalWorkbooksEnabled, observedPages, ...props }: BoardProps) {
  const personal = personalBoardOwner(props.targetId ?? '');
  return personal && (props.targetType ?? 'WHITEBOARD') === 'WHITEBOARD'
    ? <MyWhiteboardPanel {...props} sharedDocument={sharedDocument} personalWorkbooksEnabled={personalWorkbooksEnabled} observedPages={observedPages} />
    : <WhiteboardPanel {...props} key={`${props.classId}:${props.targetType ?? 'WHITEBOARD'}:${props.targetId}`}
      document={sharedDocument} />;
}
