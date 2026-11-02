import { lazy, type ComponentProps } from 'react';
import type { WhiteboardPanel as WhiteboardPanelType } from './WhiteboardPanel';
import { useBoardDocument } from './useBoardDocument';
import { isPersonalWorkbookBoard } from './boards';
import type { PdfDoc } from './pdfDocument';

const WhiteboardPanel = lazy(() => import('./WhiteboardPanel').then(module => ({ default: module.WhiteboardPanel })));

type BoardProps = Omit<ComponentProps<typeof WhiteboardPanelType>, 'document'>;

function WorksheetWhiteboardPanel(props: BoardProps) {
  const document = useBoardDocument(props.classId, props.targetId, props.active ?? true);
  return <WhiteboardPanel {...props} document={document} />;
}

/** Common and ordinary personal boards reuse one parsed PDF. Only a worksheet
 * has its own loader, revision, page cache and lifetime. */
export function DocumentWhiteboardPanel({ sharedDocument, ...props }: BoardProps & { sharedDocument: PdfDoc | null }) {
  return isPersonalWorkbookBoard(props.targetId ?? '')
    ? <WorksheetWhiteboardPanel {...props} />
    : <WhiteboardPanel {...props} document={sharedDocument} />;
}
