/**
 * Cross-platform handwriting input for Mindcrafti's canvas/PDF boards.
 *
 * iPadOS: native Touch Events for the Pencil (Scribble can suppress pointerdown).
 * Android/desktop: Pointer Events (S Pen, active stylus, mouse, touch).
 * Legacy touch browsers: Touch Events fallback.
 *
 * Only ONE event family drives a given stroke; avoids duplicate Pencil strokes.
 * No cooldown, input throttling, React state or rendering/saving in this module.
 * This is a shared experimental controller: production integration is separate.
 */
export type TabletInkBackend = 'ios-touch' | 'pointer' | 'legacy-touch';
export type TabletInputMode = 'auto' | TabletInkBackend;
export type TabletInkDevice = 'pen' | 'finger' | 'mouse';
export type TabletInkChannel = 'touch' | 'pointer';
export type TabletInkPoint = {
  clientX: number;
  clientY: number;
  pressure: number;
  timeStamp: number;
};
export type TabletInkContact = { id: number; clientX: number; clientY: number };
export type TabletInkStrokeMeta = {
  source: TabletInkChannel;
  device: TabletInkDevice;
  inputId: number;
};
export type TabletInkCallbacks = {
  onStart: (point: TabletInkPoint, meta: TabletInkStrokeMeta) => void;
  onMove: (point: TabletInkPoint, meta: TabletInkStrokeMeta) => void;
  onEnd: (point: TabletInkPoint, meta: TabletInkStrokeMeta, cancelled: boolean) => void;
  /** Finger contacts: one finger pans, two fingers pinch/drag. */
  onGesture?: (contacts: TabletInkContact[]) => void;
};
export type TabletInkConfig = {
  mode?: TabletInputMode;
  /** Finger drawing is opt-in. When disabled, fingers pan/zoom instead. */
  allowFinger?: () => boolean;
  /** On browsers using pointer input, capture active pen for reliable pointerup. */
  pointerCapture?: boolean;
  /** Let the browser handle non-drawing finger pan and pinch on a PDF sheet. */
  nativeFingerNavigation?: boolean;
};
export type TabletInkPlatform = {
  userAgent: string;
  maxTouchPoints: number;
  supportsPointer: boolean;
  supportsTouch: boolean;
};

export function detectTabletInkBackend(platform: TabletInkPlatform): TabletInkBackend {
  const appleMobile = /iPad|iPhone|iPod/i.test(platform.userAgent) ||
    (/Macintosh/i.test(platform.userAgent) && platform.maxTouchPoints > 1);
  if (appleMobile && platform.supportsTouch) return 'ios-touch';
  if (platform.supportsPointer) return 'pointer';
  return 'legacy-touch';
}

export function getTabletInkPlatform(): TabletInkPlatform {
  return {
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    supportsPointer: typeof window.PointerEvent !== 'undefined',
    supportsTouch: 'ontouchstart' in window,
  };
}

function pointerPoint(event: PointerEvent): TabletInkPoint {
  return {
    clientX: event.clientX,
    clientY: event.clientY,
    pressure: Number.isFinite(event.pressure) && event.pressure > 0 ? event.pressure : 0.5,
    timeStamp: event.timeStamp,
  };
}

function touchPoint(touch: Touch, timeStamp: number): TabletInkPoint {
  return {
    clientX: touch.clientX,
    clientY: touch.clientY,
    pressure: Number.isFinite(touch.force) && touch.force > 0 ? touch.force : 0.5,
    timeStamp,
  };
}

/** WebKit supports touchType='stylus'; Chromium Android generally does not. */
function touchDevice(touch: Touch): TabletInkDevice {
  return (touch as Touch & { touchType?: string }).touchType === 'stylus'
    ? 'pen' : 'finger';
}

