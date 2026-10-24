export type CameraQuality = 'detail' | 'balanced';
interface CameraInspection {
  settings: Record<string, unknown>;
  focus: { canAuto: boolean; modes: string[]; distance: unknown };
}
export interface CameraModule {
  cameraConstraints: (quality: CameraQuality, portrait?: boolean) => MediaTrackConstraints;
  inspectCamera: (track: MediaStreamTrack) => CameraInspection;
  setCameraFocus: (track: MediaStreamTrack, action: string, value?: unknown) => Promise<unknown>;
  QUALITY_PROFILES: Record<CameraQuality, { bitrate: number; fps: number }>;
}
export async function loadCameraModule(): Promise<CameraModule> {
  const path = '/notebook-camera/signal.mjs';
  return import(/* @vite-ignore */ path);
}
export async function drawCameraQR(canvas: HTMLCanvasElement, value: string): Promise<void> {
  const path = '/notebook-camera/qr.mjs';
  const module = await import(/* @vite-ignore */ path);
  module.drawQR(canvas, value);
}
