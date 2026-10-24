import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { AnnotationTargetType } from '../../api/onlineClasses';
import { A4_PORTRAIT_ASPECT } from './boardPaper';
import type { ToolSettings } from './boardTools';
import type { PageView } from './boardView';
import { isPersonalBoard, personalBoardOwner } from './boards';
import { ANNOTATION_TOPIC, annotationEvent } from './events';
import type { InputMode } from './inputPolicy';
import type { PdfDoc } from './pdfDocument';
import { useAnnotationBoard } from './useAnnotationBoard';
import { useClassEvents } from './useClassEvents';
import { useHostUserId } from './useHostUserId';
import { toLiveShape, useLiveStrokes } from './useLiveStrokes';
import { usePdfPage } from './usePdf';
import type { LiveBoardBackground } from './WhiteboardPanel';
import {
  WhiteboardCanvas,
  type EraserMode,
  type RemoteLaser,
  type Tool,
  type WhiteboardCanvasHandle,
} from './WhiteboardCanvas';

const REFRESH_COOLDOWN_MS = 150;
const PERSONAL_POLL_MS = 2000;

export interface PageSurfaceHandle {
  board: ReturnType<typeof useAnnotationBoard>;
  canvas: () => WhiteboardCanvasHandle | null;
}

export interface PageSurfaceStatus {
  canUndo: boolean;
  canRedo: boolean;
  loadingPdfPage: boolean;
}

export interface WhiteboardPageSurfaceProps {
  classId: string;
  actorId: string;
  isHost: boolean;
  targetType: AnnotationTargetType;
  targetId: string;
  /** Fixed for this mounted surface; the parent keys it by target and page. */
  pageIndex: number;
  pdfDocument: PdfDoc | null;
  sourceAspect: number | null;
  liveBackground: LiveBoardBackground | null;
  tool: Tool;
  settings: ToolSettings;
  textSettings: ToolSettings;
  eraserMode: EraserMode;
  inputMode: InputMode;
  view: PageView;
  onViewChange: (view: PageView) => void;
  canAnnotate: boolean;
  navigationLocked: boolean;
  /** Poll only while this page is visible in an active classroom. */
  active: boolean;
  selected: boolean;
  lasers: RemoteLaser[];
  onLaser?: (point: { x: number; y: number }) => void;
  continuous: boolean;
  onScrollGesture?: (dx: number, dy: number) => void;
  onActivate?: (pageIndex: number) => void;
  onStatusChange?: (pageIndex: number, status: PageSurfaceStatus) => void;
  onAspectChange?: (pageIndex: number, aspect: number | null) => void;
}

/**
 * A stable annotation document and canvas for one page. Layout, toolbar and
 * follow state belong to the panel, so changing layout cannot discard its ink.
 */
