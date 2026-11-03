import { useCallback, useEffect, useRef, useState } from 'react';
import { lessonPreparationApi } from '../../api/lessonPreparation';
import { clampPage } from './boardView';
import { type PdfState, usePdf } from './usePdf';
import { openPdf, type PdfDoc } from './pdfDocument';

export type AnswersStatus = 'unavailable' | 'checking' | 'none' | 'available';

/** Where the teacher left off in one pupil's answers, independent of the board. */
export interface AnswersView {
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
interface AnswerSource { scope: string; status: AnswersStatus; filename: string | null; revision: number }

/**
 * Only the host requests answers. A personal source never falls back to the
 * common file. Switching pupils keeps the panel open and restores each source's
 * page, zoom and scroll, while releasing the previous private PDF.
 */
export function useAnswersPanel(
  eventId: string | undefined,
  isHost: boolean,
  studentId?: string,
  teacherId?: string,
  pending = false,
) {
  const ownerScope = JSON.stringify([teacherId ?? null, eventId ?? null, isHost]);
  const scope = JSON.stringify([teacherId ?? null, eventId ?? null, isHost, studentId ?? null, pending]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const [source, setSource] = useState<AnswerSource>({ scope, status: isHost && eventId ? 'checking' : 'unavailable', filename: null, revision: 0 });
  const [panel, setPanel] = useState({ ownerScope, open: false });
  const [renderedView, setRenderedView] = useState<{ scope: string; value: AnswersView }>({ scope, value: { ...INITIAL_VIEW } });
  const views = useRef(new Map<string, AnswersView>());
  const openedSources = useRef(new Set<string>());
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const session = useRef<AnswersSession | null>(null);
  const verifiedBytes = useRef<PreparedAnswers | null>(null);
  const preparedDocuments = useRef(new Map<ArrayBuffer, PreparedAnswers>());
  const panelOpen = isHost && Boolean(eventId) && panel.ownerScope === ownerScope && panel.open;

  useEffect(() => {
    if (panelOpen) openedSources.current.add(scope);
  }, [panelOpen, scope]);

  useEffect(() => {
    const current: AnswersSession = { scope, active: true, uploading: false, mutation: 0 };
    session.current = current;
    const release = () => {
      current.active = false;
      for (const [bytes, prepared] of preparedDocuments.current) {
        if (prepared.scope === scope && !prepared.claimed) {
          prepared.doc.destroy();
          preparedDocuments.current.delete(bytes);
        }
      }
      if (verifiedBytes.current?.scope === scope) verifiedBytes.current = null;
    };
    setPanel(previous => previous.ownerScope === ownerScope ? previous : { ownerScope, open: false });
    setUploading(false);
    setUploadError(null);
    setRenderedView({ scope, value: views.current.get(scope) ?? { ...INITIAL_VIEW } });
    if (!isHost || !eventId || pending) {
      setSource({ scope, status: isHost && eventId ? 'checking' : 'unavailable', filename: null, revision: 0 });
      return release;
    }
    const mutation = current.mutation;
    setSource({ scope, status: 'checking', filename: null, revision: 0 });
    const metadata = studentId
      ? lessonPreparationApi.personalAnswersMetadata(eventId, studentId)
      : lessonPreparationApi.get(eventId);
    metadata.then(preparation => {
      if (!current.active || currentScope.current !== scope || mutation !== current.mutation) return;
      setSource({
        scope, status: preparation.hasAnswers ? 'available' : 'none',
        filename: preparation.answersFilename ?? null,
        revision: 'version' in preparation ? Number(preparation.version) : 0,
      });
    }).catch(() => {
      // A failed personal lookup remains an empty personal source.
      if (current.active && currentScope.current === scope && mutation === current.mutation) {
        setSource({ scope, status: 'none', filename: null, revision: 0 });
      }
    });
    return release;
  }, [eventId, isHost, studentId, ownerScope, pending, scope]);

  const accessible = isHost && Boolean(eventId) && !pending && source.scope === scope;
  const currentStatus = !isHost || !eventId ? 'unavailable' : source.scope === scope ? source.status : 'checking';
  const loadDocument = panelOpen || openedSources.current.has(scope);
  const pdfKey = accessible && source.status === 'available' && loadDocument
    ? `${scope}:${source.filename ?? ''}:${source.revision}` : null;
  const loadedPdf = usePdf(pdfKey, () => {
    if (verifiedBytes.current?.scope === scope) {
      const prepared = verifiedBytes.current;
      prepared.claimed = true;
      verifiedBytes.current = null;
      return Promise.resolve(prepared.bytes);
    }
    return studentId ? lessonPreparationApi.personalAnswersBytes(eventId!, studentId) : lessonPreparationApi.answersBytes(eventId!);
  }, bytes => {
    const prepared = preparedDocuments.current.get(bytes);
    if (prepared?.scope === scope) {
      preparedDocuments.current.delete(bytes);
      return Promise.resolve(prepared.doc);
    }
    return openPdf(bytes);
  });
  const pdf: PdfState = panelOpen && currentStatus === 'checking' ? { status: 'loading' } : accessible ? loadedPdf : IDLE_PDF;

  const upload = useCallback(async (file: File): Promise<void> => {
    const current = session.current;
    if (!isHost || !eventId || !current || !current.active || current.scope !== scope || currentScope.current !== scope || !accessible || current.uploading) return;
    const live = () => current.active && currentScope.current === scope;
    setUploadError(null);
    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
      setUploadError('Для решений нужен PDF'); return;
    }
    if (!file.size) { setUploadError('Выбранный PDF пустой'); return; }
    if (file.size > 25 * 1024 * 1024) { setUploadError('PDF решений должен быть не больше 25 МБ'); return; }
    current.uploading = true;
    setUploading(true);
    try {
      const preparation = studentId
        ? await lessonPreparationApi.uploadPersonalAnswers(eventId, studentId, file)
        : await lessonPreparationApi.uploadAnswers(eventId, file);
      if (!live()) return;
      if (!preparation.hasAnswers || (studentId && 'studentId' in preparation && preparation.studentId !== studentId)) {
        throw new Error('Сервер не подтвердил сохранение решений');
      }
      const bytes = studentId
        ? await lessonPreparationApi.personalAnswersBytes(eventId, studentId)
        : await lessonPreparationApi.answersBytes(eventId);
      if (!live()) return;
      if (!bytes.byteLength) throw new Error('Сервер вернул пустой PDF');
      const doc = await openPdf(bytes);
      if (!live()) { doc.destroy(); return; }
      current.mutation++;
      const previous = verifiedBytes.current;
      if (previous && !previous.claimed) {
        previous.doc.destroy(); preparedDocuments.current.delete(previous.bytes);
      }
      const prepared = { scope, bytes, doc, claimed: false };
      preparedDocuments.current.set(bytes, prepared);
      verifiedBytes.current = prepared;
      views.current.set(scope, { ...INITIAL_VIEW });
      setRenderedView({ scope, value: views.current.get(scope)! });
      openedSources.current.add(scope);
      setSource(previousSource => ({
        scope, status: 'available', filename: preparation.answersFilename || file.name,
        revision: Math.max(previousSource.scope === scope ? previousSource.revision + 1 : 1,
          'version' in preparation ? Number(preparation.version) : 0),
      }));
    } catch (error) {
      if (live()) setUploadError(error instanceof Error ? error.message : 'Не удалось загрузить решения');
    } finally {
      current.uploading = false;
      if (live()) setUploading(false);
    }
  }, [accessible, eventId, isHost, studentId, scope]);

  const setView = useCallback((patch: Partial<AnswersView>) => {
    if (currentScope.current !== scope) return;
    const value = { ...(views.current.get(scope) ?? INITIAL_VIEW), ...patch };
    views.current.set(scope, value);
    setRenderedView({ scope, value });
  }, [scope]);
  const rememberScroll = useCallback((scrollTop: number, scrollLeft: number) => {
    if (currentScope.current !== scope) return;
    views.current.set(scope, { ...(views.current.get(scope) ?? INITIAL_VIEW), scrollTop, scrollLeft });
  }, [scope]);
  const getView = useCallback(() => views.current.get(scope) ?? { ...INITIAL_VIEW }, [scope]);
  const openPanel = useCallback(() => {
    if (!accessible || !['available', 'none'].includes(currentStatus)) return;
    openedSources.current.add(scope);
    setPanel({ ownerScope, open: true });
  }, [accessible, currentStatus, ownerScope, scope]);
  const closePanel = useCallback(() => setPanel({ ownerScope, open: false }), [ownerScope]);
  const toggle = useCallback(() => panelOpen ? closePanel() : openPanel(), [closePanel, panelOpen, openPanel]);
  const view = renderedView.scope === scope ? renderedView.value : views.current.get(scope) ?? { ...INITIAL_VIEW };

  useEffect(() => {
    if (pdf.status === 'ready') {
      const page = clampPage(getView().page, pdf.doc.pageCount);
      if (page !== getView().page) setView({ page });
    }
  }, [pdf, getView, setView]);

  return {
    scope,
    personal: Boolean(studentId),
    status: currentStatus,
    open: panelOpen,
    toggle,
    close: closePanel,
    pdf,
    upload,
    uploading: accessible && uploading,
    uploadError: accessible ? uploadError : null,
    getView,
    view,
    setView,
    rememberScroll,
  };
}
