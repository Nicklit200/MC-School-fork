/**
 * Decides what a pointer does on the board.
 *
 * Pure so the stylus/finger rules are testable without a touch device.
 *
 * - stylus mode: a pen draws; fingers move/zoom the canvas; a palm (which
 *   browsers report as a touch) must never leave a mark.
 * - finger mode: one finger draws; two or more fingers always pan/zoom.
 * - a mouse always draws, in either mode.
 */

export type InputMode = 'stylus' | 'finger';
export type PointerKind = 'mouse' | 'pen' | 'touch';
export type PointerAction = 'draw' | 'pan' | 'ignore';

export function normalizePointerKind(value: string | undefined): PointerKind {
  return value === 'pen' || value === 'touch' ? value : 'mouse';
}

/**
 * @param kind pointer type of the event
 * @param mode explicit user choice
 * @param activeTouches number of touch pointers currently down, including this one
 */
export function actionFor(kind: PointerKind, mode: InputMode, activeTouches: number): PointerAction {
  if (kind === 'mouse') return 'draw';
  if (kind === 'pen') return 'draw';
  // Touch from here on.
  if (activeTouches >= 2) return 'pan';
  return mode === 'finger' ? 'draw' : 'pan';
}

/**
 * Whether a stroke already in progress must be cancelled because a second
 * finger landed: in finger mode the first finger had started drawing, and a
 * second one turns the gesture into pan/zoom without leaving a stray dot.
 */
export function shouldCancelStroke(kind: PointerKind, activeTouches: number): boolean {
  return kind === 'touch' && activeTouches >= 2;
}

/**
 * Large touch contact areas are palms, not fingertips. Reported where the
 * browser supports it (`width`/`height` of the contact ellipse, in CSS px).
 */
export function looksLikePalm(width: number | undefined, height: number | undefined): boolean {
  const size = Math.max(width ?? 0, height ?? 0);
  return size > 40;
}
