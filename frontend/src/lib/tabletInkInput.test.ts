import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachTabletInkInput, detectTabletInkBackend, type TabletInkBackend } from './tabletInkInput';

const mounted: Array<{ sheet: HTMLElement; driver: ReturnType<typeof attachTabletInkInput> }> = [];
afterEach(() => {
  for (const { sheet, driver } of mounted.splice(0)) {
    driver.destroy();
    sheet.remove();
  }
});

function attach(mode: TabletInkBackend) {
  const sheet = document.createElement('div');
  document.body.appendChild(sheet);
  const callbacks = { onStart: vi.fn(), onMove: vi.fn(), onEnd: vi.fn(), onGesture: vi.fn() };
  const driver = attachTabletInkInput(sheet, callbacks, { mode, pointerCapture: false });
  mounted.push({ sheet, driver });
  return { sheet, ...callbacks };
}

function pointer(sheet: HTMLElement, type: string, patch: PointerEventInit = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const properties = { pointerId: 7, pointerType: 'pen', clientX: 10, clientY: 20,
    button: 0, width: 1, height: 1, pressure: .5, ...patch };
  for (const [key, value] of Object.entries(properties)) Object.defineProperty(event, key, { value });
  sheet.dispatchEvent(event);
}

type TestTouch = {
  identifier: number; target: HTMLElement; clientX: number; clientY: number; touchType: string; force?: number;
};
function contact(target: HTMLElement, patch: Partial<TestTouch> = {}): TestTouch {
  return { identifier: 7, target, clientX: 10, clientY: 20, touchType: 'stylus', force: .5, ...patch };
}

function touch(sheet: HTMLElement, type: string, patch: Partial<TestTouch> = {}, touches?: TestTouch[]) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const changed = contact(sheet, patch);
  const current = touches ?? (type === 'touchend' || type === 'touchcancel' ? [] : [changed]);
  Object.defineProperties(event, {
    changedTouches: { value: [changed] },
    touches: { value: current },
    targetTouches: { value: current.filter(point => point.target === sheet) },
  });
  sheet.dispatchEvent(event);
  return event;
}

describe('cross-platform ink backend selection', () => {
  it('uses Touch Events on classic iPads with Apple Pencil', () => {
    expect(detectTabletInkBackend({
      userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
      maxTouchPoints: 5, supportsPointer: true, supportsTouch: true,
    })).toBe('ios-touch');
  });
  it('recognizes iPadOS desktop Safari user agent', () => {
    expect(detectTabletInkBackend({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
      maxTouchPoints: 5, supportsPointer: true, supportsTouch: true,
    })).toBe('ios-touch');
  });
  it('uses Pointer Events for Samsung Android tablets and S Pen', () => {
    expect(detectTabletInkBackend({
      userAgent: 'Mozilla/5.0 (Linux; Android 15; SM-X910) AppleWebKit/537.36 Chrome/130',
      maxTouchPoints: 10, supportsPointer: true, supportsTouch: true,
    })).toBe('pointer');
  });
  it('uses Pointer Events for desktop browser mice', () => {
    expect(detectTabletInkBackend({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130',
      maxTouchPoints: 0, supportsPointer: true, supportsTouch: false,
    })).toBe('pointer');
  });
  it('falls back to Touch Events on older mobile browsers', () => {
    expect(detectTabletInkBackend({
      userAgent: 'Mozilla/5.0 (Linux; Android 7; Tablet)',
      maxTouchPoints: 5, supportsPointer: false, supportsTouch: true,
    })).toBe('legacy-touch');
  });
});

