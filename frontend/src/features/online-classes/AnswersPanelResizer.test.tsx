import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n/I18nContext';
import { AnswersPanelResizer } from './AnswersPanelResizer';

let stageWidth = 1000;
let measure: ResizeObserverCallback;
function mount(teacher = 'teacher-1') {
  return render(<I18nProvider><div data-testid="stage">
    <aside id="answers-panel" /><AnswersPanelResizer storageKey={teacher} /><main />
  </div></I18nProvider>);
}
function pointer(type: string, x: number, pointerType = 'mouse', pointerId = 1) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, button: 0 });
  Object.defineProperties(event, {
    pointerId: { value: pointerId }, pointerType: { value: pointerType }, isPrimary: { value: true },
  });
  fireEvent(screen.getByRole('separator'), event);
}

describe('teacher answer panel width', () => {
  beforeEach(() => {
    stageWidth = 1000;
    localStorage.clear(); localStorage.setItem('language', 'RU');
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return { width: this.dataset.testid === 'stage' ? stageWidth : this.getAttribute('role') === 'separator' ? 12 : 204, height: 700,
        left: 0, top: 0, right: stageWidth, bottom: 700, x: 0, y: 0, toJSON: () => ({}) };
    });
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) { measure = callback; }
      observe() {} disconnect() {} unobserve() {}
    });
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it.each(['mouse', 'touch', 'pen'])('drags with %s and leaves space for the board', pointerType => {
    mount();
    pointer('pointerdown', 210, pointerType);
    pointer('pointermove', 506, pointerType);
    expect(screen.getByTestId('stage').style.getPropertyValue('--answers-panel-width')).toBe('500px');
    pointer('pointermove', 3000, pointerType);
    const width = Number(screen.getByRole('separator').getAttribute('aria-valuenow'));
    expect(stageWidth - width - 12).toBeGreaterThanOrEqual(260);
    pointer('pointerup', 3000, pointerType);
    expect(screen.getByTestId('stage')).not.toHaveClass('answers-panel-resizing');
  });

  it('restores the teacher preference across reopening, with a separate preference for another teacher', () => {
    const first = mount();
    pointer('pointerdown', 204); pointer('pointermove', 500); pointer('pointerup', 500);
    first.unmount();
    const another = mount('teacher-2');
    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '204');
    another.unmount(); mount();
    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '500');
  });

  it('fits a smaller window and restores the preferred width when the window grows', () => {
    mount();
    pointer('pointerdown', 204); pointer('pointermove', 600); pointer('pointerup', 600);
    stageWidth = 500;
    act(() => measure([], {} as ResizeObserver));
    expect(Number(screen.getByRole('separator').getAttribute('aria-valuenow'))).toBeLessThanOrEqual(240);
    stageWidth = 1000;
    act(() => measure([], {} as ResizeObserver));
    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '600');
  });

  it('supports keyboard resizing and cancels interrupted drags without saving a partial width', () => {
    mount();
    fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowRight' });
    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '228');
    pointer('pointerdown', 228); pointer('pointermove', 500);
    pointer('pointercancel', 500);
    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '228');
    fireEvent.keyDown(screen.getByRole('separator'), { key: 'End' });
    expect(Number(screen.getByRole('separator').getAttribute('aria-valuenow'))).toBeLessThanOrEqual(stageWidth - 260);
    fireEvent.keyDown(screen.getByRole('separator'), { key: 'Home' });
    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '180');
  });

  it('cleans up the temporary stage width and dragging state on close', () => {
    const view = mount();
    const stage = screen.getByTestId('stage');
    pointer('pointerdown', 204); pointer('pointermove', 400);
    view.unmount();
    expect(stage.style.getPropertyValue('--answers-panel-width')).toBe('');
    expect(stage).not.toHaveClass('answers-panel-resizing');
  });
});
