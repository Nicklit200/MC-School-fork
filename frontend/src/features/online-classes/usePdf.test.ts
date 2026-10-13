import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { type PdfDoc, widthBucket } from './pdfDocument';
import { usePdf, usePdfPage } from './usePdf';

function fakeDoc(pageCount = 3): PdfDoc & { destroy: ReturnType<typeof vi.fn> } {
  return {
    pageCount,
    renderPage: vi.fn(async (index: number) => ({
      canvas: { tag: `page-${index}` } as unknown as HTMLCanvasElement,
      aspect: 0.7,
    })),
    destroy: vi.fn(),
  };
}

describe('widthBucket', () => {
  it('rounds up so small resizes share a render', () => {
    expect(widthBucket(790)).toBe(800);
    expect(widthBucket(801)).toBe(1000);
    expect(widthBucket(10)).toBe(200);
  });
});

describe('usePdf', () => {
  it('stays idle without a key', () => {
    const { result } = renderHook(() => usePdf(null, vi.fn()));
    expect(result.current.status).toBe('idle');
  });

  it('loads and exposes the document', async () => {
    const doc = fakeDoc();
    const { result } = renderHook(() =>
      usePdf('k1', async () => new ArrayBuffer(8), async () => doc),
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
  });

  it('reports an error when the file cannot be fetched or parsed', async () => {
    const { result } = renderHook(() =>
      usePdf('k1', async () => { throw new Error('403'); }, async () => fakeDoc()),
    );
    await waitFor(() => expect(result.current.status).toBe('error'));
  });

  it('releases the document on unmount, and one that finishes late', async () => {
    const early = fakeDoc();
    const { result, unmount } = renderHook(() =>
      usePdf('k1', async () => new ArrayBuffer(8), async () => early),
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    unmount();
    expect(early.destroy).toHaveBeenCalled();

    const late = fakeDoc();
    let resolveOpen: (doc: PdfDoc) => void = () => {};
    const slow = renderHook(() =>
      usePdf('k2', async () => new ArrayBuffer(8), () => new Promise<PdfDoc>((resolve) => { resolveOpen = resolve; })),
    );
    // Let the fetch resolve so opening has started, then leave before it finishes.
    await act(async () => {
      await Promise.resolve();
    });
    slow.unmount();
    await act(async () => {
      resolveOpen(late);
    });
    expect(late.destroy).toHaveBeenCalled();
  });
});

describe('usePdfPage', () => {
  it('renders the requested page', async () => {
    const doc = fakeDoc();
    const { result } = renderHook(() => usePdfPage(doc, 1, 800));
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(doc.renderPage).toHaveBeenCalledWith(1, 800);
  });

  it('never shows the previous page while the next one renders', async () => {
    const doc = fakeDoc();
    const { result, rerender } = renderHook(({ index }) => usePdfPage(doc, index, 800), {
      initialProps: { index: 0 },
    });
    await waitFor(() => expect(result.current).not.toBeNull());
    rerender({ index: 2 });
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).not.toBeNull());
  });

  it('does nothing for a page past the end or a zero width', () => {
    const doc = fakeDoc(2);
    renderHook(() => usePdfPage(doc, 5, 800));
    renderHook(() => usePdfPage(doc, 0, 0));
    expect(doc.renderPage).not.toHaveBeenCalled();
  });
});
