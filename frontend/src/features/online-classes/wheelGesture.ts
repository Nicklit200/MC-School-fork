/** Wheel deltas use pixels, lines or pages depending on the browser/device. */
export function wheelDeltaPixels(
  event: Pick<WheelEvent, 'deltaX' | 'deltaY' | 'deltaMode'>,
  viewportHeight: number,
): { x: number; y: number } {
  const unit = event.deltaMode === 1 ? 16
    : event.deltaMode === 2 ? Math.max(1, Number.isFinite(viewportHeight) ? viewportHeight : 1) : 1;
  return {
    x: Number.isFinite(event.deltaX) ? event.deltaX * unit : 0,
    y: Number.isFinite(event.deltaY) ? event.deltaY * unit : 0,
  };
}

/** Fine trackpad movement stays proportional; one coarse wheel tick cannot jump several zoom levels. */
export function wheelZoomScale(
  event: Pick<WheelEvent, 'deltaY' | 'deltaMode' | 'ctrlKey'>,
  viewportHeight: number,
): number {
  const delta = wheelDeltaPixels({ deltaX: 0, deltaY: event.deltaY, deltaMode: event.deltaMode }, viewportHeight).y;
  return Math.exp(-Math.max(-100, Math.min(100, delta)) * .002);
}
