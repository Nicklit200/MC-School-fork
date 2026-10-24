import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import '../../styles/floating-islands.css';
import { ApiRequestError } from '../../api/client';
import { onlineClassesApi, type AnnotationTargetType } from '../../api/onlineClasses';
import { useI18n } from '../../i18n/I18nContext';
import { BoardToolbar } from './BoardToolbar';
import { downloadBlob, exportBoardPdf } from './boardExport';
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
import { ANNOTATION_TOPIC, annotationEvent, VIEW_TOPIC, viewEvent } from './events';
import type { InputMode } from './inputPolicy';
import { navigationLocked } from './followTeacher';
import { PageNavigator } from './PageNavigator';
import { describeView } from './followTeacher';
import type { PdfDoc } from './pdfDocument';
import { buildPdf, dataUrlToBytes } from './pdfWriter';
import { useAnnotationBoard } from './useAnnotationBoard';
import { useClassEvents } from './useClassEvents';
import { useFollowTeacher } from './useFollowTeacher';
import { useHostUserId } from './useHostUserId';
import { useLaserPointers } from './useLaserPointers';
import { toLiveShape, useLiveStrokes } from './useLiveStrokes';
import { usePdfPage } from './usePdf';
import {
  WhiteboardCanvas,
  type EraserMode,
  type Tool,
  type WhiteboardCanvasHandle,
} from './WhiteboardCanvas';

const INPUT_MODE_KEY = 'mc.board.inputMode';
// Keep the teacher's pen settings while individual student boards mount/unmount.
const boardToolPreferences = new Map<string, Record<Tool, ToolSettings>>();
/**
 * After a refresh, further packets within this window collapse into one more
 * refresh, so a burst of strokes costs a couple of replays, not one per packet.
 */
