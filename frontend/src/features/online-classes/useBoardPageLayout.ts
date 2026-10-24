import { useMemo, useSyncExternalStore } from 'react';

export type BoardPageLayout = 'continuous' | 'paged';

const STORAGE_PREFIX = 'mc.board.pageLayout:';
const DEFAULT_LAYOUT: BoardPageLayout = 'continuous';
type Listener = () => void;
interface LayoutStore {
  value: BoardPageLayout;
  listeners: Set<Listener>;
  subscribe: (listener: Listener) => () => void;
  getSnapshot: () => BoardPageLayout;
  setLayout: (layout: BoardPageLayout) => void;
}

// The memory value remains authoritative if a browser refuses storage writes.
// Sharing it also keeps separately mounted student boards in the same tab in sync.
const stores = new Map<string, LayoutStore>();
let observedWindow: Window | null = null;

function normalize(value: unknown): BoardPageLayout {
  return value === 'paged' ? 'paged' : DEFAULT_LAYOUT;
}

function localStorageOrNull(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; }
  catch { return null; }
}

function update(store: LayoutStore, layout: BoardPageLayout): void {
  if (store.value === layout) return;
  store.value = layout;
  store.listeners.forEach(listener => listener());
}

function onStorage(event: StorageEvent): void {
  const local = localStorageOrNull();
  if (event.storageArea && local && event.storageArea !== local) return;
  if (event.key === null) {
    stores.forEach(store => update(store, DEFAULT_LAYOUT));
    return;
  }
  if (!event.key.startsWith(STORAGE_PREFIX)) return;
  const store = stores.get(event.key.slice(STORAGE_PREFIX.length));
  if (store) update(store, normalize(event.newValue));
}

function observeStorage(): void {
  if (typeof window === 'undefined' || observedWindow === window) return;
  observedWindow?.removeEventListener('storage', onStorage);
  window.addEventListener('storage', onStorage);
  // Keep observing cached actors while no panel is open, so a later remount
  // sees changes made in another tab without discarding a memory fallback.
  observedWindow = window;
}

function storeFor(actorId: string): LayoutStore {
  observeStorage();
  const existing = stores.get(actorId);
  if (existing) return existing;
  const key = STORAGE_PREFIX + actorId;
  let initial = DEFAULT_LAYOUT;
  try { initial = normalize(localStorageOrNull()?.getItem(key)); }
  catch { /* A blocked getItem keeps the default until the user chooses. */ }
  const listeners = new Set<Listener>();
  const store: LayoutStore = {
    value: initial,
    listeners,
    subscribe: listener => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getSnapshot: () => store.value,
    setLayout: layout => {
      const next = normalize(layout);
      // Even a repeated choice retries persistence if storage has become usable.
      try { localStorageOrNull()?.setItem(key, next); }
      catch { /* Private browsing/quota restrictions retain the shared memory value. */ }
      update(store, next);
    },
  };
  stores.set(actorId, store);
  return store;
}

const serverSnapshot = (): BoardPageLayout => DEFAULT_LAYOUT;

export function useBoardPageLayout(actorId: string): readonly [BoardPageLayout, (layout: BoardPageLayout) => void] {
  const store = useMemo(() => storeFor(actorId), [actorId]);
  const layout = useSyncExternalStore(store.subscribe, store.getSnapshot, serverSnapshot);
  return [layout, store.setLayout] as const;
}
