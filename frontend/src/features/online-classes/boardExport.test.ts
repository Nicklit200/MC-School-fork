import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnnotationDocument, AnnotationTargetType } from '../../api/onlineClasses';
import type { PdfDoc } from './pdfDocument';
import { exportBoardPdf, captureBoardPage } from './boardExport';
import type { Operation } from './annotations';

const mocks = vi.hoisted(() => ({
  version: vi.fn(), bytes: vi.fn(), openPdf: vi.fn(),
  list: vi.fn(), replay: vi.fn(), stages: [] as Record<string, any>[], images: [] as Record<string, any>[],
  lines: [] as { page: number; attributes: Record<string, any> }[],
}));
vi.mock('../../api/onlineClasses', () => ({ onlineClassesApi: { listAnnotationDocuments: mocks.list, replayAnnotations: mocks.replay,
  documentVersion: mocks.version, documentBytes: mocks.bytes } }));
vi.mock('./pdfDocument', () => ({ openPdf: mocks.openPdf }));
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
    Line: class extends Node { constructor(attributes: Record<string, any>) {
      super(attributes); mocks.lines.push({ page: mocks.stages.length - 1, attributes });
    } },
    Layer: Node, Rect: Node, Shape: Node, Arrow: Node, Ellipse: Node, Text: Node,
  } };
});

beforeEach(() => {
  vi.clearAllMocks(); mocks.stages.length = 0; mocks.images.length = 0; mocks.lines.length = 0;
  mocks.list.mockResolvedValue([]); mocks.replay.mockResolvedValue([]);
  mocks.version.mockReset().mockResolvedValue({ version: 4 }); mocks.bytes.mockResolvedValue(new ArrayBuffer(10));
});

const options = { classId: 'class-1', targetType: 'WHITEBOARD' as const, targetId: 'board-1', pageCount: 1, pdfDocument: null };

