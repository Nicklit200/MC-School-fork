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
import { VIEW_TOPIC, viewEvent } from './events';
import type { InputMode } from './inputPolicy';
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

const INPUT_MODE_KEY = 'mc.board.inputMode';
// Keep the teacher's pen settings while individual student boards mount/unmount.
const boardToolPreferences = new Map<string, Record<Tool, ToolSettings>>();
const ZOOM_BUTTON_FACTOR = 1.25;

export interface LiveBoardBackground {
  source: CanvasImageSource;
  width: number;
  height: number;
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
  const continuous = targetType === 'WHITEBOARD' && canAnnotate && layout === 'continuous';
  const pageHandles = useRef(new Map<number, PageSurfaceHandle>());
  const pageElements = useRef(new Map<number, HTMLElement>());
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const currentPage = useCallback(() => pageHandles.current.get(pagesRef.current.current), []);
  const stageRef = useRef<HTMLDivElement | null>(null);

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
  });
  const locked = navigationLocked(isHost, follow.following);

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

  const scrollRef = useRef<HTMLDivElement | null>(null);
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
  useEffect(() => {
    setVisitedPages(current => current.has(pages.current) ? current : new Set([...current, pages.current]));
  }, [pages.current]);
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const resize = () => {
      if (element.clientHeight > 0) setPageHeight(Math.max(160, Math.round(element.clientHeight * .92)));
      if (element.clientWidth > 0) {
        const style = getComputedStyle(element);
        setPageWidth(Math.max(1, element.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0)));
      }
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
    if (root && element) root.scrollTop = Math.max(0, element.offsetTop - root.clientHeight * .02);
  }, []);
  useLayoutEffect(() => {
    if (!continuous || !active) return;
    if (scrollSelected.current === pages.current && !locked) { scrollSelected.current = null; return; }
    scrollSelected.current = null;
    alignCurrentPage();
  }, [continuous, active, pages.current, pages.count, pageHeight, pageWidth, locked, alignCurrentPage]);
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
    if (locked) { alignCurrentPage(); return; }
    const focus = root.scrollTop + root.clientHeight / 2;
    let nearest = pagesRef.current.current, distance = Infinity, mostVisible = -1;
    for (const [index, element] of pageElements.current) {
      const visible = Math.max(0, Math.min(element.offsetTop + element.offsetHeight, root.scrollTop + root.clientHeight) - Math.max(element.offsetTop, root.scrollTop));
      const next = Math.abs(element.offsetTop + element.offsetHeight / 2 - focus);
      if (visible > mostVisible || (visible === mostVisible && next < distance)) { nearest = index; distance = next; mostVisible = visible; }
    }
    activatePage(nearest);
  };
  const finishPointerNavigation = () => {
    drawingPage.current = null;
    if (Math.abs((scrollRef.current?.scrollTop ?? 0) - pointerScrollStart.current) > .5) handleScroll();
  };

  const setView = useCallback((next: PageView) => setPages((current) => withView(current, next)), []);

  const zoomBy = (factor: number) => {
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
      <div className="whiteboard__topline-pages">
        {continuous ? <nav className="page-nav" aria-label={t('onlineClass.board.page.nav')}>
          <span className="page-nav__label" role="status" aria-live="polite"
            aria-label={t('onlineClass.board.page.current', { current: pages.current + 1, total: pages.count })}>{pages.current + 1} / {pages.count}</span>
          {(isHost || personal) && canAnnotate && <button type="button" className="page-nav__add" disabled={locked}
            aria-label={t('onlineClass.board.page.add')} onClick={() => setPages(addPage)}>+</button>}
        </nav> : <PageNavigator current={pages.current} count={pages.count} disabled={locked}
          onPrevious={() => setPages(previousPage)} onNext={() => setPages(nextPage)}
          onAdd={(isHost || personal) && canAnnotate ? () => setPages(addPage) : undefined} />}
      </div>

        <div ref={scrollRef} className={`whiteboard__pages${continuous ? ' whiteboard__pages--continuous' : ' whiteboard__pages--paged'}${locked ? ' whiteboard__pages--locked' : ''}`}
          role={continuous ? 'region' : undefined} aria-label={continuous ? (language === 'DE' ? 'Unterrichtsseiten' : 'Страницы доски') : undefined}
          tabIndex={continuous ? 0 : undefined} onScroll={handleScroll}
          onPointerDownCapture={event => {
            drawingPage.current = Number((event.target as Element).closest('[data-page-index]')?.getAttribute('data-page-index') ?? pages.current);
            pointerScrollStart.current = scrollRef.current?.scrollTop ?? 0;
          }}
          onPointerUpCapture={finishPointerNavigation} onPointerCancelCapture={finishPointerNavigation}>
          {Array.from({ length: pages.count }, (_, index) => <article key={`${targetType}:${targetId}:${index}`}
            ref={element => { if (element) pageElements.current.set(index, element); else pageElements.current.delete(index); }}
            className="whiteboard__page" data-page-index={index} hidden={!continuous && index !== pages.current}
            aria-label={t('onlineClass.board.page.current', { current: index + 1, total: pages.count })}
            style={continuous ? { height: Math.min(pageHeight, pageWidth / (pageAspects[index] ?? (sourceAspect && Number.isFinite(sourceAspect) && sourceAspect > 0 ? sourceAspect : A4_PORTRAIT_ASPECT))) } : undefined}>
            {(visitedPages.has(index) || index === pages.current) && <WhiteboardPageSurface
              ref={handle => { if (handle) pageHandles.current.set(index, handle); else pageHandles.current.delete(index); }}
              classId={classId} actorId={actorId} isHost={isHost} targetType={targetType} targetId={targetId} pageIndex={index}
              pdfDocument={pdfDocument} sourceAspect={sourceAspect} liveBackground={cameraBackground}
              tool={tool} settings={settingsOf} textSettings={toolSettings.text} eraserMode={eraserMode} inputMode={inputMode}
              view={viewOf(pages, index)} onViewChange={next => setPages(current => withView(current, next, index))}
              canAnnotate={canAnnotate} navigationLocked={locked} continuous={continuous}
              active={active && (index === pages.current || (continuous && visiblePages.has(index)))} selected={index === pages.current}
              lasers={index === pages.current && !camera ? lasers : []} onLaser={sendLaser}
              onActivate={activatePage} onStatusChange={reportPageStatus} onAspectChange={reportPageAspect} onScrollGesture={scrollPages}
            />}
          </article>)}
        </div>

        <div className="whiteboard__zoom" role="group">
          <button
            type="button"
            onClick={() => zoomBy(1 / ZOOM_BUTTON_FACTOR)}
            disabled={locked || view.zoom <= 1}
            aria-label={t('onlineClass.board.zoomOut')}
          >
            −
          </button>
          <span className="whiteboard__zoom-label">{view.zoom === 1 ? (language === 'DE' ? 'Einpassen' : 'По размеру') : `${Math.round(view.zoom * 100)}%`}</span>
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
