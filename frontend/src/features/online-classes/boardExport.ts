import type KonvaType from 'konva';
import { drawInteractive } from './interactiveTemplates';
import type { Shape as KonvaShape } from 'konva/lib/Shape';
import { onlineClassesApi, type AnnotationTargetType } from '../../api/onlineClasses';
import {
  type Operation,
  type RenderableShape,
  type Shape,
  foldOperations,
  letterbox,
  toPixels,
} from './annotations';
import { buildPdf, dataUrlToBytes, type JpegPage } from './pdfWriter';
import { openPdf, type PdfDoc } from './pdfDocument';
import { personalBoardId, personalWorkbookBoardId } from './boards';
import type { KolinBoardSnapshot } from '../../api/kolin';
import { penOutline, strokeWidthPixels, tracePenOutline } from './freehand';
import { shapeTextSizePx, textStyleFor } from './textStyles';
import { A4_PORTRAIT_ASPECT } from './boardPaper';
import { annotationPageCount } from './annotationPages';

/**
 * Konva is loaded when the first export runs, not with the board: most lessons
 * never export, and a second eager copy would sit beside the one react-konva
 * already brings in.
 */
let Konva: typeof KonvaType;

/** Width of every exported page, in pixels: sharp when printed, still small. */
const EXPORT_WIDTH = 1600;
/** Used when a page has no recorded size (a board nobody has opened yet). */
const DEFAULT_ASPECT = 16 / 9;
const JPEG_QUALITY = 0.9;
/** Mirrors OnlineClassAnnotationService.MAX_REPLAY_OPERATIONS. */
const REPLAY_BATCH_SIZE = 5000;
const MAX_REPLAY_REQUESTS = 200;

/** An archive must include late ink/undo/clear, not just the first REST batch. */
async function replayPage(classId: string, documentId: string, revision: number): Promise<Operation[]> {
  const required = Number.isSafeInteger(revision) && revision > 0 ? revision : 0;
  const operations: Operation[] = [];
  let after = 0;
  for (let request = 0; request < MAX_REPLAY_REQUESTS; request++) {
    const batch = (await onlineClassesApi.replayAnnotations(classId, documentId, after)) as unknown as Operation[];
    if (!batch.length) {
      if (after < required) throw new Error('Не удалось полностью прочитать записи доски. Повторите сохранение урока.');
      return operations;
    }
    for (const operation of batch) {
      if (!Number.isSafeInteger(operation.sequence) || operation.sequence <= after) {
        throw new Error('Не удалось полностью прочитать записи доски. Повторите сохранение урока.');
      }
      after = operation.sequence;
      operations.push(operation);
    }
    // A full batch may hide newer operations even when the initial metadata is
    // already satisfied. Read its tail; short responses can finish only once
    // the server's advertised revision has actually been reached.
    if (batch.length < REPLAY_BATCH_SIZE && after >= required) return operations;
  }
  throw new Error('На доске слишком много записей для одного сохранения. Повторите сохранение после остановки рисования.');
}

/** Marks of one page, drawn over white (or over the workbook page) as a JPEG. */
function renderPage(
  shapes: RenderableShape[],
  width: number,
  height: number,
  aspect: number,
  background: CanvasImageSource | null,
): string {
  const stage = new Konva.Stage({ container: document.createElement('div'), width, height });
  const viewport = { width, height };
  const box = letterbox(viewport, aspect);

  // The page sits on its own layer: partial-erase marks cut through the marks
  // layer only and must never punch holes in the page underneath.
  const base = new Konva.Layer({ listening: false });
  base.add(new Konva.Rect({ x: 0, y: 0, width, height, fill: '#ffffff' }));
  if (background) {
    base.add(
      new Konva.Image({
        image: background as CanvasImageSource & HTMLImageElement,
        x: box.left,
        y: box.top,
        width: box.width,
        height: box.height,
      }),
    );
  }
  const marks = new Konva.Layer({ listening: false });
  stage.add(base);
  stage.add(marks);

  for (const entry of shapes) {
    const node = shapeNode(entry.shape, viewport, aspect);
    if (node) marks.add(node);
  }

  const dataUrl = stage.toDataURL({ mimeType: 'image/jpeg', quality: JPEG_QUALITY, pixelRatio: 1 });
  stage.destroy();
  return dataUrl;
}

