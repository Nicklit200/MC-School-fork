import { useCallback, useEffect, useRef, useState } from 'react';
import { lessonPreparationApi } from '../../api/lessonPreparation';
import { clampPage } from './boardView';
import { type PdfState, usePdf } from './usePdf';

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
  const [status, setStatus] = useState<AnswersStatus>(isHost && eventId ? 'checking' : 'unavailable');
  const [filename, setFilename] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [everOpened, setEverOpened] = useState(false);
  const [view, setViewState] = useState<AnswersView>(INITIAL_VIEW);
  const viewRef = useRef(view);

  useEffect(() => {
    if (!isHost || !eventId) {
      setStatus('unavailable');
      return;
    }
    let active = true;
    setStatus('checking');
    lessonPreparationApi
      .get(eventId)
      .then((preparation) => {
        if (!active) return;
        setFilename(preparation.answersFilename);
        setStatus(preparation.hasAnswers ? 'available' : 'none');
      })
      .catch(() => {
        // Not being able to check reads as "no answers", never as an error wall
        // in the middle of a lesson.
        if (active) setStatus('none');
      });
    return () => {
      active = false;
    };
  }, [eventId, isHost]);

  const pdfKey = isHost && eventId && status === 'available' && everOpened ? `${eventId}:${filename ?? ''}` : null;
  const pdf: PdfState = usePdf(pdfKey, () => lessonPreparationApi.answersBytes(eventId!));

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
    if (status !== 'available') return;
    setEverOpened(true);
    setOpen(true);
  }, [status]);
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
    status,
    open,
    toggle,
    close: closePanel,
    pdf,
    /** Read at mount time by the panel to restore scroll; always the latest. */
    getView,
    view,
    setView,
    rememberScroll,
  };
}
