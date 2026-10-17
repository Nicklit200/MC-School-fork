/* Private, development-only Apple Pencil diagnostics for Mindcrafti Pen Lab.
 * This module NEVER sends data to a remote third-party service. The same-origin
 * Vite development server writes reports under frontend/.pen-lab-logs/.
 */
export type DiagnosticValue = string | number | boolean | null;
export type DiagnosticDetails = Record<string, DiagnosticValue | undefined>;

export type DiagnosticEvent = {
  sequence: number;
  sessionId: string;
  wallTime: string;
  elapsedMs: number;
  kind: string;
  details: DiagnosticDetails;
};

export type DiagnosticSummary = {
  sessionId: string;
  eventCount: number;
  pending: number;
  fileStatus: 'waiting' | 'saved' | 'offline';
  maxPointerGapMs: number;
  maxHandlerMs: number;
  maxFrameGapMs: number;
  markCount: number;
  recentProblem: string;
};

const PATH = '/__pen-lab-diagnostics';
const MAX_LOCAL_EVENTS = 16000;
const MAX_PENDING_EVENTS = 5000;
const MAX_BATCH_EVENTS = 120;
const integer = (value: number) => Math.round(value * 10) / 10;

const createSessionId = () => {
  const stamp = new Date().toISOString().replace(/[^0-9A-Za-z]/g, '-');
  return 'penlab-' + stamp + '-' + Math.random().toString(36).slice(2, 10);
};

class PenLabTelemetry {
  readonly sessionId = createSessionId();
  private sequence = 0;
  private startedAt = performance.now();
  private events: DiagnosticEvent[] = [];
  private pending: DiagnosticEvent[] = [];
  private flushing = false;
  private fileStatus: DiagnosticSummary['fileStatus'] = 'waiting';
  private maxPointerGapMs = 0;
  private maxHandlerMs = 0;
  private maxFrameGapMs = 0;
  private markCount = 0;
  private recentProblem = 'Нет';
  private activePointer: number | null = null;
  private lastPenMoveAt: number | null = null;
  private lastPenPosition: { x: number; y: number } | null = null;
  private previousFrameTime: number | null = null;