describe('Kolyn captures saved pupil work', () => {
  const pupil = '11111111-1111-4111-8111-111111111111', targetId = `personal-workbook-${pupil}`;
  function pdf() {
    const value = { pageCount: 4, renderPage: vi.fn(async () => ({ canvas: document.createElement('canvas'), aspect: 210 / 297 })), destroy: vi.fn() };
    mocks.openPdf.mockResolvedValue(value); return value;
  }
  it('combines page three of the correct PDF with only that page saved ink', async () => {
    const document = pdf();
    const entry = { ...annotationDocument('WHITEBOARD', 210, 297), targetId, pageIndex: 2, revision: 1 };
    mocks.list.mockResolvedValue([entry, { ...entry, id: 'another-pupil', targetId: 'personal-other' }]);
    mocks.replay.mockResolvedValue([lateLine(1)]);
    const shot = await captureBoardPage('class-1', pupil, targetId, 2, new Date().toISOString());
    expect(document.renderPage).toHaveBeenCalledExactlyOnceWith(2, 1600);
    expect(mocks.bytes).toHaveBeenCalledExactlyOnceWith('class-1', targetId);
    expect(mocks.replay).toHaveBeenCalledExactlyOnceWith('class-1', entry.id, 0);
    expect(mocks.images).toHaveLength(1); expect(mocks.lines).toHaveLength(1);
    expect(shot).toMatchObject({ studentId: pupil, pageNumber: 3, revision: 1, documentVersion: 4, scope: 'current_page', additionalPages: [] });
    expect(document.destroy).toHaveBeenCalledOnce();
  });
  it('reviews task 7 from physical page three without an active pupil microphone or page announcement', async () => {
    const document = pdf();
    const entry = { ...annotationDocument('WHITEBOARD', 210, 297), targetId, pageIndex: 2, revision: 1 };
    mocks.list.mockResolvedValue([entry]);
    mocks.replay.mockResolvedValue([lateLine(1)]);
    const shot = await captureBoardPage('class-1', pupil, '', 2, null, 'task_page');
    expect(document.renderPage).toHaveBeenCalledExactlyOnceWith(2, 1600);
    expect(mocks.replay).toHaveBeenCalledExactlyOnceWith('class-1', entry.id, 0);
    expect(mocks.lines).toHaveLength(1);
    expect(shot).toMatchObject({ studentId: pupil, pageNumber: 3, scope: 'task_page',
      observedAt: null, revision: 1, additionalPages: [] });
  });
  it('includes all PDF pages and appended handwritten pages in a workbook review', async () => {
    const document = pdf();
    mocks.list.mockResolvedValue([{ ...annotationDocument('WHITEBOARD', 210, 297), targetId, pageIndex: 4, revision: 1 }]);
    mocks.replay.mockResolvedValue([lateLine(1)]);
    const shot = await captureBoardPage('class-1', pupil, '', 0, new Date().toISOString(), 'workbook');
    expect(document.renderPage.mock.calls).toEqual([[0, 1600], [1, 1600], [2, 1600], [3, 1600]]);
    expect(shot.totalPageCount).toBe(5); expect(shot.additionalPages.map(page => page.pageNumber)).toEqual([2, 3, 4, 5]);
    expect(shot.additionalPages[3].revision).toBe(1); expect(mocks.lines).toHaveLength(1);
    expect(document.destroy).toHaveBeenCalledOnce();
  });
  it('reads the shared group document on page one without a student identifier', async () => {
    const document = pdf();
    const shot = await captureBoardPage('class-1', null, 'board-1', 0, null, 'first_page');
    expect(mocks.bytes).toHaveBeenCalledExactlyOnceWith('class-1', 'board-1');
    expect(document.renderPage).toHaveBeenCalledExactlyOnceWith(0, 1600);
    expect(shot).toMatchObject({ studentId: null, boardId: 'board-1', pageNumber: 1, scope: 'first_page' });
  });
  it('reads the inherited shared PDF but only the correct pupil ink', async () => {
    const document = pdf();
    mocks.version.mockImplementation(async (_classId: string, boardId: string) =>
      ({ version: boardId === targetId ? 0 : boardId === 'board-1' ? 7 : 4 }));
    const legacyBoard = 'personal-' + pupil;
    const entry = { ...annotationDocument('WHITEBOARD', 210, 297), targetId: legacyBoard, pageIndex: 0, revision: 1 };
    mocks.list.mockResolvedValue([entry, { ...entry, id: 'other-pupil', targetId: 'personal-other' }]);
    mocks.replay.mockResolvedValue([lateLine(1)]);
    const shot = await captureBoardPage('class-1', pupil, '', 0, null, 'first_page');
    expect(document.renderPage).toHaveBeenCalledExactlyOnceWith(0, 1600);
    expect(mocks.bytes).toHaveBeenCalledExactlyOnceWith('class-1', 'board-1');
    expect(mocks.lines).toHaveLength(1);
    expect(shot).toMatchObject({ studentId: pupil, boardId: legacyBoard, pageNumber: 1,
      documentVersion: 4, sharedDocumentVersion: 7, scope: 'first_page' });
  });
  it('rejects PDF replacement during capture instead of reviewing old questions with new ink', async () => {
    const document = pdf(); mocks.version.mockResolvedValueOnce({ version: 4 }).mockResolvedValueOnce({ version: 5 });
    await expect(captureBoardPage('class-1', pupil, targetId, 0, new Date().toISOString())).rejects.toThrow('source changed');
    expect(document.destroy).toHaveBeenCalledOnce();
  });
  it('never silently falls back to a shared workbook when the private PDF cannot be read', async () => {
    mocks.bytes.mockResolvedValueOnce(null);
    await expect(captureBoardPage('class-1', pupil, targetId, 0, new Date().toISOString())).rejects.toThrow('PDF unavailable');
    expect(mocks.bytes).toHaveBeenCalledExactlyOnceWith('class-1', targetId);
    expect(mocks.stages).toHaveLength(0);
  });
});
function annotationDocument(targetType: AnnotationTargetType, sourceWidth: number, sourceHeight: number): AnnotationDocument {
  return { id: 'document-1', targetType, targetId: 'board-1', pageIndex: 0, sourceWidth, sourceHeight, revision: 0, snapshotSavedAt: null };
}
function readPdf(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsText(blob);
  });
}

