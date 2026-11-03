import { useRef, useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n/I18nContext';
import { AnswersButton } from './AnswersButton';
import { AnswersPanel } from './AnswersPanel';
import type { AnswersView } from './useAnswersPanel';
import { type PdfState, usePdfPage } from './usePdf';

vi.mock('./usePdf', () => ({ usePdfPage: vi.fn(() => null), usePdf: vi.fn() }));

class FakeResizeObserver {
  observe() {}
  disconnect() {}
}
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  vi.mocked(usePdfPage).mockReturnValue(null);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const ready = (pageCount = 12): PdfState => ({
  status: 'ready',
  doc: { pageCount, renderPage: vi.fn(), destroy: vi.fn() },
});

function renderPanel(pdf: PdfState, view: Partial<AnswersView> = {}, extra: Partial<React.ComponentProps<typeof AnswersPanel>> = {}) {
  const handlers = { onViewChange: vi.fn(), onScroll: vi.fn(), onClose: vi.fn() };
  const full: AnswersView = { page: 2, zoom: 1, scrollTop: 0, scrollLeft: 0, ...view };
  const rendered = render(
    <I18nProvider>
      <AnswersPanel pdf={pdf} view={full} getView={() => full} {...handlers} {...extra} />
    </I18nProvider>,
  );
  return { ...handlers, ...rendered };
}

function gestureFixture() {
  const frames = new Map<number, FrameRequestCallback>(); let sequence = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++sequence, callback); return sequence; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
  const raster = document.createElement('canvas'); raster.width = 600; raster.height = 800;
  vi.mocked(usePdfPage).mockReturnValue({ canvas: raster, aspect: .75 });
  const saved = vi.fn();
  function Viewer({ pdf, initial, tick: _tick = 0 }: { pdf: PdfState; initial: AnswersView; tick?: number }) {
    const [view, setView] = useState(initial), live = useRef(view);
    live.current = view;
    return <I18nProvider><AnswersPanel pdf={pdf} view={view} getView={() => live.current}
      onViewChange={patch => { live.current = { ...live.current, ...patch }; setView(live.current); saved(live.current); }}
      onScroll={(scrollTop, scrollLeft) => { live.current = { ...live.current, scrollTop, scrollLeft }; }} onClose={vi.fn()} /></I18nProvider>;
  }
  const pdf = ready(4), initial = { page: 0, zoom: 2, scrollTop: 220, scrollLeft: 120 };
  const view = render(<Viewer pdf={pdf} initial={initial} />);
  const scroll = view.container.querySelector('.answers-panel__scroll') as HTMLDivElement;
  const canvas = view.container.querySelector('.answers-panel__page') as HTMLCanvasElement;
  let left = initial.scrollLeft, top = initial.scrollTop;
  const size = () => ({ width: 300 * parseFloat(canvas.style.width) / 100, height: 300 * parseFloat(canvas.style.width) / 100 / Number(canvas.style.aspectRatio) });
  Object.defineProperties(scroll, {
    clientWidth: { value: 324 }, clientHeight: { value: 360 },
    scrollLeft: { get: () => left, set: (value: number) => { left = Math.max(0, Math.min(size().width + 24 - 324, value)); }, configurable: true },
    scrollTop: { get: () => top, set: (value: number) => { top = Math.max(0, Math.min(size().height + 36 - 360, value)); }, configurable: true },
  });
  vi.spyOn(canvas, 'getBoundingClientRect').mockImplementation(() => ({
    left: 64 - left, top: 101 - top, ...size(), right: 64 - left + size().width, bottom: 101 - top + size().height,
    x: 64 - left, y: 101 - top, toJSON: () => ({}),
  }));
  const point = (x: number, y: number) => {
    const rect = canvas.getBoundingClientRect(); return { x: (x - rect.left) / rect.width, y: (y - rect.top) / rect.height };
  };
  const touch = (type: string, x: number, y: number, distance: number) => {
    const points = [{ clientX: x - distance / 2, clientY: y }, { clientX: x + distance / 2, clientY: y }];
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'touches', { value: { length: type === 'touchend' ? 0 : 2, item: (index: number) => points[index] } });
    fireEvent(scroll, event);
  };
  const frame = () => act(() => { const next = [...frames.values()]; frames.clear(); next.forEach(callback => callback(0)); });
  return { ...view, scroll, canvas, saved, point, touch, frame, replaceRaster: () => {
    const sharper = document.createElement('canvas'); sharper.width = 2401; sharper.height = 3202;
    vi.mocked(usePdfPage).mockReturnValue({ canvas: sharper, aspect: .75 });
    view.rerender(<Viewer pdf={pdf} initial={initial} tick={1} />);
  } };
}