/** Mirrors how the live canvas draws each kind, so the PDF matches the screen. */
function shapeNode(shape: Shape, viewport: { width: number; height: number }, aspect: number): KonvaShape | null {
  const stroke = shape.color ?? '#111111';
  const width = strokeWidthPixels(shape.width, viewport, aspect);
  const opacity = shape.kind === 'highlighter' ? 0.35 : 1;
  const box = letterbox(viewport, aspect);

  switch (shape.kind) {
    case 'interactive': {
      if(!shape.interactive)return null;
      const at=toPixels({x:shape.x??0,y:shape.y??0},viewport,aspect);
      return new Konva.Shape({sceneFunc:context=>drawInteractive(context._context,shape.interactive!,at.x,at.y,(shape.w??0)*box.width,(shape.h??0)*box.height)});
    }
    case 'pen': {
      const outline = penOutline(shape, viewport, aspect);
      return new Konva.Shape({ fill: stroke,
        sceneFunc: (context, node) => { if (tracePenOutline(context, outline)) context.fillStrokeShape(node); },
      });
    }
    case 'highlighter':
    case 'erase': {
      const points = (shape.points ?? []).flatMap(([x, y]) => {
        const pixel = toPixels({ x, y }, viewport, aspect);
        return [pixel.x, pixel.y];
      });
      return new Konva.Line({
        points,
        stroke: shape.kind === 'erase' ? '#ffffff' : stroke,
        strokeWidth: shape.kind === 'erase' ? width * 3 : width,
        opacity,
        lineCap: 'round',
        lineJoin: 'round',
        tension: 0.3,
        globalCompositeOperation: shape.kind === 'erase' ? 'destination-out' : 'source-over',
      });
    }
    case 'line':
    case 'arrow': {
      const from = toPixels({ x: shape.x1 ?? 0, y: shape.y1 ?? 0 }, viewport, aspect);
      const to = toPixels({ x: shape.x2 ?? 0, y: shape.y2 ?? 0 }, viewport, aspect);
      const points = [from.x, from.y, to.x, to.y];
      return shape.kind === 'arrow'
        ? new Konva.Arrow({ points, stroke, fill: stroke, strokeWidth: width })
        : new Konva.Line({ points, stroke, strokeWidth: width });
    }
    case 'rect': {
      const origin = toPixels({ x: shape.x ?? 0, y: shape.y ?? 0 }, viewport, aspect);
      return new Konva.Rect({
        x: origin.x,
        y: origin.y,
        width: (shape.w ?? 0) * box.width,
        height: (shape.h ?? 0) * box.height,
        stroke,
        strokeWidth: width,
      });
    }
    case 'ellipse': {
      const origin = toPixels({ x: shape.x ?? 0, y: shape.y ?? 0 }, viewport, aspect);
      return new Konva.Ellipse({
        x: origin.x + ((shape.w ?? 0) * box.width) / 2,
        y: origin.y + ((shape.h ?? 0) * box.height) / 2,
        radiusX: Math.abs(((shape.w ?? 0) * box.width) / 2),
        radiusY: Math.abs(((shape.h ?? 0) * box.height) / 2),
        stroke,
        strokeWidth: width,
      });
    }
    case 'text': {
      const origin = toPixels({ x: shape.x ?? 0, y: shape.y ?? 0 }, viewport, aspect);
      return new Konva.Text({
        x: origin.x,
        y: origin.y,
        text: shape.text ?? '',
        fontSize: shapeTextSizePx(shape.size, box.height),
        fontFamily: textStyleFor(shape.font, shape.bold).fontFamily,
        fontStyle: textStyleFor(shape.font, shape.bold).fontStyle,
        lineHeight: 1.22,
        width: Math.max(10, box.width - (origin.x - box.left)),
        wrap: 'word',
        fill: stroke,
      });
    }
    default:
      return null;
  }
}

/**
 * Builds a PDF of every page of one board (marks over the workbook page, when
 * there is one). Pages are read from the server, not from what this browser
 * happens to have open, so the file is complete whichever page is on screen.
 */
export async function exportBoardPdf({
  classId,
  targetType,
  targetId,
  pageCount,
  pdfDocument,
}: {
  classId: string;
  targetType: AnnotationTargetType;
  targetId: string;
  pageCount: number;
  pdfDocument: PdfDoc | null;
}): Promise<Blob> {
  Konva = (await import('konva')).default;
  const documents = (await onlineClassesApi.listAnnotationDocuments(classId)).filter(
    (entry) => entry.targetType === targetType && entry.targetId === targetId,
  );
  // Another participant may have added pages since this viewer last polled.
  // Use the fresh, authorized server list so even an untouched blank page is
  // included, while keeping every original PDF page and unsaved local page.
  const count = annotationPageCount(documents, targetType, targetId, Math.max(pageCount, pdfDocument?.pageCount ?? 1));

  const pages: JpegPage[] = [];
  for (let index = 0; index < count; index += 1) {
    const document = documents.find((entry) => entry.pageIndex === index);
    const operations = document
      ? await replayPage(classId, document.id, document.revision)
      : [];

    let background: CanvasImageSource | null = null;
    let aspect =
      document?.sourceWidth && document?.sourceHeight
        ? document.sourceWidth / document.sourceHeight
        : targetType === 'WHITEBOARD' ? A4_PORTRAIT_ASPECT : DEFAULT_ASPECT;
    if (pdfDocument && index < pdfDocument.pageCount) {
      const rendered = await pdfDocument.renderPage(index, EXPORT_WIDTH);
      background = rendered.canvas;
      aspect = rendered.aspect;
    }

    const width = EXPORT_WIDTH;
    const height = Math.round(EXPORT_WIDTH / aspect);
    const jpeg = renderPage(foldOperations(operations), width, height, aspect, background);
    pages.push({ jpeg: dataUrlToBytes(jpeg), width, height });
  }

  return new Blob([buildPdf(pages) as BlobPart], { type: 'application/pdf' });
}

