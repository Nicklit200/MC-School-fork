import { request, requestBlob } from './client';
import { parseInteractiveSpec, type InteractiveSpec } from '../features/online-classes/interactiveTemplates';

export interface KolinContext {
  targetType?: 'student' | 'group';
  studentId?: string;
  currentWorkbookPage?: number;
  format?: 'pdf' | 'interactive';
}

export interface KolinHistoryMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface KolinTranscriptContext {
  state: 'included' | 'empty' | 'unavailable';
  segmentCount: number;
  truncated: boolean;
  latestSegmentAt: string | null;
  fromMs: number | null;
  toMs: number | null;
  transcriptionActive: boolean;
}

export interface KolinWorksheet {
  id: string;
  studentId: string;
  studentName: string;
  taskCount: number;
  pageCount: number;
  state: 'READY' | 'ADDED';
  fromPage?: number;
  toPage?: number;
  interactive?: InteractiveSpec[];
}

export interface KolinResponse {
  type: 'text' | 'worksheet' | 'interactive';
  text: string;
  transcriptContext?: KolinTranscriptContext;
  worksheet?: KolinWorksheet;
}

/** Copy only server-owned artifact metadata, never a current board destination. */
export function parseKolinWorksheet(value: unknown): KolinWorksheet | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const source = value as Record<string, unknown>;
  if (typeof source.id !== 'string' || !source.id || typeof source.studentId !== 'string' || !source.studentId
      || typeof source.studentName !== 'string' || !source.studentName.trim()
      || source.state !== 'READY' && source.state !== 'ADDED') return;
  const positive = (item: unknown): item is number => typeof item === 'number' && Number.isSafeInteger(item) && item > 0;
  if (!positive(source.taskCount) || !positive(source.pageCount)) return;
  const from = source.fromPage, to = source.toPage;
  if (from != null && !positive(from) || to != null && !positive(to)
      || typeof from === 'number' && typeof to === 'number' && from > to) return;
  const interactive = source.interactive == null ? undefined : Array.isArray(source.interactive) ? source.interactive.map(parseInteractiveSpec) : [];
  if (interactive && (interactive.length<1 || interactive.length>5 || interactive.some(spec=>!spec) || interactive.length!==source.taskCount)) return;
  return { ...(interactive ? {interactive:interactive as InteractiveSpec[]} : {}), id: source.id, studentId: source.studentId, studentName: source.studentName,
    taskCount: source.taskCount, pageCount: source.pageCount, state: source.state,
    ...(typeof from === 'number' ? { fromPage: from } : {}), ...(typeof to === 'number' ? { toPage: to } : {}) };
}

/** Optional server metadata never prevents an otherwise valid text answer. */
export function parseKolinTranscriptContext(value: unknown): KolinTranscriptContext | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const source = value as Record<string, unknown>;
  if (source.state !== 'included' && source.state !== 'empty' && source.state !== 'unavailable') return;
  if (typeof source.segmentCount !== 'number' || !Number.isSafeInteger(source.segmentCount) || source.segmentCount < 0
      || typeof source.truncated !== 'boolean' || typeof source.transcriptionActive !== 'boolean') return;
  const offset = (item: unknown): item is number | null => item === null
    || typeof item === 'number' && Number.isSafeInteger(item) && item >= 0;
  if (!offset(source.fromMs) || !offset(source.toMs)
      || source.fromMs !== null && source.toMs !== null && source.fromMs > source.toMs) return;
  if (source.latestSegmentAt !== null && (typeof source.latestSegmentAt !== 'string'
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(source.latestSegmentAt)
      || !Number.isFinite(Date.parse(source.latestSegmentAt)))) return;
  return { state: source.state, segmentCount: source.segmentCount, truncated: source.truncated,
    latestSegmentAt: source.latestSegmentAt, fromMs: source.fromMs, toMs: source.toMs,
    transcriptionActive: source.transcriptionActive };
}

const base = (classId: string) => `/online-classes/${encodeURIComponent(classId)}/kolin`;
const worksheetPath = (classId: string, id: string) => `${base(classId)}/worksheets/${encodeURIComponent(id)}`;

export const kolinApi = {
  status: (classId: string) => request<{ configured: boolean }>('GET', `${base(classId)}/status`),
  send: (classId: string, text: string, history: KolinHistoryMessage[], context: KolinContext, clientMessageId?: string) =>
    request<KolinResponse>('POST', `${base(classId)}/messages`, {
      text,
      ...(clientMessageId ? { clientMessageId } : {}),
      history: history.slice(-8).map(message => ({ role: message.role, text: message.text })),
      context: {
        ...(context.format ? { format: context.format } : {}),
        ...(context.targetType ? { targetType: context.targetType } : {}),
        ...(context.studentId ? { studentId: context.studentId } : {}),
        ...(context.currentWorkbookPage !== undefined ? { currentWorkbookPage: context.currentWorkbookPage } : {}),
      },
    }),
  worksheetPreview: (classId: string, id: string) => requestBlob(`${worksheetPath(classId, id)}/preview`),
  worksheetPdf: (classId: string, id: string) => requestBlob(`${worksheetPath(classId, id)}/pdf`),
  appendWorksheet: (classId: string, id: string) => request<KolinWorksheet>('POST', `${worksheetPath(classId, id)}/append`),
};
