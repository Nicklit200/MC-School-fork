import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import '../../styles/floating-islands.css';
import '../../styles/whiteboard-original-v3.css';
import { ApiRequestError } from '../../api/client';
import { onlineClassesApi, type AnnotationTargetType } from '../../api/onlineClasses';
import { useI18n } from '../../i18n/I18nContext';
import { BoardToolbar, BoardToolbarIcon } from './BoardToolbar';
import { downloadBlob, exportBoardPdf } from './boardExport';
import { A4_PORTRAIT_ASPECT } from './boardPaper';
import {
  DEFAULT_TOOL_SETTINGS,
  type ToolSettings,
} from './boardTools';
import {
  addPage,
  clampZoom,
  DEFAULT_VIEW,
  ensurePageCount,
  initialPages,
  nextPage,
  previousPage,
  viewOf,
  withView,
  goToPage,
  zoomAbout,
  type BoardPages,
  type PageView,
} from './boardView';
import { isPersonalBoard, personalBoardOwner, isPersonalWorkbookBoard } from './boards';
import { VIEW_TOPIC, viewEvent, type DocumentViewport, type StudentViewSnapshot } from './events';
import { documentPageSize, documentRailWidth, documentScrollBounds, zoomDocumentScroll, type DocumentScroll } from './documentBoardView';
import { wheelZoomScale } from './wheelGesture';
import type { DocumentGesture } from './documentGesture';
import { isPalmContact, type InputMode } from './inputPolicy';
import { navigationLocked } from './followTeacher';
import { PageNavigator } from './PageNavigator';
import { describeView } from './followTeacher';
import type { PdfDoc } from './pdfDocument';
import { buildPdf, dataUrlToBytes } from './pdfWriter';
import { useClassEvents } from './useClassEvents';
import { useFollowTeacher } from './useFollowTeacher';
import { useStudentView } from './useStudentView';
import { captureContinuousRegion, capturePagedRegion, documentZoomForStudentRegion,
  fitStudentViewport, viewForStudentRegion } from './studentViewGeometry';
import { useHostUserId } from './useHostUserId';
import { useLaserPointers } from './useLaserPointers';
import {
  type EraserMode,
  type Tool,
} from './WhiteboardCanvas';

import { WhiteboardPageSurface, type PageSurfaceHandle, type PageSurfaceStatus } from './WhiteboardPageSurface';
import { useBoardPageLayout } from './useBoardPageLayout';
import { useAnnotationPageSync } from './useAnnotationPageSync';
import type { NotebookCameraGeometry } from './notebookCameraGeometry';

const INPUT_MODE_KEY = 'mc.board.inputMode';
// Keep the teacher's pen settings while individual student boards mount/unmount.
const boardToolPreferences = new Map<string, Record<Tool, ToolSettings>>();
const ZOOM_BUTTON_FACTOR = 1.25;
interface DocumentTransform { zoom: number; revision: number; scroll: DocumentScroll | null }

/** The part of the page list left visible between floating control islands. */
function readScrollViewport(element: HTMLElement) {
  const style = getComputedStyle(element);
  const top = parseFloat(style.paddingTop) || 0;
  const bottom = parseFloat(style.paddingBottom) || 0;
  return {
    top,
    height: Math.max(0, element.clientHeight - top - bottom),
    width: Math.max(0, element.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0)),
  };
}

export interface LiveBoardBackground {
  source: CanvasImageSource;
  width: number;
  height: number;
  notebookView?: NotebookCameraGeometry | null;
}

function loadInputMode(): InputMode {
  try {
    return localStorage.getItem(INPUT_MODE_KEY) === 'stylus' ? 'stylus' : 'finger';
  } catch {
    return 'finger';
  }
}

/**
 * The lesson board: toolbar, canvas, page switcher, zoom, and (for the host)
 * follow-the-teacher.
 *
 * <p>Serves the shared board by default; only the target differs for a screen
 * share overlay. The answers panel is passed in as `overlay` so it floats over
 * the board without resizing it.
 */
