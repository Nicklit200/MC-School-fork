/** A stalled network request must not leave the exit dialog waiting forever. */
export const ANNOTATION_FLUSH_TIMEOUT_MS = 15_000;

export interface AnnotationWriteOptions {
  /** Exact target type/id/page; never the canonical My-board UI alias. */
  scope?: string;
  actorId?: string;
  documentId?: () => string | null;
  operationType?: string;
  payload?: string;
  /** Read-only reconciliation for a clear whose HTTP acknowledgement was lost. */
  verify?: () => Promise<void>;
  /** Only immutable ADD and idempotent document-open requests may be replayed. */
  retainOnFailure?: boolean;
}
interface Write {
  key: string;
  operationId: string;
  options: AnnotationWriteOptions;
  order: number;
  request: () => Promise<unknown>;
  status: 'pending' | 'failed';
  confirmed: boolean;
  promise: Promise<unknown>;
  settled: Promise<void>;
}
type ClearProof = Pick<Write, 'key' | 'options' | 'order'>;
interface ClassWrites { entries: Map<string, Write>; uncertainClears: Map<string, ClearProof>; nextOrder: number }
export interface AnnotationWriteResult {
  operationId: string;
  operationType?: string;
  documentId: string | null;
  value: unknown;
  /** This request was restarted by a class flush, after its original caller failed. */
  recovered: boolean;
}
type WriteListener = (result: AnnotationWriteResult) => void;
const listeners = new Map<string, Set<WriteListener>>();
const listenerKey = (classId: string, scope: string, actorId: string) => JSON.stringify([classId, scope, actorId]);

/** A remounted canvas can receive the acknowledgement of its original write.
 * Exact actor and surface/page scope prevent cross-account or cross-board UI. */
export function subscribeAnnotationWrites(classId: string, scope: string, actorId: string, listener: WriteListener): () => void {
  const key = listenerKey(classId, scope, actorId);
  let current = listeners.get(key);
  if (!current) { current = new Set(); listeners.set(key, current); }
  current.add(listener);
  return () => { current.delete(listener); if (!current.size && listeners.get(key) === current) listeners.delete(key); };
}

// Requests and their original closures outlive their canvas, including a failed
// ADD whose local Retry button disappeared when the teacher changed pupils.
const classes = new Map<string, ClassWrites>();
const keyOf = (operationId: string, options: Pick<AnnotationWriteOptions, 'scope' | 'actorId'>) => JSON.stringify([options.scope ?? '', options.actorId ?? '', operationId]);
function clean(classId: string, state: ClassWrites) {
  if (!state.entries.size && classes.get(classId) === state) classes.delete(classId);
}
function sameDocument(left: { options: AnnotationWriteOptions }, right: { options: AnnotationWriteOptions }) {
  if (left.options.scope !== right.options.scope) return false;
  const leftId = left.options.documentId?.(), rightId = right.options.documentId?.();
  return Boolean(leftId && rightId && leftId === rightId);
}
function clearAffects(clear: ClearProof, entry: Write) {
  return entry.order < clear.order && entry.options.operationType === 'ADD' && sameDocument(entry, clear)
    && (clear.options.operationType === 'CLEAR_ALL' || clear.options.actorId === entry.options.actorId);
}
function cancelClearedAdds(state: ClassWrites, clear: ClearProof) {
  if (clear.options.operationType !== 'CLEAR_ALL' && clear.options.operationType !== 'CLEAR_LAYER') return;
  for (const entry of state.entries.values()) {
    if (!clearAffects(clear, entry)) continue;
    // Never resurrect ink deliberately cleared after its failed save. An older
    // pending HTTP request remains awaited, but cannot become a retained retry.
    entry.options.retainOnFailure = false;
    entry.confirmed = true;
    if (entry.status === 'failed') state.entries.delete(entry.key);
  }
}
function start(classId: string, state: ClassWrites, entry: Write, recovered = false): Promise<unknown> {
  entry.status = 'pending';
  let resolve!: (value: unknown) => void, reject!: (error: unknown) => void;
  entry.promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  entry.settled = entry.promise.then(() => undefined, () => undefined);
  let requested: Promise<unknown>;
  try { requested = entry.request(); }
  catch (error) { requested = Promise.reject(error); }
  void requested.then(value => {
    if (state.entries.get(entry.key) === entry) {
      cancelClearedAdds(state, entry);
      state.entries.delete(entry.key);
      clean(classId, state);
    }
    const { scope, actorId } = entry.options;
    if (scope !== undefined && actorId) {
      const result: AnnotationWriteResult = { operationId: entry.operationId, operationType: entry.options.operationType,
        documentId: entry.options.documentId?.() ?? null, value, recovered };
      for (const listener of listeners.get(listenerKey(classId, scope, actorId)) ?? []) {
        // A local render or peer-hint failure must never retry an accepted write.
        try { listener(result); } catch { /* The server acknowledgement remains authoritative. */ }
      }
    }
    resolve(value);
  }, error => {
    if (state.entries.get(entry.key) === entry) {
      if (entry.confirmed || entry.options.retainOnFailure === false) {
        if (!entry.confirmed && (entry.options.operationType === 'CLEAR_ALL' || entry.options.operationType === 'CLEAR_LAYER')) {
          state.uncertainClears.set(entry.key, { key: entry.key, options: entry.options, order: entry.order });
        }
        state.entries.delete(entry.key);
      }
      else entry.status = 'failed';
      clean(classId, state);
    }
    reject(error);
  });
  return entry.promise;
}

