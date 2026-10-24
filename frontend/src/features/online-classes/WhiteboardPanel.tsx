import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
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
import { isPersonalBoard, personalBoardOwner } from './boards';
import { VIEW_TOPIC, viewEvent, type DocumentViewport } from './events';
import { documentPageSize, zoomDocumentScroll, type DocumentScroll } from './documentBoardView';
import type { DocumentGesture } from './documentGesture';
import { isPalmContact, type InputMode } from './inputPolicy';
import { navigationLocked } from './followTeacher';
import { PageNavigator } from './PageNavigator';
import { describeView } from './followTeacher';
import type { PdfDoc } from './pdfDocument';
import { buildPdf, dataUrlToBytes } from './pdfWriter';
import { useClassEvents } from './useClassEvents';
import { useFollowTeacher } from './useFollowTeacher';
import { useHostUserId } from './useHostUserId';
import { useLaserPointers } from './useLaserPointers';
import {
  type EraserMode,
  type Tool,
} from './WhiteboardCanvas';

import { WhiteboardPageSurface, type PageSurfaceHandle, type PageSurfaceStatus } from './WhiteboardPageSurface';
import { useBoardPageLayout } from './useBoardPageLayout';
import type { NotebookCameraGeometry } from './notebookCameraGeometry';

const INPUT_MODE_KEY = 'mc.board.inputMode';
// Keep the teacher's pen settings while individual student boards mount/unmount.
const boardToolPreferences = new Map<string, Record<Tool, ToolSettings>>();
const ZOOM_BUTTON_FACTOR = 1.25;

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
  // A personal board is private: nothing about it is broadcast and it never
  // follows (or is followed by) anyone. The teacher sees a student's marks by
  // polling the server, which is what enforces who may read them.
  const personal = isPersonalBoard(targetId);
  const ownerId = personalBoardOwner(targetId);
  const [tool, setTool] = useState<Tool>('pen');
  const [toolSettings, setToolSettings] = useState<Record<Tool, ToolSettings>>(
    () => boardToolPreferences.get(`${classId}:${actorId}`) ?? DEFAULT_TOOL_SETTINGS,
  );
  const [eraserMode, setEraserMode] = useState<EraserMode>('partial');
  const [inputMode, setInputModeState] = useState<InputMode>(loadInputMode);
  const [pages, setPages] = useState<BoardPages>(() => initialPages(1));
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
  const [documentZoom, setDocumentZoom] = useState(1);
  const documentZoomRef = useRef(1);
  const [documentView, setDocumentView] = useState<DocumentViewport>({ zoom: 1, x: .5, y: .5 });
  const documentViewRef = useRef(documentView);
  documentViewRef.current = documentView;
  const pendingDocumentScroll = useRef<DocumentScroll | null>(null);
  const remoteDocumentView = useRef<{ value: DocumentViewport; page: number } | null>(null);
  const lastRemoteDocumentView = useRef<{ value: DocumentViewport; page: number } | null>(null);
  const fitViewport = useRef({ width: 0, height: 0 });
  const [remoteViewRevision, setRemoteViewRevision] = useState(0);
  const receiveDocumentView = useCallback((value: DocumentViewport, page: number) => {
    remoteDocumentView.current = { value, page };
    lastRemoteDocumentView.current = { value, page };
    documentZoomRef.current = value.zoom;
    setDocumentZoom(value.zoom);
    setRemoteViewRevision(current => current + 1);
  }, []);

  const hostUserId = useHostUserId(classId);
  const getBoardSize = useCallback((index = pagesRef.current.current) => {
    const size = pageHandles.current.get(index)?.canvas()?.getSize();
    if (size && size.width > 0 && size.height > 0) return size;
    const element = pageElements.current.get(index);
    return { width: element?.clientWidth ?? 0, height: element?.clientHeight ?? 0 };
  }, []);

  // Teacher preview opens on the student's actual page, not always page one.
  useEffect(() => {
    if (camera || !isHost || !personal || observedPage === undefined) return;
    setPages((current) => goToPage(ensurePageCount(current, observedPage + 1), observedPage));
  }, [camera, isHost, personal, observedPage]);

  const { publish: publishPersonalView } = useClassEvents(classId, VIEW_TOPIC, () => undefined);
  useEffect(() => {
    if (camera || isHost || !personal || ownerId !== actorId || !active) return;
    const send = () => void publishPersonalView(viewEvent(classId, describeView(pages, viewOf(pages), getBoardSize(), targetId, false)), true);
    send();
    const timer = window.setInterval(send, 2000);
    return () => window.clearInterval(timer);
  }, [camera, isHost, personal, ownerId, actorId, active, classId, pages, targetId, getBoardSize, publishPersonalView]);

  const view = viewOf(pages);
  const follow = useFollowTeacher({
    classId,
    boardId: targetId,
    isHost,
    hostUserId,
    pages,
    setPages,
    getBoardSize,
    enabled: !personal && !camera,
    documentView: layout === 'continuous' && targetType === 'WHITEBOARD' ? { ...documentView, zoom: documentZoom } : undefined,
    onDocumentView: receiveDocumentView,
  });
  const locked = navigationLocked(isHost, follow.following);
  const continuous = targetType === 'WHITEBOARD' && (canAnnotate || follow.followLayout === 'continuous') && (follow.followLayout ?? layout) === 'continuous';

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
  // A joiner (or a reload) learns how many pages already exist from the server.
  useEffect(() => {
    let active = true;
    onlineClassesApi
      .listAnnotationDocuments(classId)
      .then((documents) => {
        if (!active) return;
        const last = documents
          .filter((entry) => entry.targetType === targetType && entry.targetId === targetId)
          .reduce((max, entry) => Math.max(max, entry.pageIndex), 0);
        setPages((current) => ensurePageCount(current, last + 1));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [classId, targetType, targetId]);

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
    gapContacts.current.clear(); documentContacts.current.clear();
    documentNavigationActive.current = false;
    for (const handle of pageHandles.current.values()) handle.canvas()?.setDocumentNavigation?.(false);
  };
  useEffect(() => {
    const release = () => {
      gapContacts.current.clear(); documentContacts.current.clear(); surfacePointers.current.clear(); penPointers.current.clear(); nativePenPages.current.clear();
      documentNavigationActive.current = false;
      for (const handle of pageHandles.current.values()) handle.canvas()?.setDocumentNavigation?.(false);
    };
    if (!continuous || locked || !active) release();
    window.addEventListener('blur', release);
    return () => { window.removeEventListener('blur', release); release(); };
  }, [continuous, locked, active]);
  const basePageSizes = Array.from({ length: pages.count }, (_, index) => documentPageSize(pageWidth, pageHeight,
    pageAspects[index] ?? (sourceAspect && Number.isFinite(sourceAspect) && sourceAspect > 0 ? sourceAspect : A4_PORTRAIT_ASPECT)));
  const baseRailWidth = Math.max(...basePageSizes.map(size => size.width));
  const railWidth = Math.max(pageWidth, baseRailWidth * documentZoom);
  const rememberDocumentView = useCallback(() => {
    const root = scrollRef.current, element = pageElements.current.get(pagesRef.current.current);
    if (!root || !element || element.offsetWidth <= 0 || element.offsetHeight <= 0) return;
    const viewport = readScrollViewport(root), style = getComputedStyle(root);
    const left = parseFloat(style.paddingLeft) || 0;
    const value = {
      zoom: documentZoomRef.current,
      x: Math.max(-10, Math.min(10, (root.scrollLeft + left + viewport.width / 2 - element.offsetLeft) / element.offsetWidth)),
      y: Math.max(-10, Math.min(10, (root.scrollTop + viewport.top + viewport.height / 2 - element.offsetTop) / element.offsetHeight)),
    };
    setDocumentView(previous => Object.keys(value).every(key => Math.abs(value[key as keyof DocumentViewport] - previous[key as keyof DocumentViewport]) < .0001) ? previous : value);
  }, []);
  const applyDocumentGesture = useCallback(({ scale, anchor, pan }: DocumentGesture) => {
    const root = scrollRef.current;
    if (!continuous || locked || !root || penPointers.current.size > 0 || nativePenPages.current.size > 0 || !Number.isFinite(scale) || scale <= 0) return;
    const zoom = documentZoomRef.current, nextZoom = clampZoom(zoom * scale);
    const rect = root.getBoundingClientRect(), style = getComputedStyle(root);
    const origin = { x: parseFloat(style.paddingLeft) || 0, y: parseFloat(style.paddingTop) || 0 };
    const scroll = zoomDocumentScroll({ zoom, nextZoom,
      scroll: pendingDocumentScroll.current ?? { left: root.scrollLeft, top: root.scrollTop }, origin,
      railWidth: Math.max(pageWidth, baseRailWidth * zoom), nextRailWidth: Math.max(pageWidth, baseRailWidth * nextZoom),
      anchor: { x: anchor.x - rect.left, y: anchor.y - rect.top }, pan });
    if (nextZoom === zoom) {
      if (pendingDocumentScroll.current) { pendingDocumentScroll.current = scroll; return; }
      root.scrollLeft = scroll.left; root.scrollTop = scroll.top;
      rememberDocumentView();
      return;
    }
    pendingDocumentScroll.current = scroll;
    documentZoomRef.current = nextZoom;
    setDocumentZoom(nextZoom);
  }, [continuous, locked, pageWidth, baseRailWidth, rememberDocumentView]);
  useEffect(() => {
    const root = scrollRef.current;
    if (!continuous || !root) return;
    const wheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey) || (event.target as Element).closest('.whiteboard__page')) return;
      event.preventDefault(); event.stopPropagation();
      if (drawingPage.current !== null || locked) return;
      applyDocumentGesture({ scale: Math.exp(-event.deltaY * .01), anchor: { x: event.clientX, y: event.clientY }, pan: { x: 0, y: 0 } });
    };
    root.addEventListener('wheel', wheel, { passive: false });
    return () => root.removeEventListener('wheel', wheel);
  }, [continuous, locked, applyDocumentGesture]);
  useEffect(() => {
    setVisitedPages(current => current.has(pages.current) ? current : new Set([...current, pages.current]));
  }, [pages.current]);
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const resize = () => {
      const viewport = readScrollViewport(element);
      const previous = fitViewport.current;
      if (continuous && previous.width > 0 && previous.height > 0 &&
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
  }, [continuous]);
  const reportPageAspect = useCallback((index: number, aspect: number | null) => {
    if (!aspect || !Number.isFinite(aspect) || aspect <= 0 || aspectCache.current[index] === aspect) return;
    const root = scrollRef.current, selected = pageElements.current.get(pagesRef.current.current);
    if (continuous && root && selected && selected.offsetHeight > 0) geometryAnchor.current = {
      index: pagesRef.current.current, ratio: (root.scrollTop - selected.offsetTop) / selected.offsetHeight,
    };
    aspectCache.current = { ...aspectCache.current, [index]: aspect };
    setPageAspects(aspectCache.current);
  }, [continuous]);
  useLayoutEffect(() => {
    const anchor = geometryAnchor.current, root = scrollRef.current;
    if (!continuous) { geometryAnchor.current = null; return; }
    if (!anchor || !root) return;
    const element = pageElements.current.get(anchor.index);
    if (element) root.scrollTop = Math.max(0, element.offsetTop + anchor.ratio * element.offsetHeight);
    geometryAnchor.current = null;
  }, [continuous, pageAspects]);
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
    if (!continuous || !active) return;
    if (pendingDocumentScroll.current || remoteDocumentView.current || (locked && lastRemoteDocumentView.current)) return;
    if (scrollSelected.current === pages.current && !locked) { scrollSelected.current = null; return; }
    scrollSelected.current = null;
    alignCurrentPage();
  }, [continuous, active, pages.current, pages.count, pageHeight, pageWidth, alignCurrentPage]);
  useLayoutEffect(() => {
    const root = scrollRef.current;
    if (!continuous || !root) return;
    const remote = locked && follow.followLayout === 'continuous' ? lastRemoteDocumentView.current : remoteDocumentView.current;
    if (remote) {
      const element = pageElements.current.get(remote.page);
      if (element && element.offsetWidth > 0 && element.offsetHeight > 0) {
        const viewport = readScrollViewport(root), style = getComputedStyle(root);
        root.scrollLeft = Math.max(0, element.offsetLeft + remote.value.x * element.offsetWidth - (parseFloat(style.paddingLeft) || 0) - viewport.width / 2);
        root.scrollTop = Math.max(0, element.offsetTop + remote.value.y * element.offsetHeight - viewport.top - viewport.height / 2);
        remoteDocumentView.current = null;
      }
    } else if (pendingDocumentScroll.current) {
      root.scrollLeft = pendingDocumentScroll.current.left;
      root.scrollTop = pendingDocumentScroll.current.top;
    }
    pendingDocumentScroll.current = null;
    rememberDocumentView();
  }, [continuous, locked, follow.followLayout, documentZoom, remoteViewRevision, pages.current, pageAspects, pageHeight, pageWidth, rememberDocumentView]);
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
  const finishPointerNavigation = () => {
    drawingPage.current = null;
    if (Math.abs((scrollRef.current?.scrollTop ?? 0) - pointerScrollStart.current) > .5) handleScroll();
  };
  const beginDocumentPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!continuous) return;
    if (event.pointerType === 'pen') {
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

  const setView = useCallback((next: PageView) => setPages((current) => withView(current, next)), []);

  const zoomBy = (factor: number) => {
    const root = scrollRef.current;
    if (continuous && root) {
      const rect = root.getBoundingClientRect(), viewport = readScrollViewport(root), style = getComputedStyle(root);
      applyDocumentGesture({ scale: factor, anchor: { x: rect.left + (parseFloat(style.paddingLeft) || 0) + viewport.width / 2,
        y: rect.top + viewport.top + viewport.height / 2 }, pan: { x: 0, y: 0 } });
      return;
    }
    const size = getBoardSize();
    setView(zoomAbout(view, view.zoom * factor, { x: size.width / 2, y: size.height / 2 }, size));
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
      downloadBlob(blob, `${personal ? 'my-board' : 'class-board'}-${day}.pdf`);
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
    if (!canAnnotate || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') return;
    event.preventDefault();
    void (event.shiftKey ? board.redo() : board.undo());
  };

  return (
    <section className={`whiteboard school-islands-board whiteboard--original-v3${camera ? ' whiteboard--camera' : ''}${continuous ? ' whiteboard--continuous' : ''}`} aria-label={t('onlineClass.board.viewLabel')} onKeyDown={onKeyDown}>
      <div className="whiteboard__topline">
      {canAnnotate && (
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
        {locked && <span>{t('onlineClass.board.follow.student')}</span>}
      </div>

      <div ref={stageRef} className="whiteboard__stage">
      {!continuous && <div className="whiteboard__topline-pages">
        <PageNavigator current={pages.current} count={pages.count} disabled={locked}
          onPrevious={() => setPages(previousPage)} onNext={() => setPages(nextPage)}
          onAdd={(isHost || personal) && canAnnotate ? () => setPages(addPage) : undefined} />
      </div>}

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
          <div ref={railRef} className="whiteboard__document" style={continuous ? { width: railWidth, gap: 24 * documentZoom } : undefined}>
          {Array.from({ length: pages.count }, (_, index) => <article key={`${targetType}:${targetId}:${index}`}
            ref={element => { if (element) pageElements.current.set(index, element); else pageElements.current.delete(index); }}
            className="whiteboard__page" data-page-index={index} hidden={!continuous && index !== pages.current}
            aria-current={index === pages.current ? 'page' : undefined}
            aria-label={t('onlineClass.board.page.current', { current: index + 1, total: pages.count })}
            style={continuous ? { width: basePageSizes[index].width * documentZoom, height: basePageSizes[index].height * documentZoom } : undefined}>
            {(visitedPages.has(index) || index === pages.current) && <WhiteboardPageSurface
              ref={handle => { if (handle) { pageHandles.current.set(index, handle); if (documentNavigationActive.current) handle.canvas()?.setDocumentNavigation?.(true); } else pageHandles.current.delete(index); }}
              classId={classId} actorId={actorId} isHost={isHost} targetType={targetType} targetId={targetId} pageIndex={index}
              pdfDocument={pdfDocument} sourceAspect={sourceAspect} liveBackground={cameraBackground}
              tool={tool} settings={settingsOf} textSettings={toolSettings.text} eraserMode={eraserMode} inputMode={inputMode}
              view={continuous ? DEFAULT_VIEW : viewOf(pages, index)} onViewChange={next => setPages(current => withView(current, next, index))}
              onDocumentGesture={continuous ? applyDocumentGesture : undefined}
              onDocumentPenContact={continuous ? pressed => noteDocumentPenContact(index, pressed) : undefined}
              canAnnotate={canAnnotate} navigationLocked={locked} continuous={continuous}
              active={active && (index === pages.current || (continuous && visiblePages.has(index)))} selected={index === pages.current}
              lasers={index === pages.current && !camera ? lasers : []} onLaser={sendLaser}
              onActivate={activatePage} onStatusChange={reportPageStatus} onAspectChange={reportPageAspect} onScrollGesture={scrollPages}
            />}
          </article>)}
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