describe('tablet ink pressure and event ownership', () => {
  it.each([
    ['zero contact', 0, 0],
    ['light contact', .1, .1],
    ['ordinary contact', .5, .5],
    ['maximum contact', 1, 1],
    ['negative outlier', -.2, 0],
    ['high outlier', 1.2, 1],
    ['missing pressure', undefined, .5],
    ['NaN pressure', Number.NaN, .5],
    ['infinite pressure', Number.POSITIVE_INFINITY, .5],
  ] as const)('preserves or bounds %s on both native Pencil and pointer input', (_name, raw, expected) => {
    const native = attach('ios-touch');
    touch(native.sheet, 'touchstart', { force: raw });
    expect(native.onStart).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ pressure: expected }),
      { source: 'touch', device: 'pen', inputId: 7 },
    );

    const standard = attach('pointer');
    pointer(standard.sheet, 'pointerdown', { pressure: raw });
    expect(standard.onStart).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ pressure: expected }),
      { source: 'pointer', device: 'pen', inputId: 7 },
    );
  });

  it('keeps native Pencil pressure through contact and release without duplicating its pointer events', () => {
    const input = attach('ios-touch');
    touch(input.sheet, 'touchstart', { force: 0 });
    pointer(input.sheet, 'pointerdown', { pressure: .8 });
    touch(input.sheet, 'touchmove', { clientX: 20, force: .1 });
    pointer(input.sheet, 'pointermove', { clientX: 20, pressure: .8 });
    touch(input.sheet, 'touchmove', { clientX: 30, force: .5 });
    pointer(input.sheet, 'pointerup', { clientX: 30, pressure: 0 });
    expect(input.onEnd).not.toHaveBeenCalled();
    touch(input.sheet, 'touchend', { clientX: 35, force: 0 });

    expect(input.onStart).toHaveBeenCalledOnce();
    expect(input.onStart.mock.calls[0][0].pressure).toBe(0);
    expect(input.onMove.mock.calls.map(([point]) => point.pressure)).toEqual([.1, .5]);
    expect(input.onEnd).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ clientX: 35, pressure: 0 }),
      { source: 'touch', device: 'pen', inputId: 7 }, false,
    );
  });

  it.each(['pen', 'mouse'])('preserves the final zero-pressure sample for a %s tap without dropping the contact', device => {
    const input = attach('pointer');
    pointer(input.sheet, 'pointerdown', { pointerType: device, pressure: .5 });
    pointer(input.sheet, 'pointerup', { pointerType: device, pressure: 0 });
    expect(input.onStart).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ pressure: .5 }),
      { source: 'pointer', device, inputId: 7 },
    );
    expect(input.onMove).not.toHaveBeenCalled();
    expect(input.onEnd).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ clientX: 10, clientY: 20, pressure: 0 }),
      { source: 'pointer', device, inputId: 7 }, false,
    );
  });
});

