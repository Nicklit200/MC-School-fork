import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n/I18nContext';
import { AnswersButton } from './AnswersButton';
import { AnswersPanel } from './AnswersPanel';
import type { AnswersView } from './useAnswersPanel';
import type { PdfState } from './usePdf';

vi.mock('./usePdf', () => ({ usePdfPage: vi.fn(() => null), usePdf: vi.fn() }));

class FakeResizeObserver {
  observe() {}
  disconnect() {}
}
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
});

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
