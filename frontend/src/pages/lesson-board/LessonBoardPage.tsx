import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { lessonBoardApi, type BoardAction, type BoardOperation, type BoardPoint } from '../../api/lessonBoard';

const BOARD_WIDTH = 1400;
const BOARD_HEIGHT = 900;
const PILOT_TEACHER_ID = '14e3c7c1-1fc8-41bd-858a-6c20efdd957a';

type Tool = 'pen' | 'eraser' | 'text';

function visibleOperations(operations: BoardOperation[]): BoardOperation[] {
  const clearIndex = operations.findLastIndex((operation) => operation.kind === 'CLEAR');
  const relevant = operations.slice(clearIndex + 1);
  const undone = new Set(
    relevant.filter((operation) => operation.kind === 'UNDO').map((operation) => {
      try { return Number((JSON.parse(operation.payload) as BoardAction).targetId); }
      catch { return -1; }
    }),
  );
  return relevant.filter(
    (operation) => ['STROKE', 'ERASE', 'TEXT'].includes(operation.kind) && !undone.has(operation.id),
  );
}

function renderAction(ctx: CanvasRenderingContext2D, action: BoardAction) {
  if (action.kind === 'TEXT') {
    if (typeof action.x !== 'number' || typeof action.y !== 'number') return;
    ctx.fillStyle = action.color ?? '#172033';
    ctx.font = `600 ${action.width ?? 28}px system-ui, sans-serif`;
    ctx.textBaseline = 'top';
    const lines = (action.text ?? '').split('\n').slice(0, 8);
    lines.forEach((line, index) => {
      ctx.fillText(line, action.x! * BOARD_WIDTH, action.y! * BOARD_HEIGHT + index * 38, BOARD_WIDTH * 0.95);
    });
    return;
  }
  if (action.kind !== 'STROKE' && action.kind !== 'ERASE') return;
  const points = action.points ?? [];
  if (points.length === 0) return;
  ctx.strokeStyle = action.kind === 'ERASE' ? '#FFFFFF' : (action.color ?? '#172033');
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = action.width ?? 4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(points[0].x * BOARD_WIDTH, points[0].y * BOARD_HEIGHT);
  for (const point of points.slice(1)) {
    ctx.lineTo(point.x * BOARD_WIDTH, point.y * BOARD_HEIGHT);
  }
  if (points.length === 1) {
    ctx.arc(points[0].x * BOARD_WIDTH, points[0].y * BOARD_HEIGHT, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.stroke();
  }
}

function renderBoard(canvas: HTMLCanvasElement | null,
                     operations: BoardOperation[], draft: BoardAction | null) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
  ctx.save();
  for (const operation of visibleOperations(operations)) {
    try {
      const payload = JSON.parse(operation.payload) as BoardAction;
      renderAction(ctx, payload);
    } catch {
      // Discard malformed legacy board operations without hiding the room.
    }
  }
  if (draft) renderAction(ctx, draft);
  ctx.restore();
}

function position(event: React.PointerEvent<HTMLCanvasElement>): BoardPoint {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
    y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
  };
}