function disableNativeInkGestures(target: HTMLElement, preserveFingerPinch = false): () => void {
  const previous = {
    touchAction: target.style.touchAction,
    userSelect: target.style.userSelect,
    webkitUserSelect: target.style.getPropertyValue('-webkit-user-select'),
    webkitTouchCallout: target.style.getPropertyValue('-webkit-touch-callout'),
    tapHighlight: target.style.getPropertyValue('-webkit-tap-highlight-color'),
    overscrollBehavior: target.style.overscrollBehavior,
  };
  target.style.touchAction = preserveFingerPinch ? (previous.touchAction || 'pinch-zoom') : 'none';
  target.style.userSelect = 'none';
  target.style.setProperty('-webkit-user-select', 'none');
  target.style.setProperty('-webkit-touch-callout', 'none');
  target.style.setProperty('-webkit-tap-highlight-color', 'transparent');
  target.style.overscrollBehavior = 'contain';
  return () => {
    target.style.touchAction = previous.touchAction;
    target.style.userSelect = previous.userSelect;
    target.style.setProperty('-webkit-user-select', previous.webkitUserSelect);
    target.style.setProperty('-webkit-touch-callout', previous.webkitTouchCallout);
    target.style.setProperty('-webkit-tap-highlight-color', previous.tapHighlight);
    target.style.overscrollBehavior = previous.overscrollBehavior;
  };
}

