export type CameraQuality = 'detail' | 'balanced';
export interface NotebookDocumentView {
  type: 'document-view';
  version: 1;
  corners: { x: number; y: number }[] | null;
  ratio: number | null;
  turn: number;
  sourceAspect: number;
}
export interface NotebookDocumentViewState {
  type: 'document-view-state';
  version: 1;
  cameraId: string;
  revision: number;
  changeId?: string;
  view: NotebookDocumentView;
}
export interface DocumentRenderer {
  canvas: HTMLCanvasElement;
  setView: (view: NotebookDocumentView) => void;
  start: () => void;
  stop: () => void;
  setMaxDimension: (value: number) => void;
  render: () => void;
}
export interface DocumentRendererOptions {
  maxDimension?: number;
  onCanvasReplace?: (canvas: HTMLCanvasElement) => void;
  onFrame?: (canvas: HTMLCanvasElement) => void;
  onError?: (message: string) => void;
  force2D?: boolean;
}
interface CameraInspection {
  settings: Record<string, unknown>;
  focus: { canAuto: boolean; modes: string[]; distance: unknown };
}
export interface CameraModule {
  cameraConstraints: (quality: CameraQuality, portrait?: boolean) => MediaTrackConstraints;
  inspectCamera: (track: MediaStreamTrack) => CameraInspection;
  setCameraFocus: (track: MediaStreamTrack, action: string, value?: unknown) => Promise<unknown>;
  validateDocumentView: (value: unknown) => NotebookDocumentView | null;
  defaultDocumentView: (aspect?: number) => NotebookDocumentView;
  makeDocumentMap: (view: NotebookDocumentView, rawWidth: number, rawHeight: number) => {
    aspect: number;
    cameraToOutput: (point: { x: number; y: number }) => { x: number; y: number };
    outputToCamera: (point: { x: number; y: number }) => { x: number; y: number };
  };
  LiveDocumentRenderer: new (video: HTMLVideoElement, canvas: HTMLCanvasElement, options?: DocumentRendererOptions) => DocumentRenderer;
  QUALITY_PROFILES: Record<CameraQuality, { bitrate: number; fps: number; render: number }>;
}
export async function loadCameraModule(): Promise<CameraModule> {
  const path = '/notebook-camera/signal.mjs?v=shared-notebook-1';
  return import(/* @vite-ignore */ path);
}
export async function drawCameraQR(canvas: HTMLCanvasElement, value: string): Promise<void> {
  const path = '/notebook-camera/qr.mjs';
  const module = await import(/* @vite-ignore */ path);
  module.drawQR(canvas, value);
}