export const WhiteboardPageSurface = forwardRef<PageSurfaceHandle, WhiteboardPageSurfaceProps>(function WhiteboardPageSurface({
  classId,
  actorId,
  isHost,
  targetType,
  targetId,
  pageIndex,
  pdfDocument: providedPdfDocument,
  sourceAspect,
  liveBackground,
  tool,
  settings,
  textSettings,
  eraserMode,
  inputMode,
  view,
  onViewChange,
  canAnnotate,
  navigationLocked,
  active,
  selected,
  lasers,
  onLaser,
  continuous,
  onScrollGesture,
  onActivate,
  onStatusChange,
  onAspectChange,
}, ref) {
  const camera = targetType === 'NOTEBOOK_CAMERA';
  const personal = isPersonalBoard(targetId);
  const ownerId = personalBoardOwner(targetId);
  const pdfDocument = camera ? null : providedPdfDocument;
  const cameraBackground = camera && liveBackground && Number.isFinite(liveBackground.width) && liveBackground.width > 0
    && Number.isFinite(liveBackground.height) && liveBackground.height > 0 ? liveBackground : null;
  const canvasRef = useRef<WhiteboardCanvasHandle | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [stageWidth, setStageWidth] = useState(0);
  const boardRef = useRef<ReturnType<typeof useAnnotationBoard> | null>(null);
  const refresh = useRef({ cooling: false, pending: false });
  const refreshTimer = useRef<number | undefined>(undefined);
  const requestRefresh = useRef<() => void>(() => undefined);
  requestRefresh.current = () => {
    const state = refresh.current;
    if (state.cooling) {
      state.pending = true;
      return;
    }
    state.cooling = true;
    void boardRef.current?.refresh();
    refreshTimer.current = window.setTimeout(() => {
      state.cooling = false;
      if (state.pending) {
        state.pending = false;
        requestRefresh.current();
      }
    }, REFRESH_COOLDOWN_MS);
  };
  useEffect(() => () => {
    window.clearTimeout(refreshTimer.current);
    refresh.current = { cooling: false, pending: false };
  }, []);

  const hostUserId = useHostUserId(classId);
  const live = useLiveStrokes({
    classId,
    targetId,
    page: pageIndex,
    enabled: !camera,
    personalOwnerId: ownerId,
    hostUserId,
    currentUserId: actorId,
  });

  // A packet is only a replay hint. Never apply its operation or let a save on
  // another page refresh every surface in the continuous document.
  const { publish: publishAnnotation } = useClassEvents(classId, ANNOTATION_TOPIC, ({ event }) => {
    if (!personal && !camera && event.type === 'annotation' && event.documentId === boardRef.current?.document?.id) {
      requestRefresh.current();
    }
  });
  const board = useAnnotationBoard({
    classId,
    targetType,
    targetId,
    pageIndex,
    actorId,
    isHost,
    sourceWidth: cameraBackground?.width,
    sourceHeight: cameraBackground?.height,
    onSaved: (operation, documentId) => {
      if (personal || camera) return;
      void publishAnnotation(annotationEvent(classId, {
        documentId,
        operationId: operation.operationId,
        sequence: operation.sequence,
        op: operation.operationType,
        layerOwnerId: operation.layerOwnerId,
      }));
    },
  });
  boardRef.current = board;
  useImperativeHandle(ref, () => ({ board, canvas: () => canvasRef.current }));

  // Keep a preview until its authoritative, matching operation is rendered.
  const savedOperationIds = board.shapes.map((entry) => entry.operationId).join(',');
  useEffect(() => {
    live.acknowledgeRendered(savedOperationIds ? savedOperationIds.split(',') : []);
  }, [savedOperationIds, live.acknowledgeRendered]);

  useEffect(() => {
    if ((!personal && !camera) || !active) return;
    const timer = window.setInterval(() => void boardRef.current?.refresh(), PERSONAL_POLL_MS);
    return () => window.clearInterval(timer);
  }, [personal, camera, active]);

  useEffect(() => {
    const element = stageRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      // Hidden pages can report zero; retain their last rendered resolution.
      if (box && box.width > 0) setStageWidth(box.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const renderedPage = usePdfPage(pdfDocument, pageIndex, stageWidth);
  const hasPdfPage = Boolean(pdfDocument && pageIndex < pdfDocument.pageCount);
  const loadingPdfPage = hasPdfPage && !renderedPage;
  const validSourceAspect = sourceAspect !== null && Number.isFinite(sourceAspect) && sourceAspect > 0 ? sourceAspect : null;
  const pageAspect = camera ? (cameraBackground ? cameraBackground.width / cameraBackground.height : null)
    : renderedPage?.aspect ?? validSourceAspect ?? (targetType === 'WHITEBOARD' && !hasPdfPage ? A4_PORTRAIT_ASPECT : null);
  const aspectCallback = useRef(onAspectChange);
  aspectCallback.current = onAspectChange;
  useEffect(() => {
    aspectCallback.current?.(pageIndex, pageAspect !== null && Number.isFinite(pageAspect) && pageAspect > 0 ? pageAspect : null);
  }, [pageIndex, pageAspect]);
  const statusCallback = useRef(onStatusChange);
  statusCallback.current = onStatusChange;
  useEffect(() => {
    statusCallback.current?.(pageIndex, { canUndo: board.canUndo, canRedo: board.canRedo, loadingPdfPage });
  }, [pageIndex, board.canUndo, board.canRedo, loadingPdfPage]);

  return (
    <div
      ref={stageRef}
      className={`whiteboard__stage whiteboard__page-surface${continuous ? ' whiteboard__page-surface--continuous' : ''}`}
      data-page-index={pageIndex}
      onPointerDownCapture={() => onActivate?.(pageIndex)}
      onFocusCapture={() => onActivate?.(pageIndex)}
    >
      <WhiteboardCanvas
        ref={canvasRef}
        shapes={board.shapes}
        pageKey={`${targetType}:${targetId}:${pageIndex}`}
        tool={tool}
        color={settings.color}
        strokeWidth={settings.width}
        textFont={textSettings.font ?? 'clean'}
        textFontSize={textSettings.fontSize ?? 24}
        textBold={Boolean(textSettings.bold)}
        sourceAspect={pageAspect}
        readOnly={!canAnnotate || loadingPdfPage}
        eraserMode={eraserMode}
        inputMode={inputMode}
        view={view}
        onViewChange={onViewChange}
        navigationLocked={navigationLocked}
        onScrollGesture={continuous ? onScrollGesture : undefined}
        background={camera ? cameraBackground?.source ?? null : renderedPage?.canvas ?? null}
        paperColor={camera ? null : targetType === 'WHITEBOARD' ? '#ffffff' : '#fffefa'}
        backgroundLive={camera && Boolean(cameraBackground)}
        active={active}
        lasers={selected && !personal && !camera ? lasers : []}
        remoteDrafts={camera ? [] : live.drafts}
        onDraftChange={(shape, strokeId, finished) => live.sendDraft(shape ? toLiveShape(shape) : null, strokeId, finished)}
        actorId={actorId}
        onCommit={(shape, strokeId) => board.addShape(shape, strokeId)}
        onEraseShape={(id) => void board.eraseShape(id)}
        onMoveShape={(id, shape) => void board.moveShape(id, shape)}
        onLaserMove={selected && !personal && !camera ? onLaser : undefined}
      />
    </div>
  );
});
