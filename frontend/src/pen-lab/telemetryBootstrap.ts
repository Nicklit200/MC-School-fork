/**
 * Standalone Apple Pencil input test bench. Loaded in pen-lab.html separately
 * from the React drawing controller, so local Codex edits do not overwrite it.
 * Events remain on the developer's own Windows Vite server.
 */
import { penLabTelemetry as telemetry } from './telemetry';

type TestSpec = { id: string; title: string; instructions: string; expectedStrokes: number | null };
type RunningTest = {
  spec: TestSpec;
  startedAt: number;
  down: number;
  up: number;
  cancel: number;
  outsideSheet: number;
  zeroMove: number;
  veryShort: number;
  lostWhilePressed: number;
  touchDuringPen: number;
  strokes: number;
  maxMoveGap: number;
  penMoves: number;
  marked: number;
  nativeTouchStarts: number;
  nativeStylusStarts: number;
};
type ActiveStroke = {
  pointerId: number;
  start: number;
  x: number;
  y: number;
  lastX: number;
  lastY: number;
  distance: number;
  moveCount: number;
  samples: number;
  onSheet: boolean;
};

const TESTS: TestSpec[] = [
  { id: 'T1', title: '20 медленных плюсов', instructions: 'Медленно нарисуй 20 плюсов. Каждый плюс — две отдельные линии.', expectedStrokes: 40 },
  { id: 'T2', title: '20 быстрых плюсов', instructions: 'Нарисуй 20 плюсов очень быстро, как обычно пишешь. Ожидаем 40 отдельных штрихов.', expectedStrokes: 40 },
  { id: 'T3', title: 'Быстрые цифры 30 секунд', instructions: 'Пиши подряд 1+2+3+4... в быстром темпе в течение 30 секунд.', expectedStrokes: null },
  { id: 'T4', title: 'Длинная линия 20 секунд', instructions: '20 секунд води Apple Pencil по листу, не отрывая.', expectedStrokes: 1 },
  { id: 'T5', title: '10 плюсов с ладонью', instructions: 'Положи ладонь как при письме, быстро нарисуй 10 плюсов.', expectedStrokes: 20 },
  { id: 'T6', title: '10 плюсов без ладони', instructions: 'Не опираясь ладонью на экран, нарисуй 10 быстрых плюсов.', expectedStrokes: 20 },
  { id: 'T7', title: '10 плюсов с увеличением', instructions: 'Увеличь лист двумя пальцами примерно до 200%, затем быстро нарисуй 10 плюсов.', expectedStrokes: 20 },
  { id: 'T8', title: 'Долгое письмо 3 минуты', instructions: 'Пиши произвольные формулы 2–3 минуты с естественными короткими паузами.', expectedStrokes: null },
];

let running: RunningTest | null = null;
let active: ActiveStroke | null = null;
let lastPointerTimestamp = 0;
let lastPenMoveAt: number | null = null;
let previousTouchLogAt = 0;
let totalMissedByExpectation = 0;

function onDrawingSheet(event: PointerEvent) {
  return event.target instanceof Element && event.target.closest('.sheet') !== null;
}

function describeTarget(event: PointerEvent) {
  const target = event.target;
  if (!(target instanceof Element)) return 'unknown';
  if (target.closest('.sheet')) return 'sheet';
  if (target.closest('#penlab-telemetry-controls')) return 'diagnostic-controls';
  if (target.closest('.toolbar')) return 'toolbar';
  return target.tagName.toLowerCase();
}

function markStrokeFinished(kind: 'pointerup' | 'pointercancel', event: PointerEvent) {
  const stroke = active?.pointerId === event.pointerId ? active : null;
  if (!stroke) {
    telemetry.capturePointer('pen_finished_without_start', event, { kind });
    return;
  }
  const duration = performance.now() - stroke.start;
  const distance = stroke.distance + Math.hypot(event.clientX - stroke.lastX, event.clientY - stroke.lastY);
  const noMovement = stroke.moveCount === 0;
  const veryShort = duration < 120 || distance < 8 || stroke.moveCount <= 1;
  telemetry.capturePointer('stroke_end_details', event, {
    kind,
    onSheet: stroke.onSheet,
    durationMs: Math.round(duration),
    distancePx: Math.round(distance * 10) / 10,
    moveCount: stroke.moveCount,
    coalescedSamples: stroke.samples,
    zeroMove: noMovement,
    veryShort,
  });

  if (running && stroke.onSheet) {
    if (kind === 'pointerup') running.up += 1;
    else running.cancel += 1;
    running.strokes += 1;
    if (noMovement) running.zeroMove += 1;
    if (veryShort) running.veryShort += 1;
  }
  active = null;
  lastPenMoveAt = null;
}

