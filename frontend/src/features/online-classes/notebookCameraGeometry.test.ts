import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { CameraModule, NotebookDocumentView } from '../notebook-camera/cameraModules';
import { DEFAULT_VIEW } from './boardView';
import { createNotebookProjection, notebookCanvasSource, notebookRawToScreen, notebookScreenToRaw, paintNotebookProjection } from './notebookCameraGeometry';

let renderer: CameraModule;
beforeAll(async () => {
  const path = '../../../public/notebook-camera/signal.mjs';
  renderer = await import(path);
});
const documentView = (patch: Partial<NotebookDocumentView> = {}): NotebookDocumentView => ({
  type: 'document-view', version: 1, corners: null, ratio: null, turn: 2, sourceAspect: 16 / 9, ...patch,
});
const geometry = (view = documentView()) => ({ view, rawWidth: 1920, rawHeight: 1080, renderer });

describe('canonical notebook geometry', () => {
  it('places a legacy raw point under the same 180-degree rotated paper point and inverts new input', () => {
    const projection = createNotebookProjection(geometry())!;
    const raw = { x: .2, y: .3 }, viewport = { width: 960, height: 540 };
    const screen = notebookRawToScreen(raw, projection, viewport, DEFAULT_VIEW);
    expect(screen.x).toBeCloseTo(960 * .8); expect(screen.y).toBeCloseTo(540 * .7);
    const saved = notebookScreenToRaw(screen, projection, viewport, DEFAULT_VIEW);
    expect(saved.x).toBeCloseTo(raw.x); expect(saved.y).toBeCloseTo(raw.y);
  });

  it.each([0, 1, 2, 3])('uses the exact projective inverse for a cropped sheet at quarter-turn %s, including post-warp zoom/pan', turn => {
    const corners = [{ x: .15, y: .1 }, { x: .85, y: .2 }, { x: .8, y: .9 }, { x: .2, y: .85 }];
    const projection = createNotebookProjection(geometry(documentView({ corners, ratio: 210 / 297, turn })))!;
    const viewport = { width: 390, height: 650 }, view = { zoom: 2, panX: -140, panY: -210 };
    for (const raw of [...corners, { x: .5, y: .5 }, { x: .4, y: .6 }]) {
      const display = notebookRawToScreen(raw, projection, viewport, view);
      const recovered = notebookScreenToRaw(display, projection, viewport, view);
      expect(recovered.x).toBeCloseTo(raw.x, 8); expect(recovered.y).toBeCloseTo(raw.y, 8);
    }
    // A perspective transform must not be approximated with a bounding box.
    const corner = projection.cameraToOutput(corners[(4 - turn) % 4]);
    expect(corner.x).toBeCloseTo(0); expect(corner.y).toBeCloseTo(0);
    expect(projection.aspect).toBeCloseTo(turn % 2 ? 297 / 210 : 210 / 297);
  });

  it('keeps a bounded raw scene independent of display shape, and preserves rotation if old crop no longer matches capture', () => {
    const projection = createNotebookProjection({ ...geometry(documentView({
      corners: [{ x: .1, y: .1 }, { x: .9, y: .1 }, { x: .9, y: .9 }, { x: .1, y: .9 }], ratio: 1, turn: 1,
    })), rawWidth: 2160, rawHeight: 3840 })!;
    expect(projection.rawSize).toEqual({ width: 1080, height: 1920 });
    expect(projection.view.corners).toBeNull(); expect(projection.view.turn).toBe(1);
    expect(projection.aspect).toBeCloseTo(3840 / 2160);
  });

  it('rejects missing, invalid and non-finite geometry without creating an unprojected writable surface', () => {
    expect(createNotebookProjection(null)).toBeNull();
    expect(createNotebookProjection({ ...geometry(), rawWidth: 0 })).toBeNull();
    expect(createNotebookProjection({ ...geometry(), rawHeight: Infinity })).toBeNull();
    expect(createNotebookProjection(geometry(documentView({ turn: 4 })))).toBeNull();
  });

  it('adapts a canvas to the shared sampler with current raw dimensions', () => {
    const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = 600;
    const source = notebookCanvasSource(canvas);
    expect(source).toBe(canvas); expect(source.readyState).toBe(2);
    expect(source.videoWidth).toBe(1000); expect(source.videoHeight).toBe(600);
    canvas.width = 1920; expect(source.videoWidth).toBe(1920);
  });

  it('fits the fully warped composite before applying visible zoom/pan, including screenshot dimensions', () => {
    const context = { setTransform: vi.fn(), clearRect: vi.fn(), drawImage: vi.fn() };
    const target = document.createElement('canvas'), frame = document.createElement('canvas');
    vi.spyOn(target, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
    expect(paintNotebookProjection(target, frame, { width: 1000, height: 500 }, { zoom: 2, panX: -100, panY: -50 }, 1)).toBe(true);
    expect(target.width).toBe(1000); expect(target.height).toBe(500);
    expect(context.setTransform).toHaveBeenNthCalledWith(2, 2, 0, 0, 2, -100, -50);
    expect(context.drawImage).toHaveBeenCalledExactlyOnceWith(frame, 250, 0, 500, 500);
  });
});
