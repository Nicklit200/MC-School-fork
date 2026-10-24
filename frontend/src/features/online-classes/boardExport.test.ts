import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnnotationDocument, AnnotationTargetType } from '../../api/onlineClasses';
import type { PdfDoc } from './pdfDocument';
import { exportBoardPdf } from './boardExport';

const mocks = vi.hoisted(() => ({
  list: vi.fn(), replay: vi.fn(), stages: [] as Record<string, any>[], images: [] as Record<string, any>[],
}));
vi.mock('../../api/onlineClasses', () => ({ onlineClassesApi: { listAnnotationDocuments: mocks.list, replayAnnotations: mocks.replay } }));
vi.mock('konva', () => {
  class Node {
    constructor(public attributes: Record<string, any> = {}) {}
    add(..._children: unknown[]) {}
  }
  return { default: {
    Stage: class extends Node {
      constructor(attributes: Record<string, any>) { super(attributes); mocks.stages.push(attributes); }
      toDataURL() { return 'data:image/jpeg;base64,/9j/2Q=='; }
      destroy() {}
    },
    Image: class extends Node { constructor(attributes: Record<string, any>) { super(attributes); mocks.images.push(attributes); } },
    Layer: Node, Rect: Node, Shape: Node, Line: Node, Arrow: Node, Ellipse: Node, Text: Node,
  } };
});

beforeEach(() => {
  vi.clearAllMocks(); mocks.stages.length = 0; mocks.images.length = 0;
  mocks.list.mockResolvedValue([]); mocks.replay.mockResolvedValue([]);
});

const options = { classId: 'class-1', targetType: 'WHITEBOARD' as const, targetId: 'board-1', pageCount: 1, pdfDocument: null };
function annotationDocument(targetType: AnnotationTargetType, sourceWidth: number, sourceHeight: number): AnnotationDocument {
  return { id: 'document-1', targetType, targetId: 'board-1', pageIndex: 0, sourceWidth, sourceHeight, revision: 0, snapshotSavedAt: null };
}
function readPdf(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsText(blob);
  });
}

describe('board PDF page geometry', () => {
  it('exports an unopened blank WHITEBOARD page in portrait A4 proportions', async () => {
    const blob = await exportBoardPdf(options);
    expect(mocks.stages).toHaveLength(1);
    expect(mocks.stages[0]).toMatchObject({ width: 1600, height: 2263 });
    expect(blob.type).toBe('application/pdf');
    const pdf = await readPdf(blob);
    expect(pdf).toContain('/Count 1');
    expect(pdf).toContain('/Width 1600 /Height 2263');
    expect(pdf).toContain('/MediaBox [0 0 1200 1697.25]');
  });

  it('keeps the actual PDF page geometry and exports a following blank page as A4', async () => {
    const canvas = document.createElement('canvas');
    const renderPage = vi.fn(async () => ({ canvas, aspect: 2 }));
    const pdfDocument: PdfDoc = { pageCount: 1, renderPage, destroy: vi.fn() };
    const blob = await exportBoardPdf({ ...options, pageCount: 2, pdfDocument });
    expect(renderPage).toHaveBeenCalledExactlyOnceWith(0, 1600);
    expect(mocks.stages.map(({ width, height }) => [width, height])).toEqual([[1600, 800], [1600, 2263]]);
    expect(mocks.images).toHaveLength(1);
    expect(mocks.images[0]).toMatchObject({ image: canvas, x: 0, y: 0, width: 1600, height: 800 });
    const pdf = await readPdf(blob);
    expect(pdf).toContain('/Count 2');
    expect(pdf).toContain('/MediaBox [0 0 1200 600]');
    expect(pdf).toContain('/MediaBox [0 0 1200 1697.25]');
  });

  it('respects a recorded source format instead of the blank-page fallback', async () => {
    mocks.list.mockResolvedValue([annotationDocument('WHITEBOARD', 1200, 800)]);
    await exportBoardPdf(options);
    expect(mocks.stages[0]).toMatchObject({ width: 1600, height: 1067 });
    expect(mocks.replay).toHaveBeenCalledWith('class-1', 'document-1', 0);
  });

  it.each(['SCREEN_SHARE', 'NOTEBOOK_CAMERA'] as const)('preserves the existing fallback and recorded aspect for %s', async targetType => {
    await exportBoardPdf({ ...options, targetType });
    expect(mocks.stages[0]).toMatchObject({ width: 1600, height: 900 });
    mocks.list.mockResolvedValue([annotationDocument(targetType, 720, 1280)]);
    await exportBoardPdf({ ...options, targetType });
    expect(mocks.stages[1]).toMatchObject({ width: 1600, height: 2844 });
  });
});