function handlePointerDown(event: PointerEvent) {
  if (event.pointerType === 'pen') {
    const onSheet = onDrawingSheet(event);
    active = {
      pointerId: event.pointerId,
      start: performance.now(),
      x: event.clientX,
      y: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      distance: 0,
      moveCount: 0,
      samples: 0,
      onSheet,
    };
    lastPenMoveAt = performance.now();
    lastPointerTimestamp = event.timeStamp;
    telemetry.pointerStarted(event);
    if (onSheet && running) running.down += 1;
    if (!onSheet) {
      if (running) running.outsideSheet += 1;
      telemetry.capturePointer('pen_down_outside_sheet', event, { target: describeTarget(event) });
    }
  } else if (event.pointerType === 'touch') {
    telemetry.capturePointer('touch_down', event, {
      target: describeTarget(event),
      penActive: active !== null,
    });
    if (active !== null && running) running.touchDuringPen += 1;
  } else {
    // Record mouse and touch to compare with the pen on the same device.
    telemetry.capturePointer('mouse_down', event, { target: describeTarget(event) });
  }
}

function handlePointerMove(event: PointerEvent) {
  if (event.pointerType === 'pen' && active?.pointerId === event.pointerId) {
    const started = performance.now();
    const previous = lastPenMoveAt;
    const gap = previous === null ? 0 : started - previous;
    const coalesced = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [];
    const samples = Math.max(1, coalesced.length);
    active.distance += Math.hypot(event.clientX - active.lastX, event.clientY - active.lastY);
    active.lastX = event.clientX;
    active.lastY = event.clientY;
    active.moveCount += 1;
    active.samples += samples;
    lastPenMoveAt = started;
    if (running) {
      running.penMoves += 1;
      running.maxMoveGap = Math.max(running.maxMoveGap, gap);
    }
    telemetry.pointerMoved(event, samples, performance.now() - started);
    if (event.timeStamp - lastPointerTimestamp > 80) {
      telemetry.record('input_timestamp_gap', {
        sinceLastDispatchedMs: Math.round(event.timeStamp - lastPointerTimestamp),
        pointerId: event.pointerId,
      });
    }
    lastPointerTimestamp = event.timeStamp;
  } else if (event.pointerType === 'touch') {
    // Palm / finger moves can arrive extremely frequently. Keep a bounded
    // 5Hz sample; pointerdown/cancel/up remain lossless.
    const now = performance.now();
    if (now - previousTouchLogAt > 200) {
      previousTouchLogAt = now;
      telemetry.capturePointer('touch_move_sample', event, { penActive: active !== null });
    }
  }
}

function handlePointerUp(event: PointerEvent) {
  if (event.pointerType === 'pen') {
    markStrokeFinished('pointerup', event);
    telemetry.pointerFinished('pointerup', event);
  } else if (event.pointerType === 'touch') {
    telemetry.capturePointer('touch_up', event);
  } else {
    telemetry.capturePointer('mouse_up', event);
  }
}

function handlePointerCancel(event: PointerEvent) {
  if (event.pointerType === 'pen') {
    markStrokeFinished('pointercancel', event);
    telemetry.pointerFinished('pointercancel', event);
  } else {
    telemetry.capturePointer('touch_cancel', event);
  }
}

function handleLostCapture(event: PointerEvent) {
  const wasActive = active?.pointerId === event.pointerId;
  const suspicious = wasActive && event.buttons !== 0;
  if (suspicious && running) running.lostWhilePressed += 1;
  telemetry.capturePointer('lostpointercapture', event, {
    wasActive,
    buttonsStillPressed: event.buttons !== 0,
    possibleUnexpectedLoss: suspicious,
  });
  // Do not assume that every loss is a bug. A release after pointerup is normal.
}