export function LessonBoardPage() {
  const { eventId = '' } = useParams();
  const { user } = useAuth();
  const isTeacher = user?.role === 'TEACHER' && user.id === PILOT_TEACHER_ID;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const draftRef = useRef<BoardAction | null>(null);
  const operationRef = useRef<BoardOperation[]>([]);
  const cursorRef = useRef(0);
  const fetchingRef = useRef(false);

  const [operations, setOperations] = useState<BoardOperation[]>([]);
  const [title, setTitle] = useState('Онлайн-доска');
  const [meetUrl, setMeetUrl] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState('#172033');
  const [strokeWidth, setStrokeWidth] = useState(4);

  const mergeOperations = useCallback((newOperations: BoardOperation[]) => {
    if (!newOperations.length) return;
    const old = operationRef.current;
    const known = new Set(old.map((operation) => operation.id));
    const merged = old.concat(newOperations.filter((operation) => !known.has(operation.id)))
      .sort((a, b) => a.id - b.id);
    operationRef.current = merged;
    cursorRef.current = Math.max(cursorRef.current, merged[merged.length - 1]?.id ?? 0);
    setOperations(merged);
  }, []);

  const redraw = useCallback(() => {
    renderBoard(canvasRef.current, operationRef.current, draftRef.current);
  }, []);

  useEffect(() => {
    redraw();
  }, [operations, redraw]);

  useEffect(() => {
    let cancelled = false;
    operationRef.current = [];
    cursorRef.current = 0;
    setOperations([]);
    setReady(false);
    setError(null);

    const initialize = async () => {
      try {
        const snapshot = isTeacher
          ? await lessonBoardApi.start(eventId)
          : await lessonBoardApi.read(eventId, 0);
        if (cancelled) return;
        setTitle(snapshot.title);
        setMeetUrl(snapshot.meetUrl);
        mergeOperations(snapshot.operations);
        setReady(true);
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Не удалось открыть доску.');
      }
    };

    const poll = async () => {
      if (cancelled || fetchingRef.current || !cursorRef.current) return;
      fetchingRef.current = true;
      try {
        const snapshot = await lessonBoardApi.read(eventId, cursorRef.current);
        if (!cancelled) mergeOperations(snapshot.operations);
      } catch {
        // A transient connection problem must not destroy unsent work on the board.
      } finally {
        fetchingRef.current = false;
      }
    };

    void initialize();
    const interval = window.setInterval(() => void poll(), 900);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      draftRef.current = null;
    };
  }, [eventId, isTeacher, mergeOperations]);

  async function commit(action: BoardAction) {
    setWorking(true);
    setError(null);
    try {
      const saved = await lessonBoardApi.append(eventId, action);
      mergeOperations([saved]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Действие не сохранилось.');
    } finally {
      draftRef.current = null;
      setWorking(false);
      redraw();
    }
  }

  function pointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!ready || working) return;
    const point = position(event);
    if (tool === 'text') {
      const text = window.prompt('Введите текст для доски');
      if (text?.trim()) {
        void commit({ kind: 'TEXT', x: point.x, y: point.y,
          text: text.trim().slice(0, 240), color, width: 28 });
      }
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    draftRef.current = {
      kind: tool === 'eraser' ? 'ERASE' : 'STROKE',
      points: [point],
      color: tool === 'eraser' ? '#FFFFFF' : color,
      width: tool === 'eraser' ? Math.max(22, strokeWidth * 5) : strokeWidth,
    };
    redraw();
  }

  function pointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const draft = draftRef.current;
    if (!draft || !draft.points) return;
    const p = position(event);
    const previous = draft.points[draft.points.length - 1];
    if (Math.hypot(p.x - previous.x, p.y - previous.y) < 0.0015) return;
    if (draft.points.length >= 500) return;
    draft.points.push(p);
    redraw();
  }

  function pointerUp() {
    const draft = draftRef.current;
    if (!draft) return;
    void commit(draft);
  }

  async function undo() {
    const visible = visibleOperations(operationRef.current);
    const target = [...visible].reverse().find(
      (operation) => isTeacher || operation.actorId === user?.id,
    );
    if (target) await commit({ kind: 'UNDO', targetId: target.id });
  }

  async function clearBoard() {
    if (!isTeacher || !window.confirm('Очистить общую доску у всех участников?')) return;
    await commit({ kind: 'CLEAR' });
  }

  function exportPng() {
    if (!canvasRef.current) return;
    const a = document.createElement('a');
    a.href = canvasRef.current.toDataURL('image/png');
    a.download = 'mindcrafti-whiteboard.png';
    a.click();
  }

  function printPdf() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const pop = window.open('', '_blank');
    if (!pop) {
      setError('Разрешите всплывающие окна, чтобы сохранить доску в PDF.');
      return;
    }
    const doc = pop.document;
    doc.title = 'Mindcrafti whiteboard PDF';
    doc.body.style.margin = '0';
    doc.body.style.padding = '12mm';
    const image = doc.createElement('img');
    image.src = canvas.toDataURL('image/png');
    image.style.width = '100%';
    image.style.height = 'auto';
    image.onload = () => { pop.focus(); pop.print(); };
    doc.body.appendChild(image);
  }

  return (
    <div style={{ maxWidth: 1500, margin: '0 auto', padding: '12px 10px 24px' }}>
      <div style={{ display: 'flex', gap: 14, justifyContent: 'space-between',
        alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <div>
          <Link to={isTeacher ? '/teacher/lessons' : '/student/lessons'} className="muted">
            ← Назад к урокам
          </Link>
          <h1 style={{ margin: '8px 0 3px' }}>{title}</h1>
          <div className="muted" style={{ fontSize: 13 }}>
            Тестовая совместная доска · сохраняется автоматически · синхронизация около 1 сек.
          </div>
        </div>
        {meetUrl && (
          <a href={meetUrl} target="_blank" rel="noreferrer" className="btn btn--secondary">
            Открыть Google Meet
          </a>
        )}
      </div>

      {error && <div role="alert" className="banner banner--error" style={{ marginBottom: 12 }}>{error}</div>}
      {!ready && <div className="muted" style={{ marginBottom: 10 }}>Подключаем доску…</div>}

      <section className="panel" style={{ padding: 12, margin: 0 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8,
          alignItems: 'center', marginBottom: 12 }}>
          {(['pen', 'eraser', 'text'] as const).map((value) => (
            <button key={value} type="button"
              className={tool === value ? 'btn' : 'btn btn--secondary'}
              disabled={!ready || working}
              onClick={() => setTool(value)}>
              {value === 'pen' ? 'Ручка' : value === 'eraser' ? 'Ластик' : 'Текст'}
            </button>
          ))}
          <input type="color" aria-label="Цвет ручки" value={color}
            onChange={(e) => setColor(e.target.value)}
            style={{ height: 42, width: 48, border: 'none', background: 'transparent' }}/>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            Толщина
            <input type="range" min="2" max="12" value={strokeWidth}
              onChange={(e) => setStrokeWidth(Number(e.target.value))}/>
          </label>
          <button type="button" className="btn btn--ghost" disabled={!ready || working}
            onClick={() => void undo()}>Отменить</button>
          {isTeacher && (
            <button type="button" className="btn btn--ghost" disabled={!ready || working}
              onClick={() => void clearBoard()}>Очистить</button>
          )}
          <div style={{ flex: 1 }}/>
          <button type="button" className="btn btn--secondary" disabled={!ready}
            onClick={exportPng}>PNG</button>
          <button type="button" className="btn btn--secondary" disabled={!ready}
            onClick={printPdf}>Сохранить PDF</button>
        </div>

        <div style={{ background: '#e8edf4', padding: 5, borderRadius: 12,
          overflow: 'hidden', border: '1px solid #ccd5e2' }}>
          <canvas
            ref={canvasRef}
            width={BOARD_WIDTH}
            height={BOARD_HEIGHT}
            aria-label="Совместная доска урока"
            onPointerDown={pointerDown}
            onPointerMove={pointerMove}
            onPointerUp={pointerUp}
            onPointerCancel={pointerUp}
            style={{ display: 'block', width: '100%', height: 'auto',
              background: 'white', borderRadius: 8, cursor: tool === 'text' ? 'text' : 'crosshair',
              touchAction: 'none', userSelect: 'none' }}
          />
        </div>
        <div className="muted" style={{ padding: '10px 3px 2px', fontSize: 12 }}>
          Учитель и приглашённый ученик видят одинаковые записи. Видеосвязь пока проводится через Google Meet.
          {working ? ' Сохраняем…' : ''}
        </div>
      </section>
    </div>
  );
}
