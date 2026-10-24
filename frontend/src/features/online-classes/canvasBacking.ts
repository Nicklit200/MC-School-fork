/** Limit raster memory without changing the stage's logical CSS coordinates. */
export const MAX_CANVAS_SIDE = 4096;
export const MAX_CANVAS_PIXELS = 8_000_000;

export function canvasBackingRatio(width: number, height: number, deviceRatio: number, dormant = false): number {
  const ratio = Number.isFinite(deviceRatio) && deviceRatio > 0 ? deviceRatio : 1;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return ratio;
  const side = dormant ? 512 : MAX_CANVAS_SIDE, pixels = dormant ? 262_144 : MAX_CANVAS_PIXELS;
  return Math.min(ratio, side / width, side / height, Math.sqrt(pixels / width / height));
}
