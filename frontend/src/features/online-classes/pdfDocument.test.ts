import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ width: 600, height: 840, render: vi.fn() }));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?worker', () => ({ default: class {} }));
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({ destroy: vi.fn(), promise: Promise.resolve({ numPages: 2, getPage: async () => ({
    getViewport: ({ scale }: { scale: number }) => ({ width: mock.width * scale, height: mock.height * scale }),
    render: (options: unknown) => ({ promise: mock.render(options) }),
  }) }) }),
}));
import { openPdf } from './pdfDocument';

describe('PDF raster memory at document zoom', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock.width = 600; mock.height = 840;
    mock.render.mockReset().mockResolvedValue(undefined);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D);
    vi.spyOn(window, 'devicePixelRatio', 'get').mockReturnValue(2);
  });
  it.each([[600, 840], [180, 3000], [3000, 180], [1000, 1000]])('bounds first retina render of %d × %d without changing page aspect', async (width, height) => {
    mock.width = width; mock.height = height;
    const pdf = await openPdf(new ArrayBuffer(0));
    const result = await pdf.renderPage(0, 9000);
    expect(result.aspect).toBe(width / height);
    expect(result.canvas.width).toBeLessThanOrEqual(3072); expect(result.canvas.height).toBeLessThanOrEqual(3072);
    expect(result.canvas.width * result.canvas.height).toBeLessThanOrEqual(6_000_000);
    expect(mock.render).toHaveBeenCalledOnce();
    const cached = await pdf.renderPage(0, 9000);
    expect(cached).toBe(result); expect(mock.render).toHaveBeenCalledOnce();
  });

  it('reuses recent width buckets and evicts the least recently used page raster without clearing its canvas', async () => {
    const pdf = await openPdf(new ArrayBuffer(0));
    const first = pdf.renderPage(0, 200);
    await first;
    const second = await pdf.renderPage(1, 400);
    const dimensions = { width: second.canvas.width, height: second.canvas.height };
    await pdf.renderPage(0, 600);
    await pdf.renderPage(0, 800);
    expect(pdf.renderPage(0, 199)).toBe(first); // Same bucket, now most recent.
    await pdf.renderPage(0, 1000);
    expect(mock.render).toHaveBeenCalledTimes(5);
    expect(pdf.renderPage(0, 200)).toBe(first);
    const rerendered = await pdf.renderPage(1, 400);
    expect(mock.render).toHaveBeenCalledTimes(6);
    expect(rerendered).not.toBe(second);
    expect(second.canvas.width).toBe(dimensions.width);
    expect(second.canvas.height).toBe(dimensions.height);
    expect(second.canvas.width * second.canvas.height).toBeGreaterThan(0);
  });

  it('retries a rejected cached render instead of keeping a failed promise', async () => {
    mock.render.mockRejectedValueOnce(new Error('Render failed'));
    const pdf = await openPdf(new ArrayBuffer(0));
    await expect(pdf.renderPage(0, 400)).rejects.toThrow('Render failed');
    const retry = pdf.renderPage(0, 400);
    await expect(retry).resolves.toMatchObject({ aspect: 600 / 840 });
    expect(pdf.renderPage(0, 400)).toBe(retry);
    expect(mock.render).toHaveBeenCalledTimes(2);
  });

  it('does not delete a replacement cache entry when an older evicted request rejects late', async () => {
    let rejectOld!: (error: Error) => void;
    let started!: () => void;
    const began = new Promise<void>(resolve => { started = resolve; });
    const oldRender = new Promise<void>((_resolve, reject) => { rejectOld = reject; });
    mock.render.mockImplementationOnce(() => { started(); return oldRender; });
    const pdf = await openPdf(new ArrayBuffer(0));
    const old = pdf.renderPage(0, 200);
    const oldFailure = old.catch(error => error);
    await began;
    for (const width of [400, 600, 800, 1000]) await pdf.renderPage(0, width);
    const replacement = pdf.renderPage(0, 200);
    await replacement;
    rejectOld(new Error('Old render failed'));
    expect(await oldFailure).toMatchObject({ message: 'Old render failed' });
    expect(pdf.renderPage(0, 200)).toBe(replacement);
    expect(mock.render).toHaveBeenCalledTimes(6);
  });
});
