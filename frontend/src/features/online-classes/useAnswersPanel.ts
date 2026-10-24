import { useCallback, useEffect, useRef, useState } from 'react';
import { lessonPreparationApi } from '../../api/lessonPreparation';
import { clampPage } from './boardView';
import { type PdfState, usePdf } from './usePdf';
import { openPdf, type PdfDoc } from './pdfDocument';

export type AnswersStatus = 'unavailable' | 'checking' | 'none' | 'available';

/** Where the teacher left off in the answers file. Independent of the board. */
export interface AnswersView {
  /** Zero-based page. */
  page: number;
  zoom: number;
  scrollTop: number;
  scrollLeft: number;
}

export const MIN_ANSWERS_ZOOM = 1;
export const MAX_ANSWERS_ZOOM = 3;
const INITIAL_VIEW: AnswersView = { page: 0, zoom: 1, scrollTop: 0, scrollLeft: 0 };
const IDLE_PDF: PdfState = { status: 'idle' };
interface AnswersSession { scope: string; active: boolean; uploading: boolean; mutation: number }
interface PreparedAnswers { scope: string; bytes: ArrayBuffer; doc: PdfDoc; claimed: boolean }

/**
 * Teacher-only answers file for the lesson.
 *
 * Nothing is requested for a non-host, so a student's browser never asks for
 * (and the server would refuse) the file. The loaded document and the view
 * state live here, not in the panel, so closing and reopening the panel brings
 * the teacher back to the same page, scroll position and zoom — and a page
 * flip on the board never touches them.
 */