/** An on-demand saved-board snapshot; it never opens or navigates a visible board. */
export async function captureBoardPage(classId: string, studentId: string | null, boardId: string, pageIndex: number,
  observedAt: string | null, scope: 'current_page' | 'first_page' | 'workbook' | 'task_page' = 'current_page'): Promise<KolinBoardSnapshot> {
  if (!Number.isSafeInteger(pageIndex) || pageIndex < 0 || pageIndex >= 1000) throw new Error('Invalid review page');
  const shared = studentId === null;
  const privateBoard = shared ? null : personalWorkbookBoardId(studentId);
  const privateVersion = privateBoard ? (await onlineClassesApi.documentVersion(classId, privateBoard)).version : 0;
  const expectedBoard = shared ? 'board-1' : privateVersion > 0 ? privateBoard! : personalBoardId(studentId);
  if (scope === 'current_page' && boardId !== expectedBoard) throw new Error('Review source changed');
  boardId = expectedBoard;
  // Legacy personal boards inherit the common lesson PDF. They do not own a
  // second copy of that PDF, and its version must be checked independently.
  const version = (await onlineClassesApi.documentVersion(classId, boardId)).version;
  const sharedDocumentVersion = !shared && !privateVersion
    ? (await onlineClassesApi.documentVersion(classId, 'board-1')).version : null;
  const pdfVersion = sharedDocumentVersion || version;
  const pdfBoard = sharedDocumentVersion ? 'board-1' : boardId;
  let pdf: PdfDoc | null = null;
  try {
    if (pdfVersion > 0) {
      const bytes = await onlineClassesApi.documentBytes(classId, pdfBoard);
      if (!bytes) throw new Error('Review PDF unavailable');
      pdf = await openPdf(bytes);
    }
    const documents = (await onlineClassesApi.listAnnotationDocuments(classId))
      .filter(item => item.targetType === 'WHITEBOARD' && item.targetId === boardId);
    const totalPageCount = annotationPageCount(documents, 'WHITEBOARD', boardId, pdf?.pageCount ?? 1);
    if (scope === 'workbook' && totalPageCount > 40) throw new Error('REVIEW_TOO_LARGE');
    if (scope === 'first_page') pageIndex = 0;
    if (scope === 'workbook') pageIndex = Math.min(pageIndex, totalPageCount - 1);
    const indices = scope === 'workbook' ? Array.from({ length: totalPageCount }, (_, i) => i) : [pageIndex];
    const captured: KolinBoardSnapshot['additionalPages'] = [];
    let imageChars = 0;
    Konva = (await import('konva')).default;
    for (const index of indices) {
      const entry = documents.find(item => item.pageIndex === index);
      if (!entry && index >= (pdf?.pageCount ?? 1) && scope !== 'workbook') throw new Error('Review page unavailable');
      const operations = entry ? await replayPage(classId, entry.id, entry.revision) : [];
      let background: CanvasImageSource | null = null;
      let aspect = entry?.sourceWidth && entry?.sourceHeight ? entry.sourceWidth / entry.sourceHeight : A4_PORTRAIT_ASPECT;
      if (pdf && index < pdf.pageCount) {
        const rendered = await pdf.renderPage(index, EXPORT_WIDTH);
        background = rendered.canvas;
        aspect = rendered.aspect;
      }
      if (!Number.isFinite(aspect) || aspect <= 0) throw new Error('Invalid review dimensions');
      const width = Math.min(EXPORT_WIDTH, Math.floor(2400 * aspect));
      const height = Math.round(width / aspect);
      if (width < 32 || height < 32) throw new Error('Invalid review dimensions');
      const imageDataUrl = renderPage(foldOperations(operations), width, height, aspect, background);
      imageChars += imageDataUrl.length;
      if (dataUrlToBytes(imageDataUrl).length > 1_500_000 || imageChars > 16_000_000) throw new Error('REVIEW_TOO_LARGE');
      captured.push({ pageNumber: index + 1, revision: operations.at(-1)?.sequence ?? 0, imageDataUrl });
    }
    const afterPrivate = privateBoard ? (await onlineClassesApi.documentVersion(classId, privateBoard)).version : 0;
    const after = (await onlineClassesApi.documentVersion(classId, boardId)).version;
    const afterShared = sharedDocumentVersion !== null ? (await onlineClassesApi.documentVersion(classId, 'board-1')).version : null;
    if (afterPrivate !== privateVersion || after !== version || afterShared !== sharedDocumentVersion)
      throw new Error('Review source changed');
    const primary = captured.find(page => page.pageNumber === pageIndex + 1)!;
    return { studentId, boardId, ...primary, documentVersion: version, scope, totalPageCount,
      ...(sharedDocumentVersion ? { sharedDocumentVersion } : {}),
      additionalPages: captured.filter(page => page !== primary), observedAt, capturedAt: new Date().toISOString() };
  } finally { pdf?.destroy(); }
}

/** Hands a file to the browser's download flow. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