export function WhiteboardPanel({
  classId,
  actorId,
  isHost,
  targetType = 'WHITEBOARD',
  targetId = 'board-1',
  sourceAspect = null,
  canAnnotate = true,
  document: providedPdfDocument = null,
  liveBackground = null,
  fileAction,
  hostActions,
  overlay,
  active = true,
  compactPreview = false,
  followStudent = false,
  observedPage,
  onSaveLessonDocuments,
  savingLessonDocuments = false,
  lessonDocumentsStatus = null,
  lessonDocumentsError = false,
}: {
  classId: string;
  actorId: string;
  isHost: boolean;
  targetType?: AnnotationTargetType;
  targetId?: string;
  sourceAspect?: number | null;
  canAnnotate?: boolean;
  /** A loaded PDF whose pages sit under the marks. */
  document?: PdfDoc | null;
  /** Live camera frame rendered in the same coordinate system as the marks. */
  liveBackground?: LiveBoardBackground | null;
  /** The classroom's real workbook upload action. */
  fileAction?: ReactNode;
  /** Extra teacher-only buttons next to "clear all" (e.g. Answers). */
  hostActions?: ReactNode;
  /** Floats over the board area, below the toolbar. */
  overlay?: ReactNode;
  /** False while another board is on screen: pauses polling, keeps state. */
  active?: boolean;
  /** Read-only overview with an independent local pan/zoom for each pupil. */
  compactPreview?: boolean;
  /** Teacher opt-in: reproduce the owner's visible document region. */
  followStudent?: boolean;
  /** Page currently being viewed by the student who owns this board. */
  observedPage?: number;
  onSaveLessonDocuments?: () => void;
  savingLessonDocuments?: boolean;
  lessonDocumentsStatus?: string | null;
  lessonDocumentsError?: boolean;
}) {
  const { t, language } = useI18n();
  const camera = targetType === 'NOTEBOOK_CAMERA';
  const pdfDocument = camera ? null : providedPdfDocument;
  const cameraBackground = camera && liveBackground && Number.isFinite(liveBackground.width) && liveBackground.width > 0
    && Number.isFinite(liveBackground.height) && liveBackground.height > 0 ? liveBackground : null;
  // Personal ink previews go only to the owner and host; durable marks are
  // authorized by the server. Personal boards never follow the shared view.
  const personal = isPersonalBoard(targetId);
  const ownerId = personalBoardOwner(targetId);
  const studentFollowRequested = isHost && personal && followStudent;
  const [tool, setTool] = useState<Tool>('pen');
  const [toolSettings, setToolSettings] = useState<Record<Tool, ToolSettings>>(
    () => boardToolPreferences.get(`${classId}:${actorId}`) ?? DEFAULT_TOOL_SETTINGS,
  );
  const [eraserMode, setEraserMode] = useState<EraserMode>('partial');
  const [inputMode, setInputModeState] = useState<InputMode>(loadInputMode);
  const [pages, setPages] = useState<BoardPages>(() => initialPages(1));
  const [previewViews, setPreviewViews] = useState<Record<number, PageView>>({});
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<'unavailable' | 'failed' | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportFailed, setExportFailed] = useState(false);
  const [layout, setLayout] = useBoardPageLayout(actorId);
  const pageHandles = useRef(new Map<number, PageSurfaceHandle>());
  const pageElements = useRef(new Map<number, HTMLElement>());
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const currentPage = useCallback(() => pageHandles.current.get(pagesRef.current.current), []);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);
  const [documentTransform, setDocumentTransform] = useState<DocumentTransform>({ zoom: 1, revision: 0, scroll: null });
  const documentZoom = documentTransform.zoom;
  const setDocumentZoom = useCallback((zoom: number) => setDocumentTransform({ zoom, revision: 0, scroll: null }), []);
  const documentZoomRef = useRef(1);
  const committedDocumentZoom = useRef(1);
  useLayoutEffect(() => { committedDocumentZoom.current = documentZoom; }, [documentZoom]);
  const [documentView, setDocumentView] = useState<DocumentViewport>({ zoom: 1, x: .5, y: .5 });
  const documentViewRef = useRef(documentView);
  documentViewRef.current = documentView;
  const pendingDocumentScroll = useRef<DocumentScroll | null>(null);
  const documentFrameRequest = useRef<number | null>(null);
  const documentGestureRevision = useRef(0);
  const appliedDocumentRevision = useRef(0);
  const cancelDocumentFrame = useCallback(() => {
    if (documentFrameRequest.current !== null) window.cancelAnimationFrame(documentFrameRequest.current);
    documentFrameRequest.current = null;
    pendingDocumentScroll.current = null;
    documentZoomRef.current = committedDocumentZoom.current;
  }, []);
  const remoteDocumentView = useRef<{ value: DocumentViewport; page: number } | null>(null);
  const lastRemoteDocumentView = useRef<{ value: DocumentViewport; page: number } | null>(null);
  const fitViewport = useRef({ width: 0, height: 0 });
  const [remoteViewRevision, setRemoteViewRevision] = useState(0);
  const [stageViewport, setStageViewport] = useState({ width: 0, height: 0 });
  const [canvasGeometry, setCanvasGeometry] = useState<Record<number, {
    viewport: { width: number; height: number }; aspect: number | null;
  }>>({});
  const reportCanvasGeometry = useCallback((index: number, viewport: { width: number; height: number }, aspect: number | null) => {
    setCanvasGeometry(current => {
      const previous = current[index];
      return previous?.aspect === aspect && previous.viewport.width === viewport.width && previous.viewport.height === viewport.height
        ? current : { ...current, [index]: { viewport, aspect } };
    });
  }, []);
  const [pupilSnapshot, setPupilSnapshot] = useState<StudentViewSnapshot | null>(null);
  const receiveDocumentView = useCallback((value: DocumentViewport, page: number) => {
    cancelDocumentFrame();
    remoteDocumentView.current = { value, page };
    lastRemoteDocumentView.current = { value, page };
    documentZoomRef.current = value.zoom;
    setDocumentZoom(value.zoom);
    setRemoteViewRevision(current => current + 1);
  }, [cancelDocumentFrame, setDocumentZoom]);

  const hostUserId = useHostUserId(classId);
  const pupilView = useStudentView({
    classId, boardId: targetId, targetType: camera ? 'NOTEBOOK_CAMERA' : 'WHITEBOARD', actorId, isHost, hostUserId,
    active: active && personal && (targetType === 'WHITEBOARD' || camera),
    followEnabled: studentFollowRequested, snapshot: pupilSnapshot,
  });
  // A hidden tile or a short connection interruption retains its last viewport.
  const rememberedStudentView = useRef<{ key: string; value: StudentViewSnapshot | null }>({ key: '', value: null });
  const studentViewKey = `${classId}:${targetType}:${targetId}:${actorId}:${isHost}:${hostUserId}`;
  if (rememberedStudentView.current.key !== studentViewKey) rememberedStudentView.current = { key: studentViewKey, value: null };
  if (pupilView.remoteView) rememberedStudentView.current.value = pupilView.remoteView;
  const studentView = studentFollowRequested ? pupilView.remoteView ?? rememberedStudentView.current.value : null;
  const manualView = useRef<{ pages: BoardPages; zoom: number; document: DocumentViewport } | null>(null);
  useLayoutEffect(() => {
    if (studentFollowRequested) {
      manualView.current ??= { pages: pagesRef.current, zoom: documentZoomRef.current, document: documentViewRef.current };
    } else if (manualView.current) {
      const previous = manualView.current;
      manualView.current = null;
      setPages(current => ({ ...previous.pages, count: Math.max(current.count, previous.pages.count) }));
      documentZoomRef.current = previous.zoom;
      setDocumentZoom(previous.zoom);
      setDocumentView(previous.document);
      remoteDocumentView.current = { value: { ...previous.document, zoom: previous.zoom }, page: previous.pages.current };
      lastRemoteDocumentView.current = null;
      pendingDocumentScroll.current = null;
    }
  }, [studentFollowRequested]);
  const getBoardSize = useCallback((index = pagesRef.current.current) => {
    const size = pageHandles.current.get(index)?.canvas()?.getSize();
    if (size && size.width > 0 && size.height > 0) return size;
    const element = pageElements.current.get(index);
    return { width: element?.clientWidth ?? 0, height: element?.clientHeight ?? 0 };
  }, []);

  // Open on the pupil's page once. Later page changes only move the teacher
  // when they explicitly enabled following, never during manual inspection.
  const openedObservedPage = useRef(false);
  useEffect(() => {
    if (camera || !isHost || !personal || observedPage === undefined || openedObservedPage.current || studentFollowRequested) return;
    openedObservedPage.current = true;
    setPages((current) => goToPage(ensurePageCount(current, observedPage + 1), observedPage));
  }, [camera, isHost, personal, observedPage, studentFollowRequested]);

  const { publish: publishPersonalView } = useClassEvents(classId, VIEW_TOPIC, () => undefined);
  useEffect(() => {
    if (camera || isHost || !personal || ownerId !== actorId || !active) return;
    const send = () => void publishPersonalView(viewEvent(classId, describeView(pages, viewOf(pages), getBoardSize(), targetId, false)), true, hostUserId ? [hostUserId] : []);
    send();
    const timer = window.setInterval(send, 2000);
    return () => window.clearInterval(timer);
  }, [camera, isHost, personal, ownerId, actorId, active, classId, pages, targetId, getBoardSize, publishPersonalView, hostUserId]);

  const view = compactPreview ? previewViews[pages.current] ?? DEFAULT_VIEW : viewOf(pages);
  const follow = useFollowTeacher({
    classId,
    boardId: targetId,
    isHost,
    hostUserId,
    pages,
    setPages,
    getBoardSize,
    active,
    enabled: !personal && !camera,
    documentView: layout === 'continuous' && targetType === 'WHITEBOARD' ? { ...documentView, zoom: documentZoom } : undefined,
    onDocumentView: receiveDocumentView,
  });
  const locked = navigationLocked(isHost, follow.following) || studentFollowRequested;
  const annotationAllowed = canAnnotate && !studentFollowRequested;
  // Manual overview navigation is independent of the focused workspace. A
  // followed pupil can use either paged or continuous document navigation.
  const continuous = targetType === 'WHITEBOARD' && (studentFollowRequested
    ? studentView?.layout === 'continuous'
    : !compactPreview && (canAnnotate || follow.followLayout === 'continuous') && (follow.followLayout ?? layout) === 'continuous');

  useLayoutEffect(() => {
    if (!studentView) return;
    openedObservedPage.current = true;
    setPages(current => goToPage(ensurePageCount(current, studentView.pageCount), studentView.page));
    pendingDocumentScroll.current = null;
    remoteDocumentView.current = null;
  }, [studentView]);

  useEffect(() => {
    const element = stageRef.current;
    if (!element) return;
    const measure = () => {
      const next = { width: element.clientWidth, height: element.clientHeight };
      if (next.width > 0 && next.height > 0) setStageViewport(previous =>
        previous.width === next.width && previous.height === next.height ? previous : next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const studentFrame = studentView ? fitStudentViewport(studentView.viewport, stageViewport) : null;
  const studentFrameStyle: CSSProperties | undefined = studentView ? {
    inset: 'auto', left: studentFrame?.left ?? 0, top: studentFrame?.top ?? 0,
    width: studentView.viewport.width, height: studentView.viewport.height,
    transform: `scale(${studentFrame ? studentFrame.width / studentView.viewport.width : 1})`,
    transformOrigin: 'top left', visibility: studentFrame ? 'visible' : 'hidden',
  } : undefined;

  const [pageStatuses, setPageStatuses] = useState<Record<number, PageSurfaceStatus>>({});
  const reportPageStatus = useCallback((index: number, status: PageSurfaceStatus) => {
    setPageStatuses(current => {
      const previous = current[index];
      return previous?.canUndo === status.canUndo && previous.canRedo === status.canRedo
        && previous.loadingPdfPage === status.loadingPdfPage ? current : { ...current, [index]: status };
    });
  }, []);
  const status = pageStatuses[pages.current];
  const loadingPdfPage = status?.loadingPdfPage ?? false;
  const board = {
    canUndo: status?.canUndo ?? false, canRedo: status?.canRedo ?? false,
    undo: () => currentPage()?.board.undo(), redo: () => currentPage()?.board.redo(),
    clearMine: () => currentPage()?.board.clearMine(), clearAll: () => currentPage()?.board.clearAll(),
  };
  const { lasers, sendLaser: broadcastLaser } = useLaserPointers(classId, targetId);
  const sendLaser = personal || camera ? undefined : broadcastLaser;

  // --- Pages ----------------------------------------------------------------
  const receivePageCount = useCallback((count: number) => setPages(current => ensurePageCount(current, count)), []);
  const pageSync = useAnnotationPageSync({ classId, targetType, targetId, actorId, isHost, hostUserId, active,
    onPageCount: receivePageCount });

  // A PDF sets the floor for the page count; blank pages can still be added after it.
  useEffect(() => {
    if (pdfDocument) setPages((current) => ensurePageCount(current, pdfDocument.pageCount));
  }, [pdfDocument]);

  const [pageHeight, setPageHeight] = useState(500);
  const [pageWidth, setPageWidth] = useState(800);
  const [pageAspects, setPageAspects] = useState<Record<number, number>>({});
  const aspectCache = useRef<Record<number, number>>({});
  const geometryAnchor = useRef<{ index: number; ratio: number } | null>(null);
  const [visitedPages, setVisitedPages] = useState(() => new Set([0]));
  const [visiblePages, setVisiblePages] = useState(() => new Set([0]));
  const scrollSelected = useRef<number | null>(null);
  const drawingPage = useRef<number | null>(null);
  const pointerScrollStart = useRef(0);
  const gapContacts = useRef(new Map<number, { x: number; y: number }>());
  const documentContacts = useRef(new Map<number, { x: number; y: number }>());
  const documentNavigationActive = useRef(false);
  const surfacePointers = useRef(new Set<number>());
  const penPointers = useRef(new Set<number>());
  const nativePenPages = useRef(new Set<number>());
  const lastPenContact = useRef(Number.NEGATIVE_INFINITY);
  const noteDocumentPenContact = (index: number, pressed: boolean) => {
    lastPenContact.current = Date.now();
    if (!pressed) { nativePenPages.current.delete(index); return; }
    nativePenPages.current.add(index);
    cancelDocumentFrame();
    gapContacts.current.clear(); documentContacts.current.clear();
    documentNavigationActive.current = false;
    for (const handle of pageHandles.current.values()) handle.canvas()?.setDocumentNavigation?.(false);
  };
  useLayoutEffect(() => {
    const release = () => {
      cancelDocumentFrame();
      gapContacts.current.clear(); documentContacts.current.clear(); surfacePointers.current.clear(); penPointers.current.clear(); nativePenPages.current.clear();
      documentNavigationActive.current = false;
      for (const handle of pageHandles.current.values()) handle.canvas()?.setDocumentNavigation?.(false);
    };
    if (!continuous || locked || !active) release();
    window.addEventListener('blur', release);
    return () => { window.removeEventListener('blur', release); release(); };
  }, [continuous, locked, active, classId, targetType, targetId, cancelDocumentFrame]);
  const layoutWidth = studentView?.layout === 'continuous' ? studentView.viewport.width : pageWidth;
  const layoutHeight = studentView?.layout === 'continuous' ? Math.max(1, Math.round(studentView.viewport.height * .92)) : pageHeight;
  const basePageSizes = useMemo(() => Array.from({ length: pages.count }, (_, index) => documentPageSize(layoutWidth, layoutHeight,
    pageAspects[index] ?? (sourceAspect && Number.isFinite(sourceAspect) && sourceAspect > 0 ? sourceAspect : A4_PORTRAIT_ASPECT))),
  [pages.count, layoutWidth, layoutHeight, pageAspects, sourceAspect]);
  const baseRailWidth = Math.max(...basePageSizes.map(size => size.width));
  const baseRailHeight = useMemo(() => basePageSizes.reduce((sum, size) => sum + size.height, 0)
    + 24 * Math.max(0, basePageSizes.length - 1), [basePageSizes]);
  const displayedDocumentZoom = studentView?.layout === 'continuous'
    ? documentZoomForStudentRegion(studentView.region, studentView.viewport, basePageSizes[studentView.page] ?? basePageSizes[0]) ?? documentZoom
    : documentZoom;
  const railWidth = documentRailWidth(baseRailWidth, layoutWidth, displayedDocumentZoom);
  const pageGap = studentView?.layout === 'continuous' && studentView.pageGap !== undefined
    ? studentView.pageGap * (basePageSizes[studentView.page] ?? basePageSizes[0]).width * displayedDocumentZoom
    : 24 * displayedDocumentZoom;
  const rememberDocumentView = useCallback((zoom = documentZoomRef.current) => {
    const root = scrollRef.current, element = pageElements.current.get(pagesRef.current.current);
    if (!root || !element || element.offsetWidth <= 0 || element.offsetHeight <= 0) return;
    const viewport = readScrollViewport(root), style = getComputedStyle(root);
    const left = parseFloat(style.paddingLeft) || 0;
    const value = {
      zoom,
      x: Math.max(-10, Math.min(10, (root.scrollLeft + left + viewport.width / 2 - element.offsetLeft) / element.offsetWidth)),
      y: Math.max(-10, Math.min(10, (root.scrollTop + viewport.top + viewport.height / 2 - element.offsetTop) / element.offsetHeight)),
    };
    setDocumentView(previous => Object.keys(value).every(key => Math.abs(value[key as keyof DocumentViewport] - previous[key as keyof DocumentViewport]) < .0001) ? previous : value);
  }, []);
  const applyDocumentGesture = useCallback(({ scale, anchor, pan }: DocumentGesture) => {
    const root = scrollRef.current;
    if (!continuous || locked || !active || !root || penPointers.current.size > 0 || nativePenPages.current.size > 0 || !Number.isFinite(scale) || scale <= 0) return;
    const zoom = documentZoomRef.current, nextZoom = clampZoom(zoom * scale);
    const rect = root.getBoundingClientRect(), style = getComputedStyle(root);
    const origin = { x: parseFloat(style.paddingLeft) || 0, y: parseFloat(style.paddingTop) || 0 };
    const viewport = readScrollViewport(root);
    const nextRailWidth = documentRailWidth(baseRailWidth, viewport.width, nextZoom);
    const nextRailHeight = baseRailHeight * nextZoom;
    const previousScroll = pendingDocumentScroll.current ?? { left: root.scrollLeft, top: root.scrollTop };
    const scroll = zoomDocumentScroll({ zoom, nextZoom,
      scroll: previousScroll, origin,
      railWidth: documentRailWidth(baseRailWidth, viewport.width, zoom), nextRailWidth,
      anchor: { x: anchor.x - rect.left, y: anchor.y - rect.top }, pan,
      maxScroll: documentScrollBounds({ width: nextRailWidth, height: nextRailHeight }, viewport) });
    if (nextZoom === zoom && scroll.left === previousScroll.left && scroll.top === previousScroll.top) return;
    pendingDocumentScroll.current = scroll;
    documentZoomRef.current = nextZoom;
    documentGestureRevision.current++;
    if (documentFrameRequest.current !== null) return;
    documentFrameRequest.current = window.requestAnimationFrame(() => {
      documentFrameRequest.current = null;
      if (!pendingDocumentScroll.current) return;
      if (penPointers.current.size > 0 || nativePenPages.current.size > 0) { cancelDocumentFrame(); return; }
      // A frame carries its own zoom and scroll. A later input packet must not
      // apply its newer scroll to an older React layout that is still committing.
      setDocumentTransform({ zoom: documentZoomRef.current, revision: documentGestureRevision.current,
        scroll: { ...pendingDocumentScroll.current } });
    });
  }, [continuous, locked, active, baseRailWidth, baseRailHeight, cancelDocumentFrame]);
  useEffect(() => {
    const root = scrollRef.current;
    if (targetType !== 'WHITEBOARD' || !root) return;
    const wheel = (event: WheelEvent) => {
      // Page surfaces handle their own wheel. This also covers blank margins
      // around a page without applying the same event twice.
      if ((event.target as Element).closest('.whiteboard__surface')) return;
      if ((event.target as Element).closest('input, textarea, select, [contenteditable="true"]')) return;
      if (!event.ctrlKey && !event.metaKey) {
        if (drawingPage.current !== null || locked || !active) {
          event.preventDefault(); event.stopPropagation();
        }
        return;
      }
      event.preventDefault(); event.stopPropagation();
      if (drawingPage.current !== null || locked || !active) return;
      const scale = wheelZoomScale(event, readScrollViewport(root).height), anchor = { x: event.clientX, y: event.clientY };
      if (continuous) applyDocumentGesture({ scale, anchor, pan: { x: 0, y: 0 } });
      else currentPage()?.canvas()?.zoomAt?.(scale, anchor);
    };
    root.addEventListener('wheel', wheel, { passive: false });
    return () => root.removeEventListener('wheel', wheel);
  }, [continuous, locked, active, targetType, applyDocumentGesture, currentPage]);
  useEffect(() => {
    setVisitedPages(current => current.has(pages.current) ? current : new Set([...current, pages.current]));
  }, [pages.current]);
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const resize = () => {
      const viewport = readScrollViewport(element);
      const previous = fitViewport.current;
      if (continuous && !studentFollowRequested && previous.width > 0 && previous.height > 0 &&
          (Math.abs(previous.width - viewport.width) > .5 || Math.abs(previous.height - viewport.height) > .5) &&
          !pendingDocumentScroll.current && !remoteDocumentView.current) {
        remoteDocumentView.current = { value: { ...documentViewRef.current, zoom: documentZoomRef.current }, page: pagesRef.current.current };
      }
      fitViewport.current = viewport;
      if (element.clientHeight > 0) setPageHeight(Math.max(1, Math.round(viewport.height * .92)));
      if (element.clientWidth > 0) setPageWidth(Math.max(1, viewport.width));
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [continuous, studentFollowRequested]);
  const reportPageAspect = useCallback((index: number, aspect: number | null) => {
    if (!aspect || !Number.isFinite(aspect) || aspect <= 0 || aspectCache.current[index] === aspect) return;
    const root = scrollRef.current, selected = pageElements.current.get(pagesRef.current.current);
    if (continuous && !studentFollowRequested && root && selected && selected.offsetHeight > 0) geometryAnchor.current = {
      index: pagesRef.current.current, ratio: (root.scrollTop - selected.offsetTop) / selected.offsetHeight,
    };
    aspectCache.current = { ...aspectCache.current, [index]: aspect };
    setPageAspects(aspectCache.current);
  }, [continuous, studentFollowRequested]);
  useLayoutEffect(() => {
    const anchor = geometryAnchor.current, root = scrollRef.current;
    if (!continuous || studentFollowRequested) { geometryAnchor.current = null; return; }
    if (!anchor || !root) return;
    const element = pageElements.current.get(anchor.index);
    if (element) root.scrollTop = Math.max(0, element.offsetTop + anchor.ratio * element.offsetHeight);
    geometryAnchor.current = null;
  }, [continuous, pageAspects, studentFollowRequested]);
  useEffect(() => {
    const root = scrollRef.current;
    if (!continuous || !root || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => {
      setVisiblePages(current => {
        const next = new Set(current);
        for (const entry of entries) {
          const index = Number((entry.target as HTMLElement).dataset.pageIndex);
          if (entry.isIntersecting) next.add(index); else next.delete(index);
        }
        return next;
      });
      const incoming = entries.filter(entry => entry.isIntersecting).map(entry => Number((entry.target as HTMLElement).dataset.pageIndex));
      if (incoming.length) setVisitedPages(current => new Set([...current, ...incoming]));
    }, { root, rootMargin: '50% 0px', threshold: 0 });
    for (const element of pageElements.current.values()) observer.observe(element);
    return () => observer.disconnect();
  }, [continuous, pages.count, active]);
  const alignCurrentPage = useCallback(() => {
    const root = scrollRef.current, element = pageElements.current.get(pagesRef.current.current);
    if (root && element) {
      const viewport = readScrollViewport(root);
      root.scrollTop = Math.max(0, element.offsetTop - viewport.top - viewport.height * .02);
    }
  }, []);
  useLayoutEffect(() => {
    if (!continuous || !active || studentFollowRequested) return;
    if (pendingDocumentScroll.current || remoteDocumentView.current || (locked && lastRemoteDocumentView.current)) return;
    if (scrollSelected.current === pages.current && !locked) { scrollSelected.current = null; return; }
    scrollSelected.current = null;
    alignCurrentPage();
  }, [continuous, active, pages.current, pageHeight, pageWidth, alignCurrentPage, studentFollowRequested]);
  useLayoutEffect(() => {
    const root = scrollRef.current;
    if (!continuous || !root) return;
    if (studentView?.layout === 'continuous') {
      const element = pageElements.current.get(studentView.page);
      if (element && element.offsetWidth > 0 && element.offsetHeight > 0) {
        // These are logical CSS coordinates inside the source-sized frame.
        // Its outer CSS scale changes only presentation, never this scroll.
        root.scrollLeft = element.offsetLeft + studentView.region.x * element.offsetWidth;
        root.scrollTop = element.offsetTop + studentView.region.y * element.offsetHeight;
      }
      return;
    }
    const remote = locked && follow.followLayout === 'continuous' ? lastRemoteDocumentView.current : remoteDocumentView.current;
    if (remote) {
      const element = pageElements.current.get(remote.page);
      if (element && element.offsetWidth > 0 && element.offsetHeight > 0) {
        const viewport = readScrollViewport(root), style = getComputedStyle(root);
        root.scrollLeft = Math.max(0, element.offsetLeft + remote.value.x * element.offsetWidth - (parseFloat(style.paddingLeft) || 0) - viewport.width / 2);
        root.scrollTop = Math.max(0, element.offsetTop + remote.value.y * element.offsetHeight - viewport.top - viewport.height / 2);
        remoteDocumentView.current = null;
      }
    } else if (documentTransform.scroll && documentTransform.revision > appliedDocumentRevision.current) {
      root.scrollLeft = documentTransform.scroll.left;
      root.scrollTop = documentTransform.scroll.top;
      appliedDocumentRevision.current = documentTransform.revision;
      if (documentGestureRevision.current === documentTransform.revision) pendingDocumentScroll.current = null;
    }
    if (remote) pendingDocumentScroll.current = null;
    rememberDocumentView(documentZoom);
  }, [continuous, locked, follow.followLayout, documentZoom, remoteViewRevision, pages.current, pageAspects, pageHeight, pageWidth,
    rememberDocumentView, studentView, displayedDocumentZoom, documentTransform]);
  const activatePage = useCallback((index: number) => {
    if (locked) return;
    scrollSelected.current = index;
    setPages(current => goToPage(current, index));
  }, [locked]);
  const scrollPages = (dx: number, dy: number) => {
    const root = scrollRef.current;
    if (!locked && root) { root.scrollLeft += dx; root.scrollTop += dy; }
  };
  const handleScroll = () => {
    const root = scrollRef.current;
    if (!continuous || !root || drawingPage.current !== null) return;
    if (locked) return;
    const viewport = readScrollViewport(root);
    const visibleTop = root.scrollTop + viewport.top;
    const visibleBottom = visibleTop + viewport.height;
    const focus = (visibleTop + visibleBottom) / 2;
    let nearest = pagesRef.current.current, distance = Infinity, mostVisible = -1;
    for (const [index, element] of pageElements.current) {
      const visible = Math.max(0, Math.min(element.offsetTop + element.offsetHeight, visibleBottom) - Math.max(element.offsetTop, visibleTop));
      const next = Math.abs(element.offsetTop + element.offsetHeight / 2 - focus);
      if (visible > mostVisible || (visible === mostVisible && next < distance)) { nearest = index; distance = next; mostVisible = visible; }
    }
    activatePage(nearest);
    // The selected page changes in React after this event. Measure that page now.
    const element = pageElements.current.get(nearest);
    if (element && element.offsetWidth > 0 && element.offsetHeight > 0) {
      const style = getComputedStyle(root);
      const value = { zoom: documentZoomRef.current,
        x: Math.max(-10, Math.min(10, (root.scrollLeft + (parseFloat(style.paddingLeft) || 0) + viewport.width / 2 - element.offsetLeft) / element.offsetWidth)),
        y: Math.max(-10, Math.min(10, (root.scrollTop + viewport.top + viewport.height / 2 - element.offsetTop) / element.offsetHeight)),
      };
      setDocumentView(previous => previous.zoom === value.zoom && Math.abs(previous.x - value.x) < .0001 && Math.abs(previous.y - value.y) < .0001 ? previous : value);
    }
  };
  // Publish the owner's actual clear viewport, including continuous scrolling.
  // Measuring in document coordinates avoids both browser pixel density and
  // the teacher tile's dimensions changing the stored ink or visible crop.
  useLayoutEffect(() => {
    if (isHost || !personal || ownerId !== actorId || !active || (targetType !== 'WHITEBOARD' && !camera)) return;
    const geometry = canvasGeometry[pages.current];
    const canvasSize = geometry?.viewport ?? getBoardSize();
    const aspect = geometry?.aspect ?? pageAspects[pages.current] ?? sourceAspect ?? A4_PORTRAIT_ASPECT;
    let viewport = canvasSize;
    let region = capturePagedRegion(viewOf(pages), viewport, aspect);
    let gap: number | undefined;
    if (continuous) {
      const root = scrollRef.current, element = pageElements.current.get(pages.current);
      if (!root || !element) return;
      const clear = readScrollViewport(root), style = getComputedStyle(root);
      viewport = { width: clear.width, height: clear.height };
      region = captureContinuousRegion({
        left: root.scrollLeft + (parseFloat(style.paddingLeft) || 0), top: root.scrollTop + clear.top,
        ...viewport,
      }, { left: element.offsetLeft, top: element.offsetTop, width: element.offsetWidth, height: element.offsetHeight });
      if (element.offsetWidth > 0) gap = pageGap / element.offsetWidth;
    }
    if (!region) return;
    const snapshot: StudentViewSnapshot = {
      page: pages.current, pageCount: pages.count, layout: continuous ? 'continuous' : 'paged', viewport, region,
      ...(gap === undefined ? {} : { pageGap: gap }),
    };
    setPupilSnapshot(previous => JSON.stringify(previous) === JSON.stringify(snapshot) ? previous : snapshot);
  }, [isHost, personal, ownerId, actorId, active, targetType, camera, pages, continuous, documentZoom,
    documentView, canvasGeometry, pageAspects, sourceAspect, pageWidth, pageHeight, pageGap, getBoardSize]);

  const displayedPageView = (index: number) => {
    if (continuous) return DEFAULT_VIEW;
    if (studentView?.layout === 'paged') {
      const aspect = canvasGeometry[index]?.aspect ?? pageAspects[index] ?? sourceAspect ?? A4_PORTRAIT_ASPECT;
      return viewForStudentRegion(studentView.region, studentView.viewport, aspect) ?? DEFAULT_VIEW;
    }
    return compactPreview ? previewViews[index] ?? DEFAULT_VIEW : viewOf(pages, index);
  };
  const changePageView = (next: PageView, index = pagesRef.current.current) => {
    if (locked) return;
    if (compactPreview) setPreviewViews(current => ({ ...current, [index]: next }));
    else setPages(current => withView(current, next, index));
  };
  const finishPointerNavigation = () => {
    drawingPage.current = null;
    if (Math.abs((scrollRef.current?.scrollTop ?? 0) - pointerScrollStart.current) > .5) handleScroll();
  };
  const beginDocumentPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!continuous) return;
    if (event.pointerType === 'pen') {
      cancelDocumentFrame();
      penPointers.current.add(event.pointerId);
      lastPenContact.current = Date.now(); gapContacts.current.clear(); documentContacts.current.clear();
      documentNavigationActive.current = false;
      for (const handle of pageHandles.current.values()) handle.canvas()?.setDocumentNavigation?.(false);
    }
    const navigationPointer = event.pointerType === 'touch' || (event.pointerType === 'mouse' && (tool === 'pan' || event.button === 1));
    const fromPage = Boolean((event.target as Element).closest('.whiteboard__page'));
    const ignoredTouch = event.pointerType === 'touch' && (isPalmContact('touch', event.width, event.height) || penPointers.current.size > 0 || nativePenPages.current.size > 0 || Date.now() - lastPenContact.current < 350);
    if (event.pointerType === 'touch' && !ignoredTouch && !locked) {
      documentContacts.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (documentContacts.current.size >= 2) {
        if (!documentNavigationActive.current) {
          documentNavigationActive.current = true;
          for (const handle of pageHandles.current.values()) handle.canvas()?.setDocumentNavigation?.(true);
        }
        gapContacts.current = new Map(documentContacts.current);
        for (const id of gapContacts.current.keys()) {
          try { event.currentTarget.setPointerCapture(id); } catch { /* An ended contact needs no capture. */ }
        }
      }
    }
    const owned = documentNavigationActive.current || gapContacts.current.size > 0 || (!fromPage && surfacePointers.current.size === 0);
    if (!navigationPointer || !owned || locked || ignoredTouch) {
      surfacePointers.current.add(event.pointerId);
      return;
    }
    event.preventDefault(); event.stopPropagation();
    gapContacts.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Capture may be unavailable. */ }
  };
  const moveDocumentPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    if (documentContacts.current.has(event.pointerId)) documentContacts.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const previous = gapContacts.current.get(event.pointerId);
    if (!previous) return;
    event.preventDefault(); event.stopPropagation();
    const before = [...gapContacts.current.values()].slice(0, 2);
    gapContacts.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const after = [...gapContacts.current.values()].slice(0, 2);
    const center = (points: typeof before) => points.length === 1 ? points[0]
      : { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
    const start = center(before), end = center(after);
    const distance = (points: typeof before) => Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
    const scale = before.length === 2 && distance(before) > 0 ? distance(after) / distance(before) : 1;
    applyDocumentGesture({ scale, anchor: start, pan: { x: end.x - start.x, y: end.y - start.y } });
  };
  const endDocumentPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'pen') { lastPenContact.current = Date.now(); penPointers.current.delete(event.pointerId); }
    documentContacts.current.delete(event.pointerId);
    surfacePointers.current.delete(event.pointerId);
    if (gapContacts.current.delete(event.pointerId)) { event.preventDefault(); event.stopPropagation(); }
    if (documentNavigationActive.current && documentContacts.current.size === 0) {
      documentNavigationActive.current = false;
      for (const handle of pageHandles.current.values()) handle.canvas()?.setDocumentNavigation?.(false);
    }
    finishPointerNavigation();
  };

  const zoomBy = (factor: number) => {
    const root = scrollRef.current;
    if (continuous && root) {
      const rect = root.getBoundingClientRect(), viewport = readScrollViewport(root), style = getComputedStyle(root);
      applyDocumentGesture({ scale: factor, anchor: { x: rect.left + (parseFloat(style.paddingLeft) || 0) + viewport.width / 2,
        y: rect.top + viewport.top + viewport.height / 2 }, pan: { x: 0, y: 0 } });
      return;
    }
    const size = getBoardSize();
    changePageView(zoomAbout(view, view.zoom * factor, { x: size.width / 2, y: size.height / 2 }, size));
  };

  const changeInputMode = (mode: InputMode) => {
    setInputModeState(mode);
    try {
      localStorage.setItem(INPUT_MODE_KEY, mode);
    } catch {
      // Remembering the choice is a convenience only.
    }
  };

  const saveSnapshot = async () => {
    setSaved(false);
    setSaveError(null);
    const image = currentPage()?.canvas()?.toDataURL();
    const document = currentPage()?.board.document;
    if (!image || !document) {
      setSaveError('failed');
      return;
    }
    try {
      await onlineClassesApi.saveAnnotationSnapshot(classId, document.id, image);
      setSaved(true);
    } catch (error) {
      // 409 means the server has nowhere to put files; say so rather than
      // leaving the teacher to wonder whether the click registered.
      setSaveError(error instanceof ApiRequestError && error.status === 409 ? 'unavailable' : 'failed');
    }
  };

  // Every page of this board as one PDF, built in the browser from what the
  // server holds, so it is complete whichever page happens to be on screen.
  const exportPdf = async () => {
    if (exporting) return;
    setExporting(true);
    setExportFailed(false);
    try {
      if (camera) {
        const image = currentPage()?.canvas()?.toDataURL('image/jpeg');
        const size = getBoardSize();
        if (!cameraBackground || !image || size.width <= 0 || size.height <= 0) throw new Error('No camera frame to export');
        const blob = new Blob([buildPdf([{ jpeg: dataUrlToBytes(image), width: Math.max(1, Math.floor(size.width)), height: Math.max(1, Math.floor(size.height)) }]) as BlobPart], { type: 'application/pdf' });
        downloadBlob(blob, `notebook-frame-${new Date().toISOString().slice(0, 10)}.pdf`);
        return;
      }
      const blob = await exportBoardPdf({
        classId,
        targetType,
        targetId,
        pageCount: pages.count,
        pdfDocument,
      });
      const day = new Date().toISOString().slice(0, 10);
      downloadBlob(blob, `${isPersonalWorkbookBoard(targetId) ? 'personal-worksheet' : personal ? 'my-board' : 'class-board'}-${day}.pdf`);
    } catch {
      setExportFailed(true);
    } finally {
      setExporting(false);
    }
  };

  const settingsOf = toolSettings[tool];
  const updateSettings = (target: Tool, patch: Partial<ToolSettings>) =>
    setToolSettings((current) => {
      const next = { ...current, [target]: { ...current[target], ...patch } };
      boardToolPreferences.set(`${classId}:${actorId}`, next);
      return next;
    });

  const hostButtons = isHost ? (
    <>
      <button
        type="button"
        onClick={() => {
          if (window.confirm(t('onlineClass.whiteboard.clearAllConfirm'))) {
            void board.clearAll();
          }
        }}
      >
        {t('onlineClass.whiteboard.clearAll')}
      </button>
      {!personal && !camera && (
        <button
          type="button"
          aria-pressed={follow.followEnabled}
          className={follow.followEnabled ? 'is-active' : undefined}
          onClick={() => follow.setFollowEnabled((enabled) => !enabled)}
        >
          {t('onlineClass.board.follow')}
        </button>
      )}
    </>
  ) : null;

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (!annotationAllowed || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') return;
    event.preventDefault();
    void (event.shiftKey ? board.redo() : board.undo());
  };

  return (
    <section className={`whiteboard school-islands-board whiteboard--original-v3${camera ? ' whiteboard--camera' : ''}${continuous ? ' whiteboard--continuous' : ''}${compactPreview ? ' whiteboard--compact-preview' : ''}${studentFollowRequested ? ' whiteboard--following-student' : ''}`} aria-label={t('onlineClass.board.viewLabel')} onKeyDown={onKeyDown}>
      <div className="whiteboard__topline">
      {annotationAllowed && (
        <BoardToolbar
          tool={tool}
          onToolChange={setTool}
          settings={toolSettings}
          onSettingsChange={updateSettings}
          eraserMode={eraserMode}
          onEraserModeChange={setEraserMode}
          inputMode={inputMode}
          onInputModeChange={changeInputMode}
          canUndo={board.canUndo}
          canRedo={board.canRedo}
          onUndo={() => void board.undo()}
          onRedo={() => void board.redo()}
          onClearMine={() => void board.clearMine()}
          hostActions={hostButtons}
          fileAction={fileAction}
          onAddPage={targetType === 'WHITEBOARD' && (isHost || personal) ? () => setPages(addPage) : undefined}
          addPageDisabled={locked}
          primaryActions={isHost ? <>
            {hostActions}
            <button type="button" className="board-toolbar__action" disabled={savingLessonDocuments}
              aria-label={onSaveLessonDocuments ? (savingLessonDocuments ? 'Сохраняем документы…' : 'Сохранить документы урока') : t('onlineClass.whiteboard.saveSnapshot')}
              title={onSaveLessonDocuments ? 'Сохранить документы урока' : t('onlineClass.whiteboard.saveSnapshot')}
              onClick={() => onSaveLessonDocuments ? onSaveLessonDocuments() : void saveSnapshot()}>
              <BoardToolbarIcon name="save" />
            </button>
          </> : undefined}
          sharedActions={<>
            {targetType === 'WHITEBOARD' && <button type="button" role="switch" aria-checked={layout === 'continuous'}
              onClick={() => setLayout(layout === 'continuous' ? 'paged' : 'continuous')}>
              <span aria-hidden="true">{layout === 'continuous' ? '✓' : '○'}</span>
              {language === 'DE' ? 'Fortlaufendes Scrollen' : 'Непрерывная прокрутка'}
            </button>}
            <button type="button" onClick={() => void exportPdf()} disabled={exporting}>
              {exporting ? t('onlineClass.whiteboard.exporting') : camera ? 'Скачать кадр PDF' : t('onlineClass.whiteboard.exportPdf')}
            </button>
          </>}
        />
      )}

      </div>
      <div role="status" aria-live="polite" className="whiteboard__notice">
        {loadingPdfPage && <span>{t('common.loading')}</span>}
        {lessonDocumentsStatus && <span role={lessonDocumentsError ? 'alert' : 'status'} style={lessonDocumentsError ? {color:'#dc2626'} : undefined}>{lessonDocumentsStatus}</span>}
        {saved && <span>{t('onlineClass.whiteboard.saved')}</span>}
        {saveError === 'unavailable' && (
          <span className="whiteboard__error">{t('onlineClass.whiteboard.saveUnavailable')}</span>
        )}
        {saveError === 'failed' && (
          <span className="whiteboard__error">{t('onlineClass.whiteboard.saveFailed')}</span>
        )}
        {exportFailed && <span className="whiteboard__error">{t('onlineClass.whiteboard.exportFailed')}</span>}
        {isHost && follow.followEnabled && <span>{t('onlineClass.board.follow.hostOn')}</span>}
        {!isHost && follow.following && <span>{t('onlineClass.board.follow.student')}</span>}
      </div>

      <div ref={stageRef} className="whiteboard__stage">
      {studentFollowRequested && !pupilView.isFresh && <div className="whiteboard__follow-status" role="status">
        {studentView ? 'Ждём обновление вида ученика…' : 'Ожидаем вид ученика…'}
      </div>}
      {!continuous && <div className="whiteboard__topline-pages">
        <PageNavigator current={pages.current} count={pages.count} disabled={locked}
          onPrevious={() => setPages(previousPage)} onNext={() => setPages(nextPage)}
          onAdd={(isHost || personal) && canAnnotate ? () => setPages(addPage) : undefined} />
      </div>}

        <div className="whiteboard__view-frame" style={studentFrameStyle} data-following-student={Boolean(studentView)}>
        <div ref={scrollRef} className={`whiteboard__pages${continuous ? ' whiteboard__pages--continuous' : ' whiteboard__pages--paged'}${locked ? ' whiteboard__pages--locked' : ''}`}
          role={continuous ? 'region' : undefined} aria-label={continuous ? (language === 'DE' ? 'Unterrichtsseiten' : 'Страницы доски') : undefined}
          tabIndex={continuous ? 0 : undefined} onScroll={handleScroll}
          onPointerDownCapture={event => {
            beginDocumentPointer(event);
            drawingPage.current = Number((event.target as Element).closest('[data-page-index]')?.getAttribute('data-page-index') ?? pages.current);
            pointerScrollStart.current = scrollRef.current?.scrollTop ?? 0;
          }}
          onPointerMoveCapture={moveDocumentPointer}
          onPointerUpCapture={endDocumentPointer} onPointerCancelCapture={endDocumentPointer}>
          <div ref={railRef} className="whiteboard__document" style={continuous ? { width: railWidth, gap: pageGap } : undefined}>
          {Array.from({ length: pages.count }, (_, index) => <article key={`${targetType}:${targetId}:${index}`}
            ref={element => { if (element) pageElements.current.set(index, element); else pageElements.current.delete(index); }}
            className="whiteboard__page" data-page-index={index} hidden={!continuous && index !== pages.current}
            aria-current={index === pages.current ? 'page' : undefined}
            aria-label={t('onlineClass.board.page.current', { current: index + 1, total: pages.count })}
            style={continuous ? { width: basePageSizes[index].width * displayedDocumentZoom, height: basePageSizes[index].height * displayedDocumentZoom } : undefined}>
            {(visitedPages.has(index) || index === pages.current) && <WhiteboardPageSurface
              ref={handle => { if (handle) { pageHandles.current.set(index, handle); if (documentNavigationActive.current) handle.canvas()?.setDocumentNavigation?.(true); } else pageHandles.current.delete(index); }}
              classId={classId} actorId={actorId} isHost={isHost} targetType={targetType} targetId={targetId} pageIndex={index}
              pdfDocument={pdfDocument} sourceAspect={sourceAspect} liveBackground={cameraBackground}
              tool={compactPreview ? 'pan' : tool} settings={settingsOf} textSettings={toolSettings.text} eraserMode={eraserMode} inputMode={inputMode}
              view={displayedPageView(index)} onViewChange={next => changePageView(next, index)}
              viewScope={studentFollowRequested ? 'pupil' : compactPreview ? 'overview' : 'focused'}
              onDocumentGesture={continuous ? applyDocumentGesture : undefined}
              onDocumentPenContact={continuous ? pressed => noteDocumentPenContact(index, pressed) : undefined}
              canAnnotate={annotationAllowed} navigationLocked={locked} continuous={continuous}
              wheelAction="pan"
              active={active && (index === pages.current || (continuous && visiblePages.has(index)))} selected={index === pages.current}
              lasers={index === pages.current && !camera ? lasers : []} onLaser={sendLaser}
              onActivate={activatePage} onStatusChange={reportPageStatus} onAspectChange={reportPageAspect}
              onDocumentReady={pageSync.documentReady}
              onCanvasGeometry={reportCanvasGeometry} onScrollGesture={scrollPages}
            />}
          </article>)}
          </div>
        </div>
        </div>

        <div className="whiteboard__zoom" role="group">
          <button
            type="button"
            onClick={() => zoomBy(1 / ZOOM_BUTTON_FACTOR)}
            disabled={locked || (continuous ? documentZoom : view.zoom) <= 1}
            aria-label={t('onlineClass.board.zoomOut')}
          >
            −
          </button>
          <span className="whiteboard__zoom-label">{(continuous ? documentZoom : view.zoom) === 1 ? (language === 'DE' ? 'Einpassen' : 'По размеру') : `${Math.round((continuous ? documentZoom : view.zoom) * 100)}%`}</span>
          <button
            type="button"
            onClick={() => zoomBy(ZOOM_BUTTON_FACTOR)}
            disabled={locked}
            aria-label={t('onlineClass.board.zoomIn')}
          >
            +
          </button>
        </div>

        {overlay}
      </div>
    </section>
  );
}
