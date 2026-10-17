import type KonvaType from 'konva';
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
import type { PdfDoc } from './pdfDocument';
import { penOutline, tracePenOutline } from './freehand';
import { shapeTextSizePx, textStyleFor } from './textStyles';

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
  const width = Math.max(1, (shape.width ?? 0.004) * viewport.width);
  const opacity = shape.kind === 'highlighter' ? 0.35 : 1;
  const box = letterbox(viewport, aspect);

  switch (shape.kind) {
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

  const pages: JpegPage[] = [];
  for (let index = 0; index < Math.max(1, pageCount); index += 1) {
    const document = documents.find((entry) => entry.pageIndex === index);
    const operations = document
      ? ((await onlineClassesApi.replayAnnotations(classId, document.id, 0)) as unknown as Operation[])
      : [];

    let background: CanvasImageSource | null = null;
    let aspect =
      document?.sourceWidth && document?.sourceHeight
        ? document.sourceWidth / document.sourceHeight
        : DEFAULT_ASPECT;
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