function handleGotCapture(event: PointerEvent) {
  telemetry.capturePointer('gotpointercapture', event);
}

document.addEventListener('pointerdown', handlePointerDown, { capture: true, passive: true });
document.addEventListener('pointermove', handlePointerMove, { capture: true, passive: true });
document.addEventListener('pointerup', handlePointerUp, { capture: true, passive: true });
document.addEventListener('pointercancel', handlePointerCancel, { capture: true, passive: true });
document.addEventListener('lostpointercapture', handleLostCapture, { capture: true, passive: true });
document.addEventListener('gotpointercapture', handleGotCapture, { capture: true, passive: true });

// Independent Safari Touch Events observer. Pointer Events and Touch Events are
// different browser APIs. If Scribble suppresses a contact, we can now find out
// whether a native touchstart was still dispatched. Passive observation only:
// never preventDefault or change the drawing engine in this experiment.
let lastNativeTouchSampleAt = 0;
const readTouchType = (touch: Touch) =>
  (touch as Touch & { touchType?: string }).touchType ?? 'unknown';
function observeNativeTouch(kind: string, event: TouchEvent) {
  for (let i = 0; i < event.changedTouches.length; i += 1) {
    const touch = event.changedTouches.item(i);
    if (!touch) continue;
    const touchType = readTouchType(touch);
    const onSheet = touch.target instanceof Element &&
      touch.target.closest('.sheet') !== null;
    if (kind === 'native_touchmove') {
      // At most 5 samples per second, but never drop down/up/cancel.
      if (touchType !== 'stylus' || performance.now() - lastNativeTouchSampleAt < 200) continue;
      lastNativeTouchSampleAt = performance.now();
    }
    telemetry.record(kind, {
      touchId: touch.identifier,
      touchType,
      onSheet,
      clientX: Math.round(touch.clientX * 10) / 10,
      clientY: Math.round(touch.clientY * 10) / 10,
      force: Math.round(touch.force * 100) / 100,
      activeTouchCount: event.touches.length,
    });
    if (kind === 'native_touchstart' && running && onSheet) {
      running.nativeTouchStarts += 1;
      if (touchType === 'stylus') running.nativeStylusStarts += 1;
    }
  }
}
document.addEventListener('touchstart', (event) => observeNativeTouch('native_touchstart', event),
  { capture: true, passive: true });
document.addEventListener('touchend', (event) => observeNativeTouch('native_touchend', event),
  { capture: true, passive: true });
document.addEventListener('touchcancel', (event) => observeNativeTouch('native_touchcancel', event),
  { capture: true, passive: true });
document.addEventListener('touchmove', (event) => observeNativeTouch('native_touchmove', event),
  { capture: true, passive: true });

