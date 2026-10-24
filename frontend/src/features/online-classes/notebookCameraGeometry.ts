import type { CameraModule, NotebookDocumentView } from '../notebook-camera/cameraModules';
import { letterbox, toNormalized, type Viewport } from './annotations';
import { screenToBoard, type PageView, type Point } from './boardView';

export interface NotebookCameraGeometry {
  view: NotebookDocumentView;
  rawWidth: number;
  rawHeight: number;
  renderer: CameraModule;
}

export interface NotebookProjection {
  view: NotebookDocumentView;
  aspect: number;
  rawSize: Viewport;
  cameraToOutput: (point: Point) => Point;
  outputToCamera: (point: Point) => Point;
}

/** Raw operations keep their original coordinates; only their presentation changes. */
export function createNotebookProjection(geometry: NotebookCameraGeometry | null | undefined): NotebookProjection | null {
  if (!geometry || !Number.isFinite(geometry.rawWidth) || !Number.isFinite(geometry.rawHeight)
    || geometry.rawWidth <= 0 || geometry.rawHeight <= 0) return null;
  let view = geometry.renderer.validateDocumentView(geometry.view);
  if (!view) return null;
  const aspect = geometry.rawWidth / geometry.rawHeight;
  if (view.corners && Math.abs(aspect / view.sourceAspect - 1) > .06) {
    view = { ...geometry.renderer.defaultDocumentView(aspect), turn: view.turn };
  }
  const mapping = geometry.renderer.makeDocumentMap(view, geometry.rawWidth, geometry.rawHeight);
  const scale = Math.min(1, 1920 / Math.max(geometry.rawWidth, geometry.rawHeight));
  return {
    view,
    aspect: mapping.aspect,
    rawSize: { width: Math.max(1, Math.round(geometry.rawWidth * scale)), height: Math.max(1, Math.round(geometry.rawHeight * scale)) },
    cameraToOutput: mapping.cameraToOutput,
    outputToCamera: mapping.outputToCamera,
  };
}

export function notebookScreenToRaw(point: Point, projection: NotebookProjection, viewport: Viewport, view: PageView): Point {
  const output = toNormalized(screenToBoard(point, view), viewport, projection.aspect);
  const raw = projection.outputToCamera(output);
  return { x: Math.max(0, Math.min(1, raw.x)), y: Math.max(0, Math.min(1, raw.y)) };
}

export function notebookRawToScreen(point: Point, projection: NotebookProjection, viewport: Viewport, view: PageView): Point {
  const output = projection.cameraToOutput(point), box = letterbox(viewport, projection.aspect);
  return { x: (box.left + output.x * box.width) * view.zoom + view.panX,
    y: (box.top + output.y * box.height) * view.zoom + view.panY };
}

/** Reuse the exact shared video sampler for a freshly composited raw canvas. */
export function notebookCanvasSource(canvas: HTMLCanvasElement): HTMLVideoElement {
  Object.defineProperties(canvas, {
    videoWidth: { configurable: true, get: () => canvas.width },
    videoHeight: { configurable: true, get: () => canvas.height },
    readyState: { configurable: true, get: () => 2 },
  });
  return canvas as unknown as HTMLVideoElement;
}

/** Zoom/pan are applied after the projective warp, in the user's visible space. */
export function paintNotebookProjection(target: HTMLCanvasElement, frame: HTMLCanvasElement,
  viewport: Viewport, view: PageView, aspect: number): boolean {
  if (viewport.width <= 0 || viewport.height <= 0) return false;
  const width = Math.max(1, Math.round(viewport.width)), height = Math.max(1, Math.round(viewport.height));
  if (target.width !== width) target.width = width;
  if (target.height !== height) target.height = height;
  const context = target.getContext('2d');
  if (!context) return false;
  const box = letterbox(viewport, aspect);
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, width, height);
  context.setTransform(view.zoom, 0, 0, view.zoom, view.panX, view.panY);
  context.drawImage(frame, box.left, box.top, box.width, box.height);
  context.setTransform(1, 0, 0, 1, 0, 0);
  return true;
}