describe('native touch recovery after a lost release', () => {
  it('finishes the old stroke at its last delivered sample before accepting a fresh identifier', () => {
    const input = attach('ios-touch');
    const order: string[] = [];
    input.onStart.mockImplementation(() => order.push('start'));
    input.onEnd.mockImplementation(() => order.push('end'));
    touch(input.sheet, 'touchstart');
    touch(input.sheet, 'touchmove', { clientX: 30, force: .2 });
    const lastDelivered = input.onMove.mock.calls[0][0];

    // There is deliberately no touchend for id 7. The full current contact
    // snapshot contains only the newly started id 8.
    touch(input.sheet, 'touchstart', { identifier: 8, clientX: 100 });
    expect(order).toEqual(['start', 'end', 'start']);
    expect(input.onEnd).toHaveBeenCalledExactlyOnceWith(
      lastDelivered, { source: 'touch', device: 'pen', inputId: 7, recovered: true }, false,
    );
    expect(input.onStart.mock.calls[0][1]).not.toHaveProperty('recovered');
    expect(input.onStart.mock.calls[1][1]).toEqual({ source: 'touch', device: 'pen', inputId: 8 });
    touch(input.sheet, 'touchmove', { identifier: 8, clientX: 120 });
    touch(input.sheet, 'touchend', { identifier: 8, clientX: 120, force: 0 });
    expect(input.onMove).toHaveBeenCalledTimes(2);
    expect(input.onEnd).toHaveBeenLastCalledWith(
      expect.objectContaining({ clientX: 120, pressure: 0 }),
      { source: 'touch', device: 'pen', inputId: 8 }, false,
    );
  });

  it('treats a fresh activation of the same identifier as a separate stroke', () => {
    const input = attach('ios-touch');
    touch(input.sheet, 'touchstart');
    touch(input.sheet, 'touchmove', { clientX: 30 });
    touch(input.sheet, 'touchstart', { clientX: 100 });
    expect(input.onEnd).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ clientX: 30 }),
      { source: 'touch', device: 'pen', inputId: 7, recovered: true }, false,
    );
    expect(input.onStart).toHaveBeenCalledTimes(2);
    expect(input.onStart.mock.calls[1][0].clientX).toBe(100);
    touch(input.sheet, 'touchend', { clientX: 100 });
    expect(input.onEnd).toHaveBeenCalledTimes(2);
    expect(input.onEnd.mock.calls[1][1]).not.toHaveProperty('recovered');
  });

  it('replaces a ghost Pencil contact even when WebKit still lists it as present', () => {
    const input = attach('ios-touch');
    touch(input.sheet, 'touchstart');
    touch(input.sheet, 'touchmove', { clientX: 30 });
    const stale = contact(input.sheet, { identifier: 7, clientX: 30 });
    const fresh = contact(input.sheet, { identifier: 8, clientX: 100 });

    // After a Pencil disconnect, WebKit can retain the old stylus in the full
    // contact list while reporting a new stylus activation. One Pencil cannot
    // produce two simultaneous tip contacts, so id 7 must be stale.
    touch(input.sheet, 'touchstart', fresh, [stale, fresh]);

    expect(input.onEnd).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ clientX: 30 }),
      { source: 'touch', device: 'pen', inputId: 7, recovered: true }, false,
    );
    expect(input.onStart).toHaveBeenCalledTimes(2);
    expect(input.onStart.mock.calls[1]).toEqual([
      expect.objectContaining({ clientX: 100 }),
      { source: 'touch', device: 'pen', inputId: 8 },
    ]);

    touch(input.sheet, 'touchmove', { identifier: 8, clientX: 120 });
    touch(input.sheet, 'touchend', { identifier: 8, clientX: 130 });
    expect(input.onMove).toHaveBeenCalledTimes(2);
    expect(input.onEnd).toHaveBeenCalledTimes(2);
  });

  it.each([7, 8])('releases the previous page before id %i starts on another page', newId => {
    const first = attach('ios-touch'), second = attach('ios-touch');
    const order: string[] = [];
    first.onEnd.mockImplementation(() => order.push('old-end'));
    second.onStart.mockImplementation(() => order.push('new-start'));
    touch(first.sheet, 'touchstart');
    touch(first.sheet, 'touchmove', { clientX: 30 });
    touch(second.sheet, 'touchstart', { identifier: newId, clientX: 100 });
    expect(order).toEqual(['old-end', 'new-start']);
    expect(first.onEnd.mock.calls[0][1]).toMatchObject({ recovered: true });

    touch(second.sheet, 'touchmove', { identifier: newId, clientX: 120 });
    touch(second.sheet, 'touchend', { identifier: newId, clientX: 130 });
    expect(first.onMove).toHaveBeenCalledOnce();
    expect(first.onEnd).toHaveBeenCalledOnce();
    expect(second.onMove).toHaveBeenCalledOnce();
    expect(second.onEnd).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ clientX: 130 }),
      { source: 'touch', device: 'pen', inputId: newId }, false,
    );
  });

  it('releases a reused identifier outside the sheet without stealing the outside gesture', () => {
    const input = attach('ios-touch');
    touch(input.sheet, 'touchstart');
    const start = touch(document.body, 'touchstart', { clientX: 100 });
    const move = touch(document.body, 'touchmove', { clientX: 120 });
    touch(document.body, 'touchend', { clientX: 130 });
    expect(input.onEnd).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ clientX: 10 }),
      { source: 'touch', device: 'pen', inputId: 7, recovered: true }, false,
    );
    expect(input.onStart).toHaveBeenCalledOnce();
    expect(input.onMove).not.toHaveBeenCalled();
    expect(start.defaultPrevented).toBe(false);
    expect(move.defaultPrevented).toBe(false);
  });

  it('keeps a held pen active when a new finger arrives, using its original touch target even outside the sheet', () => {
    const input = attach('ios-touch');
    touch(input.sheet, 'touchstart');
    const pen = contact(input.sheet), finger = contact(document.body, { identifier: 9, touchType: 'direct' });
    touch(document.body, 'touchstart', finger, [pen, finger]);
    expect(input.onEnd).not.toHaveBeenCalled();
    // Movement coordinates/event target may be outside; Touch.target remains
    // the element on which this still-live contact originally began.
    touch(document.body, 'touchmove', { target: input.sheet, clientX: 5000 }, [
      contact(input.sheet, { clientX: 5000 }), finger,
    ]);
    touch(document.body, 'touchend', { target: input.sheet, clientX: 5000 }, [finger]);
    expect(input.onMove).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ clientX: 5000 }), { source: 'touch', device: 'pen', inputId: 7 },
    );
    expect(input.onEnd).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ clientX: 5000 }), { source: 'touch', device: 'pen', inputId: 7 }, false,
    );
  });

  it('removes stale finger contacts instead of turning the next single finger into a phantom pinch', () => {
    const input = attach('ios-touch');
    touch(input.sheet, 'touchstart', { identifier: 1, touchType: 'direct' });
    expect(input.onGesture).toHaveBeenLastCalledWith([{ id: 1, clientX: 10, clientY: 20 }]);
    touch(input.sheet, 'touchstart', { identifier: 2, touchType: 'direct', clientX: 50 });
    expect(input.onGesture).toHaveBeenLastCalledWith([{ id: 2, clientX: 50, clientY: 20 }]);
    expect(input.onGesture.mock.calls.every(([contacts]) => contacts.length <= 1)).toBe(true);
    expect(input.onStart).not.toHaveBeenCalled();
  });

  it('keeps a live pen when its original child target was removed before a foreign finger starts', () => {
    const input = attach('ios-touch');
    const originalCanvas = input.sheet.appendChild(document.createElement('canvas'));
    touch(originalCanvas, 'touchstart');
    originalCanvas.remove();
    const pen = contact(originalCanvas), finger = contact(document.body, { identifier: 9, touchType: 'direct' });
    touch(document.body, 'touchstart', finger, [pen, finger]);
    expect(input.onEnd).not.toHaveBeenCalled();
    touch(document.body, 'touchmove', { target: originalCanvas, clientX: 40 }, [
      contact(originalCanvas, { clientX: 40 }), finger,
    ]);
    expect(input.onMove).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ clientX: 40 }), { source: 'touch', device: 'pen', inputId: 7 },
    );
    expect(input.onStart).toHaveBeenCalledOnce();
    expect(input.onEnd).not.toHaveBeenCalled();
  });

  it('keeps an explicit cancellation distinct from recovery and removes the document capture listener', () => {
    const added = vi.spyOn(document, 'addEventListener');
    const removed = vi.spyOn(document, 'removeEventListener');
    const input = attach('ios-touch');
    const capture = added.mock.calls.find(([type, , options]) => type === 'touchstart'
      && typeof options === 'object' && options?.capture);
    expect(capture).toBeDefined();
    touch(input.sheet, 'touchstart');
    touch(input.sheet, 'touchcancel');
    expect(input.onEnd).toHaveBeenCalledExactlyOnceWith(
      expect.any(Object), { source: 'touch', device: 'pen', inputId: 7 }, true,
    );
    mounted.at(-1)!.driver.destroy();
    expect(removed).toHaveBeenCalledWith('touchstart', capture![1], { capture: true, passive: true });
    touch(input.sheet, 'touchstart', { clientX: 100 });
    expect(input.onStart).toHaveBeenCalledOnce();
    expect(input.onEnd).toHaveBeenCalledOnce();
  });
});
