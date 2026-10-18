import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { onlineClassesApi } from '../../api/onlineClasses';
import { useBoardDocument } from './useBoardDocument';

vi.mock('../../api/onlineClasses', async () => {
  const actual = await vi.importActual<typeof import('../../api/onlineClasses')>('../../api/onlineClasses');
  return { ...actual, onlineClassesApi: { documentBytes: vi.fn(), documentVersion: vi.fn() } };
});

const doc = { pageCount: 3, renderPage: vi.fn(), destroy: vi.fn() };
vi.mock('./pdfDocument', () => ({
  openPdf: vi.fn(async () => doc),
  widthBucket: (w: number) => w,
}));

const api = vi.mocked(onlineClassesApi);

describe('useBoardDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.documentVersion.mockResolvedValue({ version: 1 });
  });

  it('yields the loaded workbook', async () => {
    api.documentBytes.mockResolvedValue(new ArrayBuffer(8));
    const { result } = renderHook(() => useBoardDocument('class-1'));
    await waitFor(() => expect(result.current).toBe(doc));
    expect(api.documentBytes).toHaveBeenCalledWith('class-1');
  });

  it('keeps the previous PDF visible while the next version is pending', async () => {
    api.documentBytes.mockResolvedValue(new ArrayBuffer(8));
    const { result } = renderHook(() => useBoardDocument('class-1'));
    await waitFor(() => expect(result.current).toBe(doc));
    let release!: (data: ArrayBuffer | null) => void;
    api.documentBytes.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    api.documentVersion.mockResolvedValue({ version: 2 });
    act(() => window.dispatchEvent(new Event('mc-workbook-updated')));
    await waitFor(() => expect(api.documentBytes).toHaveBeenCalledTimes(2));
    expect(result.current).toBe(doc);
    await act(async () => release(new ArrayBuffer(8)));
    await waitFor(() => expect(api.documentVersion).toHaveBeenCalled());
  });

  it('stays blank when the lesson has no workbook', async () => {
    api.documentVersion.mockResolvedValue({ version: 0 });
    api.documentBytes.mockResolvedValue(null);
    const { result } = renderHook(() => useBoardDocument('class-1'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current).toBeNull();
  });

  it('stays blank when the download fails', async () => {
    api.documentBytes.mockRejectedValue(new Error('500'));
    const { result } = renderHook(() => useBoardDocument('class-1'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current).toBeNull();
  });
});
