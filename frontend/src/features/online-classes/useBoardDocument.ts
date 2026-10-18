import { useEffect, useRef, useState } from 'react';
import { onlineClassesApi } from '../../api/onlineClasses';
import { openPdf, type PdfDoc } from './pdfDocument';

/**
 * Shared workbook stays visible while another version downloads and parses.
 * Replacing the document only after it is ready avoids a blank flash and
 * preserves global annotation page indices during live additions.
 */
export function useBoardDocument(classId: string): PdfDoc | null {
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const docRef = useRef<PdfDoc | null>(null);
  const versionRef = useRef<number>(-1);
  const loadingRef = useRef(false);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    versionRef.current = -1;
    let cancelled = false;
    let deferred = false;

    const refresh = async () => {
      if (loadingRef.current) {
        deferred = true;
        return;
      }
      loadingRef.current = true;
      try {
        const { version } = await onlineClassesApi.documentVersion(classId);
        if (cancelled || version === versionRef.current) return;
        if (version === 0) {
          versionRef.current = version;
          return;
        }
        const bytes = await onlineClassesApi.documentBytes(classId);
        if (!bytes || !bytes.byteLength) throw new Error('The classroom document is not available yet');
        const next = await openPdf(bytes);
        if (cancelled || !aliveRef.current) {
          next.destroy();
          return;
        }
        const previous = docRef.current;
        docRef.current = next;
        versionRef.current = version;
        setDoc(next);
        // The old PDF was kept for display while the new file loaded.
        if (previous && previous !== next) previous.destroy();
      } catch (error) {
        if (!cancelled && versionRef.current > 0) {
          // Old pages stay usable during a temporary download failure.
          window.dispatchEvent(new CustomEvent('mc-workbook-render-error', {
            detail: `Не удалось обновить PDF на доске: ${error instanceof Error ? error.message : String(error)}`,
          }));
        }
      } finally {
        loadingRef.current = false;
        if (deferred && !cancelled) {
          deferred = false;
          void refresh();
        }
      }
    };

    const onUpdated = () => void refresh();
    window.addEventListener('mc-workbook-updated', onUpdated);
    void refresh();
    // Fallback for packet loss, reconnects and participants joining late.
    // Only a cheap version number is polled, never the PDF itself.
    const timer = window.setInterval(() => void refresh(), 4000);
    return () => {
      cancelled = true;
      aliveRef.current = false;
      window.clearInterval(timer);
      window.removeEventListener('mc-workbook-updated', onUpdated);
      docRef.current?.destroy();
      docRef.current = null;
    };
  }, [classId]);

  return doc;
}
