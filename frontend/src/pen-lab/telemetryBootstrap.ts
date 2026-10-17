/** Automatically records all Apple Pencil and touch events in a Pen Lab session.
 * Loaded directly from pen-lab.html so ongoing Codex changes to main.tsx
 * cannot accidentally disable the recorder.
 */
import { penLabTelemetry as telemetry } from './telemetry';

let livePointer: number | null = null;
let lastHandlerDoneAt = performance.now();
let lastPointerTimestamp = 0;

const record = (type: string, event: PointerEvent) => {
  telemetry.capturePointer(type, event, {
    activePointer: livePointer,
    target: event.target instanceof Element
      ? event.target.tagName.toLowerCase() + (event.target.className && typeof event.target.className === 'string' ? '.' + event.target.className.slice(0, 50) : '')
      : 'unknown',
    sincePreviousEventMs: Math.round((performance.now() - lastHandlerDoneAt) * 10) / 10,
    timestampMs: Math.round(event.timeStamp),
  });
};

const handlePointerDown = (event: PointerEvent) => {
  if (event.pointerType === 'pen') {
    livePointer = event.pointerId;
    telemetry.pointerStarted(event);
  } else {
    record('touch_or_mouse_down', event);
  }
};
const handlePointerMove = (event: PointerEvent) => {
  if (event.pointerType === 'pen' && event.pointerId === livePointer) {
    const start = performance.now();
    const coalesced = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [];
    const samples = coalesced.length + (coalesced.length ? 0 : 1);
    telemetry.pointerMoved(event, samples, performance.now() - start);
    // This observer runs in the capture phase; it measures input dispatch,
    // not total rendering time. Frame-gap instrumentation measures stalls.
    if (event.timeStamp - lastPointerTimestamp > 80 && lastPointerTimestamp !== 0) {
      telemetry.record('input_timestamp_gap', {
        sinceLastDispatchedMs: Math.round(event.timeStamp - lastPointerTimestamp),
      });
    }
    lastPointerTimestamp = event.timeStamp;
  } else if (event.pointerType === 'touch') {
    record('touch_move', event);
  }
  lastHandlerDoneAt = performance.now();
};
const handlePointerUp = (event: PointerEvent) => {
  if (event.pointerType === 'pen') {
    telemetry.pointerFinished('pointerup', event);
    if (livePointer === event.pointerId) livePointer = null;
  } else {
    record('touch_or_mouse_up', event);
  }
};
const handlePointerCancel = (event: PointerEvent) => {
  telemetry.pointerFinished('pointercancel', event);
  if (livePointer === event.pointerId) livePointer = null;
};
const handleLostCapture = (event: PointerEvent) => {
  telemetry.capturePointer('lostpointercapture', event, {
    wasActive: livePointer === event.pointerId,
    buttonsStillPressed: event.buttons !== 0,
  });
  // If capture is lost during a stroke, pointermove might still be delivered.
  // Keep observing until pointerup, cancel, or another stylus pointerdown.
};
const handleGotCapture = (event: PointerEvent) => {
  telemetry.capturePointer('gotpointercapture', event);
};

document.addEventListener('pointerdown', handlePointerDown, { capture: true, passive: true });
document.addEventListener('pointermove', handlePointerMove, { capture: true, passive: true });
document.addEventListener('pointerup', handlePointerUp, { capture: true, passive: true });
document.addEventListener('pointercancel', handlePointerCancel, { capture: true, passive: true });
document.addEventListener('lostpointercapture', handleLostCapture, { capture: true, passive: true });
document.addEventListener('gotpointercapture', handleGotCapture, { capture: true, passive: true });

function mountControls() {
  if (document.getElementById('penlab-telemetry-controls')) return;
  const box = document.createElement('aside');
  box.id = 'penlab-telemetry-controls';
  box.style.cssText = [
    'position:fixed', 'right:10px', 'bottom:10px', 'z-index:10000',
    'background:rgba(15,23,42,.96)', 'color:white', 'border-radius:12px',
    'padding:10px', 'font:12px system-ui,sans-serif', 'max-width:280px',
    'box-shadow:0 2px 14px #0004', 'touch-action:manipulation',
  ].join(';');
  const status = document.createElement('div');
  status.style.cssText = 'margin-bottom:8px;line-height:1.45';
  status.textContent = 'Диагностика: запуск...';
  const mark = document.createElement('button');
  mark.type = 'button';
  mark.textContent = 'Отметить сбой';
  mark.style.cssText = 'margin-right:6px;padding:7px;border-radius:7px;background:#facc15;color:#171717;border:0;font-weight:bold';
  mark.onclick = () => {
    telemetry.markFreeze();
    status.textContent = 'Сбой отмечен. Продолжай тестировать.';
  };
  const download = document.createElement('button');
  download.type = 'button';
  download.textContent = 'Скачать лог';
  download.style.cssText = 'padding:7px;border-radius:7px;background:#bfdbfe;color:#171717;border:0;font-weight:bold';
  download.onclick = () => { void telemetry.downloadReport(); };
  box.append(status, mark, download);
  document.body.appendChild(box);

  window.setInterval(() => {
    const summary = telemetry.snapshot();
    status.textContent =
      'Записано: ' + summary.eventCount + ' | На ПК: ' + (summary.fileStatus === 'saved' ? 'да' : summary.fileStatus === 'offline' ? 'нет соединения' : 'ожидание') +
      '\nМакс. пауза пера: ' + Math.round(summary.maxPointerGapMs) + ' мс' +
      ' | кадра: ' + Math.round(summary.maxFrameGapMs) + ' мс' +
      ' | Сбоев: ' + summary.markCount;
    status.style.whiteSpace = 'pre-line';
  }, 500);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountControls, { once: true });
} else {
  mountControls();
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    // A full reload guarantees no duplicate global pointer listeners.
    window.location.reload();
  });
}
