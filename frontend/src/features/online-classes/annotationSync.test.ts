import { afterEach, describe, expect, it, vi } from 'vitest';
import { ANNOTATION_FLUSH_TIMEOUT_MS, confirmAnnotationWrite, flushClassAnnotations, hasPendingClassAnnotations, trackAnnotationWrite } from './annotationSync';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

afterEach(() => vi.useRealTimers());

describe('class annotation save barrier', () => {
  it('waits for only the current actor while another pupil still has an in-flight write', async () => {
    const alice = deferred(), bob = deferred();
    const first = trackAnnotationWrite('actor-pending', 'a', () => alice.promise, { actorId: 'alice' });
    const second = trackAnnotationWrite('actor-pending', 'b', () => bob.promise, { actorId: 'bob' });
    const done = vi.fn();
    const flushing = flushClassAnnotations('actor-pending', 'alice').then(done);
    expect(hasPendingClassAnnotations('actor-pending', 'alice')).toBe(true);
    alice.resolve(); await first; await flushing;
    expect(done).toHaveBeenCalledOnce();
    expect(hasPendingClassAnnotations('actor-pending', 'alice')).toBe(false);
    expect(hasPendingClassAnnotations('actor-pending', 'bob')).toBe(true);
    bob.resolve(); await second;
  });

  it('recovers failed pupil ADDs with stable closures without retrying another account', async () => {
    const alice = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const bob = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    await expect(trackAnnotationWrite('actor-failed', 'a', alice, { actorId: 'alice', scope: 'personal-a', operationType: 'ADD', retainOnFailure: true })).rejects.toThrow();
    await expect(trackAnnotationWrite('actor-failed', 'b', bob, { actorId: 'bob', scope: 'personal-b', operationType: 'ADD', retainOnFailure: true })).rejects.toThrow();
    await flushClassAnnotations('actor-failed', 'alice');
    expect(alice).toHaveBeenCalledTimes(2); expect(bob).toHaveBeenCalledOnce();
    expect(hasPendingClassAnnotations('actor-failed', 'alice')).toBe(false);
    expect(hasPendingClassAnnotations('actor-failed', 'bob')).toBe(true);
    await flushClassAnnotations('actor-failed', 'bob');
    expect(bob).toHaveBeenCalledTimes(2);
  });

  it('stops before retrying an old actor when the class or account changes during a pending request', async () => {
    const pending = deferred();
    let current = true;
    const write = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(undefined);
    const saving = trackAnnotationWrite('changed-actor', 'stroke', write, { actorId: 'alice', operationType: 'ADD', retainOnFailure: true });
    const savingRejected = expect(saving).rejects.toThrow('offline');
    const rejected = expect(flushClassAnnotations('changed-actor', 'alice', () => current)).rejects.toThrow('Контекст урока изменился');
    current = false;
    pending.reject(new Error('offline'));
    await savingRejected; await rejected;
    expect(write).toHaveBeenCalledOnce();
    expect(hasPendingClassAnnotations('changed-actor', 'alice')).toBe(true);
    current = true;
    await flushClassAnnotations('changed-actor', 'alice', () => current);
    expect(write).toHaveBeenCalledTimes(2);
  });

  it('waits for all page writes without waiting for another classroom', async () => {
    const first = deferred(), second = deferred(), other = deferred();
    const saves = [trackAnnotationWrite('all-pages', 'one', () => first.promise),
      trackAnnotationWrite('all-pages', 'two', () => second.promise), trackAnnotationWrite('other-room', 'three', () => other.promise)];
    const done = vi.fn();
    const flushing = flushClassAnnotations('all-pages').then(done);
    first.resolve(); await saves[0];
    expect(done).not.toHaveBeenCalled();
    second.resolve(); await flushing;
    expect(done).toHaveBeenCalledOnce();
    other.resolve(); await saves[2];
  });

  it('includes a write started while the preceding batch is being flushed', async () => {
    const first = deferred(), trailing = deferred();
    const savedFirst = trackAnnotationWrite('trailing-page', 'one', () => first.promise);
    const done = vi.fn();
    const flushing = flushClassAnnotations('trailing-page').then(done);
    const savedTrailing = trackAnnotationWrite('trailing-page', 'two', () => trailing.promise);
    first.resolve(); await savedFirst;
    await Promise.resolve();
    expect(done).not.toHaveBeenCalled();
    trailing.resolve(); await savedTrailing; await flushing;
    expect(done).toHaveBeenCalledOnce();
  });

  it('keeps a rejected write blocking until its same operation ID is successfully retried', async () => {
    await expect(trackAnnotationWrite('retry-page', 'stroke', async () => { throw new Error('offline'); })).rejects.toThrow('offline');
    await expect(flushClassAnnotations('retry-page')).rejects.toThrow('несохранённые');
    await expect(flushClassAnnotations('retry-page')).rejects.toThrow('несохранённые');
    await trackAnnotationWrite('retry-page', 'stroke', async () => undefined);
    await expect(flushClassAnnotations('retry-page')).resolves.toBeUndefined();
  });

  it('accepts authoritative replay when the server saved a write but its acknowledgement was lost', async () => {
    await expect(trackAnnotationWrite('lost-ack', 'stroke', async () => { throw new Error('lost response'); })).rejects.toThrow();
    confirmAnnotationWrite('different-room', 'stroke');
    await expect(flushClassAnnotations('lost-ack')).rejects.toThrow('несохранённые');
    confirmAnnotationWrite('lost-ack', 'stroke');
    await expect(flushClassAnnotations('lost-ack')).resolves.toBeUndefined();
  });

  it('has a bounded deadline without cancelling or resending a still-pending HTTP write', async () => {
    vi.useFakeTimers();
    const pending = deferred(), write = vi.fn(() => pending.promise);
    const saving = trackAnnotationWrite('slow-network', 'stroke', write);
    const rejected = expect(flushClassAnnotations('slow-network')).rejects.toThrow('ещё сохраняются');
    await vi.advanceTimersByTimeAsync(ANNOTATION_FLUSH_TIMEOUT_MS);
    await rejected;
    expect(write).toHaveBeenCalledOnce();
    pending.resolve(); await saving;
    await expect(flushClassAnnotations('slow-network')).resolves.toBeUndefined();
  });

  it('deduplicates a manual retry while the original HTTP request is still pending', async () => {
    const old = deferred(), duplicate = vi.fn(async () => undefined);
    const oldSave = trackAnnotationWrite('ordered-retry', 'stroke', () => old.promise);
    const newSave = trackAnnotationWrite('ordered-retry', 'stroke', duplicate);
    expect(newSave).toBe(oldSave);
    old.resolve(); await oldSave; await newSave;
    expect(duplicate).not.toHaveBeenCalled();
    await expect(flushClassAnnotations('ordered-retry')).resolves.toBeUndefined();
  });

  it('tracks synchronous persistence errors and succeeds immediately for an untouched class', async () => {
    await expect(flushClassAnnotations('untouched')).resolves.toBeUndefined();
    await expect(trackAnnotationWrite('sync-failure', 'stroke', () => { throw new Error('request failed'); })).rejects.toThrow();
    await expect(flushClassAnnotations('sync-failure')).rejects.toThrow('несохранённые');
    confirmAnnotationWrite('sync-failure', 'stroke');
  });

  it('retries the retained original closure once per explicit save and recovers on a later save', async () => {
    const write = vi.fn().mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new Error('still offline')).mockResolvedValue(undefined);
    await expect(trackAnnotationWrite('retained-retry', 'same-stroke', write)).rejects.toThrow();
    await expect(flushClassAnnotations('retained-retry')).rejects.toThrow('несохранённые');
    expect(write).toHaveBeenCalledTimes(2);
    await expect(flushClassAnnotations('retained-retry')).resolves.toBeUndefined();
    expect(write).toHaveBeenCalledTimes(3);
  });

  it.each(['CLEAR_ALL', 'CLEAR_LAYER', 'UNDO', 'UPDATE', 'ADD-erase'])('never replays a rolled-back destructive operation %s after newer ink', async kind => {
    const write = vi.fn(async () => { throw new Error('rejected'); });
    const options = { scope: 'page-1', actorId: 'teacher', documentId: () => 'document-1', retainOnFailure: false,
      operationType: kind === 'ADD-erase' ? 'ADD' : kind };
    const classId = `destructive-${kind}`;
    await expect(trackAnnotationWrite(classId, 'old-action', write, options)).rejects.toThrow();
    await trackAnnotationWrite(classId, 'new-ink', async () => undefined, { ...options, operationType: 'ADD', retainOnFailure: true });
    await expect(flushClassAnnotations(classId)).resolves.toBeUndefined();
    expect(write).toHaveBeenCalledOnce();
  });

  it.each(['CLEAR_ALL', 'CLEAR_LAYER'])('does not resurrect a failed ADD after an acknowledged %s', async operationType => {
    const classId = `cleared-failed-${operationType}`;
    const scope = { scope: 'page-1', actorId: 'teacher', documentId: () => 'document-1' };
    const add = vi.fn(async () => { throw new Error('offline'); });
    await expect(trackAnnotationWrite(classId, 'old-ink', add, { ...scope, operationType: 'ADD' })).rejects.toThrow();
    await trackAnnotationWrite(classId, 'clear', async () => undefined, { ...scope, operationType, retainOnFailure: false });
    await expect(flushClassAnnotations(classId)).resolves.toBeUndefined();
    expect(add).toHaveBeenCalledOnce();
  });

  it('does not retain an older pending ADD when it fails after an acknowledged clear', async () => {
    const pending = deferred(), add = vi.fn(() => pending.promise);
    const scope = { scope: 'page-1', actorId: 'teacher', documentId: () => 'document-1' };
    const saving = trackAnnotationWrite('cleared-pending', 'old-ink', add, { ...scope, operationType: 'ADD' }).catch(() => undefined);
    await trackAnnotationWrite('cleared-pending', 'clear', async () => undefined, { ...scope, operationType: 'CLEAR_ALL', retainOnFailure: false });
    pending.reject(new Error('late response')); await saving;
    await expect(flushClassAnnotations('cleared-pending')).resolves.toBeUndefined();
    expect(add).toHaveBeenCalledOnce();
  });

  it('requires the exact document and actor when replay confirms a reused operation ID', async () => {
    const scope = { scope: 'page-1', actorId: 'teacher', documentId: () => 'document-1' };
    const failing = async () => { throw new Error('offline'); };
    await expect(trackAnnotationWrite('ack-scope', 'same-id', failing, scope)).rejects.toThrow();
    for (const confirmation of [
      { scope: 'page-1', actorId: 'teacher', documentId: 'document-2' },
      { scope: 'page-1', actorId: 'pupil', documentId: 'document-1' },
      { scope: 'page-2', actorId: 'teacher', documentId: 'document-1' },
    ]) {
      confirmAnnotationWrite('ack-scope', 'same-id', confirmation);
      await expect(flushClassAnnotations('ack-scope')).rejects.toThrow('несохранённые');
    }
    confirmAnnotationWrite('ack-scope', 'same-id', { scope: 'page-1', actorId: 'teacher', documentId: 'document-1' });
    await expect(flushClassAnnotations('ack-scope')).resolves.toBeUndefined();
  });

  it('keeps identical operation IDs on different documents independent', async () => {
    const failing = async () => { throw new Error('offline'); };
    for (const page of ['one', 'two']) await expect(trackAnnotationWrite('same-id-pages', 'same-id', failing,
      { scope: page, actorId: 'teacher', documentId: () => `document-${page}` })).rejects.toThrow();
    confirmAnnotationWrite('same-id-pages', 'same-id', { scope: 'one', actorId: 'teacher', documentId: 'document-one' });
    await expect(flushClassAnnotations('same-id-pages')).rejects.toThrow('несохранённые');
    confirmAnnotationWrite('same-id-pages', 'same-id', { scope: 'two', actorId: 'teacher', documentId: 'document-two' });
    await expect(flushClassAnnotations('same-id-pages')).resolves.toBeUndefined();
  });

  it('verifies a lost clear acknowledgement before retrying old ink from an unmounted page', async () => {
    const scope = { scope: 'page', actorId: 'teacher', documentId: () => 'document' };
    const add = vi.fn(async () => { throw new Error('lost add'); });
    await expect(trackAnnotationWrite('lost-clear-proof', 'ink', add, { ...scope, operationType: 'ADD' })).rejects.toThrow();
    const clear = vi.fn(async () => { throw new Error('lost clear acknowledgement'); });
    const verify = vi.fn(async () => confirmAnnotationWrite('lost-clear-proof', 'clear',
      { scope: 'page', actorId: 'teacher', documentId: 'document', operationType: 'CLEAR_ALL', payload: '{}' }));
    await expect(trackAnnotationWrite('lost-clear-proof', 'clear', clear,
      { ...scope, operationType: 'CLEAR_ALL', payload: '{}', retainOnFailure: false, verify })).rejects.toThrow();
    await expect(flushClassAnnotations('lost-clear-proof')).resolves.toBeUndefined();
    expect(verify).toHaveBeenCalledOnce();
    expect(add).toHaveBeenCalledOnce(); expect(clear).toHaveBeenCalledOnce();
  });

  it('never retries old ADD while a later clear remains ambiguous; a new explicit clear can resolve it', async () => {
    const scope = { scope: 'page', actorId: 'teacher', documentId: () => 'document' };
    const add = vi.fn(async () => { throw new Error('offline'); });
    await expect(trackAnnotationWrite('ambiguous-clear', 'ink', add, { ...scope, operationType: 'ADD' })).rejects.toThrow();
    const clear = vi.fn(async () => { throw new Error('uncertain'); }), verify = vi.fn(async () => undefined);
    await expect(trackAnnotationWrite('ambiguous-clear', 'clear', clear,
      { ...scope, operationType: 'CLEAR_LAYER', retainOnFailure: false, verify })).rejects.toThrow();
    await expect(flushClassAnnotations('ambiguous-clear')).rejects.toThrow('Очистка доски не подтверждена');
    expect(add).toHaveBeenCalledOnce(); expect(clear).toHaveBeenCalledOnce(); expect(verify).toHaveBeenCalledOnce();
    await trackAnnotationWrite('ambiguous-clear', 'new-clear', async () => undefined,
      { ...scope, operationType: 'CLEAR_LAYER', retainOnFailure: false });
    await expect(flushClassAnnotations('ambiguous-clear')).resolves.toBeUndefined();
    expect(add).toHaveBeenCalledOnce();
  });
});
