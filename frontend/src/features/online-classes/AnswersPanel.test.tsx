import { render, screen } from '@testing-library/react';
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

function renderPanel(pdf: PdfState, view: Partial<AnswersView> = {}) {
  const handlers = { onViewChange: vi.fn(), onScroll: vi.fn(), onClose: vi.fn() };
  const full: AnswersView = { page: 2, zoom: 1, scrollTop: 0, scrollLeft: 0, ...view };
  render(
    <I18nProvider>
      <AnswersPanel pdf={pdf} view={full} getView={() => full} {...handlers} />
    </I18nProvider>,
  );
  return handlers;
}

describe('AnswersButton', () => {
  it('stays in place, inert, and says answers are missing', () => {
    render(
      <I18nProvider>
        <AnswersButton status="none" open={false} onToggle={vi.fn()} />
      </I18nProvider>,
    );
    const button = screen.getByRole('button', { name: 'Ответы не добавлены' });
    expect(button).toBeDisabled();
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
    renderPanel({ status: 'error' });
    expect(screen.getByRole('alert')).toHaveTextContent('Не удалось открыть файл ответов');
  });
});
