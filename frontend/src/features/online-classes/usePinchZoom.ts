import { useEffect, useRef, type RefObject } from 'react';
import { wheelZoomScale } from './wheelGesture';

type Point = { clientX: number; clientY: number };
/** A page point beneath `from` must end up beneath `to` after changing zoom. */
export type ZoomAnchor = { from: Point; to: Point };
type SafariGesture = Event & { scale: number; clientX?: number; clientY?: number };

/** PDF-only gestures. Ordinary wheel and one-finger scrolling remain native. */
export function usePinchZoom(
  elementRef: RefObject<HTMLDivElement | null>,
  zoom: number,
  onZoom: (value: number, anchor?: ZoomAnchor) => void,
  minZoom: number,
  maxZoom: number,
  resetKey?: unknown,
) {
  const latest = useRef({ zoom, onZoom, minZoom, maxZoom, resetKey });
  latest.current = { zoom, onZoom, minZoom, maxZoom, resetKey };

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    let currentZoom = latest.current.zoom;
    let observedZoom = currentZoom;
    let frame = 0;
    let pending: { zoom: number; anchor: ZoomAnchor } | null = null;
    let touch: { distance: number; zoom: number; point: Point } | null = null;
    let safari: { scale: number; zoom: number; point: Point } | null = null;

    const flush = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      const next = pending;
      pending = null;
      if (next && latest.current.resetKey === resetKey) latest.current.onZoom(next.zoom, next.anchor);
    };
    const syncZoom = () => {
      if (latest.current.zoom !== observedZoom) {
        if (!pending) currentZoom = latest.current.zoom;
        observedZoom = latest.current.zoom;
      }
    };
    const queue = (requested: number, from: Point, to: Point) => {
      const next = Math.min(latest.current.maxZoom, Math.max(latest.current.minZoom, requested));
      if (!Number.isFinite(next) || currentZoom <= 0) return;
      const ratio = next / currentZoom;
      if (Math.abs(next - currentZoom) < .00001 && Math.hypot(to.clientX - from.clientX, to.clientY - from.clientY) < .01) return;
      // Compose native events before React commits; their centroids may move.
      if (pending) {
        pending.anchor.to = {
          clientX: to.clientX + ratio * (pending.anchor.to.clientX - from.clientX),
          clientY: to.clientY + ratio * (pending.anchor.to.clientY - from.clientY),
        };
        pending.zoom = next;
      } else pending = { zoom: next, anchor: { from, to } };
      currentZoom = next;
      if (!frame) frame = requestAnimationFrame(flush);
    };
    const pair = (touches: TouchList) => {
      if (touches.length !== 2) return null;
      const a = touches.item(0), b = touches.item(1);
      return a && b ? {
        distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
        point: { clientX: (a.clientX + b.clientX) / 2, clientY: (a.clientY + b.clientY) / 2 },
      } : null;
    };
    const start = (event: TouchEvent) => {
      const next = pair(event.touches);
      if (!next) { touch = null; return; }
      syncZoom(); flush();
      if (event.cancelable) event.preventDefault();
      safari = null;
      touch = { ...next, zoom: currentZoom };
    };
    const move = (event: TouchEvent) => {
      const next = pair(event.touches);
      if (!next) { touch = null; return; }
      if (!touch) { start(event); return; }
      if (event.cancelable) event.preventDefault();
      if (touch.distance < 10) return;
      queue(touch.zoom * next.distance / touch.distance, touch.point, next.point);
      touch.point = next.point;
    };
    const end = (event: TouchEvent) => {
      if (event.touches.length < 2) { flush(); touch = null; }
    };
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      if (event.cancelable) event.preventDefault();
      if (touch || safari) return;
      syncZoom();
      const point = { clientX: event.clientX, clientY: event.clientY };
      queue(currentZoom * wheelZoomScale(event, element.clientHeight), point, point);
    };
    const gesturePoint = (event: SafariGesture): Point => {
      const rect = element.getBoundingClientRect();
      return {
        clientX: Number.isFinite(event.clientX) ? event.clientX! : rect.left + rect.width / 2,
        clientY: Number.isFinite(event.clientY) ? event.clientY! : rect.top + rect.height / 2,
      };
    };
    const gestureStart = (raw: Event) => {
      if (raw.cancelable) raw.preventDefault();
      // iPad can send TouchEvent and GestureEvent for the same fingers.
      if (touch) return;
      const event = raw as SafariGesture;
      syncZoom(); flush();
      safari = { scale: event.scale > 0 ? event.scale : 1, zoom: currentZoom, point: gesturePoint(event) };
    };
    const gestureChange = (raw: Event) => {
      if (raw.cancelable) raw.preventDefault();
      if (touch || !safari) return;
      const event = raw as SafariGesture, point = gesturePoint(event);
      queue(safari.zoom * event.scale / safari.scale, safari.point, point);
      safari.point = point;
    };
    const gestureEnd = (event: Event) => {
      if (event.cancelable) event.preventDefault();
      if (safari) { flush(); safari = null; }
    };

    element.addEventListener('touchstart', start, { passive: false });
    element.addEventListener('touchmove', move, { passive: false });
    element.addEventListener('touchend', end, { passive: true });
    element.addEventListener('touchcancel', end, { passive: true });
    element.addEventListener('wheel', wheel, { passive: false });
    element.addEventListener('gesturestart', gestureStart, { passive: false });
    element.addEventListener('gesturechange', gestureChange, { passive: false });
    element.addEventListener('gestureend', gestureEnd, { passive: false });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      pending = null;
      element.removeEventListener('touchstart', start);
      element.removeEventListener('touchmove', move);
      element.removeEventListener('touchend', end);
      element.removeEventListener('touchcancel', end);
      element.removeEventListener('wheel', wheel);
      element.removeEventListener('gesturestart', gestureStart);
      element.removeEventListener('gesturechange', gestureChange);
      element.removeEventListener('gestureend', gestureEnd);
    };
  }, [elementRef, resetKey]);
}