  constructor() {
    this.record('session_start', {
      pagePath: window.location.pathname,
      mode: window.location.pathname.includes('pen-lab-fast') ? 'fast' : 'standard',
      userAgent: navigator.userAgent.slice(0, 300),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      screenWidth: window.screen.width,
      screenHeight: window.screen.height,
      pixelRatio: window.devicePixelRatio,
      language: navigator.language,
    });

    window.setInterval(() => { void this.flush(); }, 900);

    window.addEventListener('pagehide', () => {
      this.record('pagehide');
      this.flushOnExit();
    });
    document.addEventListener('visibilitychange', () => {
      this.record('visibility', { state: document.visibilityState });
      if (document.hidden) this.flushOnExit();
    });
    window.addEventListener('error', (event) => {
      this.record('javascript_error', {
        message: String(event.message).slice(0, 600),
        filename: String(event.filename).slice(0, 200),
        line: event.lineno,
      });
    });
    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason;
      this.record('unhandled_rejection', {
        reason: String(reason instanceof Error ? reason.message : reason).slice(0, 600),
      });
    });

    // Track stalls on the rendering thread even on Safari versions without
    // PerformanceObserver.longtask support.
    const watchFrame = (now: number) => {
      if (this.previousFrameTime !== null && this.activePointer !== null && !document.hidden) {
        const delay = now - this.previousFrameTime;
        if (delay > 40) {
          this.maxFrameGapMs = Math.max(this.maxFrameGapMs, delay);
          this.recentProblem = 'Frame gap ' + Math.round(delay) + 'ms';
          this.record('frame_gap', { delayMs: integer(delay), pointerId: this.activePointer });
        }
      }
      this.previousFrameTime = now;
      requestAnimationFrame(watchFrame);
    };
    requestAnimationFrame(watchFrame);

    try {
      if ('PerformanceObserver' in window &&
          PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            this.record('long_task', { durationMs: integer(entry.duration) });
          }
        });
        observer.observe({ entryTypes: ['longtask'] });
      }
    } catch {
      // Safari may not implement Long Tasks; frame_gap is the fallback.
    }

    let previousTick = performance.now();
    window.setInterval(() => {
      const now = performance.now();
      const drift = now - previousTick - 100;
      previousTick = now;
      if (this.activePointer !== null && drift > 75 && !document.hidden) {
        this.recentProblem = 'JS pause ' + Math.round(drift) + 'ms';
        this.record('event_loop_pause', { delayMs: integer(drift), pointerId: this.activePointer });
      }
    }, 100);
  }

  record(kind: string, details: DiagnosticDetails = {}) {
    const event: DiagnosticEvent = {
      sequence: ++this.sequence,
      sessionId: this.sessionId,
      wallTime: new Date().toISOString(),
      elapsedMs: integer(performance.now() - this.startedAt),
      kind,
      details,
    };
    this.events.push(event);
    this.pending.push(event);
    if (this.events.length > MAX_LOCAL_EVENTS) this.events.splice(0, 1000);
    if (this.pending.length > MAX_PENDING_EVENTS) {
      this.pending.splice(0, this.pending.length - MAX_PENDING_EVENTS);
      this.fileStatus = 'offline';
    }
    if (kind === 'pointercancel' || kind === 'lostpointercapture' || kind === 'javascript_error') {
      this.recentProblem = kind;
    }
  }

  capturePointer(kind: string, event: PointerEvent, details: DiagnosticDetails = {}) {
    this.record(kind, {
      pointerId: event.pointerId,
      type: event.pointerType,
      isPrimary: event.isPrimary,
      buttons: event.buttons,
      pressure: integer(event.pressure),
      tiltX: event.tiltX,
      tiltY: event.tiltY,
      clientX: integer(event.clientX),
      clientY: integer(event.clientY),
      ...details,
    });
  }

  pointerStarted(event: PointerEvent) {
    this.activePointer = event.pointerId;
    this.lastPenMoveAt = performance.now();
    this.lastPenPosition = { x: event.clientX, y: event.clientY };
    this.capturePointer('stroke_start', event);
  }

  pointerMoved(event: PointerEvent, samples: number, handlerMs: number) {
    const now = performance.now();
    const prevAt = this.lastPenMoveAt;
    const prevPosition = this.lastPenPosition;
    const sinceLast = prevAt === null ? 0 : now - prevAt;
    const distance = prevPosition
      ? Math.hypot(event.clientX - prevPosition.x, event.clientY - prevPosition.y)
      : 0;

    this.lastPenMoveAt = now;
    this.lastPenPosition = { x: event.clientX, y: event.clientY };
    this.maxHandlerMs = Math.max(this.maxHandlerMs, handlerMs);
    this.maxPointerGapMs = Math.max(this.maxPointerGapMs, sinceLast);
    if (sinceLast > 45) {
      this.recentProblem = 'Move gap ' + Math.round(sinceLast) + 'ms';
      this.record('pointer_gap', {
        pointerId: event.pointerId,
        delayMs: integer(sinceLast),
        distancePx: integer(distance),
        handlerMs: integer(handlerMs),
      });
    }
    if (handlerMs > 12) {
      this.recentProblem = 'Handler ' + Math.round(handlerMs) + 'ms';
      this.record('slow_pointer_handler', {
        pointerId: event.pointerId,
        handlerMs: integer(handlerMs),
        samples,
      });
    }
    this.capturePointer('app_pointermove', event, {
      gapMs: integer(sinceLast),
      handlerMs: integer(handlerMs),
      coalesced: samples,
    });
  }

  pointerFinished(kind: string, event: PointerEvent) {
    this.capturePointer(kind, event);
    if (this.activePointer === event.pointerId) {
      this.activePointer = null;
      this.lastPenMoveAt = null;
      this.lastPenPosition = null;
    }
  }

  markFreeze() {
    this.markCount += 1;
    this.recentProblem = 'Сбой отмечен вручную';
    this.record('FREEZE_MARKED_BY_USER', {
      activePointer: this.activePointer,
      count: this.markCount,
    });
    void this.flush();
  }

  snapshot(): DiagnosticSummary {
    return {
      sessionId: this.sessionId,
      eventCount: this.sequence,
      pending: this.pending.length,
      fileStatus: this.fileStatus,
      maxPointerGapMs: integer(this.maxPointerGapMs),
      maxHandlerMs: integer(this.maxHandlerMs),
      maxFrameGapMs: integer(this.maxFrameGapMs),
      markCount: this.markCount,
      recentProblem: this.recentProblem,
    };
  }

  private flushOnExit() {
    if (!this.pending.length) return;
    const chunk = this.pending.splice(0, MAX_BATCH_EVENTS);
    const body = JSON.stringify({ sessionId: this.sessionId, events: chunk });
    try {
      const okay = navigator.sendBeacon?.(PATH, new Blob([body], { type: 'application/json' }));
      if (!okay) this.pending.unshift(...chunk);
    } catch {
      this.pending.unshift(...chunk);
    }
  }

  async flush(_immediate = false): Promise<void> {
    if (this.flushing || this.pending.length === 0) return;
    this.flushing = true;
    try {
      while (this.pending.length > 0) {
        const chunk = this.pending.splice(0, MAX_BATCH_EVENTS);
        let okay = false;
        try {
          const response = await fetch(PATH, {
            method: 'POST',
            cache: 'no-store',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: this.sessionId, events: chunk }),
          });
          if (response.ok) {
            const body = await response.json() as { ok?: boolean };
            okay = body.ok === true;
          }
        } catch {
          // The tablet may have temporarily lost its connection to Vite.
        }
        if (!okay) {
          this.pending.unshift(...chunk);
          this.fileStatus = 'offline';
          break;
        }
        this.fileStatus = 'saved';
      }
    } finally {
      this.flushing = false;
    }
  }

  async downloadReport() {
    await this.flush();
    let blob: Blob;
    try {
      const response = await fetch(PATH + '?session=' + encodeURIComponent(this.sessionId), {
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('Local diagnostic server unavailable');
      blob = await response.blob();
    } catch {
      blob = new Blob(
        [JSON.stringify({ sessionId: this.sessionId, summary: this.snapshot(), events: this.events }, null, 2)],
        { type: 'application/json' },
      );
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = this.sessionId + (blob.type.includes('ndjson') ? '.ndjson' : '.json');
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 3000);
  }
  /** Readable local report, generated from the same authoritative .ndjson. */
  async downloadReadableReport() {
    await this.flush(true);
    try {
      const result = await fetch(
        PATH + '?session=' + encodeURIComponent(this.sessionId) + '&format=report',
        { cache: 'no-store' },
      );
      if (!result.ok) throw new Error('No saved report');
      const blob = await result.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = this.sessionId + '.report.md';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 3000);
    } catch {
      const tests = this.events.filter((item) => item.kind === 'test_end');
      const lines = [
        '# Mindcrafti Pen Lab — Apple Pencil report',
        'Session: ' + this.sessionId,
        'Captured events in browser: ' + this.sequence,
        ...tests.map((item) => '\n## ' + item.details.testId + '\n' +
          Object.entries(item.details).map(([key, value]) => '- ' + key + ': ' + String(value)).join('\n')),
        '\nManual freeze marks: ' + this.markCount,
        'Max move gap: ' + this.maxPointerGapMs.toFixed(1) + ' ms',
        'Max frame gap: ' + this.maxFrameGapMs.toFixed(1) + ' ms',
      ];
      const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = this.sessionId + '.report.md';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 3000);
    }
  }

}

export const penLabTelemetry = new PenLabTelemetry();
