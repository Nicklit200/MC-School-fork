import { describe, expect, it } from 'vitest';
import {
  annotationEvent,
  encodeEvent,
  MAX_PACKET_BYTES,
  parseClassEvent,
  viewEvent,
} from './events';

const classId = 'class-1';
const view = {
  boardId: 'board-1',
  page: 2,
  pageCount: 5,
  zoom: 2,
  panX: -0.5,
  panY: -0.25,
  follow: true,
};

describe('view events', () => {
  it('round-trips', () => {
    const event = viewEvent(classId, view);
    expect(parseClassEvent(encodeEvent(event), classId)).toEqual(event);
  });

  it.each([
    ['fractional page', { page: 1.5 }],
    ['negative page', { page: -1 }],
    ['zero page count', { pageCount: 0 }],
    ['zoom below 1', { zoom: 0.2 }],
    ['zoom above 5', { zoom: 9 }],
    ['positive pan', { panX: 0.3 }],
    ['non-numeric pan', { panY: 'x' }],
    ['missing follow flag', { follow: undefined }],
  ])('rejects %s', (_name, patch) => {
    const event = { ...viewEvent(classId, view), ...patch };
    expect(parseClassEvent(encodeEvent(event as never), classId)).toBeNull();
  });

  it('rejects another class', () => {
    expect(parseClassEvent(encodeEvent(viewEvent('other', view)), classId)).toBeNull();
  });
});

describe('annotation events', () => {
  const base = {
    documentId: 'doc-1',
    operationId: 'op-1',
    sequence: 7,
    op: 'ADD',
    layerOwnerId: 'u-1',
  };

  it('round-trips and stays far below the packet cap', () => {
    const event = annotationEvent(classId, base);
    expect(parseClassEvent(encodeEvent(event), classId)).toEqual(event);
    expect(encodeEvent(event).byteLength).toBeLessThan(MAX_PACKET_BYTES / 8);
  });

  it('rejects a malformed sequence', () => {
    const event = { ...annotationEvent(classId, base), sequence: -1 };
    expect(parseClassEvent(encodeEvent(event as never), classId)).toBeNull();
  });
});