function mountControls() {
  if (document.getElementById('penlab-telemetry-controls')) return;
  const box = document.createElement('section');
  box.id = 'penlab-telemetry-controls';
  // Put controls in the page flow *above* the React app, not on the drawing
  // canvas, so they cannot intercept Apple Pencil events on the sheet.
  box.style.cssText = [
    'margin:8px auto', 'width:calc(100% - 16px)', 'max-width:1500px',
    'background:#0f172a', 'color:white', 'border-radius:12px',
    'padding:12px', 'font:13px system-ui,sans-serif',
    'box-shadow:0 2px 10px #0003',
  ].join(';');

  const title = document.createElement('strong');
  title.textContent = 'Apple Pencil — тесты и автоматические логи';
  title.style.cssText = 'display:block;margin-bottom:6px';

  const status = document.createElement('div');
  status.style.cssText = 'font-size:12px;white-space:pre-line;line-height:1.6;margin-bottom:6px';
  status.textContent = 'Диагностика запускается...';

  const select = document.createElement('select');
  select.setAttribute('aria-label', 'Тест Apple Pencil');
  select.style.cssText = 'padding:8px;margin:4px 6px 4px 0;border-radius:7px;max-width:100%;color:#0f172a;background:white';
  for (const test of TESTS) {
    const option = document.createElement('option');
    option.value = test.id;
    option.textContent = test.id + ' — ' + test.title;
    select.appendChild(option);
  }
  select.value = 'T2';

  const help = document.createElement('div');
  help.style.cssText = 'font-size:12px;color:#cbd5e1;margin:4px 0';
  help.textContent = TESTS[1].instructions;
  select.onchange = () => {
    const test = TESTS.find((item) => item.id === select.value);
    if (test) help.textContent = test.instructions;
  };

  function button(text: string, background: string) {
    const element = document.createElement('button');
    element.type = 'button';
    element.textContent = text;
    element.style.cssText = [
      'padding:8px 10px', 'margin:4px 6px 4px 0', 'border-radius:7px',
      'border:0', 'font-weight:600', 'color:#111827', 'background:' + background,
      'font:inherit', 'touch-action:manipulation',
    ].join(';');
    return element;
  }

  const start = button('Начать тест', '#a7f3d0');
  const stop = button('Завершить', '#bfdbfe');
  const mark = button('Отметить пропуск линии', '#fde047');
  const download = button('Скачать сырой лог', '#e5e7eb');
  const report = button('Скачать отчёт', '#e5e7eb');

  const message = document.createElement('div');
  message.style.cssText = 'font-size:12px;color:#fde68a;white-space:pre-line;margin-top:4px';

  start.onclick = () => {
    if (running) {
      message.textContent = 'Сначала заверши предыдущий тест.';
      return;
    }
    const spec = TESTS.find((item) => item.id === select.value) ?? TESTS[1];
    running = {
      spec, startedAt: performance.now(), down: 0, up: 0, cancel: 0,
      outsideSheet: 0, zeroMove: 0, veryShort: 0, lostWhilePressed: 0,
      touchDuringPen: 0, strokes: 0, maxMoveGap: 0, penMoves: 0, marked: 0,
      nativeTouchStarts: 0, nativeStylusStarts: 0,
    };
    select.disabled = true;
    telemetry.record('test_start', {
      testId: spec.id,
      title: spec.title,
      expectedStrokes: spec.expectedStrokes,
    });
    message.textContent = 'Тест ' + spec.id + ' идёт. ' + spec.instructions;
  };

  stop.onclick = () => {
    const finished = running;
    if (!finished) {
      message.textContent = 'Сначала нажми «Начать тест».';
      return;
    }
    const duration = Math.round((performance.now() - finished.startedAt) / 1000);
    const expected = finished.spec.expectedStrokes;
    const shortage = expected === null ? null : Math.max(0, expected - finished.down);
    totalMissedByExpectation += shortage ?? 0;
    telemetry.record('test_end', {
      testId: finished.spec.id,
      title: finished.spec.title,
      durationSeconds: duration,
      expectedStrokes: expected,
      penDown: finished.down,
      nativeTouchStarts: finished.nativeTouchStarts,
      nativeStylusStarts: finished.nativeStylusStarts,
      penUp: finished.up,
      penCancel: finished.cancel,
      penDownOutsideSheet: finished.outsideSheet,
      zeroMoveStrokes: finished.zeroMove,
      veryShortStrokes: finished.veryShort,
      lostWhilePressed: finished.lostWhilePressed,
      touchDuringPen: finished.touchDuringPen,
      penMoveEvents: finished.penMoves,
      maxMoveGapMs: Math.round(finished.maxMoveGap),
      markedMisses: finished.marked,
      shortfallVsExpected: shortage,
    });
    message.textContent =
      'Тест ' + finished.spec.id + ' записан. ' +
      (expected === null ? 'Штрихов: ' + finished.down : 'Ожидали: ' + expected + ', Safari зарегистрировал: ' + finished.down) +
      '. Отмены пера: ' + finished.cancel +
      '. Коротких без move: ' + finished.zeroMove +
      '. Неожиданные потери захвата: ' + finished.lostWhilePressed +
      '.\nЛог сохранится автоматически на компьютере.';
    running = null;
    select.disabled = false;
    void telemetry.flush(true);
  };

  mark.onclick = () => {
    if (running) running.marked += 1;
    telemetry.markFreeze();
    message.textContent = 'Отметка сохранена. Продолжай писать; события до и после отметки будут в логе.';
  };

  download.onclick = () => { void telemetry.downloadReport(); };

  report.onclick = () => {
    void telemetry.downloadReadableReport();
  };

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;align-items:center;flex-wrap:wrap;gap:2px';
  const fastLink = document.createElement('a');
  fastLink.href = '/pen-lab-fast.html';
  fastLink.textContent = 'Режим без задержек (A/B)';
  fastLink.style.cssText = 'display:inline-block;padding:8px 10px;margin:4px 6px 4px 0;' +
    'border-radius:7px;background:#a7f3d0;color:#111827;text-decoration:none;font-weight:600;';
  const universalLink = document.createElement('a');
  universalLink.href = '/pen-lab-universal.html';
  universalLink.textContent = 'Универсальный ввод (iPad + Android)';
  universalLink.style.cssText = 'display:inline-block;padding:8px 10px;margin:4px 6px 4px 0;' +
    'border-radius:7px;background:#93c5fd;color:#111827;text-decoration:none;font-weight:600;';
  row.append(select, start, stop, mark, download, report, fastLink, universalLink);

  const syncStatus = document.createElement('div');
  syncStatus.style.cssText = 'font-size:12px;white-space:pre-line;line-height:1.6;margin-bottom:6px;color:#bfdbfe';
  syncStatus.textContent = 'GitHub: ожидаем первую синхронизацию';
  const refreshSyncStatus = async () => {
    try {
      const reply = await fetch('/__pen-lab-diagnostics?sync-status=1', { cache: 'no-store' });
      if (!reply.ok) throw new Error('HTTP ' + reply.status);
      const contentType = reply.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error('Vite запущен со старой конфигурацией. Нужен npm.cmd run dev:pen-lab после git pull.');
      }
      const info = await reply.json() as {
        state: string;
        lastSyncedAt: string | null;
        lastSessionId: string | null;
        lastError: string | null;
      };
      if (info.state === 'synced') {
        syncStatus.style.color = '#86efac';
        syncStatus.textContent = 'GitHub: синхронизировано ' +
          (info.lastSyncedAt ? new Date(info.lastSyncedAt).toLocaleTimeString('ru-RU') : '') +
          ', сессия ' + (info.lastSessionId ?? '');
      } else if (info.state === 'error') {
        syncStatus.style.color = '#fca5a5';
        syncStatus.textContent = 'GitHub: ошибка! Лог только на компьютере. ' + (info.lastError ?? '');
      } else {
        syncStatus.style.color = '#bfdbfe';
        syncStatus.textContent = info.state === 'syncing'
          ? 'GitHub: отправляем лог в приватное хранилище...'
          : 'GitHub: ожидание первой отправки';
      }
    } catch (error) {
      syncStatus.style.color = '#fca5a5';
      syncStatus.textContent = 'Диагностика не подключена. ' +
        (error instanceof Error && error.message.includes('старой конфигурацией')
          ? error.message
          : 'Проверь, что в терминале запущен обновлённый Vite (npm.cmd run dev:pen-lab). Ошибка: ' + String(error));
    }
  };
  void refreshSyncStatus();
  window.setInterval(() => { void refreshSyncStatus(); }, 4000);
  box.append(title, status, syncStatus, row, help, message);
  document.body.insertBefore(box, document.getElementById('pen-lab-root'));

  window.setInterval(() => {
    const summary = telemetry.snapshot();
    const runningInfo = running ? ' | Тест ' + running.spec.id + ': ' +
      running.down + (running.spec.expectedStrokes === null ? '' : '/' + running.spec.expectedStrokes) + ' штрихов'
      : ' | Тест не запущен';
    status.textContent =
      'Событий: ' + summary.eventCount +
      ' · запись на ПК: ' + (summary.fileStatus === 'saved' ? 'работает' : summary.fileStatus === 'offline' ? 'нет соединения' : 'ожидание') +
      runningInfo + '\nМакс. пауза событий пера: ' + Math.round(summary.maxPointerGapMs) + ' мс' +
      ' · пауза кадра: ' + Math.round(summary.maxFrameGapMs) + ' мс' +
      ' · помеченных пропусков: ' + summary.markCount +
      (totalMissedByExpectation ? ' · недостача по тестам: ' + totalMissedByExpectation : '');
  }, 500);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountControls, { once: true });
} else {
  mountControls();
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    window.location.reload();
  });
}
