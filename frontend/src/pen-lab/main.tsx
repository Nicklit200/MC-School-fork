import { StrictMode, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { renderHomeworkInkStroke, type HomeworkInkPoint, type HomeworkInkStroke } from '../lib/homeworkInk';
import './pen-lab.css';

type Tool = 'pen' | 'eraser';
type PointerData = { type: string; pressure: number; event: string };
type Stroke = HomeworkInkStroke;
type Pan = { x: number; y: number; distance: number; scale: number; offsetX: number; offsetY: number };
const WIDTH = 800;
const HEIGHT = 1100;
const STORAGE_KEY = 'mindcrafti-pen-lab-strokes-v1';
const palette = ['#2563eb', '#121826', '#dc2626', '#15803d'];
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function readSaved(): Stroke[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(data) ? data as Stroke[] : [];
  } catch {
    return [];
  }
}

function PenLab() {
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState(palette[0]);
  const [size, setSize] = useState(4);
  const [allowFinger, setAllowFinger] = useState(false);
  const [scale, setScale] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [stats, setStats] = useState<PointerData>({ type: '—', pressure: 0, event: 'Ожидание пера' });
  const [counters, setCounters] = useState({ down: 0, move: 0, cancel: 0, lost: 0 });
  const [revision, setRevision] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const inkCanvasRef = useRef<HTMLCanvasElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const strokesRef = useRef<Stroke[]>(readSaved());
  const strokeRef = useRef<Stroke | null>(null);
  const pointerRef = useRef<number | null>(null);
  const pointerTypeRef = useRef('');
  const touchesRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const gestureRef = useRef<Pan | null>(null);
  const moveCountRef = useRef(0);
  const scaleRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const toolRef = useRef(tool);
  const colorRef = useRef(color);
  const sizeRef = useRef(size);
  const allowFingerRef = useRef(allowFinger);
  toolRef.current = tool;
  colorRef.current = color;
  sizeRef.current = size;
  allowFingerRef.current = allowFinger;
  scaleRef.current = scale;
  panRef.current = { x: panX, y: panY };

  const redraw = useCallback(() => {
    const canvas = inkCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    for (const stroke of strokesRef.current) renderHomeworkInkStroke(ctx, stroke);
  }, []);

  const clearPreview = useCallback(() => {
    const canvas = previewCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    ctx?.clearRect(0, 0, WIDTH, HEIGHT);
  }, []);

  const finishStroke = useCallback((commit: boolean) => {
    const stroke = strokeRef.current;
    strokeRef.current = null;
    pointerRef.current = null;
    pointerTypeRef.current = '';
    if (commit && stroke) {
      strokesRef.current = [...strokesRef.current, stroke];
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(strokesRef.current)); } catch { /* Storage may be full. */ }
      setRevision(strokesRef.current.length);
    }
    redraw();
    clearPreview();
  }, [clearPreview, redraw]);

  useEffect(() => {
    redraw();
    const onBlur = () => {
      if (pointerRef.current !== null) finishStroke(pointerTypeRef.current !== 'touch');
      touchesRef.current.clear();
      gestureRef.current = null;
    };
    const onVisibility = () => { if (document.hidden) onBlur(); };
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [redraw, finishStroke]);

  const position = (event: PointerEvent): HomeworkInkPoint => {
    const rect = surfaceRef.current!.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * WIDTH / rect.width,
      y: (event.clientY - rect.top) * HEIGHT / rect.height,
      pressure: event.pressure > 0 ? event.pressure : 0.5,
    };
  };

  function drawLiveSegment(from: HomeworkInkPoint | undefined, to: HomeworkInkPoint, stroke: Stroke) {
    const canvas = stroke.tool === 'eraser' ? inkCanvasRef.current : previewCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = stroke.color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = stroke.tool === 'eraser'
      ? Math.max(24, stroke.size * 5)
      : stroke.size * (stroke.pressureSensitive ? 0.55 + (to.pressure ?? 0.5) : 1);
    ctx.beginPath();
    ctx.moveTo(from?.x ?? to.x, from?.y ?? to.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.restore();
  }

  function beginGesture() {
    const touches = Array.from(touchesRef.current.values());
    if (touches.length !== 2) return;
    const midX = (touches[0].x + touches[1].x) / 2;
    const midY = (touches[0].y + touches[1].y) / 2;
    gestureRef.current = {
      x: midX,
      y: midY,
      distance: Math.max(1, Math.hypot(touches[1].x - touches[0].x, touches[1].y - touches[0].y)),
      scale: scaleRef.current,
      offsetX: panRef.current.x,
      offsetY: panRef.current.y,
    };
  }

  function moveGesture() {
    const touches = Array.from(touchesRef.current.values());
    const gesture = gestureRef.current;
    if (!gesture || touches.length < 2) return;
    const midX = (touches[0].x + touches[1].x) / 2;
    const midY = (touches[0].y + touches[1].y) / 2;
    const distance = Math.max(1, Math.hypot(touches[1].x - touches[0].x, touches[1].y - touches[0].y));
    const nextScale = clamp(gesture.scale * distance / gesture.distance, 0.6, 4);
    const ratio = nextScale / gesture.scale;
    const stage = stageRef.current?.getBoundingClientRect();
    const centerX = gesture.x - (stage?.left ?? 0);
    const centerY = gesture.y - (stage?.top ?? 0);
    setScale(nextScale);
    setPanX(midX - gesture.x + centerX - (centerX - gesture.offsetX) * ratio);
    setPanY(midY - gesture.y + centerY - (centerY - gesture.offsetY) * ratio);
  }

  function down(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'touch') {
      if (pointerTypeRef.current === 'pen') return;
      touchesRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touchesRef.current.size >= 2) {
        if (pointerTypeRef.current === 'touch') finishStroke(false);
        beginGesture();
        try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* browser-managed touch */ }
        return;
      }
      if (!allowFingerRef.current) return;
    }
    if (pointerRef.current !== null) {
      if (event.pointerType === 'touch') return;
      finishStroke(true); // recover from missing pointerup
    }
    event.preventDefault();
    const first = position(event.nativeEvent);
    strokeRef.current = {
      tool: toolRef.current,
      color: colorRef.current,
      size: sizeRef.current,
      points: [first],
      pressureSensitive: event.pointerType === 'pen' && event.pressure > 0,
    };
    pointerRef.current = event.pointerId;
    pointerTypeRef.current = event.pointerType;
    setCounters((prev) => ({ ...prev, down: prev.down + 1 }));
    setStats({ type: event.pointerType, pressure: event.pressure, event: 'pointerdown' });
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* handled by lost capture */ }
    drawLiveSegment(undefined, first, strokeRef.current);
  }

  function move(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'touch' && touchesRef.current.has(event.pointerId)) {
      touchesRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touchesRef.current.size >= 2 && gestureRef.current) {
        event.preventDefault();
        moveGesture();
        return;
      }
    }
    if (pointerRef.current !== event.pointerId || !strokeRef.current) return;
    event.preventDefault();
    const raw = event.nativeEvent;
    const samples = typeof raw.getCoalescedEvents === 'function' ? raw.getCoalescedEvents() : [raw];
    const stroke = strokeRef.current;
    for (const sample of samples.length ? samples : [raw]) {
      const next = position(sample);
      const points = stroke?.points;
      if (!points) break;
      const last = points[points.length - 1];
      if (!last || Math.hypot(next.x - last.x, next.y - last.y) > 0.4) {
        points.push(next);
        drawLiveSegment(last, next, stroke);
      }
    }
    moveCountRef.current += 1;
  }

  function up(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'touch') {
      touchesRef.current.delete(event.pointerId);
      if (touchesRef.current.size < 2) gestureRef.current = null;
    }
    if (pointerRef.current !== event.pointerId) return;
    finishStroke(event.pointerType !== 'touch' || event.type === 'pointerup');
    setCounters((prev) => ({ ...prev, move: moveCountRef.current }));
    setStats({ type: event.pointerType, pressure: event.pressure, event: event.type });
  }

  function cancel(event: React.PointerEvent<HTMLDivElement>) {
    setCounters((prev) => ({ ...prev, cancel: prev.cancel + 1 }));
    up(event);
  }

  function lost(event: React.PointerEvent<HTMLDivElement>) {
    setCounters((prev) => ({ ...prev, lost: prev.lost + 1 }));
    if (pointerRef.current === event.pointerId) {
      // Losing capture must not discard a pen stroke. The next pointerdown can
      // safely start a new stroke after this recovery path has committed it.
      finishStroke(true);
      setCounters((prev) => ({ ...prev, move: moveCountRef.current }));
    }
    touchesRef.current.delete(event.pointerId);
    if (touchesRef.current.size < 2) gestureRef.current = null;
  }

  function undo() {
    if (pointerRef.current !== null) finishStroke(true);
    strokesRef.current = strokesRef.current.slice(0, -1);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(strokesRef.current)); } catch { /* storage unavailable */ }
    setRevision(strokesRef.current.length);
    redraw();
  }

  function clear() {
    if (!window.confirm('Очистить тестовый лист?')) return;
    if (pointerRef.current !== null) finishStroke(false);
    strokesRef.current = [];
    localStorage.removeItem(STORAGE_KEY);
    setRevision(0);
    redraw();
  }

  const zoom = (factor: number) => {
    setScale((current) => clamp(current * factor, 0.6, 4));
  };

  return (
    <main className="penlab">
      <header className="penlab-head">
        <div>
          <p className="eyebrow">Mindcrafti / development only</p>
          <h1>Pen Lab <span className="live">LIVE</span></h1>
          <p className="subtitle">Пиши на планшете — меняй код на компьютере. Никакого входа и домашки.</p>
        </div>
        <div className="diagnostics">
          <strong>Ввод: {stats.type}</strong>
          <span>{stats.event} · нажим: {stats.pressure.toFixed(2)}</span>
          <span>Штрихов: {revision} · down: {counters.down} · move: {counters.move}</span>
          <span>cancel: {counters.cancel} · lostcapture: {counters.lost}</span>
        </div>
      </header>
      <div className="toolbar">
        <button className={tool === 'pen' ? 'selected' : ''} onClick={() => setTool('pen')}>✎ Ручка</button>
        <button className={tool === 'eraser' ? 'selected' : ''} onClick={() => setTool('eraser')}>⌫ Ластик</button>
        <div className="colors">
          {palette.map((c) => <button key={c} className={color === c ? 'color active' : 'color'} title={c} aria-label={'Цвет ' + c} onClick={() => { setColor(c); setTool('pen'); }} style={{ background: c }} />)}
        </div>
        <label className="penlab-slider">Толщина <input type="range" min="1" max="18" value={size} onChange={(event) => setSize(Number(event.target.value))} /> {size}</label>
        <button onClick={undo} disabled={revision === 0}>↶ Назад</button>
        <button onClick={clear} disabled={revision === 0}>Очистить</button>
        <label className="finger"><input type="checkbox" checked={allowFinger} onChange={(event) => setAllowFinger(event.target.checked)} /> Писать пальцем</label>
        <div className="zoom">
          <button onClick={() => zoom(0.8)}>−</button>
          <span>{Math.round(scale * 100)}%</span>
          <button onClick={() => zoom(1.25)}>+</button>
          <button onClick={() => { setScale(1); setPanX(0); setPanY(0); }}>Сбросить</button>
        </div>
      </div>
      <div className="canvas-stage" ref={stageRef}>
        <div className="sheet" ref={surfaceRef} style={{ transform: 'translate(' + panX + 'px, ' + panY + 'px) scale(' + scale + ')' }}
          onPointerDown={down} onPointerMove={move} onPointerUp={up}
          onPointerCancel={cancel} onLostPointerCapture={lost}>
          <div className="sheet-lines" />
          <canvas ref={inkCanvasRef} width={WIDTH} height={HEIGHT} className="ink-layer" />
          <canvas ref={previewCanvasRef} width={WIDTH} height={HEIGHT} className="ink-layer" />
        </div>
      </div>
      <footer>Apple Pencil / Android stylus: пишут · Два пальца: масштабируют и двигают · Черновик сохраняется в этом браузере.</footer>
    </main>
  );
}

createRoot(document.getElementById('pen-lab-root')!).render(<StrictMode><PenLab /></StrictMode>);