export function attachTabletInkInput(
  sheet: HTMLElement,
  callbacks: TabletInkCallbacks,
  config: TabletInkConfig = {},
): { backend: TabletInkBackend; destroy: () => void } {
  const platform = getTabletInkPlatform();
  const backend = config.mode && config.mode !== 'auto'
    ? config.mode : detectTabletInkBackend(platform);
  const fingerDrawingEnabled = () => config.allowFinger?.() === true;
  const contacts = new Map<number, TabletInkContact>();
  const listeners: Array<() => void> = [];
  const restoreStyles = disableNativeInkGestures(sheet, config.nativeFingerNavigation);
  let active: { meta: TabletInkStrokeMeta; last: TabletInkPoint } | null = null;
  let destroyed = false;
  // Mouse events following native Touch Events are synthetic; never treat them
  // as a real second stroke. Touch cancelation normally prevents synthesis.
  let lastNativeTouchTime = -Infinity;
  const ownedTouches = new Set<number>();

  function listen<K extends keyof HTMLElementEventMap>(
    target: HTMLElement | Document | Window,
    eventName: K,
    listener: (event: HTMLElementEventMap[K]) => void,
    options: AddEventListenerOptions = { passive: false },
  ) {
    // Event listener signatures differ between HTMLElement, Document and Window.
    const handler = listener as EventListener;
    target.addEventListener(eventName, handler, options);
    listeners.push(() => target.removeEventListener(eventName, handler, options));
  }

  function prevent(event: Event) {
    if (event.cancelable) event.preventDefault();
  }

  function emitGesture() {
    // An active pen takes priority over accidental palm/finger contact.
    if (active?.meta.device === 'pen') return;
    callbacks.onGesture?.(Array.from(contacts.values()));
  }

  function start(point: TabletInkPoint, meta: TabletInkStrokeMeta) {
    if (active) return;
    active = { meta, last: point };
    callbacks.onStart(point, meta);
  }

  function moved(point: TabletInkPoint, source: TabletInkChannel, inputId: number) {
    const state = active;
    if (!state || state.meta.source !== source || state.meta.inputId !== inputId) return;
    // No minimum distance, delay or debounce: even fast short strokes are kept.
    if (point.clientX === state.last.clientX && point.clientY === state.last.clientY) return;
    state.last = point;
    callbacks.onMove(point, state.meta);
  }

  function finish(
    point: TabletInkPoint,
    source: TabletInkChannel,
    inputId: number,
    cancelled = false,
  ) {
    const state = active;
    if (!state || state.meta.source !== source || state.meta.inputId !== inputId) return;
    active = null; // Release synchronously so the very next input can begin.
    callbacks.onEnd(point, state.meta, cancelled);
    if (contacts.size) emitGesture();
  }

  function pointerDown(event: PointerEvent) {
    // iPadOS uses Touch Events for pen/fingers, never count their PointerEvents twice.
    if (backend === 'ios-touch' && event.pointerType !== 'mouse') return;
    const isTouch = event.pointerType === 'touch';
    if (isTouch) {
      if (active?.meta.device === 'pen') return; // reject palm while drawing
      if (Math.max(event.width, event.height) > 40) return; // ignore large palm contacts
      contacts.set(event.pointerId, {
        id: event.pointerId, clientX: event.clientX, clientY: event.clientY,
      });
      if (contacts.size > 1 && active?.meta.device === 'finger') {
        finish(pointerPoint(event), 'pointer', active.meta.inputId, true);
      }
      if (contacts.size > 1 || !fingerDrawingEnabled()) {
        if (!config.nativeFingerNavigation) prevent(event);
        emitGesture();
        return;
      }
    } else if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }
    if (active) return;
    // On WebKit the Pencil takes the Touch Events route. Preserve trackpad mouse
    // input, but never process duplicate pen/touch pointer events on iOS.
    if (backend === 'ios-touch' && event.pointerType !== 'mouse') return;
    if (!isTouch || !config.nativeFingerNavigation) prevent(event);
    const device: TabletInkDevice =
      event.pointerType === 'pen' ? 'pen' : isTouch ? 'finger' : 'mouse';
    start(pointerPoint(event), {
      source: 'pointer', device, inputId: event.pointerId,
    });
    if (config.pointerCapture !== false) {
      try { sheet.setPointerCapture(event.pointerId); } catch { /* optional */ }
    }
  }

  function pointerMove(event: PointerEvent) {
    if (backend === 'ios-touch' && event.pointerType !== 'mouse') return;
    if (event.pointerType === 'touch' && contacts.has(event.pointerId)) {
      contacts.set(event.pointerId, {
        id: event.pointerId, clientX: event.clientX, clientY: event.clientY,
      });
      if (contacts.size > 1 || !fingerDrawingEnabled()) {
        if (!config.nativeFingerNavigation) prevent(event);
        emitGesture();
        return;
      }
    }
    if (active?.meta.source !== 'pointer' || active.meta.inputId !== event.pointerId) return;
    if (event.pointerType !== 'touch' || !config.nativeFingerNavigation) prevent(event);
    const samples = event.getCoalescedEvents?.() ?? [];
    // Safari/Chrome can return an empty list. Always include the current sample.
    for (const sample of samples) moved(pointerPoint(sample), 'pointer', event.pointerId);
    moved(pointerPoint(event), 'pointer', event.pointerId);
  }

  function pointerFinish(event: PointerEvent, cancelled: boolean) {
    if (backend === 'ios-touch' && event.pointerType !== 'mouse') return;
    if (event.pointerType === 'touch' && contacts.has(event.pointerId)) {
      contacts.delete(event.pointerId);
      emitGesture();
    }
    if (active?.meta.source === 'pointer' && active.meta.inputId === event.pointerId) {
      prevent(event);
      finish(pointerPoint(event), 'pointer', event.pointerId, cancelled);
    }
  }

  function touchStart(event: TouchEvent) {
    lastNativeTouchTime = performance.now();
    let shouldPrevent = false;
    for (let i = 0; i < event.changedTouches.length; i += 1) {
      const touch = event.changedTouches[i];
      const device = touchDevice(touch);
      if (config.nativeFingerNavigation && device === 'finger' && !fingerDrawingEnabled()) continue;
      ownedTouches.add(touch.identifier);
      shouldPrevent = true;
      if (device === 'finger') {
        if (active?.meta.device === 'pen') continue;
        contacts.set(touch.identifier, {
          id: touch.identifier, clientX: touch.clientX, clientY: touch.clientY,
        });
        if (contacts.size > 1 && active?.meta.device === 'finger') {
          finish(touchPoint(touch, event.timeStamp), 'touch', active.meta.inputId, true);
        }
        if (contacts.size > 1 || !fingerDrawingEnabled()) continue;
      }
      // The stylus takes precedence over a finger gesture/palm contact.
      if (device === 'pen' && active?.meta.device === 'finger') {
        finish(active.last, 'touch', active.meta.inputId, true);
      }
      if (!active) {
        start(touchPoint(touch, event.timeStamp), {
          source: 'touch', device, inputId: touch.identifier,
        });
      }
    }
    if (shouldPrevent && (!config.nativeFingerNavigation || active?.meta.device === 'pen' || fingerDrawingEnabled())) prevent(event);
    emitGesture();
  }

  function touchMove(event: TouchEvent) {
    lastNativeTouchTime = performance.now();
    // Do not block unrelated gestures outside the drawing sheet.
    if (!Array.from(event.changedTouches).some((touch) => ownedTouches.has(touch.identifier))) return;
    prevent(event);
    for (let i = 0; i < event.changedTouches.length; i += 1) {
      const touch = event.changedTouches[i];
      if (!ownedTouches.has(touch.identifier)) continue;
      if (contacts.has(touch.identifier)) {
        contacts.set(touch.identifier, {
          id: touch.identifier, clientX: touch.clientX, clientY: touch.clientY,
        });
      }
      moved(touchPoint(touch, event.timeStamp), 'touch', touch.identifier);
    }
    emitGesture();
  }

  function touchFinish(event: TouchEvent, cancelled: boolean) {
    lastNativeTouchTime = performance.now();
    if (!Array.from(event.changedTouches).some((touch) => ownedTouches.has(touch.identifier))) return;
    prevent(event);
    for (let i = 0; i < event.changedTouches.length; i += 1) {
      const touch = event.changedTouches[i];
      if (!ownedTouches.delete(touch.identifier)) continue;
      contacts.delete(touch.identifier);
      finish(touchPoint(touch, event.timeStamp), 'touch', touch.identifier, cancelled);
    }
    emitGesture();
  }

  function mouseDown(event: MouseEvent) {
    if (event.button !== 0 || performance.now() - lastNativeTouchTime < 500) return;
    if (active) return;
    prevent(event);
    start({
      clientX: event.clientX, clientY: event.clientY,
      pressure: 0.5, timeStamp: event.timeStamp,
    }, { source: 'pointer', device: 'mouse', inputId: -1 });
  }
  function mouseMove(event: MouseEvent) {
    if (active?.meta.inputId !== -1 || active?.meta.device !== 'mouse') return;
    prevent(event);
    moved({ clientX: event.clientX, clientY: event.clientY, pressure: 0.5,
      timeStamp: event.timeStamp }, 'pointer', -1);
  }
  function mouseUp(event: MouseEvent) {
    if (active?.meta.inputId !== -1 || active?.meta.device !== 'mouse') return;
    prevent(event);
    finish({ clientX: event.clientX, clientY: event.clientY, pressure: 0.5,
      timeStamp: event.timeStamp }, 'pointer', -1);
  }

  // Pointer Events are the standard path on Android and desktop.
  // On iOS, Touch Events handle Pencil/fingers, Pointer Events handle mouse.
  if (backend !== 'legacy-touch') {
    listen(sheet, 'pointerdown', pointerDown);
    listen(document, 'pointermove', pointerMove);
    listen(document, 'pointerup', (event) => pointerFinish(event, false));
    listen(document, 'pointercancel', (event) => pointerFinish(event, true));
    listen(sheet, 'lostpointercapture', (event) => {
      if (active?.meta.source === 'pointer' && active.meta.inputId === event.pointerId) {
        finish(pointerPoint(event), 'pointer', event.pointerId, true);
      }
    });
  } else {
    // Older Android browser / WebView with no PointerEvent implementation.
    listen(sheet, 'mousedown', mouseDown);
    listen(document, 'mousemove', mouseMove);
    listen(document, 'mouseup', mouseUp);
  }

  if (backend === 'ios-touch' || backend === 'legacy-touch') {
    listen(sheet, 'touchstart', touchStart);
    listen(document, 'touchmove', touchMove);
    listen(document, 'touchend', (event) => touchFinish(event, false));
    listen(document, 'touchcancel', (event) => touchFinish(event, true));
  }

  function clearActive() {
    if (destroyed) return;
    if (active) finish(active.last, active.meta.source, active.meta.inputId, true);
    contacts.clear();
    ownedTouches.clear();
    emitGesture();
  }
  listen(window, 'blur', clearActive);
  const handleVisibilityChange = () => {
    if (document.hidden) clearActive();
  };
  document.addEventListener('visibilitychange', handleVisibilityChange);
  listeners.push(() => document.removeEventListener('visibilitychange', handleVisibilityChange));

  return {
    backend,
    destroy: () => {
      if (destroyed) return;
      clearActive();
      destroyed = true;
      for (const remove of listeners) remove();
      restoreStyles();
    },
  };
}
