import { useEffect, useRef, useState } from 'react';
import { onlineClassesApi } from '../../api/onlineClasses';
import { openPdf, type PdfDoc } from './pdfDocument';

export interface BoardDocumentState {
  status: 'loading' | 'ready' | 'empty' | 'error';
  document: PdfDoc | null;
  version: number | null;
}
const LOADING: BoardDocumentState = { status: 'loading', document: null, version: null };

/**
 * Each board owns its PDF, revision and download lifecycle. Its current workbook
 * stays visible while another version of that same board downloads and parses.
 * Replacing the document only after it is ready avoids a blank flash and
 * preserves global annotation page indices during live additions.
 */
export function useBoardDocument(classId: string, boardId?: string, active = true): PdfDoc | null {
  return useBoardDocumentState(classId, boardId, active).document;
}

/** An explicit empty result is the only permission to inherit a shared PDF. */
export function useBoardDocumentState(classId: string, boardId?: string, active = true): BoardDocumentState {
  const key = JSON.stringify([classId, boardId ?? 'board-1']);
  const [loaded, setLoaded] = useState<{ key: string; value: BoardDocumentState } | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const refreshRef = useRef<() => Promise<void>>();

  useEffect(() => {
    setLoaded(null);
    let cancelled = false;
    let deferred = false;
    let loading = false;
    let updateGeneration = 0;
    let version = -1;
    let doc: PdfDoc | null = null;

    const refresh = async () => {
      if (!activeRef.current || cancelled) return;
      if (loading) {
        deferred = true;
        return;
      }
      loading = true;
      const generation = updateGeneration;
      try {
        const revision = boardId ? await onlineClassesApi.documentVersion(classId, boardId) : await onlineClassesApi.documentVersion(classId);
        if (cancelled || generation !== updateGeneration || revision.version === version) return;
        if (revision.version === 0) {
          version = 0;
          const previous = doc;
          doc = null;
          setLoaded({ key, value: { status: 'empty', document: null, version: 0 } });
          previous?.destroy();
          return;
        }
        // Once a private file is known to exist, withdraw the shared fallback
        // before downloading it. A failed download must never reveal another PDF.
        if (!doc) setLoaded({ key, value: { status: 'loading', document: null, version: revision.version } });
        const bytes = boardId ? await onlineClassesApi.documentBytes(classId, boardId) : await onlineClassesApi.documentBytes(classId);
        if (!bytes || !bytes.byteLength) throw new Error('The classroom document is not available yet');
        const next = await openPdf(bytes);
        if (cancelled || generation !== updateGeneration) {
          next.destroy();
          return;
        }
        const previous = doc;
        doc = next;
        version = revision.version;
        setLoaded({ key, value: { status: 'ready', document: next, version } });
        // The old PDF was kept for display while the new file loaded.
        if (previous && previous !== next) previous.destroy();
      } catch (error) {
        if (!cancelled) setLoaded(current => current?.key === key && current.value.status === 'empty'
          ? current : { key, value: { status: doc ? 'ready' : 'error', document: doc, version: version > 0 ? version : null } });
        if (!cancelled && version > 0) {
          // Old pages stay usable during a temporary download failure.
          window.dispatchEvent(new CustomEvent('mc-workbook-render-error', {
            detail: `Не удалось обновить PDF на доске: ${error instanceof Error ? error.message : String(error)}`,
          }));
        }
      } finally {
        loading = false;
        if (deferred && !cancelled) {
          deferred = false;
          void refresh();
        }
      }
    };
    refreshRef.current = refresh;

    const onUpdated = () => { updateGeneration++; void refresh(); };
    const onVisible = () => { if (document.visibilityState !== 'hidden') void refresh(); };
    window.addEventListener('mc-workbook-updated', onUpdated);
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    // Fallback for packet loss, reconnects and participants joining late.
    // Only a cheap version number is polled, never the PDF itself.
    const timer = window.setInterval(() => void refresh(), 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('mc-workbook-updated', onUpdated);
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
      if (refreshRef.current === refresh) refreshRef.current = undefined;
      doc?.destroy();
    };
  }, [classId, boardId, key]);

  useEffect(() => {
    if (active) void refreshRef.current?.();
  }, [active, key]);

  return loaded?.key === key ? loaded.value : LOADING;
}
