import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n/I18nContext';
import './answers-panel-resize.css';

const DEFAULT_WIDTH = 204;
const STORAGE_PREFIX = 'mindcrafti:answers-panel-width:v1:';

/** Changes only the teacher's layout. Board coordinates and PDF view state are independent. */
export function AnswersPanelResizer({ storageKey }: { storageKey: string }) {
  const { language } = useI18n();
  const separator = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLElement | null>(null);
  const preferred = useRef(DEFAULT_WIDTH);
  const current = useRef(DEFAULT_WIDTH);
  const drag = useRef<{ pointerId: number; x: number; width: number; preferred: number } | null>(null);
  const [size, setSize] = useState({ width: DEFAULT_WIDTH, min: 180, max: 740 });
  const key = STORAGE_PREFIX + storageKey;

  const apply = useCallback((requested: number) => {
    const parent = stage.current;
    if (!parent) return;
    const available = parent.getBoundingClientRect().width || parent.clientWidth || window.innerWidth;
    const dividerWidth = separator.current?.getBoundingClientRect().width || 12;
    const max = Math.max(180, Math.min(available * 0.8, available - 260 - dividerWidth));
    const min = Math.min(180, max);
    const width = Math.round(Math.max(min, Math.min(max, requested)));
    current.current = width;
    parent.style.setProperty('--answers-panel-width', `${width}px`);
    setSize(previous => previous.width === width && previous.min === min && previous.max === max
      ? previous : { width, min, max });
  }, []);

  const persist = useCallback(() => {
    try { localStorage.setItem(key, String(preferred.current)); } catch { /* Optional device preference. */ }
  }, [key]);

  const finish = useCallback((cancelled: boolean) => {
    const active = drag.current;
    if (!active) return;
    drag.current = null;
    stage.current?.classList.remove('answers-panel-resizing');
    if (cancelled) {
      preferred.current = active.preferred;
      apply(active.width);
    } else {
      preferred.current = current.current;
      persist();
    }
    const element = separator.current;
    if (element?.hasPointerCapture?.(active.pointerId)) element.releasePointerCapture(active.pointerId);
  }, [apply, persist]);

  useEffect(() => {
    const parent = separator.current?.parentElement;
    if (!parent) return;
    stage.current = parent;
    const previousWidth = parent.style.getPropertyValue('--answers-panel-width');
    preferred.current = DEFAULT_WIDTH;
    try {
      const saved = Number(localStorage.getItem(key));
      if (Number.isFinite(saved) && saved >= 100 && saved <= 5000) preferred.current = saved;
    } catch { /* Private browsing can disable storage. */ }
    const measure = () => apply(preferred.current);
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(parent);
    const cancel = () => finish(true);
    window.addEventListener('resize', measure);
    window.addEventListener('blur', cancel);
    return () => {
      drag.current = null;
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('blur', cancel);
      parent.classList.remove('answers-panel-resizing');
      if (previousWidth) parent.style.setProperty('--answers-panel-width', previousWidth);
      else parent.style.removeProperty('--answers-panel-width');
      stage.current = null;
    };
  }, [apply, finish, key]);

  return <div ref={separator} className="answers-panel-resizer" role="separator" tabIndex={0}
    aria-orientation="vertical" aria-controls="answers-panel"
    aria-label={language === 'DE' ? 'Breite der Lösungen ändern' : 'Изменить ширину решений'}
    aria-valuemin={Math.round(size.min)} aria-valuemax={Math.round(size.max)} aria-valuenow={size.width}
    aria-valuetext={`${size.width} px`}
    onPointerDown={event => {
      if (event.button !== 0 || event.isPrimary === false || !stage.current
          || getComputedStyle(stage.current).flexDirection === 'column') return;
      event.preventDefault(); event.stopPropagation();
      drag.current = { pointerId: event.pointerId, x: event.clientX, width: current.current, preferred: preferred.current };
      event.currentTarget.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture?.(event.pointerId);
      stage.current.classList.add('answers-panel-resizing');
    }}
    onPointerMove={event => {
      const active = drag.current;
      if (!active || event.pointerId !== active.pointerId) return;
      event.preventDefault(); event.stopPropagation();
      apply(active.width + event.clientX - active.x);
    }}
    onPointerUp={event => { if (drag.current?.pointerId === event.pointerId) finish(false); }}
    onPointerCancel={event => { if (drag.current?.pointerId === event.pointerId) finish(true); }}
    onLostPointerCapture={() => finish(true)}
    onDoubleClick={() => { preferred.current = DEFAULT_WIDTH; apply(DEFAULT_WIDTH); persist(); }}
    onKeyDown={event => {
      if (event.key === 'Escape') { finish(true); return; }
      const step = event.shiftKey ? 64 : 24;
      const requested = event.key === 'ArrowLeft' ? current.current - step
        : event.key === 'ArrowRight' ? current.current + step
          : event.key === 'Home' ? size.min : event.key === 'End' ? size.max : null;
      if (requested === null) return;
      event.preventDefault(); event.stopPropagation();
      apply(requested); preferred.current = current.current; persist();
    }} />;
}