const replayOperation = (sequence: number, operationType: Operation['operationType'] = 'CLEAR_LAYER', payload = '{}', actorId = 'other'): Operation => ({
  operationId: `operation-${sequence}`, sequence, actorId, layerOwnerId: actorId, operationType, payload,
});
const lateLine = (sequence: number) => replayOperation(sequence, 'ADD',
  JSON.stringify({ kind: 'line', color: '#456abc', x1: .1, y1: .2, x2: .6, y2: .7 }), 'teacher');

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

  it('includes a freshly persisted blank personal page despite stale local page count', async () => {
    const targetId = 'personal-workbook-alice';
    mocks.list.mockResolvedValue([{ ...annotationDocument('WHITEBOARD', 210, 297), targetId, id: 'blank-page', pageIndex: 1 }]);
    const blob = await exportBoardPdf({ ...options, targetId });
    expect(mocks.stages).toHaveLength(2);
    expect(mocks.replay).toHaveBeenCalledExactlyOnceWith('class-1', 'blank-page', 0);
    expect(mocks.lines).toHaveLength(0);
    expect(await readPdf(blob)).toContain('/Count 2');
  });

  it('exports fresh later-page ink on its own page and excludes other private targets and invalid indices', async () => {
    const targetId = 'personal-workbook-alice';
    const later = { ...annotationDocument('WHITEBOARD', 210, 297), targetId, id: 'later-page', pageIndex: 3, revision: 1 };
    mocks.list.mockResolvedValue([
      later,
      { ...later, id: 'other-pupil', targetId: 'personal-workbook-bob', pageIndex: 8 },
      { ...later, id: 'my-board', targetId: 'personal-alice', pageIndex: 7 },
      { ...later, id: 'shared-board', targetId: 'board-1', pageIndex: 6 },
      { ...later, id: 'camera', targetType: 'NOTEBOOK_CAMERA', pageIndex: 5 },
      ...[-1, 1.5, 10000, Number.NaN, Number.POSITIVE_INFINITY].map((pageIndex, index) => ({ ...later, id: `invalid-${index}`, pageIndex })),
    ]);
    mocks.replay.mockImplementation(async (_classId: string, documentId: string) => documentId === 'later-page' ? [{
      operationId: 'ink', sequence: 1, actorId: 'teacher', layerOwnerId: 'teacher', operationType: 'ADD',
      payload: JSON.stringify({ kind: 'line', color: '#123abc', x1: .1, y1: .2, x2: .6, y2: .7 }),
    }] : []);
    const blob = await exportBoardPdf({ ...options, targetId });
    expect(mocks.stages).toHaveLength(4);
    expect(mocks.replay).toHaveBeenCalledExactlyOnceWith('class-1', 'later-page', 0);
    expect(mocks.lines).toEqual([{ page: 3, attributes: expect.objectContaining({ stroke: '#123abc' }) }]);
    expect(await readPdf(blob)).toContain('/Count 4');
  });

  it('keeps every original PDF page even when local annotation page count is stale', async () => {
    const canvas = document.createElement('canvas'), renderPage = vi.fn(async () => ({ canvas, aspect: 2 }));
    const pdfDocument: PdfDoc = { pageCount: 3, renderPage, destroy: vi.fn() };
    const blob = await exportBoardPdf({ ...options, pdfDocument });
    expect(renderPage.mock.calls).toEqual([[0, 1600], [1, 1600], [2, 1600]]);
    expect(mocks.images).toHaveLength(3);
    expect(await readPdf(blob)).toContain('/Count 3');
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

describe('complete annotation history in archived PDFs', () => {
  it('reads beyond 5000 operations to include the final stroke on a private page', async () => {
    const targetId = 'personal-workbook-alice';
    mocks.list.mockResolvedValue([{ ...annotationDocument('WHITEBOARD', 210, 297), targetId, revision: 5001 }]);
    const first = Array.from({ length: 5000 }, (_, index) => replayOperation(index + 1));
    mocks.replay.mockImplementation(async (_classId: string, _documentId: string, after: number) => after === 0 ? first : [lateLine(5001)]);
    await exportBoardPdf({ ...options, targetId });
    expect(mocks.replay.mock.calls.map(call => call[2])).toEqual([0, 5000]);
    expect(mocks.lines).toEqual([{ page: 0, attributes: expect.objectContaining({ stroke: '#456abc' }) }]);
  });

  it('applies a clear in the second batch instead of resurrecting an erased stroke', async () => {
    mocks.list.mockResolvedValue([{ ...annotationDocument('WHITEBOARD', 210, 297), revision: 5001 }]);
    const first = [lateLine(1), ...Array.from({ length: 4999 }, (_, index) => replayOperation(index + 2))];
    mocks.replay.mockResolvedValueOnce(first).mockResolvedValueOnce([replayOperation(5001, 'CLEAR_ALL', '{}', 'teacher')]);
    await exportBoardPdf(options);
    expect(mocks.replay.mock.calls.map(call => call[2])).toEqual([0, 5000]);
    expect(mocks.lines).toHaveLength(0);
  });

  it('reads the tail after a full batch even when metadata predates the last stroke', async () => {
    mocks.list.mockResolvedValue([{ ...annotationDocument('WHITEBOARD', 210, 297), revision: 1 }]);
    mocks.replay.mockResolvedValueOnce(Array.from({ length: 5000 }, (_, index) => replayOperation(index + 1)))
      .mockResolvedValueOnce([lateLine(5001)]);
    await exportBoardPdf(options);
    expect(mocks.replay).toHaveBeenCalledTimes(2);
    expect(mocks.lines).toHaveLength(1);
  });

  it('finishes at an empty tail when a page contains exactly one full batch', async () => {
    mocks.list.mockResolvedValue([{ ...annotationDocument('WHITEBOARD', 210, 297), revision: 5000 }]);
    mocks.replay.mockResolvedValueOnce(Array.from({ length: 5000 }, (_, index) => replayOperation(index + 1))).mockResolvedValueOnce([]);
    await exportBoardPdf(options);
    expect(mocks.replay.mock.calls.map(call => call[2])).toEqual([0, 5000]);
    expect(mocks.stages).toHaveLength(1);
  });

  it('keeps reading a short response until the advertised revision is reached', async () => {
    mocks.list.mockResolvedValue([{ ...annotationDocument('WHITEBOARD', 210, 297), revision: 2 }]);
    mocks.replay.mockResolvedValueOnce([replayOperation(1)]).mockResolvedValueOnce([lateLine(2)]);
    await exportBoardPdf(options);
    expect(mocks.replay.mock.calls.map(call => call[2])).toEqual([0, 1]);
    expect(mocks.lines).toHaveLength(1);
  });

  it.each(['missing-tail', 'repeated-sequence'])('rejects incomplete replay (%s) instead of exporting a misleading partial PDF', async failure => {
    mocks.list.mockResolvedValue([{ ...annotationDocument('WHITEBOARD', 210, 297), revision: 2 }]);
    mocks.replay.mockResolvedValueOnce([lateLine(1)])
      .mockResolvedValueOnce(failure === 'missing-tail' ? [] : [lateLine(1)]);
    await expect(exportBoardPdf(options)).rejects.toThrow('полностью прочитать');
    expect(mocks.replay).toHaveBeenCalledTimes(2);
    expect(mocks.stages).toHaveLength(0);
  });
});
