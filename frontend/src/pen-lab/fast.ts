/**
 * Purpose-built iPad fast-inking A/B test. No React, Perfect Freehand, localStorage,
 * gesture engine, or work after a stroke other than closing its path.
 * All pointer data is independently captured by telemetryBootstrap.ts.
 */
const sheet = document.getElementById('fast-sheet') as HTMLDivElement;
const canvas = document.getElementById('fast-ink') as HTMLCanvasElement;
const ctx = canvas.getContext('2d', { alpha: true })!;
const stats = document.getElementById('fast-stats') as HTMLSpanElement;
const capture = document.getElementById('fast-capture') as HTMLInputElement;
const clear = document.getElementById('fast-clear') as HTMLButtonElement;
type InProgress = {
  id: number;
  type: string;
  points: number;
  at: number;
  prevX: number;
  prevY: number;
};
let active: InProgress | null = null;
let strokeCount = 0;
let maxGap = 0;
let moves = 0;
let cancels = 0;
let lastEndedAt = 0;
let minBetween = Infinity;
let ignoredTouch = 0;

const updateStats = () => {
  stats.textContent = 'Штрихов: ' + strokeCount +
    ' · move: ' + moves +
    ' · cancel: ' + cancels +
    ' · касаний пальцем: ' + ignoredTouch +
    ' · макс. пауза: ' + Math.round(maxGap) + ' мс' +
    ' · мин. между штрихами: ' + (Number.isFinite(minBetween) ? Math.round(minBetween) + ' мс' : '—');
};

function position(event: PointerEvent): { x: number; y: number } {
  const rect = sheet.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * canvas.width / rect.width,
    y: (event.clientY - rect.top) * canvas.height / rect.height,
  };
}

function down(event: PointerEvent) {
  if (event.pointerType === 'touch') {
    ignoredTouch += 1;
    return;
  }
  if (active !== null) return;
  event.preventDefault();
  const pt = position(event);
  active = {
    id: event.pointerId,
    type: event.pointerType,
    points: 1,
    at: performance.now(),
    prevX: pt.x,
    prevY: pt.y,
  };
  if (lastEndedAt !== 0) {
    minBetween = Math.min(minBetween, performance.now() - lastEndedAt);
  }
  ctx.strokeStyle = '#2563eb';
  ctx.fillStyle = '#2563eb';
  ctx.lineWidth = 4;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(pt.x, pt.y, 2, 0, Math.PI * 2);
  ctx.fill(); // draw even a zero-length or extremely short contact

  if (capture.checked) {
    try { sheet.setPointerCapture(event.pointerId); }
    catch { /* keep drawing without capture */ }
  }
  strokeCount += 1;
}

function move(event: PointerEvent) {
  if (!active || active.id !== event.pointerId) return;
  event.preventDefault();
  const raw = typeof event.getCoalescedEvents === 'function'
    ? event.getCoalescedEvents() : [];
  const samples = raw.length ? [...raw, event] : [event];
  for (const sample of samples) {
    const pt = position(sample);
    if (pt.x === active.prevX && pt.y === active.prevY) continue;
    ctx.beginPath();
    ctx.moveTo(active.prevX, active.prevY);
    ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
    active.prevX = pt.x;
    active.prevY = pt.y;
    active.points += 1;
    moves += 1;
  }
}

function finish(event: PointerEvent, canceled: boolean) {
  if (active?.id !== event.pointerId) return;
  event.preventDefault();
  const pt = position(event);
  if (pt.x !== active.prevX || pt.y !== active.prevY) {
    ctx.beginPath();
    ctx.moveTo(active.prevX, active.prevY);
    ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
  }
  if (canceled) cancels += 1;
  lastEndedAt = performance.now();
  maxGap = Math.max(maxGap, performance.now() - active.at);
  active = null;
  // No redraw, stringify, localStorage or React state changes.
}

sheet.addEventListener('pointerdown', down, { passive: false });
sheet.addEventListener('pointermove', move, { passive: false });
sheet.addEventListener('pointerup', (event) => finish(event, false), { passive: false });
sheet.addEventListener('pointercancel', (event) => finish(event, true), { passive: false });

// When capture is disabled, pointerup may land just outside the sheet.
// Register it at document level, without committing twice.
document.addEventListener('pointerup', (event) => {
  if (active?.id === event.pointerId) finish(event, false);
});
document.addEventListener('pointercancel', (event) => {
  if (active?.id === event.pointerId) finish(event, true);
});
clear.addEventListener('click', () => {
  active = null;
  strokeCount = 0;
  moves = 0;
  cancels = 0;
  ignoredTouch = 0;
  maxGap = 0;
  lastEndedAt = 0;
  minBetween = Infinity;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  updateStats();
});
window.setInterval(updateStats, 400);
updateStats();