/** Observe a write once. A manual retry while the same operation is in flight
 * joins its original request; an explicit flush retries retained failures with
 * the original closure/ID/payload, at most once per key per flush attempt. */
export function trackAnnotationWrite<T>(classId: string, operationId: string, request: () => Promise<T>, options: AnnotationWriteOptions = {}): Promise<T> {
  let state = classes.get(classId);
  if (!state) { state = { entries: new Map(), uncertainClears: new Map(), nextOrder: 0 }; classes.set(classId, state); }
  const key = keyOf(operationId, options);
  let entry = state.entries.get(key);
  if (entry?.status === 'pending') return entry.promise as Promise<T>;
  if (entry) { entry.request = request; entry.options = { ...options }; }
  else {
    entry = { key, operationId, options: { ...options }, order: ++state.nextOrder, request,
      status: 'pending', confirmed: false, promise: Promise.resolve(), settled: Promise.resolve() };
    state.entries.set(key, entry);
  }
  return start(classId, state, entry) as Promise<T>;
}

/** Only the matching server document and actor can confirm an uncertain write. */
export function confirmAnnotationWrite(classId: string, operationId: string,
  confirmation: { scope?: string; actorId?: string; documentId?: string; operationType?: string; payload?: string } = {}) {
  const state = classes.get(classId);
  if (!state) return;
  const key = keyOf(operationId, confirmation);
  const entry = state.entries.get(key), proof = state.uncertainClears.get(key);
  const candidate = entry ?? proof;
  if (!candidate) return;
  const expectedDocument = candidate.options.documentId?.();
  if (candidate.options.documentId && (!expectedDocument || expectedDocument !== confirmation.documentId)) return;
  if (candidate.options.operationType && candidate.options.operationType !== confirmation.operationType) return;
  if (candidate.options.payload !== undefined && candidate.options.payload !== confirmation.payload) return;
  cancelClearedAdds(state, candidate);
  state.uncertainClears.delete(key);
  if (!entry) { clean(classId, state); return; }
  entry.confirmed = true;
  entry.options.retainOnFailure = false;
  if (entry.status === 'failed') state.entries.delete(entry.key);
  clean(classId, state);
}

/** Whether this actor still has writes awaiting a server acknowledgement. */
export function hasPendingClassAnnotations(classId: string, actorId?: string): boolean {
  const state = classes.get(classId);
  return Boolean(state && [...state.entries.values()].some(write => actorId === undefined || write.options.actorId === actorId));
}

/** Wait for class writes, including unmounted pages. An optional actor keeps
 * reconnect/exit recovery isolated from another account in the same browser.
 * Only retained ADD/open failures are retried: replaying a rolled-back clear/update/undo later could
 * overwrite newer drawing. Persistent failures reject and may be retried by a
 * later flush; this helper generates no new operation ID or retry timer. */
export async function flushClassAnnotations(classId: string, actorId?: string, isCurrent: () => boolean = () => true): Promise<void> {
  const retried = new Set<string>();
  const verifiedClears = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Записи на доске ещё сохраняются. Проверьте соединение и повторите сохранение урока.')),
      ANNOTATION_FLUSH_TIMEOUT_MS);
  });
  try {
    for (;;) {
      if (!isCurrent()) throw new Error('Контекст урока изменился. Сохранение остановлено.');
      const state = classes.get(classId);
      if (!state) return;
      const own = [...state.entries.values()].filter(write => actorId === undefined || write.options.actorId === actorId);
      const pending = own.filter(write => write.status === 'pending');
      if (pending.length) {
        await Promise.race([Promise.all(pending.map(write => write.settled)), timeout]);
        continue;
      }
      const failed = own.filter(write => write.status === 'failed');
      const ambiguous = [...state.uncertainClears.values()].filter(clear => failed.some(write => clearAffects(clear, write)));
      const verify = ambiguous.filter(clear => !verifiedClears.has(clear.key) && clear.options.verify);
      if (verify.length) {
        for (const clear of verify) {
          if (!isCurrent()) throw new Error('Контекст урока изменился. Сохранение остановлено.');
          verifiedClears.add(clear.key);
          await Promise.race([clear.options.verify!(), timeout]);
        }
        continue;
      }
      if (ambiguous.length) throw new Error('Очистка доски не подтверждена. Откройте страницу и повторите очистку перед сохранением урока.');
      const retry = failed.filter(write => !retried.has(write.key));
      if (retry.length) {
        for (const write of retry) {
          if (!isCurrent()) throw new Error('Контекст урока изменился. Сохранение остановлено.');
          retried.add(write.key); void start(classId, state, write, true);
        }
        continue;
      }
      if (failed.length) throw new Error('Есть несохранённые записи на доске. Повторите сохранение урока перед выходом.');
      return;
    }
  } finally { clearTimeout(timer); }
}
