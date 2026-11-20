import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PostLessonHomeworkPdfCanvas } from './PostLessonHomeworkPdfCanvas';
import { openPdf } from '../../features/online-classes/pdfDocument';

vi.mock('../../features/online-classes/pdfDocument', () => ({ openPdf: vi.fn() }));

const api = vi.hoisted(() => ({
  destroy: vi.fn(),
  renderPage: vi.fn(),
}));

function testBlob(): Blob {
  return { arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(10)) } as unknown as Blob;
}

describe('post-lesson homework PDF preview on iPad', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.renderPage.mockImplementation(async () => ({
      canvas: document.createElement('canvas'), aspect: 0.7,
    }));
    vi.mocked(openPdf).mockResolvedValue({
      pageCount: 2,
      renderPage: api.renderPage,
      destroy: api.destroy,
    });
  });
  afterEach(() => cleanup());

  it('renders a real canvas rather than an empty blob iframe, and navigates PDF pages', async () => {
    const { container, unmount } = render(<PostLessonHomeworkPdfCanvas blob={testBlob()} />);
    const rendered = await screen.findByTestId('homework-pdf-page');
    await waitFor(() => expect(rendered.querySelector('canvas')).not.toBeNull());
    expect(container.querySelector('iframe')).toBeNull();
    expect(screen.getByText('Страницы: 2')).toBeInTheDocument();
    expect(api.renderPage).toHaveBeenCalledWith(0, expect.any(Number));

    fireEvent.click(screen.getByRole('button', { name: '→' }));
    await waitFor(() => expect(api.renderPage).toHaveBeenCalledWith(1, expect.any(Number)));
    fireEvent.click(screen.getByRole('button', { name: 'Увеличить PDF' }));
    await waitFor(() => expect(api.renderPage).toHaveBeenCalledWith(1, expect.any(Number)));
    unmount();
    expect(api.destroy).toHaveBeenCalled();
  });

  it('shows a helpful error when the PDF engine cannot open a file', async () => {
    vi.mocked(openPdf).mockRejectedValueOnce(new Error('Invalid PDF'));
    render(<PostLessonHomeworkPdfCanvas blob={testBlob()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось отобразить PDF');
    expect(screen.queryByTestId('homework-pdf-page')?.querySelector('canvas')).toBeNull();
  });

  it('does not attach the previous PDF canvas when a viewer has been unmounted', async () => {
    let finish!: (value: { canvas: HTMLCanvasElement; aspect: number }) => void;
    api.renderPage.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const { unmount } = render(<PostLessonHomeworkPdfCanvas blob={testBlob()} />);
    await waitFor(() => expect(api.renderPage).toHaveBeenCalled());
    unmount();
    finish({ canvas: document.createElement('canvas'), aspect: 0.7 });
    await Promise.resolve();
    expect(api.destroy).toHaveBeenCalled();
  });
});
