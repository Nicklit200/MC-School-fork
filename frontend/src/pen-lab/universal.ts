/**
 * Cross-platform canvas A/B test using shared tabletInkInput controller.
 * This page intentionally does NOT run React, Perfect Freehand or persistence.
 */
import {
  attachTabletInkInput, type TabletInkPoint, type TabletInkContact,
} from '../lib/tabletInkInput';

const sheet = document.getElementById('fast-sheet') as HTMLDivElement;
const canvas = document.getElementById('fast-ink') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const stats = document.getElementById('fast-stats') as HTMLElement;
const backend = document.getElementById('input-backend') as HTMLElement;
const allowFinger = document.getElementById('fast-finger') as HTMLInputElement;
const clear = document.getElementById('fast-clear') as HTMLButtonElement;

let active: { x: number; y: number } | null = null;
let strokes = 0;
let finished = 0;
let cancelled = 0;
let moves = 0;
let lastFinishedAt = 0;
let shortestGap = Infinity;
let fingerContacts: TabletInkContact[] = [];

function toCanvas(point: TabletInkPoint) {
  const bounds = sheet.getBoundingClientRect();
  return {
    x: (point.clientX - bounds.left) * canvas.width / bounds.width,
    y: (point.clientY - bounds.top) * canvas.height / bounds.height,
  };
}
function drawLine(a: { x: number; y: number }, b: { x: number; y: number }) {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#2563eb';
  ctx.stroke();
}
const controller = attachTabletInkInput(sheet, {
  onStart(point) {
    active = toCanvas(point);
    // A visible dot proves even short/zero-movement contacts were received.
    ctx.beginPath();
    ctx.arc(active.x, active.y, 2, 0, Math.PI * 2);
    ctx.fillStyle = '#2563eb';
    ctx.fill();
    strokes += 1;
    if (lastFinishedAt > 0) shortestGap = Math.min(shortestGap, performance.now() - lastFinishedAt);
  },
  onMove(point) {
    const next = toCanvas(point);
    if (active) drawLine(active, next);
    active = next;
    moves += 1;
  },
  onEnd(point, _meta, wasCancelled) {
    const next = toCanvas(point);
    if (active) drawLine(active, next);
    active = null;
    finished += 1;
    if (wasCancelled) cancelled += 1;
    lastFinishedAt = performance.now();
  },
  onGesture(touches) {
    fingerContacts = touches;
  },
}, {
  allowFinger: () => allowFinger.checked,
  pointerCapture: true,
});
backend.textContent = 'Режим ввода: ' + controller.backend;
function showStats() {
  stats.textContent = 'Штрихов: ' + strokes +
    ' · закончено: ' + finished + ' · отмен: ' + cancelled +
    ' · move: ' + moves +
    ' · пальцев: ' + fingerContacts.length +
    ' · самый быстрый переход: ' +
    (Number.isFinite(shortestGap) ? Math.round(shortestGap) + ' мс' : '—');
}
clear.addEventListener('click', () => {
  if (active) return;
  strokes = 0;
  finished = 0;
  cancelled = 0;
  moves = 0;
  shortestGap = Infinity;
  lastFinishedAt = 0;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  showStats();
});
window.setInterval(showStats, 250);
showStats();
if (import.meta.hot) {
  import.meta.hot.dispose(() => controller.destroy());
}