export function useAnswersPanel(eventId: string | undefined, isHost: boolean) {
  const scope = JSON.stringify([eventId ?? null, isHost]);
  const [loadedScope, setLoadedScope] = useState(scope);
  const [status, setStatus] = useState<AnswersStatus>(isHost && eventId ? 'checking' : 'unavailable');
  const [filename, setFilename] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [everOpened, setEverOpened] = useState(false);
  const [view, setViewState] = useState<AnswersView>(INITIAL_VIEW);
  const [revision, setRevision] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const viewRef = useRef(view);
  const session = useRef<AnswersSession | null>(null);
  const verifiedBytes = useRef<PreparedAnswers | null>(null);
  const preparedDocuments = useRef(new Map<ArrayBuffer, PreparedAnswers>());

  useEffect(() => {
    const current: AnswersSession = { scope, active: true, uploading: false, mutation: 0 };
    const release = () => {
      current.active = false;
      // Once usePdf claims a document, its own cleanup releases it even if the
      // component disappears before the pending promise has finished.
      for (const [bytes, prepared] of preparedDocuments.current) {
        if (prepared.scope === scope && !prepared.claimed) { prepared.doc.destroy(); preparedDocuments.current.delete(bytes); }
      }
      if (verifiedBytes.current?.scope === scope) verifiedBytes.current = null;
    };
    session.current = current;
    setLoadedScope(scope); setFilename(null); setOpen(false); setEverOpened(false);
    setRevision(0); setUploading(false); setUploadError(null); verifiedBytes.current = null;
    viewRef.current = { ...INITIAL_VIEW }; setViewState(viewRef.current);
    if (!isHost || !eventId) {
      setStatus('unavailable');
      return release;
    }
    const version = current.mutation;
    setStatus('checking');
    lessonPreparationApi
      .get(eventId)
      .then((preparation) => {
        if (!current.active || version !== current.mutation) return;
        setFilename(preparation.answersFilename);
        setStatus(preparation.hasAnswers ? 'available' : 'none');
      })
      .catch(() => {
        // Not being able to check reads as "no answers", never as an error wall
        // in the middle of a lesson.
        if (current.active && version === current.mutation) setStatus('none');
      });
    return release;
  }, [eventId, isHost, scope]);

  const accessible = isHost && Boolean(eventId) && loadedScope === scope;
  const currentStatus = !isHost || !eventId ? 'unavailable' : loadedScope === scope ? status : 'checking';
  const pdfKey = accessible && status === 'available' && everOpened ? `${eventId}:${filename ?? ''}:${revision}` : null;
  const loadedPdf: PdfState = usePdf(pdfKey, () => {
    if (verifiedBytes.current?.scope === scope) {
      const bytes = verifiedBytes.current.bytes; verifiedBytes.current.claimed = true; verifiedBytes.current = null;
      return Promise.resolve(bytes);
    }
    return lessonPreparationApi.answersBytes(eventId!);
  }, bytes => {
    const prepared = preparedDocuments.current.get(bytes);
    if (prepared) { preparedDocuments.current.delete(bytes); return Promise.resolve(prepared.doc); }
    return openPdf(bytes);
  });
  const pdf = accessible ? loadedPdf : IDLE_PDF;

  const upload = useCallback(async (file: File): Promise<void> => {
    const current = session.current;
    if (!isHost || !eventId || !current?.active || current.scope !== scope || !accessible || current.uploading) return;
    setUploadError(null);
    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
      setUploadError('Для решений нужен PDF'); return;
    }
    if (file.size === 0) { setUploadError('Выбранный PDF пустой'); return; }
    current.uploading = true; setUploading(true);
    try {
      const preparation = await lessonPreparationApi.uploadAnswers(eventId, file);
      if (!current.active) return;
      const bytes = await lessonPreparationApi.answersBytes(eventId);
      if (!current.active) return;
      if (!bytes.byteLength) throw new Error('Сервер вернул пустой PDF');
      // Validate before releasing the current PDF. A malformed replacement
      // must leave the teacher's existing solutions on screen.
      const doc = await openPdf(bytes);
      if (!current.active) { doc.destroy(); return; }
      current.mutation++;
      const previous = verifiedBytes.current;
      if (previous && !previous.claimed) { previous.doc.destroy(); preparedDocuments.current.delete(previous.bytes); }
      const prepared = { scope, bytes, doc, claimed: false };
      preparedDocuments.current.set(bytes, prepared); verifiedBytes.current = prepared;
      setFilename(preparation.answersFilename || file.name); setStatus('available');
      viewRef.current = { ...INITIAL_VIEW }; setViewState(viewRef.current);
      setEverOpened(true); setRevision(value => value + 1);
    } catch (error) {
      if (current.active) setUploadError(error instanceof Error ? error.message : 'Не удалось загрузить решения');
    } finally {
      current.uploading = false;
      if (current.active) setUploading(false);
    }
  }, [accessible, eventId, isHost, scope]);

  const setView = useCallback((patch: Partial<AnswersView>) => {
    viewRef.current = { ...viewRef.current, ...patch };
    setViewState(viewRef.current);
  }, []);

  /** Scroll is recorded without re-rendering the panel on every wheel tick. */
  const rememberScroll = useCallback((scrollTop: number, scrollLeft: number) => {
    viewRef.current = { ...viewRef.current, scrollTop, scrollLeft };
  }, []);

  const getView = useCallback(() => viewRef.current, []);

  const openPanel = useCallback(() => {
    if (!accessible || !['available', 'none'].includes(currentStatus)) return;
    setEverOpened(true);
    setOpen(true);
  }, [accessible, currentStatus]);
  const closePanel = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => (open ? closePanel() : openPanel()), [closePanel, open, openPanel]);

  // A page index from a previous (longer) file must not outlive a replaced file.
  useEffect(() => {
    if (pdf.status === 'ready') {
      const page = clampPage(viewRef.current.page, pdf.doc.pageCount);
      if (page !== viewRef.current.page) setView({ page });
    }
  }, [pdf, setView]);

  return {
    status: currentStatus,
    open: accessible && open,
    toggle,
    close: closePanel,
    pdf,
    upload,
    uploading: accessible && uploading,
    uploadError: accessible ? uploadError : null,
    /** Read at mount time by the panel to restore scroll; always the latest. */
    getView,
    view,
    setView,
    rememberScroll,
  };
}