describe('AnswersButton', () => {
  it('opens the empty panel to add answers and explains the missing file in its title', async () => {
    const onToggle = vi.fn();
    render(
      <I18nProvider>
        <AnswersButton status="none" open={false} onToggle={onToggle} />
      </I18nProvider>,
    );
    const button = screen.getByRole('button', { name: 'Ответы' });
    expect(button).toBeEnabled(); expect(button).toHaveAttribute('title', 'Ответы не добавлены');
    await userEvent.click(button); expect(onToggle).toHaveBeenCalledOnce();
  });

  it('is active and toggles when answers exist', async () => {
    const onToggle = vi.fn();
    render(
      <I18nProvider>
        <AnswersButton status="available" open={false} onToggle={onToggle} />
      </I18nProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Ответы' }));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('is disabled while the lookup is still running', () => {
    render(
      <I18nProvider>
        <AnswersButton status="checking" open={false} onToggle={vi.fn()} />
      </I18nProvider>,
    );
    expect(screen.getByRole('button', { name: 'Ответы' })).toBeDisabled();
  });

  it('keeps the compact empty-state action accessible and disables only an unavailable lesson', () => {
    const { rerender } = render(<I18nProvider><AnswersButton compact status="none" open={false} onToggle={vi.fn()} /></I18nProvider>);
    expect(screen.getByRole('button', { name: 'Ответы' })).toBeEnabled();
    rerender(<I18nProvider><AnswersButton compact status="unavailable" open={false} onToggle={vi.fn()} /></I18nProvider>);
    expect(screen.getByRole('button', { name: 'Ответы' })).toBeDisabled();
  });
});

describe('AnswersPanel', () => {
  it('keeps the off-centre page point under moving fingers with existing scroll and padding', () => {
    const fixture = gestureFixture(), before = fixture.point(200, 230);
    fixture.touch('touchstart', 200, 230, 100);
    fixture.touch('touchmove', 200, 230, 125); fixture.frame();
    expect(fixture.point(200, 230).x).toBeCloseTo(before.x, 8);
    expect(fixture.point(200, 230).y).toBeCloseTo(before.y, 8);
    expect(fixture.canvas.style.width).toBe('250%');
    fixture.touch('touchmove', 224, 266, 125); fixture.frame();
    expect(fixture.point(224, 266).x).toBeCloseTo(before.x, 8);
    expect(fixture.point(224, 266).y).toBeCloseTo(before.y, 8);
    expect(fixture.saved.mock.lastCall![0]).toMatchObject({ zoom: 2.5, scrollTop: fixture.scroll.scrollTop, scrollLeft: fixture.scroll.scrollLeft });
    fixture.touch('touchend', 224, 266, 125);
    const position = { left: fixture.scroll.scrollLeft, top: fixture.scroll.scrollTop };
    fixture.replaceRaster();
    expect(fixture.scroll.scrollLeft).toBe(position.left); expect(fixture.scroll.scrollTop).toBe(position.top);
    expect(fixture.point(224, 266).x).toBeCloseTo(before.x, 8);
    expect(fixture.point(224, 266).y).toBeCloseTo(before.y, 8);
  });

  it('anchors a trackpad pinch at its cursor and stores actual clamped offsets at fit', () => {
    const fixture = gestureFixture(), before = fixture.point(210, 240);
    fireEvent.wheel(fixture.scroll, { ctrlKey: true, deltaY: -80, clientX: 210, clientY: 240 }); fixture.frame();
    expect(fixture.point(210, 240).x).toBeCloseTo(before.x, 8);
    expect(fixture.point(210, 240).y).toBeCloseTo(before.y, 8);
    for (let index = 0; index < 10; index++) fireEvent.wheel(fixture.scroll, { ctrlKey: true, deltaY: 100, clientX: 210, clientY: 240 });
    fixture.frame();
    expect(fixture.saved.mock.lastCall![0]).toMatchObject({ zoom: 1, scrollLeft: 0, scrollTop: fixture.scroll.scrollTop });
    expect(fixture.scroll.scrollTop).toBeGreaterThanOrEqual(0);
    expect(fixture.canvas.style.aspectRatio).toBe('0.75');
  });

  it('names the selected pupil and makes missing personal solutions explicit', () => {
    renderPanel({ status: 'idle' }, {}, { personal: true, studentName: 'Анна' });
    expect(screen.getByText('Решения: Анна')).toBeInTheDocument();
    expect(screen.getByText(/Для этого ученика решения ещё не загружены/)).toBeInTheDocument();
    expect(screen.getByText('Видны только преподавателю')).toBeInTheDocument();
    expect(screen.queryByText('Решения для учителя')).not.toBeInTheDocument();
  });

  it('closes from the × on its border', async () => {
    const handlers = renderPanel(ready());
    await userEvent.click(screen.getByRole('button', { name: 'Закрыть ответы' }));
    expect(handlers.onClose).toHaveBeenCalledOnce();
  });

  it('shows "3 / 12" and flips pages with the same arrows as the board', async () => {
    const handlers = renderPanel(ready(12));
    expect(screen.getByRole('status')).toHaveTextContent('3 / 12');
    await userEvent.click(screen.getByRole('button', { name: 'Следующая страница' }));
    expect(handlers.onViewChange).toHaveBeenCalledWith({ page: 3, scrollTop: 0 });
    await userEvent.click(screen.getByRole('button', { name: 'Предыдущая страница' }));
    expect(handlers.onViewChange).toHaveBeenCalledWith({ page: 1, scrollTop: 0 });
  });

  it('has no "add page" control — the answers file is read-only', () => {
    renderPanel(ready());
    expect(screen.queryByRole('button', { name: 'Добавить страницу' })).not.toBeInTheDocument();
  });

  it('zooms within its own limits', async () => {
    const handlers = renderPanel(ready(), { zoom: 1 });
    expect(screen.getByRole('button', { name: 'Уменьшить' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Увеличить' }));
    expect(handlers.onViewChange).toHaveBeenCalledWith({ zoom: 1.25 });
  });

  it('shows a loading and an error state', () => {
    const { unmount } = render(<div />);
    unmount();
    renderPanel({ status: 'loading' });
    expect(screen.getByText('Загрузка ответов…')).toBeInTheDocument();
  });

  it('reports an unreadable file without breaking the lesson', () => {
    renderPanel({ status: 'error', message: 'PDF parse failed' });
    expect(screen.getByRole('alert')).toHaveTextContent('Не удалось открыть файл ответов');
  });

  it('offers the first PDF upload in the empty panel and permits selecting the same file again', async () => {
    const user = userEvent.setup(), onUpload = vi.fn();
    renderPanel({ status: 'idle' }, {}, { onUpload });
    expect(screen.getByText('Добавьте PDF с решениями')).toBeInTheDocument();
    const input = screen.getByLabelText('PDF решений') as HTMLInputElement;
    const openPicker = vi.spyOn(input, 'click');
    await user.click(screen.getByRole('button', { name: 'Загрузить PDF решений' })); expect(openPicker).toHaveBeenCalledOnce();
    const file = new File(['%PDF'], 'solutions.pdf', { type: 'application/pdf' });
    await user.upload(input, file); await user.upload(input, file);
    expect(onUpload).toHaveBeenCalledTimes(2); expect(onUpload).toHaveBeenLastCalledWith(file); expect(input.value).toBe('');
    expect(screen.queryByRole('button', { name: 'Добавить страницу' })).not.toBeInTheDocument();
  });

  it('keeps the current PDF available while showing upload failures and busy state', () => {
    const { rerender } = renderPanel(ready(), {}, { onUpload: vi.fn(), uploadError: 'Не удалось загрузить решения' });
    expect(screen.getByRole('alert')).toHaveTextContent('Не удалось загрузить решения');
    expect(screen.getByRole('button', { name: 'Заменить PDF решений' })).toBeEnabled();
    expect(screen.getByLabelText('Страница 3 из 12', { selector: 'canvas' })).toBeInTheDocument();
    const view = { page: 2, zoom: 1, scrollTop: 0, scrollLeft: 0 };
    rerender(<I18nProvider><AnswersPanel pdf={ready()} view={view} getView={() => view} onViewChange={vi.fn()} onScroll={vi.fn()} onClose={vi.fn()} onUpload={vi.fn()} uploading /></I18nProvider>);
    expect(screen.getByRole('button', { name: 'Загрузка…' })).toBeDisabled(); expect(screen.getByLabelText('PDF решений')).toBeDisabled();
    expect(screen.getByLabelText('Страница 3 из 12', { selector: 'canvas' })).toBeInTheDocument();
  });

  it('does not render upload controls unless the caller provides the upload action', () => {
    renderPanel(ready()); expect(screen.queryByLabelText('PDF решений')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Заменить PDF решений' })).not.toBeInTheDocument();
  });

  it('resets both scroll offsets after a replacement document even when the page was already zero', () => {
    const first = ready(4), next = ready(2), view = { page: 0, zoom: 1, scrollTop: 340, scrollLeft: 20 };
    const { container, rerender, onScroll } = renderPanel(first, view);
    const scroll = container.querySelector('.answers-panel__scroll') as HTMLDivElement;
    fireEvent.scroll(scroll, { target: { scrollTop: 340, scrollLeft: 20 } }); expect(onScroll).toHaveBeenCalledWith(340, 20);
    const reset = { page: 0, zoom: 1, scrollTop: 0, scrollLeft: 0 };
    rerender(<I18nProvider><AnswersPanel pdf={next} view={reset} getView={() => reset} onViewChange={vi.fn()} onScroll={onScroll} onClose={vi.fn()} /></I18nProvider>);
    expect(scroll.scrollTop).toBe(0); expect(scroll.scrollLeft).toBe(0);
  });
});
