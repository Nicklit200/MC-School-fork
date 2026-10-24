import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBoardPageLayout } from './useBoardPageLayout';

const key = (actor: string) => `mc.board.pageLayout:${actor}`;
let sequence = 0;
const actor = () => `page-layout-test-${++sequence}`;
function storageChange(storageKey: string | null, newValue: string | null, storageArea: Storage = window.localStorage) {
  window.dispatchEvent(new StorageEvent('storage', { key: storageKey, newValue, storageArea }));
}

describe('useBoardPageLayout', () => {
  beforeEach(() => { window.localStorage.clear(); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('defaults to continuous, restores a valid preference and ignores unknown stored values', () => {
    const fresh = actor(), saved = actor(), invalid = actor();
    window.localStorage.setItem(key(saved), 'paged');
    window.localStorage.setItem(key(invalid), 'future-layout');
    expect(renderHook(() => useBoardPageLayout(fresh)).result.current[0]).toBe('continuous');
    expect(renderHook(() => useBoardPageLayout(saved)).result.current[0]).toBe('paged');
    expect(renderHook(() => useBoardPageLayout(invalid)).result.current[0]).toBe('continuous');
  });

  it('synchronously updates two mounted consumers and persists exactly the actor-scoped choice', () => {
    const id = actor(), otherId = actor();
    const first = renderHook(() => useBoardPageLayout(id));
    const second = renderHook(() => useBoardPageLayout(id));
    const other = renderHook(() => useBoardPageLayout(otherId));
    act(() => first.result.current[1]('paged'));
    expect(first.result.current[0]).toBe('paged');
    expect(second.result.current[0]).toBe('paged');
    expect(other.result.current[0]).toBe('continuous');
    expect(window.localStorage.getItem(key(id))).toBe('paged');
    expect(window.localStorage.getItem(key(otherId))).toBeNull();
    act(() => second.result.current[1]('continuous'));
    expect(first.result.current[0]).toBe('continuous');
    expect(second.result.current[0]).toBe('continuous');
    expect(window.localStorage.getItem(key(id))).toBe('continuous');
  });

  it('switches actors without showing or writing the previous actor preference', () => {
    const firstActor = actor(), secondActor = actor();
    const view = renderHook(({ id }) => useBoardPageLayout(id), { initialProps: { id: firstActor } });
    act(() => view.result.current[1]('paged'));
    const setFirstActor = view.result.current[1];
    view.rerender({ id: secondActor });
    expect(view.result.current[0]).toBe('continuous');
    act(() => setFirstActor('continuous'));
    expect(view.result.current[0]).toBe('continuous');
    expect(window.localStorage.getItem(key(secondActor))).toBeNull();
    act(() => view.result.current[1]('paged'));
    view.rerender({ id: firstActor });
    expect(view.result.current[0]).toBe('continuous');
    expect(renderHook(() => useBoardPageLayout(secondActor)).result.current[0]).toBe('paged');
    expect(window.localStorage.getItem(key(firstActor))).toBe('continuous');
    expect(window.localStorage.getItem(key(secondActor))).toBe('paged');
  });

  it('applies localStorage events to every consumer of the matching actor and ignores sessionStorage/unrelated keys', () => {
    const id = actor(), otherId = actor();
    const first = renderHook(() => useBoardPageLayout(id));
    const second = renderHook(() => useBoardPageLayout(id));
    const other = renderHook(() => useBoardPageLayout(otherId));
    act(() => storageChange(key(id), 'paged'));
    expect(first.result.current[0]).toBe('paged');
    expect(second.result.current[0]).toBe('paged');
    expect(other.result.current[0]).toBe('continuous');
    act(() => {
      storageChange(key(id), 'continuous', window.sessionStorage);
      storageChange('mc.board.another-preference', 'continuous');
    });
    expect(first.result.current[0]).toBe('paged');
    act(() => storageChange(key(id), 'unknown'));
    expect(first.result.current[0]).toBe('continuous');
    act(() => storageChange(key(id), 'paged'));
    act(() => storageChange(key(id), null));
    expect(first.result.current[0]).toBe('continuous');
    act(() => {
      storageChange(key(id), 'paged');
      storageChange(key(otherId), 'paged');
      storageChange(null, null);
    });
    expect(first.result.current[0]).toBe('continuous');
    expect(second.result.current[0]).toBe('continuous');
    expect(other.result.current[0]).toBe('continuous');
  });

  it('keeps cross-tab changes for a cached actor even while its panels are unmounted', () => {
    const id = actor();
    const first = renderHook(() => useBoardPageLayout(id));
    first.unmount();
    act(() => storageChange(key(id), 'paged'));
    expect(renderHook(() => useBoardPageLayout(id)).result.current[0]).toBe('paged');
  });

  it('shares an actor-specific memory fallback when accessing localStorage itself is blocked', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError'); });
    const id = actor(), otherId = actor();
    const first = renderHook(() => useBoardPageLayout(id));
    const second = renderHook(() => useBoardPageLayout(id));
    expect(first.result.current[0]).toBe('continuous');
    expect(() => act(() => first.result.current[1]('paged'))).not.toThrow();
    expect(first.result.current[0]).toBe('paged');
    expect(second.result.current[0]).toBe('paged');
    first.unmount(); second.unmount();
    expect(renderHook(() => useBoardPageLayout(id)).result.current[0]).toBe('paged');
    expect(renderHook(() => useBoardPageLayout(otherId)).result.current[0]).toBe('continuous');
  });

  it('retains an unsaved choice across remounts when reads work but setItem exceeds the quota', () => {
    const id = actor();
    window.localStorage.setItem(key(id), 'continuous');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError'); });
    const first = renderHook(() => useBoardPageLayout(id));
    act(() => first.result.current[1]('paged'));
    expect(window.localStorage.getItem(key(id))).toBe('continuous');
    first.unmount();
    expect(renderHook(() => useBoardPageLayout(id)).result.current[0]).toBe('paged');
  });

  it('tolerates blocked getItem and retries persistence when storage becomes usable', () => {
    const id = actor();
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError'); });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError'); });
    const view = renderHook(() => useBoardPageLayout(id));
    expect(view.result.current[0]).toBe('continuous');
    act(() => view.result.current[1]('paged'));
    expect(view.result.current[0]).toBe('paged');
    get.mockRestore(); set.mockRestore();
    act(() => view.result.current[1]('paged'));
    expect(window.localStorage.getItem(key(id))).toBe('paged');
  });
});