const REFRESH_COOLDOWN_MS = 150;
const ZOOM_BUTTON_FACTOR = 1.25;
/** How often a personal board is re-read while it is on screen. */
const PERSONAL_POLL_MS = 2000;

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
  const { t } = useI18n();
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
  const [stageWidth, setStageWidth] = useState(0);
  const canvasRef = useRef<WhiteboardCanvasHandle | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);

  const hostUserId = useHostUserId(classId);
  const getBoardSize = useCallback(() => canvasRef.current?.getSize() ?? { width: 0, height: 0 }, []);

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

  // --- Realtime marks -------------------------------------------------------
  // The board hook and the packet handler need each other, so the handler
  // reaches the board through a ref.
  const boardRef = useRef<ReturnType<typeof useAnnotationBoard> | null>(null);
  const refresh = useRef({ cooling: false, pending: false });
  const requestRefresh = useRef<() => void>(() => undefined);
  requestRefresh.current = () => {
    const state = refresh.current;
    if (state.cooling) {
      state.pending = true;
      return;
    }
    state.cooling = true;
    void boardRef.current?.refresh();
    window.setTimeout(() => {
      state.cooling = false;
      if (state.pending) {
        state.pending = false;
        requestRefresh.current();
      }
    }, REFRESH_COOLDOWN_MS);
  };

  // Others watch a stroke grow while it is drawn. Preview only: the saved stroke
  // still comes from the server, and a personal board broadcasts nothing.
  const live = useLiveStrokes({
    classId,
    targetId,
    page: pages.current,
    enabled: !camera,
    personalOwnerId: ownerId,
    hostUserId,
    currentUserId: actorId,
  });

  // A packet only says "something was saved". Any participant can publish on
  // the data channel, so its contents are never applied: the server's replay is
  // the one source of truth, and a forged packet can at most trigger a harmless
  // re-fetch.
  const { publish: publishAnnotation } = useClassEvents(classId, ANNOTATION_TOPIC, ({ event }) => {
    if (event.type === 'annotation' && !personal && !camera) {
      requestRefresh.current();
      // The preview must persist until the matching REST-replayed shape is rendered.
      // A saved-event hint alone can arrive well before the actual geometry.
    }
  });

  const board = useAnnotationBoard({
    classId,
    targetType,
    targetId,
    pageIndex: pages.current,
    actorId,
    isHost,
    sourceWidth: cameraBackground?.width,
    sourceHeight: cameraBackground?.height,
    onSaved: (operation, documentId) => {
      if (personal || camera) return;
      void publishAnnotation(
        annotationEvent(classId, {
          documentId,
          operationId: operation.operationId,
          sequence: operation.sequence,
          op: operation.operationType,
          layerOwnerId: operation.layerOwnerId,
        }),
      );
    },
  });
  boardRef.current = board;
  const savedOperationIds = board.shapes.map((entry) => entry.operationId).join(',');
  useEffect(() => {
    live.acknowledgeRendered(savedOperationIds ? savedOperationIds.split(',') : []);
  }, [savedOperationIds, live.acknowledgeRendered]);

  const { lasers, sendLaser: broadcastLaser } = useLaserPointers(classId, targetId);
  const sendLaser = personal || camera ? undefined : broadcastLaser;

  // Personal board: nobody is told when it changes, so a viewer polls instead.
  useEffect(() => {
    if ((!personal && !camera) || !active) return;
    const timer = window.setInterval(() => void boardRef.current?.refresh(), PERSONAL_POLL_MS);
    return () => window.clearInterval(timer);
  }, [personal, camera, active]);

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

  useEffect(() => {
    const element = stageRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) setStageWidth(box.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const renderedPage = usePdfPage(pdfDocument, pages.current, stageWidth);
  const pageAspect = camera ? (cameraBackground ? cameraBackground.width / cameraBackground.height : null)
    : renderedPage?.aspect ?? sourceAspect;

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
    const image = canvasRef.current?.toDataURL();
    if (!image || !board.document) {
      setSaveError('failed');
      return;
    }
    try {
      await onlineClassesApi.saveAnnotationSnapshot(classId, board.document.id, image);
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
        const image = canvasRef.current?.toDataURL('image/jpeg');
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
      <button type="button" disabled={savingLessonDocuments} onClick={() => onSaveLessonDocuments ? onSaveLessonDocuments() : void saveSnapshot()}>
        {onSaveLessonDocuments ? (savingLessonDocuments ? 'Сохраняем документы…' : 'Сохранить документы урока') : t('onlineClass.whiteboard.saveSnapshot')}
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
      {hostActions}
    </>
  ) : null;

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (!canAnnotate || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') return;
    event.preventDefault();
    void (event.shiftKey ? board.redo() : board.undo());
  };

  return (
    <section className={`whiteboard school-islands-board${camera ? ' whiteboard--camera' : ''}`} aria-label={t('onlineClass.board.viewLabel')} onKeyDown={onKeyDown}>
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
          sharedActions={
            <button type="button" onClick={() => void exportPdf()} disabled={exporting}>
              {exporting ? t('onlineClass.whiteboard.exporting') : camera ? 'Скачать кадр PDF' : t('onlineClass.whiteboard.exportPdf')}
            </button>
          }
        />
      )}

      </div>
      <div role="status" aria-live="polite" className="whiteboard__notice">
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
        <PageNavigator current={pages.current} count={pages.count} disabled={locked}
          onPrevious={() => setPages(previousPage)}
          onNext={() => setPages(nextPage)}
          onAdd={(isHost || personal) && canAnnotate ? () => setPages(addPage) : undefined} />
      </div>

        <WhiteboardCanvas
          ref={canvasRef}
          shapes={board.shapes}
          pageKey={`${targetType}:${targetId}:${pages.current}`}
          tool={tool}
          color={settingsOf.color}
          strokeWidth={settingsOf.width}
          textFont={toolSettings.text.font ?? 'clean'}
          textFontSize={toolSettings.text.fontSize ?? 24}
          textBold={Boolean(toolSettings.text.bold)}
          sourceAspect={pageAspect}
          readOnly={!canAnnotate}
          eraserMode={eraserMode}
          inputMode={inputMode}
          view={view}
          onViewChange={setView}
          navigationLocked={locked}
          background={camera ? cameraBackground?.source ?? null : renderedPage?.canvas ?? null}
          backgroundLive={camera && Boolean(cameraBackground)}
          active={active}
          lasers={camera ? [] : lasers}
          remoteDrafts={camera ? [] : live.drafts}
          onDraftChange={(shape, strokeId, finished) => live.sendDraft(shape ? toLiveShape(shape) : null, strokeId, finished)}
          actorId={actorId}
          onCommit={(shape, strokeId) => board.addShape(shape, strokeId)}
          onEraseShape={(id) => void board.eraseShape(id)}
          onMoveShape={(id, shape) => void board.moveShape(id, shape)}
          onLaserMove={sendLaser}
        />


        <div className="whiteboard__zoom" role="group">
          <button
            type="button"
            onClick={() => zoomBy(1 / ZOOM_BUTTON_FACTOR)}
            disabled={locked || view.zoom <= 1}
            aria-label={t('onlineClass.board.zoomOut')}
          >
            −
          </button>
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
