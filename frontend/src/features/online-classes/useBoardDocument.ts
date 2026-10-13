import { onlineClassesApi } from '../../api/onlineClasses';
import type { PdfDoc } from './pdfDocument';
import { usePdf } from './usePdf';

/**
 * The lesson's workbook as the board's document, for everyone in the class.
 *
 * A lesson without a workbook (or a failed download) simply yields no document
 * and the board stays blank — the lesson never waits on it.
 */
export function useBoardDocument(classId: string): PdfDoc | null {
  const state = usePdf(classId, async () => {
    const bytes = await onlineClassesApi.documentBytes(classId);
    if (!bytes) throw new Error('no document');
    return bytes;
  });
  return state.status === 'ready' ? state.doc : null;
}
